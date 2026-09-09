const assert = require('node:assert/strict');
const test = require('node:test');

const { createServiceRegistry, isDynamicServiceId } = require('../src/server/services/registry');
const { createServiceRuntime } = require('../src/server/services/runtime');
const { createCleanupService } = require('../src/server/services/cleanup');
const { createDynamicServiceConfigBuilder } = require('../src/server/services/dynamic-service-config');
const { serviceActionCodeToStatus } = require('../src/server/routes/services');

function createRegistry(appType = 'CLOUD') {
    return createServiceRegistry({ appRoot: '/tmp/does-not-exist', appType });
}

function createDockerMock() {
    return {
        dockerPath: '/usr/bin/docker',
        dockerComposeCmd: '/usr/bin/docker',
        composeArgsFor: (def, args) => ['compose', '-f', def.composeAbsPath, ...args],
        readyMessage: () => null,
        async exec() {
            return { stdout: '', stderr: '', error: null };
        }
    };
}

test('a site without HA sees exactly the original service list', () => {
    const registry = createRegistry();
    const ids = registry.listServiceDefinitions().map(def => def.id);

    // 未发现任何动态服务时，行为必须与改造前完全一致。
    assert.equal(ids.includes('postgres-ha'), false);
    assert.equal(ids.includes('highgo-ha'), false);
    assert.equal(ids.includes('redis-cluster'), false);
    assert.ok(ids.includes('postgres'));
    assert.deepEqual(registry.listConflictingServiceIds(), []);
});

test('discovered dynamic services join the list in order', () => {
    const registry = createRegistry();
    registry.setDiscoveredDynamicServices(['postgres-ha', 'redis-cluster']);

    const ids = registry.listServiceDefinitions().map(def => def.id);
    assert.ok(ids.includes('postgres-ha'));
    assert.ok(ids.includes('redis-cluster'));
    // postgres(10) -> postgres-ha(11) -> redis(20) -> redis-cluster(21)
    assert.ok(ids.indexOf('postgres-ha') > ids.indexOf('postgres'));
    assert.ok(ids.indexOf('redis-cluster') > ids.indexOf('redis'));
});

test('unknown ids cannot be injected into dynamic registration', () => {
    const registry = createRegistry();
    assert.deepEqual(registry.setDiscoveredDynamicServices(['postgres-ha', 'not-a-service']), ['postgres-ha']);
    assert.equal(isDynamicServiceId('not-a-service'), false);
});

test('HA services register under both CLOUD and EDGE', () => {
    // PG 与瀚高都可用于 iotcloud 和 iotedge，因此不能带 appType 过滤。
    ['CLOUD', 'EDGE'].forEach(appType => {
        const registry = createRegistry(appType);
        registry.setDiscoveredDynamicServices(['postgres-ha', 'highgo-ha']);
        const ids = registry.listServiceDefinitions().map(def => def.id);
        assert.ok(ids.includes('postgres-ha'), `postgres-ha missing for ${appType}`);
        assert.ok(ids.includes('highgo-ha'), `highgo-ha missing for ${appType}`);
    });
});

test('discovered HA reports the conflicting single-node database', () => {
    const registry = createRegistry();
    registry.setDiscoveredDynamicServices(['postgres-ha']);
    const conflicts = registry.listConflictingServiceIds();

    // 单机 postgres 与 HA 抢 5432 端口，必须在界面上提示互斥。
    assert.ok(conflicts.includes('postgres'));
    assert.ok(conflicts.includes('highgo-ha'));
});

test('dynamic services are marked existing only after discovery', () => {
    const registry = createRegistry();
    assert.equal(registry.getServiceDefinition('postgres-ha').exists, false);

    registry.setDiscoveredDynamicServices(['postgres-ha']);
    assert.equal(registry.getServiceDefinition('postgres-ha').exists, true);
    // 动态服务不依赖 compose 文件路径。
    assert.equal(registry.getServiceDefinition('postgres-ha').composeAbsPath, '');
});

