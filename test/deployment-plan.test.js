const assert = require('node:assert/strict');
const test = require('node:test');

const { createDeploymentPlanner } = require('../src/server/services/deployment-plan');

function makePlanner({ config = {}, statuses = {}, actions = [] } = {}) {
    const definitions = {
        postgres: { id: 'postgres', label: 'PostgreSQL', order: 10, exists: true },
        redis: { id: 'redis', label: 'Redis', order: 20, exists: true },
        cassandra: { id: 'cassandra', label: 'Cassandra', order: 30, exists: true },
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
