/**
 * Deployment / config domain typedefs.
 */

/**
 * @typedef {Object} DeploymentInfo
 * @property {string} [target]
 * @property {string} [version]
 * @property {string} [composeFile]
 * @property {boolean} [installed]
 */

/**
 * @typedef {Object} DeploymentPlan
 * @property {Array<{action: string, service: string, reason: string}>} steps
 * @property {boolean} requiresRestart
 * @property {string[]} [warnings]
 */

/**
 * @typedef {Object} HistoryEntry
 * @property {string} filename
 * @property {string} timestamp ISO timestamp
 * @property {string} [operator]
 * @property {string} [comment]
 */

export const __deploymentTypes = null;
