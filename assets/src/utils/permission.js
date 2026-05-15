/**
 * Permission helpers.
 *
 * Today the backend exposes a single operator role; there is no
 * fine-grained RBAC. This module provides the API shape so future
 * features (audit / multi-tenant) plug in without spreading auth
 * checks across pages.
 *
 * Usage:
 *   import { permission } from '@/src/utils/permission.js';
 *   permission.isLoggedIn()                       → boolean
 *   permission.has('cleanup.execute')             → boolean
 *   permission.canAccessRoute('/services')        → boolean
 *   const off = permission.subscribe(state => ...)
 *
 * Backend contract (existing today):
 *   /api/auth/status returns { required, authenticated, operator }
 *
 * Future extension:
 *   When the backend gains roles / capabilities, extend
 *   evaluateCapabilities() — call sites do not change.
 */

import { authStore } from '../stores/auth.store.js';

/**
 * @typedef {Object} CapabilityMap
 * @property {boolean} cleanupExecute
 * @property {boolean} configEdit
 * @property {boolean} serviceRestart
 * @property {boolean} historyRestore
 * @property {boolean} installRun
 */

/** @returns {CapabilityMap} */
function evaluateCapabilities() {
    const auth = authStore.get();
    const loggedIn = !auth.required || auth.authenticated;
    return {
        cleanupExecute: loggedIn,
        configEdit:     loggedIn,
        serviceRestart: loggedIn,
        historyRestore: loggedIn,
        installRun:     loggedIn
    };
}

const ROUTE_REQUIREMENTS = {
    '/login':       () => true,
    '/services':    () => isLoggedIn(),
    '/config':      () => isLoggedIn(),
    '/logs':        () => isLoggedIn(),
    '/history':     () => isLoggedIn(),
    '/settings':    () => isLoggedIn()
};

function isLoggedIn() {
    const auth = authStore.get();
    if (!auth.required) return true;
    return Boolean(auth.authenticated);
}

function has(capability) {
    const caps = evaluateCapabilities();
    // Allow either camelCase or dot.case lookup
    const key = capability.replace(/[._-](.)/g, (_, c) => c.toUpperCase());
    return Boolean(caps[key]);
}

function canAccessRoute(path) {
    const check = ROUTE_REQUIREMENTS[path];
    if (!check) return true;
    return Boolean(check());
}

function operator() {
    return authStore.get().operator || '';
}

export const permission = {
    isLoggedIn,
    has,
    canAccessRoute,
    operator,
    capabilities: evaluateCapabilities,

    /** React to auth changes. Returns unsubscribe. */
    subscribe(fn) {
        return authStore.subscribe(() => fn(evaluateCapabilities()));
    }
};
