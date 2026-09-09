const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const { createNodeRegistry, normalizeEndpoint, parseNodesConfig } = require('../src/server/cluster/node-registry');
const { createClusterAggregator, tagServices } = require('../src/server/cluster/aggregator');
const { createDeploymentPlanner } = require('../src/server/services/deployment-plan');

function writeNodesFile(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cluster-'));
    const file = path.join(dir, 'nodes.yml');
    fs.writeFileSync(file, content);
    return file;
}

const SAMPLE_NODES = `
cluster:
  id: sprixin-prod
  token: test-cluster-token-abcdef
localNodeId: node-a
nodes:
  - id: node-a
    label: 业务机
    endpoint: http://10.8.8.157:3300
  - id: node-b
    label: 数据机
    endpoint: 10.8.8.235:3300
`;

/* ---- 节点清单 -------------------------------------------------------- */

test('endpoints are normalized with a default scheme', () => {
    assert.equal(normalizeEndpoint('10.8.8.235:3300'), 'http://10.8.8.235:3300');
    assert.equal(normalizeEndpoint('https://host:3300/'), 'https://host:3300');
    assert.equal(normalizeEndpoint(''), '');
});

test('duplicate node ids are rejected', () => {
    const raw = 'cluster:\n  id: x\n  token: t\nnodes:\n  - id: a\n    endpoint: h1:1\n  - id: a\n    endpoint: h2:2\n';
    // 重复 id 会让聚合结果互相覆盖，属于配置错误。
    assert.throws(() => parseNodesConfig(raw, { yaml }), /重复 id/);
});

test('cluster stays disabled without a nodes file', () => {
    const registry = createNodeRegistry({ nodesFile: '/tmp/does-not-exist.yml', yaml, env: {} });
    assert.equal(registry.isEnabled(), false);
    assert.deepEqual(registry.listNodes(), []);
});

test('cluster stays disabled when the token is missing', () => {
    const file = writeNodesFile('cluster:\n  id: x\nnodes:\n  - id: a\n    endpoint: h:1\n');
    const registry = createNodeRegistry({ nodesFile: file, yaml, env: {}, logger: { warn() {} } });
    // 没有 token 就没有节点间鉴权，宁可不启用也不能裸奔。
    assert.equal(registry.isEnabled(), false);
    assert.match(registry.getLoadError(), /token/);
});

test('a valid nodes file enables the cluster', () => {
    const registry = createNodeRegistry({ nodesFile: writeNodesFile(SAMPLE_NODES), yaml, env: {}, logger: { log() {} } });
    assert.equal(registry.isEnabled(), true);
    assert.equal(registry.getClusterId(), 'sprixin-prod');
    assert.equal(registry.getLocalNodeId(), 'node-a');

    const nodes = registry.listNodes();
    assert.equal(nodes.length, 2);
    assert.equal(nodes[0].local, true);
    assert.equal(nodes[1].local, false);
    assert.equal(nodes[1].endpoint, 'http://10.8.8.235:3300');
});

test('the token can be supplied via environment instead of the file', () => {
    const file = writeNodesFile('cluster:\n  id: x\nnodes:\n  - id: a\n    endpoint: h:1\n');
    const registry = createNodeRegistry({
        nodesFile: file,
        yaml,
        env: { CONFIG_MATE_CLUSTER_TOKEN: 'from-env-token' },
        logger: { log() {} }
    });
    assert.equal(registry.isEnabled(), true);
    assert.equal(registry.getToken(), 'from-env-token');
});

/* ---- 节点间鉴权 ------------------------------------------------------ */

function registryWithNodes() {
    return createNodeRegistry({ nodesFile: writeNodesFile(SAMPLE_NODES), yaml, env: {}, logger: { log() {} } });
}

test('cluster requests require a matching token', () => {
    const registry = registryWithNodes();
    const ok = registry.verifyClusterRequest({
        headers: { authorization: 'Bearer test-cluster-token-abcdef', 'x-cluster-id': 'sprixin-prod' }
    });
    assert.equal(ok.ok, true);

    assert.equal(registry.verifyClusterRequest({ headers: {} }).reason, 'MISSING_TOKEN');
    assert.equal(registry.verifyClusterRequest({ headers: { authorization: 'Bearer wrong' } }).reason, 'BAD_TOKEN');
    // 长度相同但内容不同，验证走的是内容比较而非长度判断。
    assert.equal(
        registry.verifyClusterRequest({ headers: { authorization: 'Bearer test-cluster-token-ABCDEF' } }).reason,
        'BAD_TOKEN'
    );
});

