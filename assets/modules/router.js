/* Config Mate · lightweight hash router.
   Drives top mega-nav <-> route container visibility. Routes without a
   container yet are no-ops here; callers can fall back to legacy modals. */

(function () {
    'use strict';

    const ROUTES = {
        overview:   { container: '#overview-page' },
        deployment: { container: '#deployment-panel' },
        config:     { container: '#config-workspace' },
        diff:       { container: '#runtime-diff-page' },
        history:    { container: '#history-page' },
        logs:       { container: '#logs-page' },
        install:    { container: '#install-page' },
    };

    const DEFAULT_ROUTE = 'deployment';
    const LEGACY_HASH_MAP = {
        'deployment-panel': 'deployment',
        'config-workspace': 'config',
    };
    const listeners = new Set();

    function parseHash(hash) {
        const m = (hash || '').match(/^#\/?([a-z][a-z0-9-]*)/i);
        if (!m) return null;
        const raw = m[1].toLowerCase();
        return LEGACY_HASH_MAP[raw] || raw;
    }

    function currentRoute() {
        const k = parseHash(location.hash);
        return k && ROUTES[k] ? k : DEFAULT_ROUTE;
    }

    function hasContainer(key) {
        return !!(ROUTES[key] && document.querySelector(ROUTES[key].container));
    }

    function navigate(route) {
        const key = String(route || '').replace(/^#?\/?/, '').toLowerCase();
        if (!ROUTES[key] || !hasContainer(key)) return false;
        if (location.hash === '#/' + key) {
            apply(key);
        } else {
            location.hash = '#/' + key;
        }
        return true;
    }

    function apply(routeKey) {
        const key = ROUTES[routeKey] ? routeKey : DEFAULT_ROUTE;
        Object.entries(ROUTES).forEach(([k, def]) => {
            const el = document.querySelector(def.container);
            if (!el) return;
            const active = k === key;
            el.hidden = !active;
            el.classList.toggle('route-active', active);
        });
        document.querySelectorAll('[data-mega-nav]').forEach(btn => {
            const active = btn.dataset.megaNav === key;
            btn.classList.toggle('active', active);
            if (active) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        });
        document.body.dataset.workbenchPage = (ROUTES[key].container || '').replace('#', '');
        listeners.forEach(fn => {
            try { fn(key); } catch (err) { console.warn('[router] listener failed', err); }
        });
    }

    function init() {
        window.addEventListener('hashchange', () => apply(currentRoute()));
        if (!parseHash(location.hash)) {
            history.replaceState(null, '', '#/' + DEFAULT_ROUTE);
        }
        apply(currentRoute());
    }

    function onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    window.ConfigMateRouter = { init, navigate, onChange, currentRoute, hasContainer, ROUTES, DEFAULT_ROUTE };
})();