test('runComposeAction refuses to start or stop a read-only service', async () => {
    const registry = createRegistry();
    registry.setDiscoveredDynamicServices(['postgres-ha', 'redis-cluster']);
    const runtime = createServiceRuntime({
        docker: createDockerMock(),
        getServiceDefinition: registry.getServiceDefinition
    });

    for (const id of ['postgres-ha', 'redis-cluster']) {
        for (const action of ['up', 'down', 'restart']) {
            const result = await runtime.runComposeAction(id, action);
            assert.equal(result.status, 'error', `${id}/${action} should be refused`);
            assert.equal(result.code, 'SERVICE_READ_ONLY');
        }
    }
});

test('read-only refusal maps to a client error, not a server error', () => {
    assert.equal(serviceActionCodeToStatus({ status: 'error', code: 'SERVICE_READ_ONLY' }), 400);
    assert.equal(serviceActionCodeToStatus({ status: 'success' }), 200);
});

test('normal services are unaffected by the read-only guard', async () => {
    const registry = createRegistry();
    const runtime = createServiceRuntime({
        docker: createDockerMock(),
        getServiceDefinition: registry.getServiceDefinition
    });

    // postgres 的 compose 文件在测试环境不存在，应落到原有的缺失分支，
    // 而不是被误判为只读。
    const result = await runtime.runComposeAction('postgres', 'up');
    assert.equal(result.status, 'error');
    assert.notEqual(result.code, 'SERVICE_READ_ONLY');
    assert.match(result.message, /Compose file not found/);
});

test('getServiceStatus routes dynamic services to their probe', async () => {
    const registry = createRegistry();
    registry.setDiscoveredDynamicServices(['postgres-ha']);

    const runtime = createServiceRuntime({
        docker: createDockerMock(),
        getServiceDefinition: registry.getServiceDefinition,
        haProbe: {
            async probe(id) {
                return { id, status: 'running', running: true, role: 'primary', vipHeld: true };
            }
        }
    });

    const status = await runtime.getServiceStatus(registry.getServiceDefinition('postgres-ha'));
    assert.equal(status.status, 'running');
    assert.equal(status.role, 'primary');
    assert.equal(status.vipHeld, true);
});

test('getServiceStatus surfaces docker unavailability for dynamic services', async () => {
    const registry = createRegistry();
    registry.setDiscoveredDynamicServices(['postgres-ha']);
    const docker = { ...createDockerMock(), readyMessage: () => 'Docker socket is not mounted.' };

    const runtime = createServiceRuntime({
        docker,
        getServiceDefinition: registry.getServiceDefinition,
        haProbe: { async probe() { throw new Error('should not be called'); } }
    });

    const status = await runtime.getServiceStatus(registry.getServiceDefinition('postgres-ha'));
    assert.equal(status.status, 'unknown');
    assert.match(status.message, /docker socket/i);
});

function createCleanup(registry) {
    return createCleanupService({
        appRoot: '/tmp/app-root',
        runtimeDir: '/tmp/app-root/.config-mate',
        backupRoot: '/tmp/app-root/services/config-mate/backups',
        auditLogFile: '/tmp/app-root/services/config-mate/backups/audit.log',
        cleanupServiceDataDirs: {
            postgres: 'services/postgres/data',
            'postgres-ha': 'services/postgres/data'
        },
        cleanupServiceDataDirModes: {},
        getServiceDefinition: registry.getServiceDefinition,
        getPackageServiceId: registry.getPackageServiceId,
        getServiceStatus: async () => ({ running: false }),
        docker: createDockerMock(),
        logger: { log() {}, error() {} }
    });
}

test('cleanup plan refuses HA and points at the right runbook', () => {
    const registry = createRegistry();
    registry.setDiscoveredDynamicServices(['postgres-ha']);

    const plan = createCleanup(registry).buildCleanupPlan('postgres-ha', { operator: 'admin' });
    assert.equal(plan.status, 'error');
    assert.equal(plan.code, 'SERVICE_READ_ONLY');
    assert.match(plan.message, /ops\.sh/);
});

