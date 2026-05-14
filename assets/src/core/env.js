/**
 * Runtime environment configuration.
 *
 * The backend may inject runtime config via:
 *   <script>window.__CM_ENV__ = { apiBase: '/api', version: '1.4.16', appType: 'CLOUD' };</script>
 *
 * Without injection we fall back to safe defaults.
 */

const injected = (typeof window !== 'undefined' && window.__CM_ENV__) || {};

export const env = Object.freeze({
    apiBase: injected.apiBase || '/api',
    version: injected.version || 'dev',
    appType: injected.appType || 'UNKNOWN',
    isDev: Boolean(injected.isDev) || (typeof window !== 'undefined' && /[?&]debug=1\b/.test(window.location.search)),
    isProd: !injected.isDev
});
