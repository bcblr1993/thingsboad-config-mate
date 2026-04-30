(function () {
    const nativeFetch = window.fetch.bind(window);
    let unauthorizedHandler = null;
    let authExpiredNotified = false;

    function getRequestPath(input) {
        try {
            const rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
            return new URL(rawUrl, window.location.origin).pathname;
        } catch (e) {
            return '';
        }
    }

    function resetAuthExpiredNotice() {
        authExpiredNotified = false;
    }

    function setUnauthorizedHandler(handler) {
        unauthorizedHandler = typeof handler === 'function' ? handler : null;
        resetAuthExpiredNotice();
    }

    function notifyUnauthorized() {
        if (authExpiredNotified) return;
        authExpiredNotified = true;
        if (unauthorizedHandler) unauthorizedHandler();
    }

    async function request(input, init) {
        const res = await nativeFetch(input, init);
        const path = getRequestPath(input);
        const skipAuthOverlay = path === '/api/login' || path === '/api/auth/status';
        if (res.status === 401 && !skipAuthOverlay) {
            notifyUnauthorized();
        }
        return res;
    }

    function postJson(path, body) {
        return request(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        });
    }

    function postText(path, body) {
        return request(path, {
            method: 'POST',
            body
        });
    }

    function servicePath(serviceId, suffix = '') {
        return `/api/services/${encodeURIComponent(serviceId)}${suffix}`;
    }

    function logsUrl(serviceId) {
        const query = serviceId ? `?service=${encodeURIComponent(serviceId)}` : '';
        return `/api/logs${query}`;
    }

    window.ConfigMateApi = {
        request,
        postJson,
        postText,
        setUnauthorizedHandler,
        resetAuthExpiredNotice,
        logsUrl,

        authStatus: () => request('/api/auth/status'),
        login: ({ operator, password }) => postJson('/api/login', { operator, password }),
        logout: () => request('/api/logout', { method: 'POST' }),
        config: () => request('/api/config'),
        deployment: () => request('/api/deployment'),
        plan: config => postJson('/api/plan', { config }),
        services: () => request('/api/services'),
        serviceConfig: serviceId => request(servicePath(serviceId, '/config')),
        cleanupPlan: serviceId => request(servicePath(serviceId, '/cleanup-plan')),
        cleanup: (serviceId, confirmServiceId) => postJson(servicePath(serviceId, '/cleanup'), { confirmServiceId }),
        serviceAction: (serviceId, action) => request(servicePath(serviceId, `/${encodeURIComponent(action)}`), { method: 'POST' }),
        rawEnv: () => request('/api/env-raw'),
        saveRaw: rawContent => postText('/api/save-raw', rawContent),
        saveConfig: values => postJson('/api/save', values || {}),
        applyPlan: (config, save = true) => postJson('/api/apply-plan', { config, save }),
        status: () => request('/api/status'),
        stopAppService: () => request('/api/stop', { method: 'POST' }),
        restartAppService: () => request('/api/service-restart', { method: 'POST' }),
        history: () => request('/api/history'),
        historyContent: filename => postJson('/api/history/content', { filename }),
        restoreHistory: filename => postJson('/api/history/restore', { filename }),
        version: () => request('/api/version'),
        runtimeDiff: () => request('/api/diff-runtime'),
        checkInstall: () => request('/api/check-install'),
        install: () => request('/api/install', { method: 'POST' }),
        validateCompose: () => request('/api/validate-compose?t=' + Date.now())
    };

    window.fetch = request;
})();
