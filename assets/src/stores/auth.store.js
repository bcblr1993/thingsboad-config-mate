/**
 * Authentication state slice.
 *
 *   authStore.subscribe(state => render(state.operator));
 *   authStore.setOperator('alice');
 *   authStore.clear();
 *
 * Persistence:
 *   The operator id is mirrored to localStorage[STORAGE_KEY.OPERATOR]
 *   so that the login form can pre-fill across reloads. Reading from
 *   localStorage during construction makes this safe even if the
 *   service hasn't run yet.
 */

import { createStore } from '../core/store.js';
import { STORAGE_KEY } from '../constants/ui.js';

function readStoredOperator() {
    try { return localStorage.getItem(STORAGE_KEY.OPERATOR) || ''; }
    catch { return ''; }
}

const initial = {
    /** Operator id of the current session ('' when logged out). */
    operator: readStoredOperator(),

    /** Authoritative auth state from the server (null when not yet checked). */
    authenticated: null,

    /** Whether the server requires authentication at all. */
    required: true
};

const store = createStore(initial);

function setOperator(operator) {
    const value = operator || '';
    store.set({ operator: value });
    try {
        if (value) localStorage.setItem(STORAGE_KEY.OPERATOR, value);
        else localStorage.removeItem(STORAGE_KEY.OPERATOR);
    } catch { /* localStorage may be disabled */ }
}

/**
 * @param {boolean} authenticated
 * @param {{required?: boolean}} [opts]
 */
function setAuthenticated(authenticated, opts) {
    const required = opts?.required;
    /** @type {{authenticated: boolean, required?: boolean}} */
    const patch = { authenticated: Boolean(authenticated) };
    if (required !== undefined) patch.required = Boolean(required);
    store.set(patch);
}

function clear() {
    store.set({ operator: '', authenticated: false });
    try { localStorage.removeItem(STORAGE_KEY.OPERATOR); }
    catch { /* ignore */ }
}

export const authStore = {
    get: store.get,
    subscribe: store.subscribe,
    setOperator,
    setAuthenticated,
    clear
};
