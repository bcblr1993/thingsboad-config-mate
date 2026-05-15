/**
 * Hash-based router. Designed to coexist with the legacy
 * scrollToWorkbenchSection / hash navigation in app.js (which uses
 * #deployment-panel and #config-workspace as anchor scroll targets).
 *
 *   import { router } from '@/src/core/router.js';
 *   router.add('/services', ctx => mountServicesPage(ctx));
 *   router.add('/config',   ctx => mountConfigPage(ctx));
 *   router.start();
 *   router.navigate('/config?tab=database');
 *   const off = router.onRouteChange((path, query) => ...);
 *
 * URL shape:
 *   /#/path?key=value
 *
 * The leading slash distinguishes router paths from legacy anchor
 * navigation. A bare #foo (no leading slash) is treated as legacy
 * anchor navigation and the router does not dispatch.
 */

import { logger } from './logger.js';
import { eventBus } from './event-bus.js';

/** @type {Map<string, (ctx: {path: string, query: URLSearchParams}) => void | Promise<void>>} */
const routes = new Map();

/** @type {Set<(path: string, query: URLSearchParams) => void>} */
const listeners = new Set();

let started = false;
let lastPath = null;

function parseHash(rawHash) {
    const hash = (rawHash || '').replace(/^#/, '');
    if (!hash.startsWith('/')) return null;        // legacy anchor → ignore
    const [path, search = ''] = hash.split('?');
    return { path: path || '/', query: new URLSearchParams(search) };
}

function dispatch() {
    const parsed = parseHash(window.location.hash);
    if (!parsed) return;
    const { path, query } = parsed;
    if (path === lastPath) {
        // same-path notify (e.g. query change) — still fire listeners
        for (const fn of listeners) fn(path, query);
        return;
    }
    lastPath = path;

    const handler = routes.get(path);
    if (handler) {
        try { handler({ path, query }); }
        catch (err) { logger.error(`router handler for "${path}" threw:`, err); }
    } else {
        logger.debug(`router: no handler for "${path}"`);
    }
    for (const fn of listeners) fn(path, query);
    eventBus.emit('router:change', { path, query });
}

export const router = {
    add(path, handler) {
        if (typeof handler !== 'function') {
            throw new TypeError(`router.add(${path}): handler must be a function`);
        }
        routes.set(path, handler);
    },

    remove(path) { routes.delete(path); },

    navigate(path) {
        if (!path) return;
        const target = path.startsWith('/') ? path : '/' + path;
        if (window.location.hash === '#' + target) {
            dispatch();
            return;
        }
        window.location.hash = target;
    },

    onRouteChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    },

    /** Current parsed route (or null when on a legacy anchor). */
    current() {
        return parseHash(window.location.hash);
    },

    start() {
        if (started) return;
        started = true;
        window.addEventListener('hashchange', dispatch);
        // Defer first dispatch so callers can finish registering routes.
        queueMicrotask(dispatch);
    },

    stop() {
        if (!started) return;
        started = false;
        window.removeEventListener('hashchange', dispatch);
    }
};
