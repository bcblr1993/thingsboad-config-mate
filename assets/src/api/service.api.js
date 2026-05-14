import { http } from '../core/http.js';

const base = '/api';

function path(serviceId, suffix = '') {
    return `${base}/services/${encodeURIComponent(serviceId)}${suffix}`;
}

export const serviceApi = {
    list:           () => http.get(`${base}/services`),
    config:         serviceId => http.get(path(serviceId, '/config')),
    cleanupPlan:    serviceId => http.get(path(serviceId, '/cleanup-plan')),
    cleanup:        (serviceId, confirmServiceId) => http.postJson(path(serviceId, '/cleanup'), { confirmServiceId }),
    runAction:      (serviceId, action) => http.request(path(serviceId, `/${encodeURIComponent(action)}`), { method: 'POST' }),
    runtimeDiff:    () => http.get(`${base}/diff-runtime`),

    /** Build an EventSource URL for log streaming (consumer creates the EventSource). */
    logsUrl: serviceId => `${base}/logs${serviceId ? `?service=${encodeURIComponent(serviceId)}` : ''}`
};
