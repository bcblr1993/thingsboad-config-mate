// JSDoc typedefs for API payloads.
//
// Types live in standalone .js files exporting only typedefs. VSCode and
// WebStorm pick up these typedefs across the project as long as another
// module imports the file. At a call site, annotate via JSDoc:
//
//   const auth = await authApi.status();
//   // jsdoc: type {import('../types/api.types.js').AuthStatus}

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
