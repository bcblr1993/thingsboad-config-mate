/**
 * State bridge — mirrors mutations from legacy app.js into the new ESM
 * stores so that future ESM-based pages and components can subscribe
 * to a single source of truth without rewriting app.js end-to-end.
 *
 * Direction:  app.js (push)  →  stores (read by ESM consumers)
 *
 * Why:
 *   app.js holds business state in top-level `let` variables that we
 *   cannot proxy or observe from the outside. Rather than rewrite all
 *   ~25 mutation sites at once (very high regression risk), we add
 *   tiny push hooks at the existing mutation points. Stores become a
 *   read-only mirror; new ESM code can subscribe normally.
 *
 * Removal plan:
 *   When app.js eventually disappears (stage 3.14 + 4 fully done),
 *   delete this file along with the bridge.js wiring.
 */

import { authStore } from '../stores/auth.store.js';
import { deploymentStore } from '../stores/deployment.store.js';
import { configStore } from '../stores/config.store.js';
import { eventBus } from './event-bus.js';
import { logger } from './logger.js';

function pushOperator(operator) {
    authStore.setOperator(operator || '');
    authStore.setAuthenticated(Boolean(operator));
    if (operator) eventBus.emit('auth:login', { operator });
    else eventBus.emit('auth:logout', {});
}

function pushUnauthorized() {
    authStore.setAuthenticated(false);
    eventBus.emit('auth:expired', {});
}

function pushDeployment(deployment) {
    deploymentStore.setDeployment(deployment || null);
}

function pushServices(services) {
    deploymentStore.setServices(services || []);
    eventBus.emit('deployment:refreshed', services || []);
}

function pushSelectedService(serviceId, serviceConfig) {
    deploymentStore.selectService(serviceId || null);
    if (serviceConfig !== undefined) deploymentStore.setSelectedConfig(serviceConfig);
}

function pushConfigMeta(meta) {
    configStore.setMeta(meta || {});
}

function pushConfigValues(values, opts) {
    configStore.setValues(values || {}, opts);
}

function pushConfigValue(key, value) {
    configStore.updateValue(key, value);
}

function pushConfigSaved() {
    configStore.markSaved();
    eventBus.emit('config:saved', {});
}

function pushRawSource(text, opts) {
    configStore.setRawSource(text ?? '', opts);
}

export const stateBridge = {
    pushOperator,
    pushUnauthorized,
    pushDeployment,
    pushServices,
    pushSelectedService,
    pushConfigMeta,
    pushConfigValues,
    pushConfigValue,
    pushConfigSaved,
    pushRawSource
};

logger.debug('state-bridge ready');
