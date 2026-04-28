function createDeploymentPlanner({
    appType,
    getPackageServiceId,
    getServiceDefinition,
    getServiceStatus,
    runComposeAction,
    configProvider = () => ({})
}) {
    function buildDeploymentPlan(config = configProvider()) {
        const required = new Set(['postgres']);
        const warnings = [];

        if (config.DATABASE_TS_TYPE === 'cassandra' || config.DATABASE_TS_LATEST_TYPE === 'cassandra') {
            required.add('cassandra');
        }

        if (config.DATABASE_TS_LATEST_TYPE === 'redis-cluster' || config.REDIS_CONNECTION_TYPE === 'cluster') {
            warnings.push('Redis Cluster 暂不自动初始化，请确认 ANNOUNCE_IP 和 REDIS_NODES 后手动执行高级流程。');
        } else if (config.DATABASE_TS_LATEST_TYPE === 'redis' || config.CACHE_TYPE === 'redis') {
            required.add('redis');
        }

        if (config.TB_QUEUE_TYPE === 'kafka') {
            required.add('kafka');
        }

        required.add(getPackageServiceId());

        const services = Array.from(required)
            .map(getServiceDefinition)
            .filter(Boolean)
            .sort((a, b) => a.order - b.order);

        return {
            appType,
            appService: getPackageServiceId(),
            services: services.map(service => ({
                id: service.id,
                label: service.label,
                order: service.order,
                exists: service.exists
            })),
            warnings
        };
    }

    async function buildDeploymentPlanWithStatus(config = configProvider()) {
        const plan = buildDeploymentPlan(config);
        const statuses = await Promise.all(plan.services.map(service => getServiceStatus(getServiceDefinition(service.id))));
        const appServiceId = getPackageServiceId();
        const missingServices = statuses.filter(status => !status.running).map(status => status.id);
        const missingDependencyIds = statuses
            .filter(status => status.id !== appServiceId && !status.running)
            .map(status => status.id);
        return { ...plan, statuses, missingServices, missingDependencyIds };
    }

    async function checkRequiredDependencies(config = configProvider()) {
        const plan = await buildDeploymentPlanWithStatus(config);
        const appServiceId = getPackageServiceId();
        const missingDependencies = (plan.statuses || [])
            .filter(status => status.id !== appServiceId && !status.running)
            .map(status => ({
                id: status.id,
                label: status.label || status.id,
                status: status.status || 'unknown',
                message: status.message || ''
            }));

        return {
            ok: missingDependencies.length === 0,
            plan,
            missingDependencies,
            missingDependencyIds: missingDependencies.map(service => service.id)
        };
    }

    function dependencyBlockResult(actionText, dependencyCheck) {
        const names = dependencyCheck.missingDependencies.map(service => service.label || service.id).join('、');
        return {
            status: 'error',
            code: 'DEPENDENCIES_NOT_RUNNING',
            message: `请先启动依赖服务：${names}，状态变为 running 后再${actionText}。`,
            plan: dependencyCheck.plan,
            missingDependencyIds: dependencyCheck.missingDependencyIds,
            missingDependencies: dependencyCheck.missingDependencies
        };
    }

    async function guardAppServiceDependencies(actionText, config = configProvider()) {
        const dependencyCheck = await checkRequiredDependencies(config);
        if (!dependencyCheck.ok) {
            return dependencyBlockResult(actionText, dependencyCheck);
        }
        return null;
    }

    async function applyAppConfigChange(config = configProvider()) {
        const dependencyBlock = await guardAppServiceDependencies('重启当前业务服务', config);
        if (dependencyBlock) return dependencyBlock;

        const plan = buildDeploymentPlan(config);
        const outputs = [];
        const appServiceId = getPackageServiceId();
        const appDef = getServiceDefinition(appServiceId);

        if (!appDef || !appDef.exists) {
            return { status: 'error', plan, output: `[ERROR] ${appServiceId}: compose file missing` };
        }

        const statuses = await Promise.all(plan.services.map(service => getServiceStatus(getServiceDefinition(service.id))));
        const missingServices = statuses
            .filter(status => status.exists && !status.running)
            .map(status => status.id);
        const missingDependencyIds = statuses
            .filter(status => status.id !== appServiceId && status.exists && !status.running)
            .map(status => status.id);

        const result = await runComposeAction(appServiceId, 'restart');
        outputs.push(`[${result.status.toUpperCase()}] ${appServiceId}: restart\n${result.output || result.message || ''}`);
        if (result.status !== 'success') {
            return {
                status: 'error',
                plan: { ...plan, statuses, missingServices, missingDependencyIds },
                output: outputs.join('\n'),
                restartedService: appServiceId,
                skippedDependencies: missingDependencyIds
            };
        }

        return {
            status: 'success',
            plan: { ...plan, statuses, missingServices, missingDependencyIds },
            output: outputs.join('\n'),
            restartedService: appServiceId,
            skippedDependencies: missingDependencyIds
        };
    }

    return {
        buildDeploymentPlan,
        buildDeploymentPlanWithStatus,
        checkRequiredDependencies,
        dependencyBlockResult,
        guardAppServiceDependencies,
        applyAppConfigChange
    };
}

module.exports = {
    createDeploymentPlanner
};
