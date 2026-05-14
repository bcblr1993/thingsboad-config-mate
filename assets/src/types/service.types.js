/**
 * Service domain typedefs.
 *
 * Sourced from runtime observation of legacy app.js and services-ui.js.
 * As the backend contract is documented these can become authoritative.
 */

/**
 * @typedef {'running'|'stopped'|'pending'|'error'|'missing'|'unknown'|'missing-image'|'unsupported'} ServiceStatus
 */

/**
 * @typedef {Object} ServiceInfo
 * @property {string} id Stable service identifier (matches docker-compose service name).
 * @property {string} name Display name.
 * @property {ServiceStatus} status
 * @property {string} [image] Image reference (repo:tag).
 * @property {number} [cpuPercent] CPU usage 0..100 when running.
 * @property {number} [memoryBytes]
 * @property {string} [startedAt] ISO timestamp of last start.
 * @property {string} [group] Logical group (核心 / 数据 / 缓存 / ...).
 */

/**
 * @typedef {Object} ServiceConfig
 * @property {string} id
 * @property {Record<string, string>} env Environment variables effective for this service.
 * @property {string} [composeSnippet] Rendered docker-compose snippet for inspection.
 */

/**
 * @typedef {Object} CleanupPlan
 * @property {string} serviceId
 * @property {string[]} volumes Volumes that would be removed.
 * @property {string[]} dataPaths Host paths that would be cleared.
 * @property {string} [warning]
 */

export const __serviceTypes = null;
