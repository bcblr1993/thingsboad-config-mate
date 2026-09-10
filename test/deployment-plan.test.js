const assert = require('node:assert/strict');
const test = require('node:test');

const { createDeploymentPlanner } = require('../src/server/services/deployment-plan');

function makePlanner({ config = {}, statuses = {}, actions = [] } = {}) {
    const definitions = {
        postgres: { id: 'postgres', label: 'PostgreSQL', order: 10, exists: true },
        redis: { id: 'redis', label: 'Redis', order: 20, exists: true },
        cassandra: { id: 'cassandra', label: 'Cassandra', order: 30, exists: true },
        iotdb: { id: 'iotdb', label: 'IoTDB', order: 35, exists: true },
        kafka: { id: 'kafka', label: 'Kafka', order: 40, exists: true },
        iotcloud: { id: 'iotcloud', label: 'IoT Cloud', order: 90, exists: true }
    };

    return createDeploymentPlanner({
        appType: 'CLOUD',
        getPackageServiceId: () => 'iotcloud',
        getServiceDefinition: id => definitions[id],
        configProvider: () => config,
        getServiceStatus: async def => ({
            id: def.id,
            label: def.label,
            exists: def.exists,
            running: statuses[def.id] !== false,
            status: statuses[def.id] === false ? 'stopped' : 'running'
        }),
        runComposeAction: async (serviceId, action) => {
            actions.push({ serviceId, action });
            return { status: 'success', output: `${serviceId}:${action}` };
        }
    });
}

test('buildDeploymentPlan derives dependencies from config', () => {
    const planner = makePlanner({
        config: {
            DATABASE_TS_TYPE: 'cassandra',
            DATABASE_TS_LATEST_TYPE: 'redis',
            TB_QUEUE_TYPE: 'kafka'
        }
    });

    const plan = planner.buildDeploymentPlan();
    assert.deepEqual(plan.services.map(service => service.id), [
        'postgres',
        'redis',
        'cassandra',
        'kafka',
        'iotcloud'
    ]);
});

test('buildDeploymentPlan requires iotdb when history storage is iotdb', () => {
    const planner = makePlanner({
        config: {
            DATABASE_TS_TYPE: 'iotdb',
            DATABASE_TS_LATEST_TYPE: 'redis',
            TB_QUEUE_TYPE: 'kafka'
        }
    });

    assert.deepEqual(planner.buildDeploymentPlan().services.map(service => service.id), [
        'postgres',
        'redis',
        'iotdb',
        'kafka',
        'iotcloud'
    ]);
});

test('buildDeploymentPlan requires iotdb when only latest storage is iotdb', () => {
    const planner = makePlanner({
        config: {
            DATABASE_TS_TYPE: 'sql',
            DATABASE_TS_LATEST_TYPE: 'iotdb'
        }
    });

    assert.deepEqual(planner.buildDeploymentPlan().services.map(service => service.id), [
        'postgres',
        'iotdb',
        'iotcloud'
    ]);
});

test('guardAppServiceDependencies blocks when required dependency is stopped', async () => {
    const planner = makePlanner({
        config: { CACHE_TYPE: 'redis' },
        statuses: { redis: false }
    });

    const result = await planner.guardAppServiceDependencies('重启当前业务服务');
    assert.equal(result.code, 'DEPENDENCIES_NOT_RUNNING');
    assert.deepEqual(result.missingDependencyIds, ['redis']);
});

test('guardAppServiceDependencies allows initialization when app service is stopped', async () => {
    const planner = makePlanner({
        config: {},
        statuses: { iotcloud: false }
    });

    const result = await planner.guardAppServiceDependencies('执行初始化安装');

    assert.equal(result, null);
});

test('guardAppServiceRunning blocks when app service is stopped', async () => {
    const planner = makePlanner({
        config: {},
        statuses: { iotcloud: false }
    });

    const result = await planner.guardAppServiceRunning('执行初始化安装');

    assert.equal(result.code, 'APP_SERVICE_NOT_RUNNING');
    assert.equal(result.appServiceId, 'iotcloud');
    assert.equal(result.appServiceStatus, 'stopped');
});

test('applyAppConfigChange refuses to restart a stopped app service', async () => {
    const actions = [];
    const planner = makePlanner({
        config: {},
        statuses: { iotcloud: false },
        actions
    });

    const result = await planner.applyAppConfigChange();

    assert.equal(result.code, 'APP_SERVICE_NOT_RUNNING');
    assert.deepEqual(actions, []);
});

test('applyAppConfigChange restarts only the app service', async () => {
    const actions = [];
    const planner = makePlanner({ config: {}, actions });

    const result = await planner.applyAppConfigChange();

    assert.equal(result.status, 'success');
    assert.equal(result.restartedService, 'iotcloud');
    assert.deepEqual(actions, [{ serviceId: 'iotcloud', action: 'restart' }]);
});

