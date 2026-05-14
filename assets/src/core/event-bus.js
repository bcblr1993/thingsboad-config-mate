/**
 * Minimal pub/sub event bus for cross-module communication.
 *
 *   eventBus.on('deployment:refreshed', list => ...);
 *   eventBus.emit('deployment:refreshed', services);
 *   const off = eventBus.on('foo', fn);
 *   off();  // unsubscribe
 *
 * Use sparingly. Prefer direct imports for tight coupling;
 * use events for loose, optional notifications.
 */

import { logger } from './logger.js';

function createEventBus() {
    /** @type {Map<string, Set<Function>>} */
    const channels = new Map();

    function on(event, handler) {
        if (typeof handler !== 'function') {
            throw new TypeError(`eventBus.on(${event}): handler must be a function`);
        }
        let set = channels.get(event);
        if (!set) {
            set = new Set();
            channels.set(event, set);
        }
        set.add(handler);
        return () => off(event, handler);
    }

    function off(event, handler) {
        const set = channels.get(event);
        if (!set) return;
        set.delete(handler);
        if (set.size === 0) channels.delete(event);
    }

    function emit(event, payload) {
        const set = channels.get(event);
        if (!set) return;
        for (const handler of [...set]) {
            try {
                handler(payload);
            } catch (err) {
                logger.error(`eventBus handler for "${event}" threw:`, err);
            }
        }
    }

    function clear(event) {
        if (event) channels.delete(event);
        else channels.clear();
    }

    return { on, off, emit, clear };
}

export const eventBus = createEventBus();
