const crypto = require('crypto');

function parseCookies(req) {
    const header = req.headers.cookie || '';
    const cookies = {};
    header.split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx === -1) return;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        cookies[key] = decodeURIComponent(val);
    });
    return cookies;
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || '';
}

function normalizeOperatorName(value) {
    const text = String(value || '').trim();
    return text.slice(0, 64);
}

const DEFAULT_LOGIN_LIMIT = {
    maxFailures: 5,           // 连续失败次数上限
    lockoutMs: 5 * 60 * 1000, // 触发后锁定时长
    windowMs: 15 * 60 * 1000  // 失败计数的滑动窗口
};

function createAuthService({
    password = '',
    sessionTtlMs = 24 * 60 * 60 * 1000,
    loginLimit = {},
    now = () => Date.now()
} = {}) {
    const sessions = new Map();
    const authRequired = password.trim().length > 0;
    const limit = { ...DEFAULT_LOGIN_LIMIT, ...loginLimit };
    /* 按来源 IP 记录登录失败。改造前没有任何速率限制，6 位数字密码
       可以在很短时间内被穷举；多节点部署后每个节点都是一个入口。 */
    const loginFailures = new Map();

    function pruneLoginFailures() {
        const cutoff = now() - limit.windowMs;
        loginFailures.forEach((entry, key) => {
            if (entry.lockedUntil <= now() && entry.lastFailureAt < cutoff) {
                loginFailures.delete(key);
            }
        });
    }

    /** 返回 null 表示允许尝试；否则返回剩余锁定秒数。 */
    function checkLoginAllowed(req) {
        const key = getClientIp(req) || 'unknown';
        const entry = loginFailures.get(key);
        if (!entry) return null;
        if (entry.lockedUntil > now()) {
            return { retryAfterSeconds: Math.ceil((entry.lockedUntil - now()) / 1000) };
        }
        return null;
    }

    function recordLoginFailure(req) {
        pruneLoginFailures();
        const key = getClientIp(req) || 'unknown';
        const entry = loginFailures.get(key) || { count: 0, lastFailureAt: 0, lockedUntil: 0 };

        // 超出窗口的历史失败不再累计。
        if (entry.lastFailureAt && now() - entry.lastFailureAt > limit.windowMs) {
            entry.count = 0;
        }
        entry.count += 1;
        entry.lastFailureAt = now();
        if (entry.count >= limit.maxFailures) {
            entry.lockedUntil = now() + limit.lockoutMs;
            entry.count = 0;
        }
        loginFailures.set(key, entry);
        return entry;
    }

    function recordLoginSuccess(req) {
        loginFailures.delete(getClientIp(req) || 'unknown');
    }

    function getAuthToken(req) {
        const auth = req.headers.authorization || '';
        let token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!token) token = parseCookies(req).config_mate_session;
        return token;
    }

    function getSession(req) {
        const token = getAuthToken(req);
        if (!token || !sessions.has(token)) return null;

        const session = sessions.get(token);
        if (session.expiresAt < now()) {
            sessions.delete(token);
            return null;
        }

        session.expiresAt = now() + sessionTtlMs;
        return { ...session, token };
    }

    function isAuthenticated(req) {
        if (!authRequired) return true;
        return !!getSession(req);
    }

    function createSession(req, operator) {
        const token = crypto.randomBytes(32).toString('hex');
        const sessionId = token.slice(0, 10);
        sessions.set(token, {
            operator: normalizeOperatorName(operator) || 'operator',
            sessionId,
            loginAt: new Date().toISOString(),
            ip: getClientIp(req),
            expiresAt: now() + sessionTtlMs
        });
        return token;
    }

    function destroySession(token) {
        if (token) sessions.delete(token);
    }

    function getRequestActor(req) {
        const session = getSession(req);
        return {
            operator: session?.operator || 'anonymous',
            sessionId: session?.sessionId || 'anonymous',
            ip: session?.ip || getClientIp(req)
        };
    }

    /* 会话过期原本只在访问时惰性清理，长期运行会缓慢堆积。 */
    function pruneExpiredSessions() {
        const current = now();
        sessions.forEach((session, token) => {
            if (session.expiresAt < current) sessions.delete(token);
        });
        return sessions.size;
    }

    return {
        authRequired,
        checkLoginAllowed,
        createSession,
        destroySession,
        getAuthToken,
        getClientIp,
        getRequestActor,
        getSession,
        isAuthenticated,
        normalizeOperatorName,
        pruneExpiredSessions,
        recordLoginFailure,
        recordLoginSuccess
    };
}

module.exports = {
    DEFAULT_LOGIN_LIMIT,
    createAuthService,
    parseCookies,
    getClientIp,
    normalizeOperatorName
};
