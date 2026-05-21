const { readRequestBody, writeJson } = require('../http');

function serviceActionStatusCode(result) {
    if (result.status === 'success') return 200;
    if (['DEPENDENCIES_NOT_RUNNING', 'APP_SERVICE_NOT_RUNNING'].includes(result.code)) return 409;
    return 500;
}

function cleanupStatusCode(result) {
    if (result.status === 'success') return 200;
    if (['APP_SERVICE_RUNNING', 'TARGET_SERVICE_RUNNING', 'CLEANUP_RUNNING'].includes(result.code)) return 409;
    return 400;
}

function createServiceRoutes({
    listServiceDefinitions,
    getServiceDefinition,
    getPackageServiceId,
    getServiceStatus,
    runComposeAction,
    buildServiceComposeConfig,
    buildCleanupPlan,
    runCleanupService,
    getRequestActor,
    guardAppServiceDependencies,
    guardAppServiceRunning
}) {
    function handle(req, res, { method, pathname, headers }) {
        if (pathname === '/api/services' && method === 'GET') {
            Promise.all(listServiceDefinitions().map(getServiceStatus))
                .then(services => writeJson(res, 200, { status: 'success', services }, headers))
                .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return true;
        }

        const serviceConfigMatch = pathname.match(/^\/api\/services\/([^/]+)\/config$/);
        if (serviceConfigMatch && method === 'GET') {
            const result = buildServiceComposeConfig(serviceConfigMatch[1]);
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
                return runCleanupService(serviceCleanupMatch[1], payload.confirmServiceId, getRequestActor(req));
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
                .then(result => writeJson(res, serviceActionStatusCode(result), result, headers))
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
    serviceActionStatusCode
};
