/**
 * 集群节点清单。
 *
 * Agent/Console 形态下，每个节点跑的都是同一个 Config Mate：
 *   - 没有 nodes.yml → 纯 Agent，行为与单机完全一致
 *   - 有 nodes.yml   → 同时兼任 Console，可聚合其他节点的状态
 *
 * 这样不引入新的部署单元，且任一节点单独访问时仍可自管——
 * Console 挂掉不影响现场对本机的操作。
 *
 * 节点间调用使用独立的 cluster token，与 admin 登录密码完全分离：
 * admin 密码是给人用的，cluster token 是给机器用的，泄露面和轮换周期都不同。
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_NODE_TIMEOUT_MS = 5000;

function normalizeEndpoint(value) {
    const text = String(value || '').trim().replace(/\/+$/, '');
    if (!text) return '';
    return /^https?:\/\//i.test(text) ? text : `http://${text}`;
}

function parseNodesConfig(raw, { yaml } = {}) {
    if (!raw || !String(raw).trim()) return null;

    let doc = null;
    try {
        doc = yaml ? yaml.load(raw) : JSON.parse(raw);
    } catch (e) {
        throw new Error(`节点清单解析失败: ${e.message}`);
    }
    if (!doc || typeof doc !== 'object') return null;

    const cluster = doc.cluster || {};
    const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];

    const normalized = nodes
        .map(node => ({
            id: String(node?.id || '').trim(),
            label: String(node?.label || node?.id || '').trim(),
            endpoint: normalizeEndpoint(node?.endpoint)
        }))
        .filter(node => node.id && node.endpoint);

    // 重复 id 会让聚合结果互相覆盖，属于配置错误而非可容忍的情况。
    const seen = new Set();
    normalized.forEach(node => {
        if (seen.has(node.id)) throw new Error(`节点清单存在重复 id: ${node.id}`);
        seen.add(node.id);
    });

    return {
        clusterId: String(cluster.id || '').trim(),
        token: String(cluster.token || '').trim(),
        localNodeId: String(doc.localNodeId || cluster.localNodeId || '').trim(),
        timeoutMs: Number(cluster.timeoutMs) > 0 ? Number(cluster.timeoutMs) : DEFAULT_NODE_TIMEOUT_MS,
        nodes: normalized
    };
}

function createNodeRegistry({
    nodesFile,
    yaml = null,
    env = process.env,
    logger = console
}) {
    let config = null;
    let loadError = '';

    function load() {
        if (config !== null) return config || null;

        try {
            const raw = nodesFile && fs.existsSync(nodesFile) ? fs.readFileSync(nodesFile, 'utf8') : '';
            const parsed = parseNodesConfig(raw, { yaml });
            if (!parsed || parsed.nodes.length === 0) {
                config = false;
                return null;
            }
            /* token 可以放在环境变量里，避免写进随包分发的文件。 */
            const token = env.CONFIG_MATE_CLUSTER_TOKEN || parsed.token;
            if (!token) {
                loadError = '节点清单缺少 cluster.token，集群功能未启用。';
                logger.warn?.(`[Cluster] ${loadError}`);
                config = false;
                return null;
            }
            config = { ...parsed, token };
            logger.log?.(`[Cluster] 已加载节点清单：${config.nodes.length} 个节点，本机 =${config.localNodeId || '未标注'}`);
            return config;
        } catch (e) {
            loadError = e.message;
            logger.error?.(`[Cluster] ${e.message}`);
            config = false;
            return null;
        }
    }

    /** 是否启用集群（Console）能力。未启用时所有集群接口都不注册。 */
    function isEnabled() {
        return !!load();
    }

    function getClusterId() {
        return load()?.clusterId || '';
    }

    function getToken() {
        return load()?.token || '';
    }

    function getTimeoutMs() {
        return load()?.timeoutMs || DEFAULT_NODE_TIMEOUT_MS;
    }

    function getLocalNodeId() {
        return load()?.localNodeId || '';
    }

    function listNodes() {
        return (load()?.nodes || []).map(node => ({ ...node, local: node.id === getLocalNodeId() }));
    }

    function getNode(id) {
        return listNodes().find(node => node.id === id) || null;
    }

    function getLoadError() {
        return loadError;
    }

    /** 校验来自其他节点的调用。 */
    function verifyClusterRequest(req) {
        const current = load();
        if (!current) return { ok: false, reason: 'CLUSTER_DISABLED' };

        const auth = String(req.headers?.authorization || '');
        const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        if (!token) return { ok: false, reason: 'MISSING_TOKEN' };

        const expected = Buffer.from(current.token, 'utf8');
        const actual = Buffer.from(token, 'utf8');
        if (expected.length !== actual.length) return { ok: false, reason: 'BAD_TOKEN' };
        // eslint-disable-next-line global-require
        if (!require('crypto').timingSafeEqual(expected, actual)) return { ok: false, reason: 'BAD_TOKEN' };

        /* 集群 id 不匹配说明配错了对端，放行会让两套环境的状态互相污染。 */
        const requestClusterId = String(req.headers?.['x-cluster-id'] || '').trim();
        if (current.clusterId && requestClusterId && requestClusterId !== current.clusterId) {
            return { ok: false, reason: 'CLUSTER_MISMATCH' };
        }
        return { ok: true };
    }

    function clusterHeaders() {
        return {
            Authorization: `Bearer ${getToken()}`,
            'X-Cluster-Id': getClusterId(),
            'Content-Type': 'application/json'
        };
    }

    return {
        clusterHeaders,
        getClusterId,
        getLoadError,
        getLocalNodeId,
        getNode,
        getTimeoutMs,
        getToken,
        isEnabled,
        listNodes,
        verifyClusterRequest
    };
}

module.exports = {
    DEFAULT_NODE_TIMEOUT_MS,
    createNodeRegistry,
    normalizeEndpoint,
    parseNodesConfig
};
