const fs = require('fs');
const os = require('os');
const { readRequestBody, writeJson } = require('../http');
const { getDiskUsageForPath } = require('../services/disk-usage');

const ADMIN_OPERATOR = 'admin';

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
    getPackageServiceId,
    settingsStore = null,
    credentialStore = null,
    logger = console
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
                operator: session?.operator || '',
                appType,
                appService: getPackageServiceId(),
                // 仍在使用交付包默认密码时，界面需要强制引导改密。
                mustChangePassword: !!credentialStore?.isUsingDefaultPassword()
            }, headers);
            return true;
        }

        if (pathname === '/api/login' && method === 'POST') {
            readRequestBody(req).then(body => {
                try {
                    // 先做速率限制，避免把密码校验暴露给无限次尝试。
                    const locked = authService.checkLoginAllowed(req);
                    if (locked) {
                        writeJson(res, 429, {
                            status: 'error',
                            code: 'LOGIN_LOCKED',
                            message: `登录失败次数过多，请 ${locked.retryAfterSeconds} 秒后重试。`,
                            retryAfterSeconds: locked.retryAfterSeconds
                        }, { ...headers, 'Retry-After': String(locked.retryAfterSeconds) });
                        return;
                    }

                    const payload = JSON.parse(body || '{}');
                    const operator = normalizeOperatorName(payload.operator || ADMIN_OPERATOR);
                    if (operator !== ADMIN_OPERATOR) {
                        authService.recordLoginFailure(req);
                        writeJson(res, 401, { status: 'error', message: '仅支持 admin 账号登录' }, headers);
                        return;
                    }

                    // 恒定时间校验；已改密时比对哈希，否则比对环境变量密码。
                    const passed = credentialStore
                        ? credentialStore.verify(payload.password)
                        : payload.password === configMatePassword;

                    if (!passed) {
                        authService.recordLoginFailure(req);
                        writeJson(res, 401, { status: 'error', message: '密码错误' }, headers);
                        return;
                    }

                    authService.recordLoginSuccess(req);
                    const token = createSession(req, ADMIN_OPERATOR);
                    writeJson(res, 200, {
                        status: 'success',
                        operator: ADMIN_OPERATOR,
                        mustChangePassword: !!credentialStore?.isUsingDefaultPassword()
                    }, {
                        ...headers,
                        'Set-Cookie': `config_mate_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
                    });
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

        if (pathname === '/api/password' && method === 'POST') {
            if (!credentialStore) {
                writeJson(res, 500, { status: 'error', message: '凭据存储不可用' }, headers);
                return true;
            }
            readRequestBody(req).then(body => {
                const payload = JSON.parse(body || '{}');
                const actor = authService.getRequestActor(req);

                // 必须验证当前密码，避免会话被劫持后直接改密。
                if (!credentialStore.verify(payload.currentPassword)) {
                    logger.log?.(`[Auth] 改密失败（当前密码错误） operator=${actor.operator} ip=${actor.ip}`);
                    writeJson(res, 401, { status: 'error', message: '当前密码不正确。' }, headers);
                    return;
                }

                const result = credentialStore.setPassword(payload.newPassword);
                if (!result.ok) {
                    writeJson(res, 400, { status: 'error', message: result.message }, headers);
                    return;
                }

                logger.log?.(`[Auth] 管理员密码已更新 operator=${actor.operator} ip=${actor.ip}`);
                writeJson(res, 200, { status: 'success', message: '密码已更新，请牢记新密码。' }, headers);
            }).catch(e => writeJson(res, 400, { status: 'error', message: e.message }, headers));
            return true;
        }

        if (pathname === '/api/settings' && method === 'GET') {
            writeJson(res, 200, {
                status: 'success',
                settings: settingsStore ? settingsStore.get() : { strictDependencyCheck: true }
            }, headers);
            return true;
        }

        if (pathname === '/api/settings' && method === 'POST') {
            if (!settingsStore) {
                writeJson(res, 500, { status: 'error', message: '设置存储不可用' }, headers);
                return true;
            }
            readRequestBody(req).then(body => {
                const payload = JSON.parse(body || '{}');
                const actor = authService.getRequestActor(req);
                const next = settingsStore.update(payload);
                // 关闭严格校验会放行依赖不满足的操作，属于需要留痕的变更。
                logger.log?.(`[Settings] operator=${actor.operator} ip=${actor.ip} strictDependencyCheck=${next.strictDependencyCheck}`);
                writeJson(res, 200, { status: 'success', settings: next }, headers);
            }).catch(e => writeJson(res, 400, { status: 'error', message: e.message }, headers));
            return true;
        }

        if (pathname === '/api/disk-usage' && method === 'GET') {
            getDiskUsageForPath(appRoot).then(usage => {
                writeJson(res, 200, { status: 'success', usage }, headers);
            }).catch(err => {
                writeJson(res, 200, {
                    status: 'success',
                    usage: { available: false, reason: err.message || 'unknown' }
                }, headers);
            });
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
    ADMIN_OPERATOR,
    createSystemRoutes
};