test('cleanup execution is blocked for HA even with a matching confirmation', async () => {
    const registry = createRegistry();
    registry.setDiscoveredDynamicServices(['postgres-ha']);

    // HA 数据在 docker named volume 里，白名单的 bind mount 路径对它无效；
    // 放行只会归档出一个空目录，给运维虚假的安全感。
    const result = await createCleanup(registry).runCleanupService(
        'postgres-ha',
        'postgres-ha',
        { operator: 'admin', sessionId: 's1', ip: '127.0.0.1' },
        {}
    );

    assert.equal(result.status, 'error');
    assert.equal(result.code, 'SERVICE_READ_ONLY');
});

test('HA detail is built from probe output without reading any compose file', async () => {
    const registry = createRegistry();
    registry.setDiscoveredDynamicServices(['highgo-ha']);

    const builder = createDynamicServiceConfigBuilder({
        getServiceDefinition: registry.getServiceDefinition,
        getServiceStatus: async def => ({
            ...def,
            containerName: 'highgo-ha',
            status: 'running',
            running: true,
            role: 'primary',
            writable: true,
            vip: '10.8.8.250',
            vipHeld: true,
            vipIface: 'ens192',
            port: 5866,
            database: 'tb_edge',
            nodeName: 'hg-node1',
            env: { NODE_VIP: '10.8.8.250', POSTGRES_PASSWORD: 'secret', PATH: '/usr/bin' },
            topology: { nodes: [{ name: 'hg-node1', role: 'primary', status: 'running', current: true, upstream: '' }], degraded: false, message: '' },
            replication: [{ applicationName: 'hg-node2', state: 'streaming', syncState: 'async', lagBytes: 2048 }],
            license: { status: 'normal', mode: 'trial', expiry: '2027-01-01', daysRemaining: 100, level: 'ok', products: [] }
        })
    });

    const detail = await builder.buildDynamicServiceConfig('highgo-ha');
    assert.equal(detail.status, 'success');
    assert.equal(detail.readOnly, true);

    const titles = detail.sections.map(section => section.title);
    assert.deepEqual(titles, ['说明', '集群概览', '集群拓扑', '流复制', 'License', '容器生效配置', '运行信息']);

    const envSection = detail.sections.find(section => section.title === '容器生效配置');
    const envKeys = envSection.items.map(item => item.key);
    assert.ok(envKeys.includes('NODE_VIP'));
    // PATH 之类的容器噪声不展示。
    assert.equal(envKeys.includes('PATH'), false);
    // 密码类字段必须标记为敏感，由前端脱敏。
    assert.equal(envSection.items.find(item => item.key === 'POSTGRES_PASSWORD').sensitive, true);
});

test('HA detail degrades gracefully when the container is stopped', async () => {
    const registry = createRegistry();
    registry.setDiscoveredDynamicServices(['postgres-ha']);

    const builder = createDynamicServiceConfigBuilder({
        getServiceDefinition: registry.getServiceDefinition,
        getServiceStatus: async def => ({ ...def, status: 'stopped', running: false })
    });

    const detail = await builder.buildDynamicServiceConfig('postgres-ha');
    assert.equal(detail.status, 'success');
    assert.deepEqual(detail.sections.map(section => section.title), ['说明', '当前状态']);
});

test('dynamic config builder ignores plain compose services', async () => {
    const registry = createRegistry();
    const builder = createDynamicServiceConfigBuilder({
        getServiceDefinition: registry.getServiceDefinition,
        getServiceStatus: async () => ({})
    });

    // 普通服务仍走 compose-config.js，这里必须返回 null 让路由回退。
    assert.equal(await builder.buildDynamicServiceConfig('postgres'), null);
});
