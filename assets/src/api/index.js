/**
 * Barrel export for all API domains.
 *
 *   import { authApi, configApi, serviceApi } from '@/src/api/index.js';
 *
 * Each domain module wraps http.js (which provides interceptors, error
 * normalization, timeout). Callers receive parsed payloads or HttpError.
 *
 * For legacy code paths that still need the original window.ConfigMateApi
 * surface (raw Response objects, no error normalization), import from
 * ./legacy.js instead.
 */

export { authApi }    from './auth.api.js';
export { configApi }  from './config.api.js';
export { serviceApi } from './service.api.js';
export { installApi } from './install.api.js';
export { systemApi }  from './system.api.js';
export { legacyApi }  from './legacy.js';
