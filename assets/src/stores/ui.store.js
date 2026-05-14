/**
 * Global UI store: named loadings, toast queue, modal stack, global error banner.
 *
 * Replaces these legacy patterns scattered across app.js:
 *   - `let isActionPending = false` (app.js:1485) — anti-double-click flag
 *   - direct showToast() calls from anywhere → toast queue with id
 *   - openModal/closeModal called by string id from anywhere → modal stack
 *
 * Subscribe to the whole state; consumer decides what to read.
 *
 *   uiStore.subscribe(state => renderSpinners(state.loadings));
 *   uiStore.setLoading('deployment.refresh', true);
 *   const id = uiStore.pushToast({ message: '保存成功', type: 'success' });
 *   uiStore.dismissToast(id);
 */

import { createStore } from '../core/store.js';
import { TOAST_TYPE, TOAST_DEFAULT_DURATION_MS } from '../constants/ui.js';
import { TOAST_TYPE as _TOAST_TYPE } from '../constants/toast-type.js'; // re-import for explicit usage

const initial = {
    /** @type {Record<string, boolean>} */
    loadings: {},

    /** @type {Array<{id: string, message: string, type: string, duration: number}>} */
    toasts: [],

    /** @type {string[]} stack of open modal ids (top = most recent) */
    modalStack: [],

    /** @type {{visible: boolean, message: string, type: string} | null} */
    globalBanner: null
};

const store = createStore(initial);

let toastCounter = 0;
function nextToastId() {
    toastCounter += 1;
    return `t_${Date.now()}_${toastCounter}`;
}

/* ---------- loadings ---------- */

function setLoading(key, value) {
    const current = store.get().loadings;
    if (Boolean(current[key]) === Boolean(value)) return;
    const loadings = { ...current };
    if (value) loadings[key] = true;
    else delete loadings[key];
    store.set({ loadings });
}

function isLoading(key) {
    return Boolean(store.get().loadings[key]);
}

function isAnyLoading() {
    return Object.keys(store.get().loadings).length > 0;
}

/* ---------- toasts ---------- */

function pushToast({ message, type = _TOAST_TYPE.INFO, duration = TOAST_DEFAULT_DURATION_MS } = {}) {
    const id = nextToastId();
    const toast = { id, message: String(message ?? ''), type, duration };
    store.set(s => ({ toasts: [...s.toasts, toast] }));
    if (duration > 0) setTimeout(() => dismissToast(id), duration);
    return id;
}

function dismissToast(id) {
    store.set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
}

function clearToasts() {
    store.set({ toasts: [] });
}

/* ---------- modals ---------- */

function pushModal(modalId) {
    if (!modalId) return;
    store.set(s => ({ modalStack: [...s.modalStack, modalId] }));
}

function popModal(modalId) {
    store.set(s => ({
        modalStack: modalId
            ? s.modalStack.filter(id => id !== modalId)
            : s.modalStack.slice(0, -1)
    }));
}

function topModal() {
    const stack = store.get().modalStack;
    return stack[stack.length - 1] || null;
}

/* ---------- global banner ---------- */

function showBanner({ message, type = _TOAST_TYPE.INFO } = {}) {
    store.set({ globalBanner: { visible: true, message, type } });
}

function hideBanner() {
    store.set({ globalBanner: null });
}

/* ---------- public surface ---------- */

export const uiStore = {
    get: store.get,
    subscribe: store.subscribe,

    setLoading, isLoading, isAnyLoading,
    pushToast, dismissToast, clearToasts,
    pushModal, popModal, topModal,
    showBanner, hideBanner,

    TOAST_TYPE
};
