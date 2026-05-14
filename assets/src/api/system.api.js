import { http } from '../core/http.js';

const base = '/api';

export const systemApi = {
    deployment:    () => http.get(`${base}/deployment`),
    status:        () => http.get(`${base}/status`),
    version:       () => http.get(`${base}/version`),
    stopApp:       () => http.request(`${base}/stop`, { method: 'POST' }),
    restartApp:    () => http.request(`${base}/service-restart`, { method: 'POST' })
};
