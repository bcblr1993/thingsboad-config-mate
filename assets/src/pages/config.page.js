/**
 * Business config page mount.
 *
 * Stage 3.14 — skeleton. Today the config-workspace section is rendered
 * by legacy app.js (renderConfigGroups, renderField, ...). This module
 * subscribes to configStore so future incremental moves from app.js can
 * land here without changing the public mount surface.
 *
 * Migration intent:
 *   - app.js renderConfigGroups()       → renderGroups(state.meta)
 *   - app.js renderField()              → renderField(meta, value, errors)
 *   - app.js setupSourcePanel()         → bindSourceMode() inside mount()
 *   - app.js validateConfig()           → use components/form/validator.js
 */

import { configStore } from '../stores/index.js';
import { uiStore } from '../stores/index.js';
import { logger } from '../core/logger.js';

/**
 * @param {HTMLElement | null} root
 * @returns {() => void} unmount
 */
export function mount(root) {
    if (!root) {
        logger.warn('config.page.mount(): root element not found');
        return () => {};
    }

    const unsubConfig = configStore.subscribe(state => {
        // TODO: drive form rendering once app.js stops owning DOM
        logger.debug('config.store changed: isDirty=' + state.isDirty);
    });

    const unsubUi = uiStore.subscribe(_state => {});

    return function unmount() {
        unsubConfig();
        unsubUi();
    };
}

export function render(_state) {
    // Placeholder.
}
