const { readRequestBody, respondError, writeJson } = require('../http');

function appActionStatusCode(result) {
    if (result.status === 'success') return 200;
    if (result.code === 'CONFIG_VALIDATION_FAILED') return 400;
    if (['DEPENDENCIES_NOT_RUNNING', 'APP_SERVICE_NOT_RUNNING'].includes(result.code)) return 409;
    return 500;
}

function createAppRoutes({
    parseEnvFile,
    saveEnvFile,
    buildDependencyAdvisory = null,
    buildDeploymentPlanWithStatus,
    guardAppServiceRunning,
    applyAppConfigChange,
    runComposeAction,
    getPackageServiceId,
    getServiceDefinition,
    getServiceStatus,
    logStreamService,
    validateConfig = () => []
}) {
    function handle(req, res, { method, pathname, requestUrl, headers }) {
        if (pathname === '/api/plan' && method === 'POST') {
            readRequestBody(req).then(async body => {
                const payload = body ? JSON.parse(body) : {};
                const config = payload.config || parseEnvFile();
                const plan = await buildDeploymentPlanWithStatus(config);
                /* advisory 告诉前端本次依赖缺失是否会真的阻断：
                   严格模式弹阻断框，非严格模式弹带警告的确认框。 */
                const advisory = buildDependencyAdvisory ? await buildDependencyAdvisory(config) : null;
                return { plan, advisory };
            }).then(({ plan, advisory }) => {
                writeJson(res, 200, { status: 'success', plan, advisory }, headers);
            }).catch(e => respondError(res, e, headers));
            return true;
        }

        if (pathname === '/api/apply-plan' && method === 'POST') {
            readRequestBody(req).then(async body => {
                const payload = body ? JSON.parse(body) : {};
                const config = payload.config || parseEnvFile();
                const validationErrors = payload.config ? validateConfig(config) : [];
                if (validationErrors.length > 0) {
                    return {
                        status: 'error',
                        code: 'CONFIG_VALIDATION_FAILED',
                        message: '配置校验未通过',
                        errors: validationErrors
                    };
                }
                const dependencyBlock = await guardAppServiceRunning('保存并应用到当前业务服务', config);
                if (dependencyBlock) return dependencyBlock;
                if (payload.save !== false && payload.config) saveEnvFile(config);
                return applyAppConfigChange(config);
            }).then(result => {
                writeJson(res, appActionStatusCode(result), result, headers);
            }).catch(e => respondError(res, e, headers));
            return true;
        }

        if ((pathname === '/api/restart' || pathname === '/api/service-restart') && method === 'POST') {
            guardAppServiceRunning('重启当前业务服务')
                .then(block => block || runComposeAction(getPackageServiceId(), 'restart'))
                .then(result => writeJson(res, appActionStatusCode(result), result, headers))
                .catch(e => respondError(res, e, headers));
            return true;
        }

        if (pathname === '/api/stop' && method === 'POST') {
            runComposeAction(getPackageServiceId(), 'down')
                .then(result => writeJson(res, result.status === 'success' ? 200 : 500, result, headers))
                .catch(e => respondError(res, e, headers));
            return true;
        }

        const serviceLogsMatch = pathname.match(/^\/api\/services\/([^/]+)\/logs$/);
        if ((pathname === '/api/logs' || serviceLogsMatch) && method === 'GET') {
            const serviceId = serviceLogsMatch
                ? serviceLogsMatch[1]
                : (requestUrl.searchParams.get('service') || getPackageServiceId());
            logStreamService.streamLogs({ req, res, serviceId, headers });
            return true;
        }

        if (pathname === '/api/status' && method === 'GET') {
            const def = getServiceDefinition(getPackageServiceId());
            getServiceStatus(def)
                .then(status => {
                    writeJson(res, 200, {
                        status: status.status,
                        service: status.id,
                        dockerComposeMissing: !status.exists,
                        missingFiles: status.exists ? [] : [status.composePath],
                        message: status.message
                    }, headers);
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
    appActionStatusCode,
    createAppRoutes
};
