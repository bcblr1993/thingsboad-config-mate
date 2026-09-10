const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createAuthService } = require('../src/server/auth/session');
const {
    DEFAULT_PASSWORD,
    createCredentialStore,
    hashPassword,
    safeEqual,
    verifyPassword
} = require('../src/server/auth/credential-store');

function tmpFile(name) {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cm-auth-')), name);
}

function fakeReq(ip = '10.0.0.1') {
    return { headers: {}, socket: { remoteAddress: ip } };
}

/* ---- 凭据存储 -------------------------------------------------------- */

test('password hashing uses a per-password salt', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    // 相同明文必须产生不同哈希，否则可通过比对哈希判断密码是否相同。
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hash, b.hash);
    assert.equal(verifyPassword('same-password', a), true);
    assert.equal(verifyPassword('same-password', b), true);
    assert.equal(verifyPassword('wrong-password', a), false);
});

test('safeEqual handles differing lengths without throwing', () => {
    assert.equal(safeEqual('abc', 'abcdef'), false);
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('', ''), true);
});

test('falls back to the environment password before any change', () => {
    const store = createCredentialStore({ credentialFile: tmpFile('auth.json'), envPassword: 'env-secret-1' });
    assert.equal(store.verify('env-secret-1'), true);
    assert.equal(store.verify('wrong'), false);
    assert.equal(store.hasStoredCredential(), false);
});

test('detects the shipped default password', () => {
    const usingDefault = createCredentialStore({ credentialFile: tmpFile('auth.json'), envPassword: DEFAULT_PASSWORD });
    assert.equal(usingDefault.isUsingDefaultPassword(), true);

    const changed = createCredentialStore({ credentialFile: tmpFile('auth.json'), envPassword: 'something-else-1' });
    assert.equal(changed.isUsingDefaultPassword(), false);
});

test('changing the password persists and supersedes the environment value', () => {
    const file = tmpFile('auth.json');
    const store = createCredentialStore({ credentialFile: file, envPassword: DEFAULT_PASSWORD });

    assert.equal(store.setPassword('Str0ngPass').ok, true);
    assert.equal(store.verify('Str0ngPass'), true);
    // 改密后环境变量里的旧密码必须失效。
    assert.equal(store.verify(DEFAULT_PASSWORD), false);
    assert.equal(store.isUsingDefaultPassword(), false);

    // 新实例（模拟容器重建）读取持久化凭据。
    const reloaded = createCredentialStore({ credentialFile: file, envPassword: DEFAULT_PASSWORD });
    assert.equal(reloaded.verify('Str0ngPass'), true);
    assert.equal(reloaded.isUsingDefaultPassword(), false);
});

