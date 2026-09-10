/**
 * 集群路由，分两类：
 *
 * 1. Agent 侧（供其他节点调用，用 cluster token 鉴权，不需要 admin 会话）
 *      GET /api/cluster/services   本节点服务状态
 *      GET /api/cluster/ping       存活与身份
 *
 * 2. Console 侧（供浏览器调用，用 admin 会话鉴权）
 *      GET /api/nodes              节点清单与在线状态
 *      GET /api/nodes/services     跨节点聚合后的服务列表
 *
 * 未配置 nodes.yml 时全部不注册，单机行为完全不变。
 */

const { writeJson } = require('../http');

function createClusterRoutes({
    nodeRegistry,
    aggregator,
    localServicesProvider,
    appType,
    getPackageServiceId,
    version = '',
    logger = console
}) {
    /**
     * Agent 侧接口：走 cluster token，不依赖 admin 会话。
     * 必须在 admin 鉴权之前处理，否则会被 401 拦掉。
     */
    function handleAgent(req, res, { method, pathname, headers }) {
        if (!pathname.startsWith('/api/cluster/')) return false;

        if (!nodeRegistry.isEnabled()) {
            writeJson(res, 404, { status: 'error', message: '本节点未启用集群功能' }, headers);
            return true;
        }

        const verified = nodeRegistry.verifyClusterRequest(req);
        if (!verified.ok) {
            logger.warn?.(`[Cluster] 拒绝节点请求 path=${pathname} reason=${verified.reason}`);
            writeJson(res, 401, { status: 'error', code: verified.reason, message: '集群凭据校验失败' }, headers);
            return true;
        }

        if (pathname === '/api/cluster/ping' && method === 'GET') {
            writeJson(res, 200, {
                status: 'success',
                nodeId: nodeRegistry.getLocalNodeId(),
                clusterId: nodeRegistry.getClusterId(),
                appType,
                appService: getPackageServiceId(),
                version
            }, headers);
            return true;
        }

        if (pathname === '/api/cluster/services' && method === 'GET') {
            Promise.resolve(localServicesProvider())
                .then(local => writeJson(res, 200, {
                    status: 'success',
                    nodeId: nodeRegistry.getLocalNodeId(),
                    appType: local.appType,
                    appService: local.appService,
                    version,
                    services: local.services,
                    conflicts: local.conflicts
                }, headers))
                .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return true;
        }

        writeJson(res, 404, { status: 'error', message: 'Unknown cluster endpoint' }, headers);
        return true;
    }

    /** Console 侧接口：走 admin 会话。 */
    function handleConsole(req, res, { method, pathname, headers }) {
        if (pathname === '/api/nodes' && method === 'GET') {
            if (!nodeRegistry.isEnabled()) {
                writeJson(res, 200, {
                    status: 'success',
                    enabled: false,
                    message: nodeRegistry.getLoadError() || '未配置节点清单，当前为单机模式',
                    nodes: []
                }, headers);
                return true;
            }
            aggregator.collectAll()
                .then(result => writeJson(res, 200, {
                    status: 'success',
                    enabled: true,
                    clusterId: nodeRegistry.getClusterId(),
                    localNodeId: nodeRegistry.getLocalNodeId(),
                    degraded: result.degraded,
                    offlineNodeIds: result.offlineNodeIds,
                    nodes: result.nodes
                }, headers))
                .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return true;
        }

        if (pathname === '/api/nodes/services' && method === 'GET') {
            if (!nodeRegistry.isEnabled()) {
                writeJson(res, 200, { status: 'success', enabled: false, services: [], nodes: [] }, headers);
                return true;
            }
            aggregator.collectAll()
                .then(result => writeJson(res, 200, {
                    status: 'success',
                    enabled: true,
                    localNodeId: nodeRegistry.getLocalNodeId(),
                    degraded: result.degraded,
                    offlineNodeIds: result.offlineNodeIds,
                    nodes: result.nodes,
                    services: result.services
                }, headers))
                .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return true;
        }

        return false;
    }

    return { handleAgent, handleConsole };
}

module.exports = { createClusterRoutes };