test('requests from a different cluster are rejected', () => {
    const registry = registryWithNodes();
    const result = registry.verifyClusterRequest({
        headers: { authorization: 'Bearer test-cluster-token-abcdef', 'x-cluster-id': 'other-cluster' }
    });
    // 配错对端会让两套环境的状态互相污染。
    assert.equal(result.reason, 'CLUSTER_MISMATCH');
});

/* ---- 聚合 ------------------------------------------------------------ */

test('remote services are tagged read-only, local ones keep their flag', () => {
    const node = { id: 'node-b', label: '数据机' };
    const remote = tagServices([{ id: 'postgres', readOnly: false }], node, { local: false });
    assert.equal(remote[0].readOnly, true, '远端服务阶段 1 只读');
    assert.equal(remote[0].remote, true);
    assert.equal(remote[0].nodeId, 'node-b');

    const local = tagServices([{ id: 'postgres', readOnly: false }], node, { local: true });
    assert.equal(local[0].readOnly, false);
    assert.equal(local[0].remote, false);
});

function aggregatorWith(fetchImpl, localServices = [{ id: 'iotcloud', running: true }]) {
    const registry = registryWithNodes();
    return createClusterAggregator({
        nodeRegistry: registry,
        localServicesProvider: async () => ({
            appType: 'CLOUD',
            appService: 'iotcloud',
            services: localServices,
            conflicts: []
        }),
        fetchImpl,
        logger: { warn() {} }
    });
}

test('collectAll merges local and remote services', async () => {
    const aggregator = aggregatorWith(async () => ({
        ok: true,
        json: async () => ({ appType: 'CLOUD', services: [{ id: 'postgres', running: true }], conflicts: [] })
    }));

    const result = await aggregator.collectAll();
    assert.equal(result.degraded, false);
    assert.deepEqual(result.services.map(s => `${s.nodeId}/${s.id}`), ['node-a/iotcloud', 'node-b/postgres']);
});

test('an unreachable node degrades instead of failing the whole request', async () => {
    const aggregator = aggregatorWith(async () => { throw new Error('ECONNREFUSED'); });

    const result = await aggregator.collectAll();
    // 一台机器出问题不能让控制台整体打不开。
    assert.equal(result.degraded, true);
    assert.deepEqual(result.offlineNodeIds, ['node-b']);
    assert.deepEqual(result.services.map(s => s.id), ['iotcloud'], '本机服务仍可见');

    const offline = result.nodes.find(n => n.nodeId === 'node-b');
    assert.equal(offline.online, false);
    assert.match(offline.message, /ECONNREFUSED/);
});

