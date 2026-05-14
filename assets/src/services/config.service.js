/**
 * Config service — orchestrates business config (.env) load, edit, save,
 * apply, and history operations.
 *
 * Boundaries:
 *   - Calls configApi (HTTP)
 *   - Reads/writes configStore
 *   - Reports status via uiStore
 *   - Emits events on the bus (config:loaded, config:saved, config:applied,
 *     config:restored)
 *   - Does NOT touch the DOM
 *
 * Migration target:
 *   Legacy app.js currently inlines these flows around lines 167 (load),
 *   557 (plan), 1252 (rawEnv), 1365 (saveRaw), 1368 (saveConfig), 1405
 *   (applyPlan).
 */

import { configApi } from '../api/config.api.js';
import { configStore } from '../stores/config.store.js';
import { uiStore } from '../stores/ui.store.js';
import { eventBus } from '../core/event-bus.js';
import { TOAST_TYPE } from '../constants/toast-type.js';
import { logger } from '../core/logger.js';

const LOADING_KEY = {
    LOAD:        'config.load',
    LOAD_RAW:    'config.loadRaw',
    PLAN:        'config.plan',
    SAVE:        'config.save',
    SAVE_RAW:    'config.saveRaw',
    APPLY:       'config.apply',
    HISTORY:     'config.history',
    RESTORE:     'config.restore'
};

async function loadConfig() {
    uiStore.setLoading(LOADING_KEY.LOAD, true);
    try {
        // Legacy /api/config returns { meta, values } shape; expose as-is.
        const data = await configApi.get();
        if (data?.meta) configStore.setMeta(data.meta);
        configStore.setValues(data?.values || data || {}, { markClean: true });
        eventBus.emit('config:loaded', data);
        return data;
    } finally {
        uiStore.setLoading(LOADING_KEY.LOAD, false);
    }
}

async function loadRawSource() {
    uiStore.setLoading(LOADING_KEY.LOAD_RAW, true);
    try {
        const text = await configApi.rawEnv();
        configStore.setRawSource(text, { markClean: true });
        return text;
    } finally {
        uiStore.setLoading(LOADING_KEY.LOAD_RAW, false);
    }
}

async function computePlan(values = configStore.get().values) {
    uiStore.setLoading(LOADING_KEY.PLAN, true);
    try {
        return await configApi.plan(values);
    } finally {
        uiStore.setLoading(LOADING_KEY.PLAN, false);
    }
}

async function save() {
    const values = configStore.get().values;
    uiStore.setLoading(LOADING_KEY.SAVE, true);
    try {
        const result = await configApi.saveValues(values);
        configStore.markSaved();
        eventBus.emit('config:saved', { values, result });
        uiStore.pushToast({ message: '✅ 配置保存成功', type: TOAST_TYPE.SUCCESS });
        return result;
    } catch (err) {
        uiStore.pushToast({ message: '保存失败：' + err.message, type: TOAST_TYPE.ERROR });
        throw err;
    } finally {
        uiStore.setLoading(LOADING_KEY.SAVE, false);
    }
}

async function saveRaw() {
    const text = configStore.get().rawSource;
    uiStore.setLoading(LOADING_KEY.SAVE_RAW, true);
    try {
        const result = await configApi.saveRaw(text);
        configStore.markSaved();
        eventBus.emit('config:saved', { rawSource: text, result });
        return result;
    } finally {
        uiStore.setLoading(LOADING_KEY.SAVE_RAW, false);
    }
}

async function applyPlan(save = true) {
    const values = configStore.get().values;
    uiStore.setLoading(LOADING_KEY.APPLY, true);
    try {
        const result = await configApi.applyPlan(values, save);
        if (save) configStore.markSaved();
        eventBus.emit('config:applied', { values, save, result });
        return result;
    } finally {
        uiStore.setLoading(LOADING_KEY.APPLY, false);
    }
}

async function listHistory() {
    uiStore.setLoading(LOADING_KEY.HISTORY, true);
    try {
        return await configApi.history();
    } finally {
        uiStore.setLoading(LOADING_KEY.HISTORY, false);
    }
}

async function getHistoryContent(filename) {
    return await configApi.historyContent(filename);
}

async function restoreFromHistory(filename) {
    uiStore.setLoading(LOADING_KEY.RESTORE, true);
    try {
        const result = await configApi.restoreHistory(filename);
        eventBus.emit('config:restored', { filename, result });
        return result;
    } catch (err) {
        logger.error('restoreFromHistory failed:', err);
        throw err;
    } finally {
        uiStore.setLoading(LOADING_KEY.RESTORE, false);
    }
}

export const configService = {
    loadConfig,
    loadRawSource,
    computePlan,
    save,
    saveRaw,
    applyPlan,
    listHistory,
    getHistoryContent,
    restoreFromHistory,
    LOADING_KEY
};
