/**
 * Ambient declarations for runtime globals installed by legacy IIFE
 * scripts and our own bridge.js. These are NOT npm module imports;
 * they exist as side effects of <script> tag execution.
 */

interface LegacyConfigMateApi {
    request: (input: any, init?: any) => Promise<Response>;
    postJson: (path: string, body?: any) => Promise<Response>;
    postText: (path: string, body?: any) => Promise<Response>;
    setUnauthorizedHandler: (handler: (() => void) | null) => void;
    resetAuthExpiredNotice: () => void;
    logsUrl: (serviceId?: string | null) => string;

    authStatus: () => Promise<Response>;
    login: (creds: { operator: string; password: string }) => Promise<Response>;
    logout: () => Promise<Response>;
    config: () => Promise<Response>;
    deployment: () => Promise<Response>;
    plan: (config: any) => Promise<Response>;
    services: () => Promise<Response>;
    serviceConfig: (serviceId: string) => Promise<Response>;
    cleanupPlan: (serviceId: string) => Promise<Response>;
    cleanup: (serviceId: string, confirmServiceId: string) => Promise<Response>;
    serviceAction: (serviceId: string, action: string) => Promise<Response>;
    rawEnv: () => Promise<Response>;
    saveRaw: (rawContent: string) => Promise<Response>;
    saveConfig: (values: Record<string, string>) => Promise<Response>;
    applyPlan: (config: any, save?: boolean) => Promise<Response>;
    status: () => Promise<Response>;
    stopAppService: () => Promise<Response>;
    restartAppService: () => Promise<Response>;
    history: () => Promise<Response>;
    historyContent: (filename: string) => Promise<Response>;
    restoreHistory: (filename: string) => Promise<Response>;
    version: () => Promise<Response>;
    runtimeDiff: () => Promise<Response>;
    checkInstall: () => Promise<Response>;
    install: () => Promise<Response>;
    validateCompose: () => Promise<Response>;
}

interface LegacyConfigMateUi {
    escapeHtml: (text: unknown) => string;
    showToast: (message: string, type?: string) => void;
    openModal: (modalOrId: HTMLElement | string, display?: string) => HTMLElement | null;
    closeModal: (modalOrId: HTMLElement | string, options?: any) => void;
    customConfirm: (message: string, btnText?: string, btnColor?: string) => Promise<boolean>;
    resolveConfirm: (result: boolean) => void;
    copyText: (text: string, successMessage?: string) => Promise<void>;
}

interface BackendInjectedEnv {
    apiBase?: string;
    version?: string;
    appType?: string;
    isDev?: boolean;
}

interface Window {
    /** Installed by /assets/api.js IIFE before any other module evaluates. */
    ConfigMateApi: LegacyConfigMateApi;

    /** Installed by /assets/modules/ui-core.js IIFE. */
    ConfigMateUi: LegacyConfigMateUi;

    /** Installed by /assets/modules/logs-ui.js IIFE. */
    ConfigMateLogsUi: { createLogViewer: (options: any) => any };

    /** Installed by /assets/modules/history-ui.js IIFE. */
    ConfigMateHistoryUi: { createHistoryUi: (options: any) => any };

    /** Backend-injected runtime config (see core/env.js). Optional. */
    __CM_ENV__?: BackendInjectedEnv;

    /** Compatibility bridge installed by bridge.js. Read-only. */
    __CM__?: any;
}
