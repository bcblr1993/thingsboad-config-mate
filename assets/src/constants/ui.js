/**
 * UI timing and behavior constants.
 * Anything that previously appeared as a bare number in setTimeout / setInterval / debounce.
 */

export const POLL_INTERVAL_MS = Object.freeze({
    SERVICE_STATUS: 5000,
    APP_STATUS:     10000
});

export const DEBOUNCE_MS = Object.freeze({
    SEARCH:     300,
    FORM_INPUT: 500
});

export const MODAL_CLOSE_DELAY_MS = 200;

export const TOAST_DEFAULT_DURATION_MS = 3000;

/** Storage keys (localStorage / sessionStorage). */
export const STORAGE_KEY = Object.freeze({
    OPERATOR:        'configMateOperator',
    PREVIEW_THEME:   'cm-preview-theme'
});
