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
    logger = console
}) {
    const doFetch = fetchImpl || globalThis.fetch;

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
            node.id === localId ? collectLocal(node) : fetchNodeServices(node)
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

    return {
        collectAll,
        collectRunningServiceIds,
        fetchNodeServices
    };
}

module.exports = {
    DEFAULT_FETCH_TIMEOUT_MS,
    createClusterAggregator,
    nodeOfflineEntry,
    tagServices
};
