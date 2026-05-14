import { http } from '../core/http.js';

const base = '/api';

export const installApi = {
    check:           () => http.get(`${base}/check-install`),
    run:             () => http.request(`${base}/install`, { method: 'POST' }),
    validateCompose: () => http.get(`${base}/validate-compose?t=${Date.now()}`)
};