test('cassandra and iotdb can be required at the same time', () => {
    /* 历史数据与最新数据可以分别选用不同的时序引擎，此时两者都必须就绪，
       不能按「任选其一」处理。合并 iotdb 分支后新出现的组合。 */
    const planner = makePlanner({
        config: {
            DATABASE_TS_TYPE: 'cassandra',
            DATABASE_TS_LATEST_TYPE: 'iotdb',
            TB_QUEUE_TYPE: 'kafka'
        }
    });

    const plan = planner.buildDeploymentPlan();
    const ids = plan.services.map(service => service.id);
    assert.ok(ids.includes('cassandra'), 'cassandra 应在依赖中');
    assert.ok(ids.includes('iotdb'), 'iotdb 应在依赖中');

    // 两者各自成组，而不是合并成一个「任一满足」的组。
    const tsGroups = (plan.dependencyGroups || []).filter(g => g.capability === 'timeseries');
    assert.equal(tsGroups.length, 2);
    assert.deepEqual(tsGroups.map(g => g.candidates).flat().sort(), ['cassandra', 'iotdb']);
});

test('iotdb dependency is reported as missing when it is not running', async () => {
    // statuses 用 false 标记未运行，未列出的默认视为运行中。
    const planner = makePlanner({
        config: { DATABASE_TS_TYPE: 'iotdb', TB_QUEUE_TYPE: 'kafka' },
        statuses: { iotdb: false }
    });

    const check = await planner.checkRequiredDependencies();
    assert.equal(check.ok, false);
    assert.ok(check.missingDependencyIds.includes('iotdb'));
});

test('missingDependencyIds is computed per capability group, not per service', async () => {
    /* 现场跑着瀚高 HA 时，postgres-ha 虽然未运行也不算缺失——两者互斥。
       若按服务简单过滤，界面会提示「请先启动 PostgreSQL 双机热备」，
       让运维去启动一个根本没部署的服务。真机在安装页复现过。 */
    const definitions = {
        'postgres-ha': { id: 'postgres-ha', label: 'PostgreSQL 双机热备', order: 11, exists: true, readOnly: true },
        'highgo-ha': { id: 'highgo-ha', label: '瀚高双机热备', order: 12, exists: true, readOnly: true },
        redis: { id: 'redis', label: 'Redis', order: 20, exists: true },
        iotcloud: { id: 'iotcloud', label: 'IoT Cloud', order: 90, exists: true }
    };
    const running = ['highgo-ha'];
    const planner = createDeploymentPlanner({
        appType: 'CLOUD',
        getPackageServiceId: () => 'iotcloud',
        getServiceDefinition: id => definitions[id],
        configProvider: () => ({ CACHE_TYPE: 'redis' }),
        getServiceStatus: async def => ({
            ...def,
            running: running.includes(def.id),
            status: running.includes(def.id) ? 'running' : 'stopped'
        }),
        runComposeAction: async () => ({ status: 'success' }),
        listCapabilityServiceIds: cap => (cap === 'database' ? ['postgres-ha', 'highgo-ha'] : ['redis'])
    });

    const plan = await planner.buildDeploymentPlanWithStatus({ CACHE_TYPE: 'redis' });
    assert.equal(plan.missingDependencyIds.includes('postgres-ha'), false,
        '数据库能力已由瀚高满足，postgres-ha 不应被列为缺失');
    assert.ok(plan.missingDependencyIds.includes('redis'), 'redis 未运行应被列为缺失');

    // 与依赖检查保持同口径
    const check = await planner.checkRequiredDependencies({ CACHE_TYPE: 'redis' });
    assert.deepEqual(plan.missingDependencyIds.sort(), check.missingDependencyIds.sort());
});

test('missingServices still lists every stopped service for display', async () => {
    // missingServices 用于界面展示「哪些没跑」，语义与依赖判定不同，保持原样。
    const definitions = {
        postgres: { id: 'postgres', label: 'PostgreSQL', order: 10, exists: true },
        iotcloud: { id: 'iotcloud', label: 'IoT Cloud', order: 90, exists: true }
    };
    const planner = createDeploymentPlanner({
        appType: 'CLOUD',
        getPackageServiceId: () => 'iotcloud',
        getServiceDefinition: id => definitions[id],
        configProvider: () => ({}),
        getServiceStatus: async def => ({ ...def, running: false, status: 'stopped' }),
        runComposeAction: async () => ({ status: 'success' })
    });

    const plan = await planner.buildDeploymentPlanWithStatus({});
    assert.ok(plan.missingServices.includes('postgres'));
    assert.ok(plan.missingServices.includes('iotcloud'));
});
