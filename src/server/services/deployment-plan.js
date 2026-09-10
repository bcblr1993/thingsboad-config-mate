function createDeploymentPlanner({
    appType,
    getPackageServiceId,
    getServiceDefinition,
    getServiceStatus,
    runComposeAction,
    configProvider = () => ({}),
    // 未注入时退化为原有的固定 id 行为，保证非 HA 现场完全不变。
    listCapabilityServiceIds = (capability, fallbackId) => [fallbackId],
    /* 集群判定用的全量候选：不做「动态优先」裁剪，因为别的节点可能用的是
       被裁掉的那个静态服务。未注入时退化为与本机候选一致。 */
    listAllCapabilityServiceIds = null,
    refreshDynamicServices = null,
    // 关闭严格模式后依赖不满足只提示不阻断；未注入时保持原有的严格行为。
    isStrictDependencyCheck = () => true,
    /* 集群模式下，依赖可能由其他节点提供（如数据库单独部署在一台机器上）。
       返回全集群处于 running 的服务 id 列表；单机时不注入，行为不变。 */
    collectClusterRunningServiceIds = null
}) {
    /**
     * 构建依赖分组。每组代表一项能力，组内任一服务 running 即视为满足。
     *
     * 数据库能力可能由 postgres、postgres-ha 或 highgo-ha 提供，
     * 缓存能力可能由 redis 或 redis-cluster 提供，因此不能按固定服务 id 判断。
     */
    /* 构建一个能力组：candidates 用于本机判定与界面展示，
       clusterCandidates 用于跨节点判定（不做裁剪）。 */
    function capabilityGroup(capability, fallbackId) {
        const candidates = listCapabilityServiceIds(capability, fallbackId);
        return {
            capability,
            candidates,
            clusterCandidates: listAllCapabilityServiceIds
                ? listAllCapabilityServiceIds(capability, fallbackId)
                : candidates
        };
    }

    function buildDependencyGroups(config) {
        const groups = [];
        const warnings = [];

        groups.push(capabilityGroup('database', 'postgres'));

        /* 时序存储由配置显式指定，且历史数据与最新数据可以分别选用不同引擎
           （例如历史走 Cassandra、最新走 IoTDB），因此各自成组、都必须就绪，
           而不是「任选其一即可」。 */
        const timeseriesTypes = [config.DATABASE_TS_TYPE, config.DATABASE_TS_LATEST_TYPE];
        if (timeseriesTypes.includes('cassandra')) {
            groups.push({ capability: 'timeseries', candidates: ['cassandra'] });
        }
        if (timeseriesTypes.includes('iotdb')) {
            groups.push({ capability: 'timeseries', candidates: ['iotdb'] });
        }

        if (config.DATABASE_TS_LATEST_TYPE === 'redis-cluster' || config.REDIS_CONNECTION_TYPE === 'cluster') {
            // 现场已部署 Redis Cluster 时按能力纳入依赖，否则维持原有的手动提示。
            const cacheCandidates = listCapabilityServiceIds('cache', 'redis');
            if (cacheCandidates.includes('redis-cluster')) {
                groups.push(capabilityGroup('cache', 'redis'));
            } else {
                warnings.push('Redis Cluster 暂不自动初始化，请确认 ANNOUNCE_IP 和 REDIS_NODES 后手动执行高级流程。');
            }
        } else if (config.DATABASE_TS_LATEST_TYPE === 'redis' || config.CACHE_TYPE === 'redis') {
            groups.push(capabilityGroup('cache', 'redis'));
        }

        if (config.TB_QUEUE_TYPE === 'kafka') {
            groups.push({ capability: 'queue', candidates: ['kafka'] });
        }

        return { groups, warnings };
    }

    function buildDeploymentPlan(config = configProvider()) {
        const { groups, warnings } = buildDependencyGroups(config);

        const required = new Set();
        const capabilityById = {};
        groups.forEach(group => {
            group.candidates.forEach(id => {
                required.add(id);
                capabilityById[id] = group.capability;
            });
        });
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
                exists: service.exists,
                readOnly: !!service.readOnly,
                capability: capabilityById[service.id] || ''
            })),
            dependencyGroups: groups,
            warnings
        };
    }

    /* 供前端决定弹窗形态：严格模式弹阻断框，非严格模式弹带警告的确认框。 */
    async function buildDependencyAdvisory(config = configProvider()) {
        const dependencyCheck = await checkRequiredDependencies(config);
        const strict = isStrictDependencyCheck();
        return {
            ok: dependencyCheck.ok,
            strict,
            blocking: !dependencyCheck.ok && strict,
            missingDependencies: dependencyCheck.missingDependencies,
            missingDependencyIds: dependencyCheck.missingDependencyIds
        };
    }

    async function buildDeploymentPlanWithStatus(config = configProvider()) {
        /* 依赖检查可能先于 /api/services 被调用（例如直接点启动业务服务），
           此时动态服务尚未发现，按能力解析会退回单机 postgres 而误拦。 */
        if (refreshDynamicServices) {
            try {
                await refreshDynamicServices();
            } catch (e) {
                // 发现失败时沿用上一次结果，不阻断计划构建。
            }
        }
        const plan = buildDeploymentPlan(config);
        const statuses = await Promise.all(plan.services.map(service => getServiceStatus(getServiceDefinition(service.id))));
        const appServiceId = getPackageServiceId();
        const missingServices = statuses.filter(status => !status.running).map(status => status.id);

        /* missingDependencyIds 必须与依赖检查同口径——按能力组判定。
           若在这里简单过滤所有未运行的服务，互斥候选会被一并列为缺失：
           现场跑着瀚高 HA 时，界面会提示「请先启动 PostgreSQL 双机热备」，
           让运维去启动一个根本没部署的服务。 */
        const statusById = statuses.reduce((acc, status) => {
            acc[status.id] = status;
            return acc;
        }, {});
        const missingDependencyIds = [];
        (plan.dependencyGroups || []).forEach(group => {
            const candidates = (group.candidates || []).map(id => statusById[id]).filter(Boolean);
            if (candidates.length === 0 || candidates.some(status => status.running)) return;
            const reported = candidates.find(status => status.readOnly) || candidates[0];
            if (reported.id !== appServiceId) missingDependencyIds.push(reported.id);
        });

        return { ...plan, statuses, missingServices, missingDependencyIds };
    }

    async function checkRequiredDependencies(config = configProvider()) {
        const plan = await buildDeploymentPlanWithStatus(config);
        const appServiceId = getPackageServiceId();
        const statusById = (plan.statuses || []).reduce((acc, status) => {
            acc[status.id] = status;
            return acc;
        }, {});

        /* 集群模式下先取全集群运行中的服务，避免把「依赖部署在另一台机器上」
           误判为未启动——这是跨机部署最容易被卡住的地方。 */
        let clusterRunningIds = [];
        if (collectClusterRunningServiceIds) {
            try {
                clusterRunningIds = await collectClusterRunningServiceIds() || [];
            } catch (e) {
                // 聚合失败时退化为只看本机，不阻断检查。
                clusterRunningIds = [];
            }
        }

        /* 按能力分组判断：只要组内任一候选处于 running，该能力即满足。
           现场把单机 postgres 换成 postgres-ha / highgo-ha 后，
           不应再因为「postgres 未启动」而拦住业务服务。 */
        const missingDependencies = [];
        (plan.dependencyGroups || []).forEach(group => {
            // 该能力在集群任一节点上被满足即可（用未裁剪的全量候选匹配）。
            const clusterCandidates = group.clusterCandidates || group.candidates;
            if (clusterCandidates.some(id => clusterRunningIds.includes(id))) return;

            const candidates = group.candidates
                .map(id => statusById[id])
                .filter(Boolean);
            if (candidates.length === 0) return;
            if (candidates.some(status => status.running)) return;

            // 整组都没运行时，报告实际部署的那个（只读 HA 优先于未使用的单机服务）。
            const reported = candidates.find(status => status.readOnly) || candidates[0];
            missingDependencies.push({
                id: reported.id,
                label: reported.label || reported.id,
                status: reported.status || 'unknown',
                message: reported.message || '',
                readOnly: !!reported.readOnly,
                capability: group.capability
            });
        });

        return {
            ok: missingDependencies.length === 0,
            plan,
            missingDependencies,
            missingDependencyIds: missingDependencies.map(service => service.id)
        };
    }

    function dependencyBlockResult(actionText, dependencyCheck) {
        const missing = dependencyCheck.missingDependencies;
        const names = missing.map(service => service.label || service.id).join('、');
        const readOnlyNames = missing
            .filter(service => service.readOnly)
            .map(service => service.label || service.id);

        /* 只读纳管的依赖（HA 集群 / Redis Cluster）无法从界面启动，
           提示「请先启动」会让运维在界面上空转，必须指向交付包脚本。 */
        const message = readOnlyNames.length > 0
            ? `请先启动依赖服务：${names}。其中 ${readOnlyNames.join('、')} 为只读纳管，需在对应节点执行其交付包中的 ./start.sh 启动，状态变为 running 后再${actionText}。`
            : `请先启动依赖服务：${names}，状态变为 running 后再${actionText}。`;

        return {
            status: 'error',
            code: 'DEPENDENCIES_NOT_RUNNING',
            message,
            plan: dependencyCheck.plan,
            missingDependencyIds: dependencyCheck.missingDependencyIds,
            missingDependencies: dependencyCheck.missingDependencies
        };
    }

    function appServiceBlockResult(actionText, dependencyCheck) {
        const appServiceId = getPackageServiceId();
        const appStatus = (dependencyCheck.plan.statuses || []).find(status => status.id === appServiceId);
        const label = appStatus?.label || appServiceId;
        return {
            status: 'error',
            code: 'APP_SERVICE_NOT_RUNNING',
            message: `请先启动 ${label}，状态变为 running 后再${actionText}。`,
            plan: dependencyCheck.plan,
            appServiceId,
            appServiceStatus: appStatus?.status || 'unknown',
            appServiceRunning: false
        };
    }

    async function guardAppServiceDependencies(actionText, config = configProvider()) {
        const dependencyCheck = await checkRequiredDependencies(config);
        // 非严格模式下依赖不满足不阻断，风险由确认弹窗提示。
        if (!dependencyCheck.ok && isStrictDependencyCheck()) {
            return dependencyBlockResult(actionText, dependencyCheck);
        }
        return null;
    }

    async function guardAppServiceRunning(actionText, config = configProvider()) {
        const dependencyCheck = await checkRequiredDependencies(config);
        if (!dependencyCheck.ok && isStrictDependencyCheck()) {
            return dependencyBlockResult(actionText, dependencyCheck);
        }

        /* 「业务服务自身未运行」与依赖校验无关：保存并应用、重启这类操作
           本就要求目标服务在跑，因此不受严格模式开关影响。 */
        const appServiceId = getPackageServiceId();
        const appStatus = (dependencyCheck.plan.statuses || []).find(status => status.id === appServiceId);
        if (!appStatus?.running) {
            return appServiceBlockResult(actionText, dependencyCheck);
        }

        return null;
    }

    async function applyAppConfigChange(config = configProvider()) {
        const dependencyBlock = await guardAppServiceRunning('重启当前业务服务', config);
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
        buildDependencyAdvisory,
        buildDeploymentPlan,
        buildDeploymentPlanWithStatus,
        checkRequiredDependencies,
        dependencyBlockResult,
        guardAppServiceDependencies,
        guardAppServiceRunning,
        applyAppConfigChange
    };
}

module.exports = {
    createDeploymentPlanner
};
