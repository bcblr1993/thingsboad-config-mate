/* Config Mate · lightweight hash router.
   Drives top mega-nav <-> route container visibility. Routes without a
   container yet are no-ops here; callers can fall back to legacy modals. */

(function () {
    'use strict';

    const ROUTES = {
        overview:   { container: '#overview-page' },
        deployment: { container: '#deployment-panel' },
        config:     { container: '#config-workspace' },
        install:    { container: '#install-modal' },
    };

    const DEFAULT_ROUTE = 'overview';
    const LEGACY_HASH_MAP = {
        'deployment-panel': 'deployment',
        'config-workspace': 'config',
        diff: 'config',
        history: 'config',
        'runtime-diff-modal': 'config',
        'history-modal': 'config',
    };
    const listeners = new Set();
    let activeRouteKey = DEFAULT_ROUTE;

    function parseHash(hash) {
        const m = (hash || '').match(/^#\/?([a-z][a-z0-9-]*)/i);
        if (!m) return null;
        const raw = m[1].toLowerCase();
        return LEGACY_HASH_MAP[raw] || raw;
    }

    function rawHashRoute(hash) {
        const m = (hash || '').match(/^#\/?([a-z][a-z0-9-]*)/i);
        return m ? m[1].toLowerCase() : null;
    }

    function currentRoute() {
        const k = parseHash(location.hash);
        return k && ROUTES[k] ? k : DEFAULT_ROUTE;
    }

    function hasContainer(key) {
        return !!(ROUTES[key] && document.querySelector(ROUTES[key].container));
    }

    function canLeaveRoute(nextKey, fromKey) {
        if (typeof window.ConfigMateCanNavigateRoute !== 'function') return true;
        try {
            return window.ConfigMateCanNavigateRoute(nextKey, fromKey) !== false;
        } catch (err) {
            console.warn('[router] navigation guard failed', err);
            return true;
        }
    }

    function navigate(route) {
        const key = String(route || '').replace(/^#?\/?/, '').toLowerCase();
        if (!ROUTES[key] || !hasContainer(key)) return false;
        if (!canLeaveRoute(key, activeRouteKey)) {
            if (location.hash !== '#/' + activeRouteKey) {
                history.replaceState(null, '', '#/' + activeRouteKey);
            }
            apply(activeRouteKey, { notify: false });
            return false;
        }
        if (location.hash === '#/' + key) {
            apply(key);
        } else {
            location.hash = '#/' + key;
        }
        return true;
    }

    function apply(routeKey, options = {}) {
        const key = ROUTES[routeKey] ? routeKey : DEFAULT_ROUTE;
        activeRouteKey = key;
        Object.entries(ROUTES).forEach(([k, def]) => {
            const el = document.querySelector(def.container);
            if (!el) return;
            const active = k === key;
            /* Two visibility mechanisms coexist:
               - SPA route containers (#overview-page / #deployment-panel /
                 #config-workspace) toggle [hidden] for display:none.
               - Modal-derived containers (#history-modal / #runtime-diff-modal /
                 #install-modal) keep [hidden] alone
                 (their CSS owns visibility via .modal-overlay + class
                 .route-active set below) — touching hidden would interfere
                 with the overlay/opacity transition. */
            if (!el.classList.contains('modal-overlay')) {
                el.hidden = !active;
            }
            el.classList.toggle('route-active', active);
        });
        document.querySelectorAll('[data-mega-nav]').forEach(btn => {
            const active = btn.dataset.megaNav === key;
            btn.classList.toggle('active', active);
            if (active) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        });
        document.body.dataset.workbenchPage = (ROUTES[key].container || '').replace('#', '');
        if (options.notify !== false) {
            listeners.forEach(fn => {
                try { fn(key); } catch (err) { console.warn('[router] listener failed', err); }
            });
        }
    }

    function syncCurrentRoute(options = {}) {
        const raw = rawHashRoute(location.hash);
        const key = currentRoute();
        if (!raw) {
            history.replaceState(null, '', '#/' + DEFAULT_ROUTE);
        } else if (raw !== key) {
            history.replaceState(null, '', '#/' + key);
        }
        apply(key, { notify: options.notify !== false });
        return key;
    }

    function init() {
        window.addEventListener('hashchange', () => {
            const raw = rawHashRoute(location.hash);
            const key = currentRoute();
            if (!canLeaveRoute(key, activeRouteKey)) {
                history.replaceState(null, '', '#/' + activeRouteKey);
                apply(activeRouteKey, { notify: false });
                return;
            }
            if (raw && raw !== key) {
                history.replaceState(null, '', '#/' + key);
            }
            apply(key);
        });
        syncCurrentRoute();
    }

    function onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    window.ConfigMateRouter = { init, navigate, onChange, currentRoute, hasContainer, syncCurrentRoute, ROUTES, DEFAULT_ROUTE };
})();
