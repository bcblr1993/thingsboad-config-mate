/**
 * Compatibility bridge between new ESM modules and legacy app.js.
 *
 * What this does:
 *   Exposes the new infrastructure (http, store, eventBus, errors, env, logger,
 *   api domains, uiStore, constants, utils) on window.__CM__ so that legacy
 *   /assets/app.js — which cannot use ESM `import` — can still consume the
 *   new building blocks incrementally.
 *
 * What this does NOT do:
 *   - Replace window.ConfigMateApi or window.ConfigMateUi (those keep working).
 *   - Modify window.fetch (legacy api.js owns that; new http.js delegates to it).
 *
 * Usage from legacy code:
 *   if (window.__CM__) {
 *       const services = await window.__CM__.api.service.list();
 *       window.__CM__.uiStore.setLoading('services.refresh', true);
 *       window.__CM__.eventBus.emit('services:refreshed', services);
 *   }
 *
 * Removal plan:
 *   Once all callers move to ESM imports (stage 3 of refactor), this bridge
 *   can be deleted along with the legacy IIFE files.
 */

import { http } from './core/http.js';
import { createStore } from './core/store.js';
import { eventBus } from './core/event-bus.js';
import { HttpError, BizError, TimeoutError } from './core/errors.js';
import { env } from './core/env.js';
import { logger } from './core/logger.js';
import { stateBridge } from './core/state-bridge.js';
import { router } from './core/router.js';

import { authApi, configApi, serviceApi, installApi, systemApi, legacyApi } from './api/index.js';

import { uiStore, authStore, deploymentStore, configStore } from './stores/index.js';

import { authService, deploymentService, configService } from './services/index.js';

import * as constants from './constants/index.js';
import * as utils from './utils/index.js';

import { createLogViewer } from './components/log-viewer/log-viewer.js';
import { createHistoryUi } from './components/history-viewer/history-viewer.js';
import * as formValidator from './components/form/validator.js';
import * as formField from './components/form/field.js';

import * as deploymentPage from './pages/deployment.page.js';
import * as configPage from './pages/config.page.js';
import * as loginPage from './pages/login.page.js';

import { permission } from './utils/permission.js';

const bridge = Object.freeze({
    http,
    createStore,
    eventBus,
    errors: { HttpError, BizError, TimeoutError },
    env,
    logger,
    stateBridge,
    router,
    permission,

    api: {
        auth:    authApi,
        config:  configApi,
        service: serviceApi,
        install: installApi,
        system:  systemApi,
        legacy:  legacyApi
    },

    stores: { uiStore, authStore, deploymentStore, configStore },
    uiStore,                  // shortcut
    authStore,                // shortcut
    services: {
        auth:       authService,
        deployment: deploymentService,
        config:     configService
    },
    constants,
    utils,

    components: {
        logViewer:     { createLogViewer },
        historyViewer: { createHistoryUi },
        form: {
            validator: formValidator,
            field:     formField
        }
    },

    pages: {
        deployment: deploymentPage,
        config:     configPage,
        login:      loginPage
    }
});

if (typeof window !== 'undefined') {
    if (window.__CM__) {
        logger.warn('window.__CM__ already exists — bridge.js evaluated twice?');
    } else {
        Object.defineProperty(window, '__CM__', {
            value: bridge,
            writable: false,
            configurable: false,
            enumerable: true
        });
    }
}

export default bridge;
