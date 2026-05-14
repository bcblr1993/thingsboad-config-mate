/**
 * Legacy bridge to the pre-existing window.ConfigMateApi.
 *
 * Why this exists:
 *   The legacy /assets/api.js IIFE installs window.ConfigMateApi and also
 *   replaces window.fetch to intercept 401. Many parts of the codebase
 *   (app.js, modules/*) still call ConfigMateApi.* directly. To migrate
 *   gradually without breaking those callers, we re-export the same
 *   surface as ESM so new modules can `import { legacyApi } from '@/api/legacy.js'`.
 *
 * Lifecycle:
 *   Legacy api.js loads as a classic <script> BEFORE main.js (type=module, defer),
 *   so window.ConfigMateApi is guaranteed to exist by the time this module is
 *   evaluated. We capture it as a frozen reference for type safety.
 *
 * Migration path:
 *   New code should prefer the http-based ESM APIs in sibling files
 *   (auth.api.js, config.api.js, service.api.js, install.api.js, system.api.js).
 *   This module will shrink as callers move off.
 */

const legacyApi = (typeof window !== 'undefined' && window.ConfigMateApi) || null;

if (!legacyApi) {
    console.warn('[CM] legacy ConfigMateApi not found at module evaluation time.');
}

export { legacyApi };
