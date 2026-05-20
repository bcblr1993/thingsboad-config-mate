/**
 * Authentication service — orchestrates login / logout / session-check.
 *
 * Boundaries:
 *   - Reads/writes authStore (operator, authenticated, required)
 *   - Calls authApi (HTTP)
 *   - Emits events on the bus (auth:login, auth:logout, auth:expired)
 *   - DOES NOT touch the DOM. Pages subscribe to authStore + events
 *     and decide what to render (login overlay vs main app).
 *
 * Migration target:
 *   Today the equivalent flow lives inline in app.js (boot / login /
 *   logout / showLoginOverlay). This service is the destination they
 *   migrate to in stage 3.10+.
 */

import { authApi } from '../api/auth.api.js';
import { authStore } from '../stores/auth.store.js';
import { uiStore } from '../stores/ui.store.js';
import { eventBus } from '../core/event-bus.js';
import { TOAST_TYPE } from '../constants/toast-type.js';
import { HttpError } from '../core/errors.js';
import { logger } from '../core/logger.js';

const LOADING_KEY = {
    BOOT:   'auth.boot',
    LOGIN:  'auth.login',
    LOGOUT: 'auth.logout'
};

/**
 * Bootstrap session check. Call once during page init.
 * @returns {Promise<{authenticated: boolean, operator: string, required: boolean}>}
 */
async function checkSession() {
    uiStore.setLoading(LOADING_KEY.BOOT, true);
    try {
        const res = await authApi.status();
        // status() returns parsed payload via http.js
        const required = Boolean(res?.required);
        const authenticated = Boolean(res?.authenticated);
        const operator = res?.operator || authStore.get().operator || '';

        authStore.setAuthenticated(authenticated, { required });
        if (authenticated && operator) authStore.setOperator(operator);

        return { authenticated, operator, required };
    } catch (err) {
        logger.error('checkSession failed:', err);
        throw err;
    } finally {
        uiStore.setLoading(LOADING_KEY.BOOT, false);
    }
}

/**
 * Log in with the single admin account and password.
 * Pushes a toast on failure; throws so callers can react further.
 *
 * @param {{operator?: string, password: string}} credentials
 */
async function login({ operator = 'admin', password }) {
    uiStore.setLoading(LOADING_KEY.LOGIN, true);
    try {
        const data = await authApi.login({ operator, password });
        // legacy backend shape: { status: 'success' | 'error', operator?, message? }
        if (data?.status !== 'success') {
            const message = data?.message || '登录失败';
            uiStore.pushToast({ message, type: TOAST_TYPE.ERROR });
            throw new Error(message);
        }
        const finalOperator = data.operator || operator;
        authStore.setOperator(finalOperator);
        authStore.setAuthenticated(true);
        eventBus.emit('auth:login', { operator: finalOperator });
        return { operator: finalOperator };
    } catch (err) {
        if (err instanceof HttpError && !err.isUnauthorized) {
            uiStore.pushToast({ message: '登录失败：' + err.message, type: TOAST_TYPE.ERROR });
        }
        throw err;
    } finally {
        uiStore.setLoading(LOADING_KEY.LOGIN, false);
    }
}

/**
 * Log out. Always clears local state, even if the server call fails.
 */
async function logout() {
    uiStore.setLoading(LOADING_KEY.LOGOUT, true);
    try {
        await authApi.logout().catch(err => {
            logger.warn('logout request failed; clearing local state anyway:', err);
        });
    } finally {
        authStore.clear();
        uiStore.setLoading(LOADING_KEY.LOGOUT, false);
        eventBus.emit('auth:logout', {});
    }
}

/**
 * Notify the system that the session has expired (e.g. from a 401 response
 * intercepted by http.js). Triggers store/event updates so the page can
 * present the login overlay.
 *
 * @param {string} [reason]
 */
function notifyExpired(reason = '登录已过期，请重新登录') {
    authStore.setAuthenticated(false);
    eventBus.emit('auth:expired', { reason });
    uiStore.pushToast({ message: reason, type: TOAST_TYPE.WARNING });
}

export const authService = {
    checkSession,
    login,
    logout,
    notifyExpired,
    LOADING_KEY
};