test('a node returning an HTTP error is treated as offline', async () => {
    const aggregator = aggregatorWith(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const result = await aggregator.collectAll();
    assert.equal(result.degraded, true);
    assert.match(result.nodes.find(n => n.nodeId === 'node-b').message, /503/);
});

test('collectRunningServiceIds spans every node', async () => {
    const aggregator = aggregatorWith(async () => ({
        ok: true,
        json: async () => ({ services: [{ id: 'postgres', running: true }, { id: 'kafka', running: false }] })
    }));

    const ids = await aggregator.collectRunningServiceIds();
    assert.deepEqual(ids.sort(), ['iotcloud', 'postgres']);
});

/* ---- 跨节点依赖判定 -------------------------------------------------- */

function plannerWithCluster(clusterRunningIds, localRunning = []) {
    const definitions = {
        postgres: { id: 'postgres', label: 'PostgreSQL', order: 10, exists: true },
        redis: { id: 'redis', label: 'Redis', order: 20, exists: true },
        iotcloud: { id: 'iotcloud', label: 'IoT Cloud', order: 90, exists: true }
    };
    return createDeploymentPlanner({
        appType: 'CLOUD',
        getPackageServiceId: () => 'iotcloud',
        getServiceDefinition: id => definitions[id],
        configProvider: () => ({ CACHE_TYPE: 'redis' }),
        getServiceStatus: async def => ({
            id: def.id,
            label: def.label,
            exists: true,
            running: localRunning.includes(def.id),
            status: localRunning.includes(def.id) ? 'running' : 'stopped'
        }),
        runComposeAction: async () => ({ status: 'success' }),
        collectClusterRunningServiceIds: async () => clusterRunningIds
    });
}

test('a dependency running on another node satisfies the check', async () => {
    /* 跨机部署：数据库和缓存在另一台机器上，本机只有 iotcloud。
       改造前这里会因为「本机查不到 postgres」而拦住启动。 */
    const planner = plannerWithCluster(['postgres', 'redis', 'iotcloud'], ['iotcloud']);
    const check = await planner.checkRequiredDependencies({ CACHE_TYPE: 'redis' });
    assert.equal(check.ok, true, `不应有缺失依赖，实际: ${JSON.stringify(check.missingDependencies)}`);
});

test('a dependency missing everywhere is still reported', async () => {
    const planner = plannerWithCluster(['iotcloud'], ['iotcloud']);
    const check = await planner.checkRequiredDependencies({ CACHE_TYPE: 'redis' });
    assert.equal(check.ok, false);
    assert.ok(check.missingDependencyIds.includes('postgres'));
});

test('cluster aggregation failure degrades to local-only checking', async () => {
    const definitions = { postgres: { id: 'postgres', label: 'PG', order: 10, exists: true } };
    const planner = createDeploymentPlanner({
        appType: 'CLOUD',
        getPackageServiceId: () => 'iotcloud',
        getServiceDefinition: id => definitions[id] || { id, label: id, order: 90, exists: true },
        configProvider: () => ({}),
        getServiceStatus: async def => ({ id: def.id, label: def.label, exists: true, running: true, status: 'running' }),
        runComposeAction: async () => ({ status: 'success' }),
        collectClusterRunningServiceIds: async () => { throw new Error('all nodes unreachable'); }
    });

    // 聚合失败不能让依赖检查整体抛错。
    const check = await planner.checkRequiredDependencies({});
    assert.equal(check.ok, true);
});

test('cluster matching uses the untrimmed candidate list', async () => {
    /* 真机验证踩到的坑：本机存在 HA 容器时，database 候选被裁剪为
       [postgres-ha, highgo-ha]，而另一台节点跑的是单机 postgres，
       id 对不上导致误判缺失。跨节点判定必须用全量候选。 */
    const { createServiceRegistry } = require('../src/server/services/registry');
    const registry = createServiceRegistry({ appRoot: '/tmp/none', appType: 'EDGE' });
    registry.setDiscoveredDynamicServices(['postgres-ha', 'highgo-ha']);

    // 本机候选被裁剪，不含单机 postgres
    assert.deepEqual(registry.listCapabilityServiceIds('database', 'postgres').sort(), ['highgo-ha', 'postgres-ha']);
    // 全量候选必须包含单机 postgres
    assert.ok(registry.listAllCapabilityServiceIds('database', 'postgres').includes('postgres'));

    const definitions = {
        'postgres-ha': { id: 'postgres-ha', label: 'PG HA', order: 11, exists: true, readOnly: true },
        'highgo-ha': { id: 'highgo-ha', label: '瀚高 HA', order: 12, exists: true, readOnly: true },
        iotedge: { id: 'iotedge', label: 'IoT Edge', order: 90, exists: true }
    };
    const planner = createDeploymentPlanner({
        appType: 'EDGE',
        getPackageServiceId: () => 'iotedge',
        getServiceDefinition: id => definitions[id] || { id, label: id, order: 50, exists: true },
        configProvider: () => ({}),
        getServiceStatus: async def => ({ ...def, running: def.id === 'iotedge', status: 'stopped' }),
        runComposeAction: async () => ({ status: 'success' }),
        listCapabilityServiceIds: registry.listCapabilityServiceIds,
        listAllCapabilityServiceIds: registry.listAllCapabilityServiceIds,
        // 另一台节点上跑的是单机 postgres
        collectClusterRunningServiceIds: async () => ['postgres', 'iotedge']
    });

    const check = await planner.checkRequiredDependencies({});
    assert.equal(check.ok, true, `另一节点的单机 postgres 应满足数据库依赖，实际缺失: ${JSON.stringify(check.missingDependencyIds)}`);
});

test('capability groups expose both trimmed and full candidate lists', () => {
    const { createServiceRegistry } = require('../src/server/services/registry');
    const registry = createServiceRegistry({ appRoot: '/tmp/none', appType: 'EDGE' });
    registry.setDiscoveredDynamicServices(['postgres-ha']);

    const planner = createDeploymentPlanner({
        appType: 'EDGE',
        getPackageServiceId: () => 'iotedge',
        getServiceDefinition: id => ({ id, label: id, order: 50, exists: true }),
        configProvider: () => ({}),
        getServiceStatus: async def => ({ ...def, running: true }),
        runComposeAction: async () => ({ status: 'success' }),
        listCapabilityServiceIds: registry.listCapabilityServiceIds,
        listAllCapabilityServiceIds: registry.listAllCapabilityServiceIds
    });

    const group = planner.buildDeploymentPlan({}).dependencyGroups.find(g => g.capability === 'database');
    assert.deepEqual(group.candidates, ['postgres-ha'], '本机候选应被裁剪');
    assert.ok(group.clusterCandidates.includes('postgres'), '集群候选应保留单机服务');
    assert.ok(group.clusterCandidates.includes('postgres-ha'));
});
