/**
 * Deployment / services state slice.
 *
 * Mirrors the legacy app.js top-level state:
 *   deploymentInfo, latestServices, selectedServiceId, selectedServiceConfig
 *
 * Pages and components subscribe; the deployment service is the only
 * caller that mutates this store.
 */

import { createStore } from '../core/store.js';

/**
 * @typedef {import('../types/deployment.types.js').DeploymentInfo} DeploymentInfo
 * @typedef {import('../types/service.types.js').ServiceInfo} ServiceInfo
 * @typedef {import('../types/service.types.js').ServiceConfig} ServiceConfig
 */

const initial = {
    /** @type {DeploymentInfo | null} */
    deployment: null,

    /** @type {ServiceInfo[]} */
    services: [],

    /** @type {string | null} */
    selectedServiceId: null,

    /** @type {ServiceConfig | null} */
    selectedServiceConfig: null,

    /** @type {string} - last refresh ISO timestamp for diagnostics */
    lastRefreshedAt: ''
};

const store = createStore(initial);

export const deploymentStore = {
    get: store.get,
    subscribe: store.subscribe,

    setDeployment(deployment) { store.set({ deployment }); },

    setServices(services) {
        store.set({
            services: Array.isArray(services) ? services : [],
            lastRefreshedAt: new Date().toISOString()
        });
    },

    selectService(serviceId) { store.set({ selectedServiceId: serviceId || null }); },

    setSelectedConfig(config) { store.set({ selectedServiceConfig: config || null }); },

    clear() { store.replace(initial); }
};
