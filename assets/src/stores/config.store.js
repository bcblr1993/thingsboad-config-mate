/**
 * Business config (.env) state slice.
 *
 * Mirrors legacy app.js top-level state:
 *   configMeta, configValues, initialConfigValues, initialSourceContent, isDirty
 */

import { createStore } from '../core/store.js';

const initial = {
    /** Config schema metadata (sections, fields, validators). */
    meta: {},

    /** Current effective values (mutable, edited by user). */
    values: {},

    /** Snapshot of values at last load — used for dirty detection. */
    initialValues: {},

    /** Raw .env source when in source mode. */
    rawSource: '',

    /** Snapshot of raw source at last load. */
    initialRawSource: null,

    /** Computed flag: any unsaved change. */
    isDirty: false
};

const store = createStore(initial);

function isSameRecord(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => a[k] === b[k]);
}

function recomputeDirty(state) {
    if (state.initialRawSource !== null && state.rawSource !== state.initialRawSource) return true;
    return !isSameRecord(state.values, state.initialValues);
}

export const configStore = {
    get: store.get,
    subscribe: store.subscribe,

    setMeta(meta) { store.set({ meta: meta || {} }); },

    setValues(values, { markClean = false } = {}) {
        const next = { ...(values || {}) };
        store.set(prev => {
            const initialValues = markClean ? next : prev.initialValues;
            const newState = { ...prev, values: next, initialValues };
            return { values: next, initialValues, isDirty: recomputeDirty(newState) };
        });
    },

    updateValue(key, value) {
        store.set(prev => {
            const values = { ...prev.values, [key]: value };
            const newState = { ...prev, values };
            return { values, isDirty: recomputeDirty(newState) };
        });
    },

    setRawSource(rawSource, { markClean = false } = {}) {
        const text = rawSource ?? '';
        store.set(prev => {
            const initialRawSource = markClean ? text : prev.initialRawSource;
            const newState = { ...prev, rawSource: text, initialRawSource };
            return { rawSource: text, initialRawSource, isDirty: recomputeDirty(newState) };
        });
    },

    markSaved() {
        store.set(prev => ({
            initialValues: { ...prev.values },
            initialRawSource: prev.rawSource,
            isDirty: false
        }));
    },

    clear() { store.replace(initial); }
};
