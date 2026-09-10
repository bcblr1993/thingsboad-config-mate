/**
 * 集群聚合：把各节点的服务状态合并成一份带 nodeId 的列表。
 *
 * 设计原则：
 *   - 本机数据始终来自本地调用，不走 HTTP，避免自己请求自己
 *   - 远端节点并发拉取，单个节点失败不影响其余节点（降级为 offline）
 *   - 任何一个节点不可达都不能让整个服务列表接口失败——现场最怕的是
 *     一台机器出问题导致控制台整体打不开
 */

const DEFAULT_FETCH_TIMEOUT_MS = 5000;

function nodeOfflineEntry(node, message) {
    return {
        nodeId: node.id,
        nodeLabel: node.label || node.id,
        endpoint: node.endpoint,
        online: false,
        message,
        services: [],
        conflicts: []
    };
}

/** 给服务打上节点归属，并标注远端服务为只读。 */
function tagServices(services, node, { local }) {
    return (services || []).map(service => ({
        ...service,
        nodeId: node.id,
        nodeLabel: node.label || node.id,
        // 远端服务在阶段 1 只做只读展示，启停仍需登录对应节点。
        readOnly: local ? !!service.readOnly : true,
        remote: !local
    }));
}

function createClusterAggregator({
    nodeRegistry,
    localServicesProvider,
    fetchImpl = null,
    /* 远端节点结果的缓存时长。前端按秒级轮询，多开几个页面就会对每个节点
       重复发起聚合请求；缓存只作用于跨节点的 HTTP 结果，本机状态始终实时，
       因此不会出现「操作完看不到变化」。 */
    remoteCacheTtlMs = 2000,
    now = () => Date.now(),
    logger = console
}) {
    const doFetch = fetchImpl || globalThis.fetch;
    const remoteCache = new Map();
    // 同一节点的并发请求合并为一次，避免瞬时并发放大成 N 倍远端调用。
    const inflight = new Map();

    async function fetchNodeServices(node) {
        if (!doFetch) return nodeOfflineEntry(node, '当前运行环境不支持 HTTP 客户端');

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), nodeRegistry.getTimeoutMs() || DEFAULT_FETCH_TIMEOUT_MS);
        try {
            const res = await doFetch(`${node.endpoint}/api/cluster/services`, {
                method: 'GET',
                headers: nodeRegistry.clusterHeaders(),
                signal: controller.signal
            });
            if (!res.ok) {
                return nodeOfflineEntry(node, `节点返回 HTTP ${res.status}`);
            }
            const payload = await res.json();
            return {
                nodeId: node.id,
                nodeLabel: node.label || node.id,
                endpoint: node.endpoint,
                online: true,
                appType: payload.appType || '',
                appService: payload.appService || '',
                version: payload.version || '',
                services: tagServices(payload.services, node, { local: false }),
                conflicts: payload.conflicts || []
            };
        } catch (e) {
            const reason = e.name === 'AbortError' ? '连接超时' : e.message;
            logger.warn?.(`[Cluster] 节点 ${node.id} 不可达: ${reason}`);
            return nodeOfflineEntry(node, reason);
        } finally {
            clearTimeout(timer);
        }
    }

    /** 带缓存与并发合并的远端拉取。 */
    async function fetchNodeServicesCached(node) {
        const cached = remoteCache.get(node.id);
        if (cached && now() - cached.at < remoteCacheTtlMs) return cached.value;

        const pending = inflight.get(node.id);
        if (pending) return pending;

        const task = fetchNodeServices(node)
            .then(value => {
                remoteCache.set(node.id, { at: now(), value });
                return value;
            })
            .finally(() => inflight.delete(node.id));

        inflight.set(node.id, task);
        return task;
    }

    async function collectLocal(node) {
        const local = await localServicesProvider();
        return {
            nodeId: node?.id || 'local',
            nodeLabel: node?.label || node?.id || '本机',
            endpoint: node?.endpoint || '',
            online: true,
            local: true,
            appType: local.appType || '',
            appService: local.appService || '',
            services: tagServices(local.services, node || { id: 'local' }, { local: true }),
            conflicts: local.conflicts || []
        };
    }

    /**
     * 汇总所有节点。本机走本地调用，其余节点并发拉取。
     */
    async function collectAll() {
        const nodes = nodeRegistry.listNodes();
        const localId = nodeRegistry.getLocalNodeId();

        const results = await Promise.all(nodes.map(node => (
            node.id === localId ? collectLocal(node) : fetchNodeServicesCached(node)
        )));

        // 清单里没有标注本机时，仍要把本机数据并进来，否则会漏掉本地服务。
        if (!nodes.some(node => node.id === localId)) {
            results.unshift(await collectLocal(null));
        }

        const services = results.flatMap(entry => entry.services);
        const offline = results.filter(entry => !entry.online);

        return {
            nodes: results.map(({ services: _services, ...rest }) => rest),
            services,
            offlineNodeIds: offline.map(entry => entry.nodeId),
            degraded: offline.length > 0
        };
    }

    /**
     * 供依赖检查使用：跨节点判断某能力是否已满足。
     * 只要任意节点上有该 id 的服务处于 running，就视为满足。
     */
    async function collectRunningServiceIds() {
        const { services } = await collectAll();
        return services.filter(service => service.running).map(service => service.id);
    }

    /* 节点状态刚被改变时（如刚启动某个服务）可主动失效，避免读到旧缓存。 */
    function invalidateCache(nodeId = null) {
        if (nodeId) remoteCache.delete(nodeId);
        else remoteCache.clear();
    }

    return {
        collectAll,
        collectRunningServiceIds,
        fetchNodeServices,
        invalidateCache
    };
}

module.exports = {
    DEFAULT_FETCH_TIMEOUT_MS,
    createClusterAggregator,
    nodeOfflineEntry,
    tagServices
};
