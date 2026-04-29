const fs = require('fs');
const os = require('os');
const { readRequestBody, writeJson } = require('../http');

function createSystemRoutes({
    appRoot,
    appDir,
    appType,
    envFilePath,
    yamlConfigPath,
    authService,
    configMatePassword,
    dockerRuntime,
    buildDeploymentDiagnostics,
    getPackageServiceId
}) {
    if (!authService) throw new Error('authService is required');
    if (!dockerRuntime) throw new Error('dockerRuntime is required');

    const {
        authRequired,
        createSession,
        destroySession,
        getAuthToken,
        getSession,
        isAuthenticated,
        normalizeOperatorName
    } = authService;

    function handlePublic(req, res, { method, pathname, headers }) {
        if (pathname === '/api/health' && method === 'GET') {
            writeJson(res, 200, {
                status: 'ok',
                appRoot,
                appDir,
                appType,
                docker: {
                    available: !dockerRuntime.readyMessage(),
                    message: dockerRuntime.readyMessage()
                }
            }, headers);
            return true;
        }

        if (pathname === '/api/auth/status' && method === 'GET') {
            const session = getSession(req);
            writeJson(res, 200, {
                required: authRequired,
                authenticated: isAuthenticated(req),
                operator: session?.operator || ''
            }, headers);
            return true;
        }

        if (pathname === '/api/login' && method === 'POST') {
            readRequestBody(req).then(body => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const operator = normalizeOperatorName(payload.operator);
                    if (!operator) {
                        writeJson(res, 400, { status: 'error', message: '请输入操作员名称' }, headers);
                        return;
                    }
                    if (!authRequired || payload.password === configMatePassword) {
                        const token = createSession(req, operator);
                        writeJson(res, 200, { status: 'success', operator: normalizeOperatorName(operator) || 'operator' }, {
                            ...headers,
                            'Set-Cookie': `config_mate_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
                        });
                    } else {
                        writeJson(res, 401, { status: 'error', message: '密码错误' }, headers);
                    }
                } catch (e) {
                    writeJson(res, 400, { status: 'error', message: e.message }, headers);
                }
            });
            return true;
        }

        if (pathname === '/api/logout' && method === 'POST') {
            const token = getAuthToken(req);
            destroySession(token);
            writeJson(res, 200, { status: 'success' }, {
                ...headers,
                'Set-Cookie': 'config_mate_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
            });
            return true;
        }

        if (pathname === '/api/version' && method === 'GET') {
            const packageJson = require('../../../package.json');
            writeJson(res, 200, { version: packageJson.version }, headers);
            return true;
        }

        return false;
    }

    function handleAuthenticated(req, res, { method, pathname, headers }) {
        if (pathname === '/api/deployment' && method === 'GET') {
            writeJson(res, 200, {
                status: 'success',
                appRoot,
                appDir,
                appType,
                appService: getPackageServiceId(),
                envPath: envFilePath,
                yamlPath: yamlConfigPath,
                authRequired,
                docker: {
                    cli: dockerRuntime.dockerPath,
                    compose: dockerRuntime.dockerComposeCmd,
                    socketMounted: fs.existsSync('/var/run/docker.sock') || os.platform() === 'win32',
                    available: !dockerRuntime.readyMessage(),
                    message: dockerRuntime.readyMessage()
                },
                diagnostics: buildDeploymentDiagnostics()
            }, headers);
            return true;
        }

        return false;
    }

    return {
        handlePublic,
        handleAuthenticated
    };
}

module.exports = {
    createSystemRoutes
};
