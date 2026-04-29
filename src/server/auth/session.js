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

function createAuthService({
    password = '',
    sessionTtlMs = 24 * 60 * 60 * 1000
} = {}) {
    const sessions = new Map();
    const authRequired = password.trim().length > 0;

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
        if (session.expiresAt < Date.now()) {
            sessions.delete(token);
            return null;
        }

        session.expiresAt = Date.now() + sessionTtlMs;
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
            expiresAt: Date.now() + sessionTtlMs
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

    return {
        authRequired,
        getAuthToken,
        getSession,
        isAuthenticated,
        createSession,
        destroySession,
        getRequestActor,
        getClientIp,
        normalizeOperatorName
    };
}

module.exports = {
    createAuthService,
    parseCookies,
    getClientIp,
    normalizeOperatorName
};
