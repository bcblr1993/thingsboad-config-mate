const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');

const { createAuthService } = require('../src/server/auth/session');
const { ADMIN_OPERATOR, createSystemRoutes } = require('../src/server/routes/system');

function createJsonRequest(payload = {}) {
    const req = Readable.from([JSON.stringify(payload)]);
    req.headers = {};
    req.socket = { remoteAddress: '127.0.0.1' };
    return req;
}

function createResponseCapture(resolve) {
    return {
        statusCode: 0,
        headers: {},
        body: '',
        writeHead(statusCode, headers) {
            this.statusCode = statusCode;
            this.headers = headers;
        },
        end(chunk = '') {
            this.body = String(chunk);
            resolve(this);
        }
    };
}

function createRoutes(password = '123456') {
    const authService = createAuthService({ password });
    return createSystemRoutes({
        appRoot: '/tmp/config-mate',
        appDir: '/tmp/config-mate/services/iotcloud',
        appType: 'CLOUD',
        envFilePath: '/tmp/config-mate/services/iotcloud/.env',
        yamlConfigPath: '',
        authService,
        configMatePassword: password,
        dockerRuntime: { readyMessage: () => '' },
        buildDeploymentDiagnostics: () => ({ status: 'ok', checks: [] }),
        getPackageServiceId: () => 'iotcloud'
    });
}

function invokeLogin(routes, payload) {
    return new Promise(resolve => {
        routes.handlePublic(
            createJsonRequest(payload),
            createResponseCapture(resolve),
            { method: 'POST', pathname: '/api/login', headers: {} }
        );
    }).then(res => ({
        statusCode: res.statusCode,
        headers: res.headers,
        body: JSON.parse(res.body)
    }));
}

test('system login accepts only admin with configured password', async () => {
    const routes = createRoutes('123456');

    const wrongUser = await invokeLogin(routes, { operator: 'chenxu', password: '123456' });
    assert.equal(wrongUser.statusCode, 401);
    assert.equal(wrongUser.body.message, '仅支持 admin 账号登录');

    const wrongPassword = await invokeLogin(routes, { operator: ADMIN_OPERATOR, password: 'bad' });
    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(wrongPassword.body.message, '密码错误');

    const ok = await invokeLogin(routes, { operator: ADMIN_OPERATOR, password: '123456' });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.operator, ADMIN_OPERATOR);
    assert.match(ok.headers['Set-Cookie'], /config_mate_session=/);
});
