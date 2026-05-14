/**
 * JSDoc typedefs for API payloads.
 *
 * Style: types live in standalone .js files exporting only typedefs.
 * VSCode / WebStorm / Vue Volar all pick up these typedefs across the
 * project as long as another module imports the file (or it's referenced
 * in a JSDoc @import).
 *
 * Usage at call site:
 *   /** @type {import('../types/api.types.js').AuthStatus} *\/
 *   const auth = await authApi.status();
 */

/**
 * @typedef {Object} AuthStatus
 * @property {boolean} required Whether authentication is enabled on this server.
 * @property {boolean} authenticated Current session is valid.
 * @property {string} [operator] Operator id when authenticated.
 */

/**
 * @typedef {Object} LoginPayload
 * @property {string} operator
 * @property {string} password
 */

/**
 * @typedef {Object} VersionInfo
 * @property {string} version
 * @property {string} appType
 * @property {string} [buildDate]
 */

/** Marker so the file has a runtime export and can be imported anywhere. */
export const __apiTypes = null;