test('credential file is written with owner-only permissions', () => {
    const file = tmpFile('auth.json');
    createCredentialStore({ credentialFile: file, envPassword: 'x' }).setPassword('Str0ngPass');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('weak passwords are rejected', () => {
    const store = createCredentialStore({ credentialFile: tmpFile('auth.json'), envPassword: 'x' });
    assert.equal(store.setPassword('short1').ok, false);          // 太短
    assert.equal(store.setPassword('abcdefghij').ok, false);      // 无数字
    assert.equal(store.setPassword('1234567890').ok, false);      // 无字母
    assert.equal(store.setPassword(DEFAULT_PASSWORD).ok, false);  // 默认密码
    assert.equal(store.setPassword('Str0ngPass').ok, true);
});

test('a corrupted credential file falls back instead of locking everyone out', () => {
    const file = tmpFile('auth.json');
    fs.writeFileSync(file, '{ broken');
    const store = createCredentialStore({ credentialFile: file, envPassword: 'env-secret-1', logger: { warn() {} } });
    assert.equal(store.verify('env-secret-1'), true);
});

/* ---- 登录速率限制 ---------------------------------------------------- */

test('login is locked after repeated failures from the same address', () => {
    let clock = 1_000_000;
    const auth = createAuthService({
        password: 'secret',
        loginLimit: { maxFailures: 3, lockoutMs: 60_000, windowMs: 600_000 },
        now: () => clock
    });
    const req = fakeReq();

    assert.equal(auth.checkLoginAllowed(req), null);
    auth.recordLoginFailure(req);
    auth.recordLoginFailure(req);
    assert.equal(auth.checkLoginAllowed(req), null, '未达阈值不应锁定');

    auth.recordLoginFailure(req);
    const locked = auth.checkLoginAllowed(req);
    assert.ok(locked, '达到阈值应锁定');
    assert.equal(locked.retryAfterSeconds, 60);
});

test('lockout expires after the configured window', () => {
    let clock = 1_000_000;
    const auth = createAuthService({
        password: 'secret',
        loginLimit: { maxFailures: 2, lockoutMs: 60_000, windowMs: 600_000 },
        now: () => clock
    });
    const req = fakeReq();

    auth.recordLoginFailure(req);
    auth.recordLoginFailure(req);
    assert.ok(auth.checkLoginAllowed(req));

    clock += 61_000;
    assert.equal(auth.checkLoginAllowed(req), null, '锁定应在超时后自动解除');
});

test('a successful login clears the failure counter', () => {
    let clock = 1_000_000;
    const auth = createAuthService({
        password: 'secret',
        loginLimit: { maxFailures: 3, lockoutMs: 60_000, windowMs: 600_000 },
        now: () => clock
    });
    const req = fakeReq();

    auth.recordLoginFailure(req);
    auth.recordLoginFailure(req);
    auth.recordLoginSuccess(req);

    // 计数清零后再失败两次仍不应锁定。
    auth.recordLoginFailure(req);
    auth.recordLoginFailure(req);
    assert.equal(auth.checkLoginAllowed(req), null);
});

test('lockout is tracked per source address', () => {
    let clock = 1_000_000;
    const auth = createAuthService({
        password: 'secret',
        loginLimit: { maxFailures: 2, lockoutMs: 60_000, windowMs: 600_000 },
        now: () => clock
    });

    const attacker = fakeReq('10.0.0.9');
    auth.recordLoginFailure(attacker);
    auth.recordLoginFailure(attacker);
    assert.ok(auth.checkLoginAllowed(attacker), '攻击来源应被锁定');

    // 正常运维不应被别人的失败连累。
    assert.equal(auth.checkLoginAllowed(fakeReq('10.0.0.2')), null);
});

test('failures outside the window do not accumulate', () => {
    let clock = 1_000_000;
    const auth = createAuthService({
        password: 'secret',
        loginLimit: { maxFailures: 3, lockoutMs: 60_000, windowMs: 10_000 },
        now: () => clock
    });
    const req = fakeReq();

    auth.recordLoginFailure(req);
    auth.recordLoginFailure(req);
    clock += 11_000;                 // 超出滑动窗口
    auth.recordLoginFailure(req);
    assert.equal(auth.checkLoginAllowed(req), null, '窗口外的历史失败不应累计');
});

test('expired sessions are pruned instead of accumulating', () => {
    let clock = 1_000_000;
    const auth = createAuthService({ password: 'secret', sessionTtlMs: 1000, now: () => clock });

    auth.createSession(fakeReq('10.0.0.3'), 'admin');
    auth.createSession(fakeReq('10.0.0.4'), 'admin');
    assert.equal(auth.pruneExpiredSessions(), 2);

    clock += 5000;
    assert.equal(auth.pruneExpiredSessions(), 0, '过期会话应被清理');
});

test('the failure that triggers the lockout is itself reported as locked', () => {
    /* 否则运维要等到下一次尝试才知道自己被锁了。 */
    let clock = 1_000_000;
    const auth = createAuthService({
        password: 'secret',
        loginLimit: { maxFailures: 3, lockoutMs: 60_000, windowMs: 600_000 },
        now: () => clock
    });
    const req = fakeReq('10.0.0.7');

    auth.recordLoginFailure(req);
    auth.recordLoginFailure(req);
    assert.equal(auth.checkLoginAllowed(req), null);

    const third = auth.recordLoginFailure(req);
    assert.equal(third.maxFailures, 3, '应返回阈值供提示剩余次数');
    // 触发锁定的那一次，立即就能查到锁定状态。
    assert.ok(auth.checkLoginAllowed(req), '触发锁定后应立即可见');
});

test('remaining attempts can be derived before lockout', () => {
    let clock = 1_000_000;
    const auth = createAuthService({
        password: 'secret',
        loginLimit: { maxFailures: 5, lockoutMs: 60_000, windowMs: 600_000 },
        now: () => clock
    });
    const req = fakeReq('10.0.0.8');

    const first = auth.recordLoginFailure(req);
    assert.equal(first.maxFailures - first.count, 4);
    const second = auth.recordLoginFailure(req);
    assert.equal(second.maxFailures - second.count, 3);
});

/* ---- 来源 IP 伪造防护 ------------------------------------------------ */

function fakeReqWithHeader(ip, forwardedFor) {
    return { headers: { 'x-forwarded-for': forwardedFor }, socket: { remoteAddress: ip } };
}

test('X-Forwarded-For is ignored by default so lockout cannot be bypassed', () => {
    /* 该请求头可被客户端任意伪造：若无条件采信，攻击者每次换一个假 IP
       就能完全绕过登录锁定。默认必须只认 TCP 对端地址。 */
    let clock = 1_000_000;
    const auth = createAuthService({
        password: 'secret',
        loginLimit: { maxFailures: 2, lockoutMs: 60_000, windowMs: 600_000 },
        now: () => clock
    });

    // 同一个真实来源，但每次伪造不同的 XFF
    auth.recordLoginFailure(fakeReqWithHeader('10.0.0.50', '1.1.1.1'));
    auth.recordLoginFailure(fakeReqWithHeader('10.0.0.50', '2.2.2.2'));

    const locked = auth.checkLoginAllowed(fakeReqWithHeader('10.0.0.50', '3.3.3.3'));
    assert.ok(locked, '伪造 XFF 不应绕过锁定');
});

test('X-Forwarded-For is honoured when trustProxy is enabled', () => {
    let clock = 1_000_000;
    const auth = createAuthService({
        password: 'secret',
        loginLimit: { maxFailures: 2, lockoutMs: 60_000, windowMs: 600_000 },
        trustProxy: true,
        now: () => clock
    });

    // 反向代理场景：真实来源由 XFF 提供，不同 XFF 视为不同来源。
    auth.recordLoginFailure(fakeReqWithHeader('10.0.0.50', '1.1.1.1'));
    auth.recordLoginFailure(fakeReqWithHeader('10.0.0.50', '1.1.1.1'));
    assert.ok(auth.checkLoginAllowed(fakeReqWithHeader('10.0.0.50', '1.1.1.1')), '同一真实来源应被锁定');
    assert.equal(auth.checkLoginAllowed(fakeReqWithHeader('10.0.0.50', '9.9.9.9')), null, '其他来源不受影响');
});

test('session actor records the resolved client ip', () => {
    const auth = createAuthService({ password: 'secret' });
    auth.createSession(fakeReqWithHeader('10.0.0.60', '8.8.8.8'), 'admin');
    // 默认不信任 XFF，审计里记录的应是真实对端地址。
    const req = fakeReqWithHeader('10.0.0.60', '8.8.8.8');
    assert.equal(auth.getRequestActor(req).ip, '10.0.0.60');
});
