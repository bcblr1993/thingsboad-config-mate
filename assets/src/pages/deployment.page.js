/**
 * Deployment page mount.
 *
 * Stage 3.14 — skeleton. Today the deployment-panel section is rendered
 * by legacy app.js (renderServiceCards, renderServiceConfig, ...). This
 * page module exposes the standard `mount/unmount` contract and
 * subscribes to deploymentStore + uiStore so future incremental moves
 * from app.js can land here without changing the public mount surface.
 *
 * Migration intent (not done yet, tracked separately):
 *   - app.js renderServiceCards()       → renderServices(state)
 *   - app.js renderServiceConfig()      → renderServiceConfig(state)
 *   - app.js bindServiceCardEvents()    → bind() inside mount()
 *
 * Usage (future):
 *   import { mount } from '@/src/pages/deployment.page.js';
 *   const unmount = mount(document.getElementById('deployment-panel'));
 *   // ... later
 *   unmount();
 */

import { deploymentStore } from '../stores/index.js';
import { uiStore } from '../stores/index.js';
import { logger } from '../core/logger.js';

/**
 * @param {HTMLElement | null} root
 * @returns {() => void} unmount
 */
export function mount(root) {
    if (!root) {
        logger.warn('deployment.page.mount(): root element not found');
        return () => {};
    }

    const unsubDeploy = deploymentStore.subscribe(state => {
        // TODO(stage 3.14 follow-up): drive renderServices(state.services)
        // from here once app.js stops owning DOM.
        logger.debug('deployment.store changed:', state.services?.length ?? 0, 'services');
    });

    const unsubUi = uiStore.subscribe(state => {
        // TODO: surface loading badges, banners
        const isLoading = Boolean(state.loadings['deployment.services']);
        if (isLoading) logger.debug('services loading...');
    });

    return function unmount() {
        unsubDeploy();
        unsubUi();
    };
}

/** Pure render entry, kept exported for parity with future move from app.js. */
export function render(_state) {
    // Placeholder. Real renderer migrates from app.js renderServiceCards.
}
