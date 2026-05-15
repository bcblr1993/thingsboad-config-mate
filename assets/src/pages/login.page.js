/**
 * Login overlay page mount.
 *
 * Stage 3.14 — skeleton. Today the login overlay is shown/hidden by
 * legacy app.js (showLoginOverlay, login, logout). This module
 * subscribes to authStore so future moves can land here.
 */

import { authStore } from '../stores/index.js';
import { eventBus } from '../core/event-bus.js';
import { logger } from '../core/logger.js';

/**
 * @param {HTMLElement | null} root
 * @returns {() => void} unmount
 */
export function mount(root) {
    if (!root) {
        logger.warn('login.page.mount(): root element not found');
        return () => {};
    }

    const unsubAuth = authStore.subscribe(state => {
        // TODO: toggle login overlay visibility based on state.authenticated
        logger.debug('auth changed: authenticated=' + state.authenticated);
    });

    const onExpired = () => {
        // TODO: surface "session expired" message
        logger.debug('auth:expired received');
    };
    eventBus.on('auth:expired', onExpired);

    return function unmount() {
        unsubAuth();
        eventBus.off('auth:expired', onExpired);
    };
}
