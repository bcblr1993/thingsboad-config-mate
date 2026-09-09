const { readRequestBody, writeJson } = require('../http');

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
    listConflictingServiceIds = () => []
}) {
    function handle(req, res, { method, pathname, headers }) {
        if (pathname === '/api/services' && method === 'GET') {
            // 先刷新动态服务发现（HA / redis-cluster 按容器名探测），
            // 再列出服务，保证现场部署或移除后界面能自动跟随。
            Promise.resolve(refreshDynamicServices ? refreshDynamicServices() : null)
                .then(() => Promise.all(listServiceDefinitions().map(getServiceStatus)))
                .then(services => writeJson(res, 200, {
                    status: 'success',
                    services,
                    conflicts: listConflictingServiceIds()
                }, headers))
                .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
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
                    .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
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
                    .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
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
                writeJson(res, cleanupStatusCode(result), result, headers);
            }).catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
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
                .then(result => writeJson(res, serviceActionCodeToStatus(result), result, headers))
                .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
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
