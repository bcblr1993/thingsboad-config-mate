/**
 * Application route paths.
 *
 * Currently the app uses anchor-based navigation between two top-level
 * sections (deployment-panel and config-workspace). Route values match
 * existing HTML element IDs so the eventual router can scrollIntoView
 * without breaking deep links from emails / docs.
 *
 * When a real router is introduced (stage 4), this file becomes the
 * single source of truth for path → page mapping.
 */

export const ROUTES = Object.freeze({
    DEPLOYMENT: 'deployment-panel',
    CONFIG:     'config-workspace',
    LOGIN:      'login-overlay'
});

export const DEFAULT_ROUTE = ROUTES.DEPLOYMENT;
