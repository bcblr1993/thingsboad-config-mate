/**
 * Service status enum and helpers.
 *
 * Centralizes all status string literals that legacy code spreads via
 * services-ui.js, history-ui.js, logs-ui.js, and app.js. Currently ~50
 * occurrences across business code use these as bare strings.
 *
 * Migration: replace `service.status === 'running'` with
 * `service.status === SERVICE_STATUS.RUNNING`.
 */

export const SERVICE_STATUS = Object.freeze({
    RUNNING:        'running',
    STOPPED:        'stopped',
    PENDING:        'pending',
    ERROR:          'error',
    MISSING:        'missing',
    UNKNOWN:        'unknown',
    MISSING_IMAGE:  'missing-image',
    UNSUPPORTED:    'unsupported'
});

/** Visual label for each status (Chinese, end-user facing). */
export const SERVICE_STATUS_LABEL = Object.freeze({
    [SERVICE_STATUS.RUNNING]:       '运行中',
    [SERVICE_STATUS.STOPPED]:       '已停止',
    [SERVICE_STATUS.PENDING]:       '启动中',
    [SERVICE_STATUS.ERROR]:         '异常',
    [SERVICE_STATUS.MISSING]:       '缺失',
    [SERVICE_STATUS.UNKNOWN]:       '未知',
    [SERVICE_STATUS.MISSING_IMAGE]: '镜像缺失',
    [SERVICE_STATUS.UNSUPPORTED]:   '不支持'
});

/** Statuses for which user actions (restart/cleanup/etc.) are disabled. */
export const DISABLED_STATUSES = new Set([
    SERVICE_STATUS.MISSING,
    SERVICE_STATUS.UNKNOWN,
    SERVICE_STATUS.MISSING_IMAGE,
    SERVICE_STATUS.UNSUPPORTED
]);

/** Services known to support credential copy and data cleanup. Sourced from services-ui.js. */
export const COPY_ENABLED_SERVICES = new Set(['postgres', 'redis', 'kafka', 'cassandra', 'wechat']);
export const CLEANUP_SUPPORTED_SERVICES = new Set(['postgres', 'redis', 'kafka', 'cassandra']);

export function isDisabledStatus(status) {
    return DISABLED_STATUSES.has(status);
}

export function isRunning(status) {
    return status === SERVICE_STATUS.RUNNING;
}

export function statusLabel(status) {
    return SERVICE_STATUS_LABEL[status] || status || '--';
}
