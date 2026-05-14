import { http } from '../core/http.js';

const base = '/api';

export const authApi = {
    /** @returns {Promise<{required: boolean, authenticated: boolean, operator?: string}>} */
    status: () => http.get(`${base}/auth/status`),

    /** @returns {Promise<{operator: string}>} */
    login: ({ operator, password }) => http.postJson(`${base}/login`, { operator, password }),

    logout: () => http.request(`${base}/logout`, { method: 'POST' })
};
