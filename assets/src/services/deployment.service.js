/**
 * Deployment service — orchestrates service list refresh, action triggers,
 * cleanup planning, and runtime diff inspection.
 *
 * Boundaries:
 *   - Calls serviceApi + systemApi (HTTP)
 *   - Reads/writes deploymentStore
 *   - Reports status via uiStore (named loadings, toasts)
 *   - Emits events on the bus (deployment:refreshed, service:action,
 *     service:cleanup-completed)
 *   - Does NOT touch the DOM
 *
 * Migration target:
 *   Legacy app.js currently inlines these flows around lines 468 (deployment),
 *   667 (services list), 748 (serviceConfig), 872 (cleanupPlan), 886
 *   (cleanup), 915 (serviceAction), 1851 (runtimeDiff). They migrate
 *   to call deploymentService.* once pages/deployment.page.js exists.
 */

import { serviceApi } from '../api/service.api.js';
import { systemApi } from '../api/system.api.js';
import { deploymentStore } from '../stores/deployment.store.js';
import { uiStore } from '../stores/ui.store.js';
import { eventBus } from '../core/event-bus.js';
import { TOAST_TYPE } from '../constants/toast-type.js';
import { logger } from '../core/logger.js';

const LOADING_KEY = {
    DEPLOYMENT_INFO: 'deployment.info',
    SERVICES_LIST:   'deployment.services',
    SERVICE_CONFIG:  'deployment.serviceConfig',
    SERVICE_ACTION:  'deployment.serviceAction',
    CLEANUP:         'deployment.cleanup',
    RUNTIME_DIFF:    'deployment.runtimeDiff'
};

async function refreshDeployment() {
    uiStore.setLoading(LOADING_KEY.DEPLOYMENT_INFO, true);
    try {
        const data = await systemApi.deployment();
        deploymentStore.setDeployment(data);
        return data;
    } catch (err) {
        logger.error('refreshDeployment failed:', err);
        uiStore.pushToast({ message: '部署信息加载失败：' + err.message, type: TOAST_TYPE.ERROR });
        throw err;
    } finally {
        uiStore.setLoading(LOADING_KEY.DEPLOYMENT_INFO, false);
    }
}

async function refreshServices() {
    uiStore.setLoading(LOADING_KEY.SERVICES_LIST, true);
    try {
        const list = await serviceApi.list();
        deploymentStore.setServices(list);
        eventBus.emit('deployment:refreshed', list);
        return list;
    } finally {
        uiStore.setLoading(LOADING_KEY.SERVICES_LIST, false);
    }
}

async function loadServiceConfig(serviceId) {
    if (!serviceId) {
        deploymentStore.setSelectedConfig(null);
        return null;
    }
    deploymentStore.selectService(serviceId);
    uiStore.setLoading(LOADING_KEY.SERVICE_CONFIG, true);
    try {
        const config = await serviceApi.config(serviceId);
        deploymentStore.setSelectedConfig(config);
        return config;
    } finally {
        uiStore.setLoading(LOADING_KEY.SERVICE_CONFIG, false);
    }
}

async function runAction(serviceId, action) {
    uiStore.setLoading(LOADING_KEY.SERVICE_ACTION, true);
    try {
        const result = await serviceApi.runAction(serviceId, action);
        eventBus.emit('service:action', { serviceId, action, result });
        // Refresh list silently to reflect state change
        refreshServices().catch(err => logger.warn('post-action refresh failed:', err));
        return result;
    } finally {
        uiStore.setLoading(LOADING_KEY.SERVICE_ACTION, false);
    }
}

async function planCleanup(serviceId) {
    uiStore.setLoading(LOADING_KEY.CLEANUP, true);
    try {
        return await serviceApi.cleanupPlan(serviceId);
    } finally {
        uiStore.setLoading(LOADING_KEY.CLEANUP, false);
    }
}

async function performCleanup(serviceId, confirmServiceId) {
    uiStore.setLoading(LOADING_KEY.CLEANUP, true);
    try {
        const result = await serviceApi.cleanup(serviceId, confirmServiceId);
        eventBus.emit('service:cleanup-completed', { serviceId, result });
        refreshServices().catch(err => logger.warn('post-cleanup refresh failed:', err));
        return result;
    } finally {
        uiStore.setLoading(LOADING_KEY.CLEANUP, false);
    }
}

async function fetchRuntimeDiff() {
    uiStore.setLoading(LOADING_KEY.RUNTIME_DIFF, true);
    try {
        return await serviceApi.runtimeDiff();
    } finally {
        uiStore.setLoading(LOADING_KEY.RUNTIME_DIFF, false);
    }
}

export const deploymentService = {
    refreshDeployment,
    refreshServices,
    loadServiceConfig,
    runAction,
    planCleanup,
    performCleanup,
    fetchRuntimeDiff,
    LOADING_KEY
};
