/**
 * Redis Cluster 只读探测。
 *
 * 与普通服务不同，redis-cluster 的 docker-compose.yml 不在交付包里，
 * 而是由 services/redis-cluster/redis-cluster.sh 在运维执行 `up N` 时
 * 按节点数动态生成，服务名为 redis1..redisN、host 网络、端口 7001 起。
 *
 * 因此这里同样按容器名发现，不依赖 compose 文件是否存在。
 */

const REDIS_CLUSTER_TIMEOUT_MS = 5000;
const REDIS_CLUSTER_SERVICE_ID = 'redis-cluster';

/* redis-cluster.sh 生成的 compose 位于 services/redis-cluster/，
   compose 默认项目名取目录名，故容器名形如 redis-cluster-redis1-1。 */
const CONTAINER_NAME_PATTERN = /^redis-cluster[-_]redis(\d+)[-_]\d+$/;

function parseClusterNodeName(name) {
    const match = String(name || '').replace(/^\//, '').match(CONTAINER_NAME_PATTERN);
    return match ? { container: String(name).replace(/^\//, ''), index: Number(match[1]) } : null;
}

/** 从 `docker ps --format {{.Names}}` 输出里挑出 redis-cluster 节点。 */
function parseClusterContainers(stdout) {
    return String(stdout || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(parseClusterNodeName)
        .filter(Boolean)
        .sort((a, b) => a.index - b.index);
}

/** 解析 `redis-cli cluster info` 的 key:value 输出。 */
function parseClusterInfo(stdout) {
    const info = {};
    String(stdout || '').split(/\r?\n/).forEach(line => {
        const text = line.trim();
        if (!text || text.startsWith('#')) return;
        const idx = text.indexOf(':');
        if (idx > 0) info[text.slice(0, idx)] = text.slice(idx + 1).trim();
    });
    return info;
}

/**
 * 解析 `redis-cli cluster nodes` 输出。
 * <id> <ip:port@bus> <flags> <master> <ping> <pong> <epoch> <link-state> [slots]
 */
function parseClusterNodes(stdout) {
    return String(stdout || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const parts = line.split(/\s+/);
            const flags = (parts[2] || '').split(',');
            return {
                id: (parts[0] || '').slice(0, 8),
                address: (parts[1] || '').split('@')[0],
                role: flags.includes('master') ? 'master' : (flags.includes('slave') ? 'replica' : ''),
                myself: flags.includes('myself'),
                linkState: parts[7] || '',
                slots: parts.slice(8).join(' ')
            };
        })
        .filter(node => node.id);
}

function createRedisClusterProbe({ docker, logger = console, timeoutMs = REDIS_CLUSTER_TIMEOUT_MS }) {
    function dockerExec(args) {
        return docker.exec(docker.dockerPath, args, { timeout: timeoutMs });
    }

    async function listClusterContainers() {
        // 包含未运行的容器，便于把「已部署但已停止」与「未部署」区分开。
        const result = await dockerExec(['ps', '-a', '--format', '{{.Names}}']);
        if (result.error) return [];
        return parseClusterContainers(result.stdout);
    }

    async function inspectNode(containerName) {
        const result = await dockerExec(['inspect', containerName]);
        if (result.error) return null;
        try {
            return JSON.parse(result.stdout || '[]')?.[0] || null;
        } catch (error) {
            logger.error?.(`[RedisCluster] Failed to parse inspect for ${containerName}: ${error.message}`);
            return null;
        }
    }

    /** 从容器 command 中取出监听端口与密码，用于后续 redis-cli 调用。 */
    function readNodeRuntime(inspectData) {
        const cmd = (inspectData?.Config?.Cmd || []).join(' ');
        const portMatch = cmd.match(/--port\s+(\d+)/);
        const passMatch = cmd.match(/--requirepass\s+(\S+)/);
        return {
            port: portMatch ? Number(portMatch[1]) : null,
            password: passMatch ? passMatch[1] : ''
        };
    }

    function redisCli(containerName, runtime, args) {
        const base = ['exec'];
        if (runtime.password) base.push('-e', `REDISCLI_AUTH=${runtime.password}`);
        base.push(containerName, 'redis-cli', '--no-auth-warning');
        if (runtime.port) base.push('-p', String(runtime.port));
        return dockerExec([...base, ...args]);
    }

    async function probe() {
        const containers = await listClusterContainers();
        if (containers.length === 0) {
            return {
                id: REDIS_CLUSTER_SERVICE_ID,
                label: 'Redis Cluster',
                exists: false,
                status: 'missing',
                running: false,
                nodes: []
            };
        }

        const nodeStates = [];
        let runningEntry = null;

        for (const item of containers) {
            const inspectData = await inspectNode(item.container);
            const running = !!inspectData?.State?.Running;
            const runtime = readNodeRuntime(inspectData);
            nodeStates.push({
                container: item.container,
                index: item.index,
                running,
                port: runtime.port,
                startedAt: inspectData?.State?.StartedAt || ''
            });
            if (running && !runningEntry) runningEntry = { container: item.container, runtime };
        }

        const runningCount = nodeStates.filter(node => node.running).length;
        const base = {
            id: REDIS_CLUSTER_SERVICE_ID,
            label: 'Redis Cluster',
            exists: true,
            running: runningCount > 0,
            status: runningCount === 0 ? 'stopped' : (runningCount === nodeStates.length ? 'running' : 'degraded'),
            nodeCount: nodeStates.length,
            runningCount,
            nodes: nodeStates
        };

        if (!runningEntry) return base;

        const [infoResult, nodesResult] = await Promise.all([
            redisCli(runningEntry.container, runningEntry.runtime, ['cluster', 'info']),
            redisCli(runningEntry.container, runningEntry.runtime, ['cluster', 'nodes'])
        ]);

        const info = infoResult.error ? {} : parseClusterInfo(infoResult.stdout);
        const clusterNodes = nodesResult.error ? [] : parseClusterNodes(nodesResult.stdout);

        return {
            ...base,
            clusterState: info.cluster_state || '',
            slotsAssigned: info.cluster_slots_assigned || '',
            knownNodes: info.cluster_known_nodes || '',
            clusterSize: info.cluster_size || '',
            clusterNodes
        };
    }

    async function discover() {
        const containers = await listClusterContainers();
        return containers.length > 0 ? [REDIS_CLUSTER_SERVICE_ID] : [];
    }

    return {
        discover,
        probe,
        listClusterContainers
    };
}

module.exports = {
    REDIS_CLUSTER_SERVICE_ID,
    createRedisClusterProbe,
    parseClusterContainers,
    parseClusterInfo,
    parseClusterNodeName,
    parseClusterNodes
};
