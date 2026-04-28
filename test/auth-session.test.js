const assert = require('node:assert/strict');
const test = require('node:test');

const {
    createAuthService,
    getClientIp,
    normalizeOperatorName,
    parseCookies
} = require('../src/server/auth/session');

function req(headers = {}) {
    return {
        headers,
        socket: { remoteAddress: '127.0.0.1' }
    };
}

test('parseCookies reads config mate session cookie', () => {
    assert.deepEqual(parseCookies(req({ cookie: 'a=1; config_mate_session=abc%20123' })), {
        a: '1',
        config_mate_session: 'abc 123'
    });
});

test('auth service creates, reads, and destroys sessions', () => {
    const auth = createAuthService({ password: 'secret' });
    assert.equal(auth.authRequired, true);
    assert.equal(auth.isAuthenticated(req()), false);

    const token = auth.createSession(req({ 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }), ' chenxu ');
    const authedReq = req({ authorization: `Bearer ${token}` });

    assert.equal(auth.isAuthenticated(authedReq), true);
    assert.equal(auth.getSession(authedReq).operator, 'chenxu');
    assert.deepEqual(auth.getRequestActor(authedReq), {
        operator: 'chenxu',
        sessionId: token.slice(0, 10),
        ip: '10.0.0.1'
    });

    auth.destroySession(token);
    assert.equal(auth.isAuthenticated(authedReq), false);
});

test('auth can be disabled when no password is configured', () => {
    const auth = createAuthService({ password: '' });
    assert.equal(auth.authRequired, false);
    assert.equal(auth.isAuthenticated(req()), true);
});

test('operator and client ip normalization', () => {
    assert.equal(normalizeOperatorName(` ${'a'.repeat(70)} `).length, 64);
    assert.equal(getClientIp(req({ 'x-forwarded-for': '192.168.1.10, proxy' })), '192.168.1.10');
});
