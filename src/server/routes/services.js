const { readRequestBody, respondError, writeJson } = require('../http');

function serviceActionStatusCode(result) {
    if (result.status === 'success') return 200;
    if (['DEPENDENCIES_NOT_RUNNING', 'APP_SERVICE_NOT_RUNNING'].includes(result.code)) return 409;
    return 500;
}

function cleanupStatusCode(result) {
    if (result.status === 'success') return 200;
    if (['APP_SERVICE_RUNNING', 'TARGET_SERVICE_RUNNING', 'CLEANUP_RUNNING', 'BACKUP_DIR_EXISTS'].includes(result.code)) return 409;
    return 400;
}

function serviceActionCodeToStatus(result) {
    // 只读纳管服务收到启停请求属于客户端错误，不是服务端故障。
    return result.code === 'SERVICE_READ_ONLY' ? 400 : serviceActionStatusCode(result);
}

function createServiceRoutes({
    listServiceDefinitions,
    getServiceDefinition,
    getPackageServiceId,
    getServiceStatus,
    runComposeAction,
    buildServiceComposeConfig,
    buildDynamicServiceConfig = null,
    buildCleanupPlan,
    runCleanupService,
    getRequestActor,
    guardAppServiceDependencies,
    guardAppServiceRunning,
    refreshDynamicServices = null,
    listConflictingServiceIds = () => [],
    /* 注入后 /api/services 走统一的本机快照缓存；未注入时保持原有的直接探测。 */
    localServicesProvider = null,
    invalidateServiceSnapshot = () => {}
}) {
    function handle(req, res, { method, pathname, headers }) {
        if (pathname === '/api/services' && method === 'GET') {
            /* 动态服务发现（HA / redis-cluster 按容器名探测）与状态探测都在
               快照里完成，保证现场部署或移除后界面能自动跟随。 */
            const load = localServicesProvider
                ? localServicesProvider().then(local => ({
                    services: local.services,
                    conflicts: local.conflicts
                }))
                : Promise.resolve(refreshDynamicServices ? refreshDynamicServices() : null)
                    .then(() => Promise.all(listServiceDefinitions().map(getServiceStatus)))
                    .then(services => ({ services, conflicts: listConflictingServiceIds() }));

            load
                .then(({ services, conflicts }) => writeJson(res, 200, {
                    status: 'success',
                    services,
                    conflicts
                }, headers))
                .catch(e => respondError(res, e, headers));
            return true;
        }

        const serviceConfigMatch = pathname.match(/^\/api\/services\/([^/]+)\/config$/);
        if (serviceConfigMatch && method === 'GET') {
            const serviceId = serviceConfigMatch[1];
            const def = getServiceDefinition(serviceId);

            if (def && def.kind && def.kind !== 'compose' && buildDynamicServiceConfig) {
                buildDynamicServiceConfig(serviceId)
                    .then(result => writeJson(res, result?.status === 'success' ? 200 : 404, result || {
                        status: 'error',
                        message: 'Unknown service'
                    }, headers))
                    .catch(e => respondError(res, e, headers));
                return true;
            }

            const result = buildServiceComposeConfig(serviceId);
            writeJson(res, result.status === 'success' ? 200 : 404, result, headers);
            return true;
        }

        const serviceCleanupPlanMatch = pathname.match(/^\/api\/services\/([^/]+)\/cleanup-plan$/);
        if (serviceCleanupPlanMatch && method === 'GET') {
            const actor = getRequestActor(req);
            const result = buildCleanupPlan(serviceCleanupPlanMatch[1], actor);
            if (result.status === 'success') {
                Promise.all([
                    getServiceStatus(getServiceDefinition(getPackageServiceId())),
                    getServiceStatus(getServiceDefinition(serviceCleanupPlanMatch[1]))
                ])
                    .then(([appStatus, targetStatus]) => {
                        result.appServiceRunning = !!appStatus.running;
                        result.appServiceStatus = appStatus.status || 'unknown';
                        result.targetServiceRunning = !!targetStatus.running;
                        result.targetServiceStatus = targetStatus.status || 'unknown';
                        writeJson(res, 200, result, headers);
                    })
                    .catch(e => respondError(res, e, headers));
            } else {
                writeJson(res, 404, result, headers);
            }
            return true;
        }

        const serviceCleanupMatch = pathname.match(/^\/api\/services\/([^/]+)\/cleanup$/);
        if (serviceCleanupMatch && method === 'POST') {
            readRequestBody(req).then(body => {
                const payload = body ? JSON.parse(body) : {};
                return runCleanupService(serviceCleanupMatch[1], payload.confirmServiceId, getRequestActor(req), {
                    backupDir: payload.backupDir
                });
            }).then(result => {
                invalidateServiceSnapshot();
                writeJson(res, cleanupStatusCode(result), result, headers);
            }).catch(e => respondError(res, e, headers));
            return true;
        }

        const serviceActionMatch = pathname.match(/^\/api\/services\/([^/]+)\/(up|down|restart)$/);
        if (serviceActionMatch && method === 'POST') {
            const [, serviceId, action] = serviceActionMatch;
            const actionText = action === 'up' ? '启动当前业务服务' : '重启当前业务服务';
            const guardedAction = async () => {
                if (serviceId === getPackageServiceId() && (action === 'up' || action === 'restart')) {
                    const block = action === 'restart'
                        ? await guardAppServiceRunning(actionText)
                        : await guardAppServiceDependencies(actionText);
                    if (block) return block;
                }
                return runComposeAction(serviceId, action);
            };
            guardedAction()
                .then(result => {
                    // 状态已改变，立即失效快照，避免下一次读取拿到旧值。
                    invalidateServiceSnapshot();
                    return writeJson(res, serviceActionCodeToStatus(result), result, headers);
                })
                .catch(e => respondError(res, e, headers));
            return true;
        }

        return false;
    }

    return {
        handle
    };
}

module.exports = {
    cleanupStatusCode,
    createServiceRoutes,
    serviceActionCodeToStatus,
    serviceActionStatusCode
};
