/**
 * Toast / inline message severity levels.
 * Maps directly to existing CSS classes (.toast.success / .error / .warning / .info).
 */

export const TOAST_TYPE = Object.freeze({
    SUCCESS: 'success',
    ERROR:   'error',
    WARNING: 'warning',
    INFO:    'info'
});

export const TOAST_DURATION_MS = 3000;
