import { http } from '../core/http.js';

const base = '/api';

export const configApi = {
    /** @returns {Promise<Record<string, string>>} */
    get: () => http.get(`${base}/config`),

    /** @returns {Promise<string>} */
    rawEnv: () => http.get(`${base}/env-raw`),

    saveRaw: rawContent => http.postText(`${base}/save-raw`, rawContent),

    saveValues: values => http.postJson(`${base}/save`, values || {}),

    /** Compute deployment plan against new config without persisting. */
    plan: config => http.postJson(`${base}/plan`, { config }),

    applyPlan: (config, save = true) => http.postJson(`${base}/apply-plan`, { config, save }),

    /** @returns {Promise<Array<{filename: string, timestamp: string, operator?: string}>>} */
    history: () => http.get(`${base}/history`),

    historyContent: filename => http.postJson(`${base}/history/content`, { filename }),

    restoreHistory: filename => http.postJson(`${base}/history/restore`, { filename })
};
