import { expect, test, type Page } from '@playwright/test';
import { mockConfigMateApi, stabilizeVisuals } from './fixtures/api';

async function openRoute(page: Page, route: string, readySelector: string) {
    await mockConfigMateApi(page, { authenticated: true });
    await page.goto(`/#/${route}`);
    await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
    await page.locator(readySelector).first().waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
        return !!(window as typeof window & { __CM__?: unknown }).__CM__;
    });
    await stabilizeVisuals(page);
}

function mockJson(data: unknown, status = 200) {
    return {
        status,
        contentType: 'application/json',
        body: JSON.stringify(data)
    };
}

const readyInstallServices = [
    { id: 'postgres', label: 'PostgreSQL', status: 'running', running: true },
    { id: 'cassandra', label: 'Cassandra', status: 'running', running: true },
    { id: 'redis', label: 'Redis', status: 'running', running: true },
    { id: 'kafka', label: 'Kafka', status: 'running', running: true },
    { id: 'iotcloud', label: 'IoT Cloud', status: 'running', running: true }
];

function readyInstallPlan() {
    return {
        appService: 'iotcloud',
        services: readyInstallServices.map((service, index) => ({ id: service.id, label: service.label, order: (index + 1) * 10 })),
        statuses: readyInstallServices,
        missingServices: [],
        warnings: []
    };
}

test.describe('Config Mate UI consistency', () => {
    test('login page', async ({ page }) => {
        await mockConfigMateApi(page, { authenticated: false });
        await page.goto('/');
        await page.locator('#login-overlay').waitFor({ state: 'visible' });
        await stabilizeVisuals(page);
        await expect(page).toHaveScreenshot('login-page.png', { fullPage: true });
    });

    test('unauthenticated refresh skips startup-only checks', async ({ page }) => {
        const startupCheckRequests: string[] = [];
        await mockConfigMateApi(page, {
            authenticated: false,
            apiHandler: ({ pathname }) => {
                if (pathname === '/api/check-install' || pathname === '/api/validate-compose') {
                    startupCheckRequests.push(pathname);
                }
                return undefined;
            }
        });
        await page.goto('/#/overview');
        await page.locator('#login-overlay').waitFor({ state: 'visible' });
        await page.waitForTimeout(500);
        expect(startupCheckRequests).toEqual([]);
    });

    test('deployment page', async ({ page }) => {
        await openRoute(page, 'deployment', '#service-grid .service-card');
        await expect(page).toHaveScreenshot('deployment-page.png', { fullPage: true });
    });

    test('overview page', async ({ page }) => {
        await openRoute(page, 'overview', '#overview-kpi-row .cm-kpi');
        await expect(page).toHaveScreenshot('overview-page.png', { fullPage: true });
    });

    test('overview keeps async metrics after route round trip', async ({ page }) => {
        const expectOverviewMetrics = async () => {
            await expect(page.locator('#overview-kpi-row')).toContainText('62%');
            await expect(page.locator('#overview-kpi-row')).toContainText('/ 5 上限');
            await expect(page.locator('#overview-kpi-row')).toContainText('1');
            await expect(page.locator('#overview-activity')).toContainText('.env.20260520-074600.bak');
        };
        const routeTargets = [
            { nav: 'deployment', selector: '#deployment-panel' },
            { nav: 'config', selector: '#config-workspace' },
            { nav: 'install', selector: '#install-modal' }
        ];

        await mockConfigMateApi(page, { authenticated: true });
        await page.goto('/#/overview');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await expectOverviewMetrics();

        for (const target of routeTargets) {
            await page.locator(`[data-mega-nav="${target.nav}"]`).click();
            await expect(page.locator(target.selector)).toBeVisible();
            await page.locator('[data-mega-nav="overview"]').click();
            await expect(page.locator('#overview-page')).toBeVisible();
            await expectOverviewMetrics();
        }
    });

    test('config page', async ({ page }) => {
        await openRoute(page, 'config', '#form-container .cm-cfg-field');
        await expect(page).toHaveScreenshot('config-page.png', { fullPage: true });
    });

    test('config group header count matches dependency-filtered tab count', async ({ page }) => {
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: ({ pathname }) => {
                if (pathname === '/api/config') {
                    return mockJson({
                        status: 'success',
                        meta: {
                            CACHE_TYPE: { label: '缓存类型', group: '缓存配置', type: 'select', options: ['caffeine', 'redis'], required: true },
                            REDIS_CONNECTION_TYPE: { label: 'Redis 连接模式', group: '缓存配置', type: 'select', options: ['standalone', 'cluster'], dependsOn: { key: 'CACHE_TYPE', value: 'redis' } },
                            REDIS_HOST: { label: 'Redis 主机地址', group: '缓存配置', type: 'text', dependsOn: { key: 'CACHE_TYPE', value: 'redis' } },
                            REDIS_PORT: { label: 'Redis 端口', group: '缓存配置', type: 'number', dependsOn: { key: 'CACHE_TYPE', value: 'redis' } },
                            REDIS_PASSWORD: { label: 'Redis 密码', group: '缓存配置', type: 'password', dependsOn: { key: 'CACHE_TYPE', value: 'redis' } },
                            REDIS_DB: { label: 'Redis 库索引', group: '缓存配置', type: 'number', dependsOn: { key: 'CACHE_TYPE', value: 'redis' } },
                            CACHE_TTL: { label: '缓存 TTL', group: '缓存配置', type: 'number', dependsOn: { key: 'CACHE_TYPE', value: 'redis' } }
                        },
                        values: {
                            CACHE_TYPE: 'caffeine',
                            REDIS_CONNECTION_TYPE: 'standalone',
                            REDIS_HOST: 'redis',
                            REDIS_PORT: '6379',
                            REDIS_PASSWORD: '',
                            REDIS_DB: '0',
                            CACHE_TTL: '600'
                        }
                    });
                }
                return undefined;
            }
        });
        await page.goto('/#/config');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await expect(page.locator('#cm-config-tabs')).toContainText('缓存配置1');
        await expect(page.locator('.group-section[data-group-name="缓存配置"] .group-field-count')).toHaveText('1 项');
    });

    test('install route', async ({ page }) => {
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: ({ pathname }) => {
                if (pathname === '/api/services') return mockJson({ status: 'success', services: readyInstallServices });
                if (pathname === '/api/plan') {
                    return mockJson({
                        status: 'success',
                        plan: readyInstallPlan()
                    });
                }
                return undefined;
            }
        });
        await page.goto('/#/install');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await page.locator('#install-logs .install-log-line').first().waitFor({ state: 'visible' });
        await stabilizeVisuals(page);
        await expect(page.locator('button', { hasText: '复制日志' })).toHaveCount(0);
        await expect(page.locator('.cm-install-log-actions button', { hasText: '复制' })).toHaveCount(1);
        await expect(page).toHaveScreenshot('install-route.png', { fullPage: true });
    });

    test('install run locks navigation and keeps progress visible', async ({ page }) => {
        let releaseInstall!: () => void;
        let markInstallRequest!: () => void;
        const installRequestSeen = new Promise<void>(resolve => {
            markInstallRequest = resolve;
        });
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: ({ pathname }) => {
                if (pathname === '/api/services') return mockJson({ status: 'success', services: readyInstallServices });
                if (pathname === '/api/plan') return mockJson({ status: 'success', plan: readyInstallPlan() });
                return undefined;
            }
        });
        await page.route('**/api/install', async route => {
            markInstallRequest();
            await new Promise<void>(resolve => {
                releaseInstall = resolve;
            });
            await route.fulfill({
                status: 200,
                contentType: 'text/plain; charset=utf-8',
                body: '[INFO] 正在执行清理 (Clean up)...\n[SUCCESS] 安装完成。\n'
            });
        });

        await page.goto('/#/install');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await page.locator('#install-logs .install-log-line').first().waitFor({ state: 'visible' });
        await page.locator('#btn-install-start').click();
        await expect(page.locator('#confirm-modal.active')).toBeVisible({ timeout: 500 });
        await page.locator('#btn-confirm-yes').click();

        await expect(page.locator('#install-state-badge')).toHaveText('运行中');
        await expect(page.locator('[data-mega-nav="deployment"]')).toBeDisabled();
        await page.evaluate(() => {
            (window as typeof window & { navigateRoute?: (route: string) => void }).navigateRoute?.('deployment');
        });
        await expect(page.locator('#install-modal')).toHaveClass(/route-active/);
        await expect(page.locator('#install-current-stage')).toContainText('准备启动安装任务');

        await installRequestSeen;
        releaseInstall();
        await expect(page.locator('#install-state-badge')).toHaveText('已完成');
        await expect(page.locator('[data-mega-nav="deployment"]')).toBeEnabled();
    });

    test('action confirmations open without waiting for slow plan refresh', async ({ page }) => {
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: ({ pathname }) => {
                if (pathname === '/api/services') return mockJson({ status: 'success', services: readyInstallServices });
                if (pathname === '/api/plan') return mockJson({ status: 'success', plan: readyInstallPlan() });
                return undefined;
            }
        });
        await page.goto('/#/install');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await page.locator('#install-logs .install-log-line').first().waitFor({ state: 'visible' });

        let slowPlanRequests = 0;
        await page.route('**/api/plan', async route => {
            slowPlanRequests += 1;
            await new Promise(() => {});
            await route.fulfill(mockJson({ status: 'success', plan: readyInstallPlan() }));
        });

        await page.locator('#btn-install-start').click();
        await expect(page.locator('#btn-install-start')).toHaveClass(/is-action-feedback/);
        await expect(page.locator('#confirm-modal.active')).toBeVisible({ timeout: 500 });
        expect(slowPlanRequests).toBe(0);
        await page.locator('#confirm-modal .btn-action-cancel').click();
        await expect(page.locator('#confirm-modal.active')).toHaveCount(0);

        await page.locator('[data-mega-nav="deployment"]').click();
        await expect(page.locator('#deployment-panel')).toBeVisible();
        await expect(page.locator('.service-card[data-service-id="iotcloud"] .cm-svc-action-restart')).toBeVisible();
        await page.locator('.service-card[data-service-id="iotcloud"] .cm-svc-action-restart').click();
        await expect(page.locator('#confirm-modal.active')).toBeVisible({ timeout: 500 });
        expect(slowPlanRequests).toBe(0);

        await page.unroute('**/api/plan');
    });

    test('cleanup dialog opens before slow cleanup plan finishes', async ({ page }) => {
        let releasePlan!: () => void;
        let cleanupPlanRequests = 0;
        const slowPlan = new Promise<void>(resolve => {
            releasePlan = resolve;
        });
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: async ({ pathname }) => {
                if (pathname === '/api/services/redis/cleanup-plan') {
                    cleanupPlanRequests += 1;
                    await slowPlan;
                    return mockJson({
                        status: 'success',
                        service: { id: 'redis', label: 'Redis' },
                        appService: 'iotcloud',
                        dataPath: '/opt/sprixin/services/redis/data',
                        backupRoot: '/opt/sprixin/services/config-mate/backups',
                        backupDir: '/opt/sprixin/services/config-mate/backups/redis-admin',
                        appServiceRunning: false,
                        targetServiceRunning: false
                    });
                }
                return undefined;
            }
        });
        await page.goto('/#/deployment');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await expect(page.locator('.service-card[data-service-id="redis"] .cm-svc-action-more')).toBeVisible();

        await page.locator('.service-card[data-service-id="redis"] .cm-svc-action-more').click();
        await page.locator('.cm-service-card-menu .btn-action-cleanup').click();

        await expect(page.locator('#cleanup-modal.active')).toBeVisible({ timeout: 500 });
        await expect(page.locator('#cleanup-block-note')).toContainText('正在读取清理计划');
        await expect(page.locator('#btn-cleanup-confirm')).toBeDisabled();
        expect(cleanupPlanRequests).toBe(1);

        releasePlan();
        await expect(page.locator('#cleanup-backup-dir')).toContainText('/opt/sprixin/services/config-mate/backups/redis-admin');
        await expect(page.locator('#cleanup-confirm-input')).toBeEnabled();
        await page.locator('#cleanup-modal .btn-action-cancel').click();
    });

    test('config save apply confirmation opens without slow plan refresh', async ({ page }) => {
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: ({ pathname }) => {
                if (pathname === '/api/services') return mockJson({ status: 'success', services: readyInstallServices });
                if (pathname === '/api/plan') return mockJson({ status: 'success', plan: readyInstallPlan() });
                return undefined;
            }
        });
        await page.goto('/#/config');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await page.locator('#form-container .cm-cfg-field').first().waitFor({ state: 'visible' });
        await page.locator('#btn-cfg-edit').click();

        const jdbcInput = page.locator('#card-SPRING_DATASOURCE_URL input.field-input');
        await jdbcInput.fill('jdbc:postgresql://postgres:5432/thingsboard_confirm_fast');
        const planRefreshAfterEdit = page.waitForResponse(response => response.url().includes('/api/plan'));
        await jdbcInput.dispatchEvent('change');
        await planRefreshAfterEdit;
        await expect(page.locator('#btn-cfg-save-apply')).toBeVisible();
        await expect(page.locator('#btn-cfg-save-apply')).toBeEnabled();

        await page.route('**/api/plan', async route => {
            await new Promise(resolve => setTimeout(resolve, 2000));
            await route.fulfill(mockJson({ status: 'success', plan: readyInstallPlan() }));
        });

        await page.locator('#btn-cfg-save-apply').click();
        await expect(page.locator('#btn-cfg-save-apply')).toHaveClass(/is-action-feedback/);
        await expect(page.locator('#confirm-modal.active')).toBeVisible({ timeout: 500 });
        await page.locator('#confirm-modal .btn-action-cancel').click();

        await page.unroute('**/api/plan');
    });

    test('runtime diff summary hides zero-count categories', async ({ page }) => {
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: ({ pathname }) => {
                if (pathname === '/api/diff-runtime') {
                    return mockJson({
                        status: 'success',
                        service: 'iotcloud',
                        diffs: [
                            { key: 'SWAGGER_ENABLED', state: 'MODIFIED', runtimeVal: 'true', localVal: 'false' }
                        ]
                    });
                }
                return undefined;
            }
        });
        await page.goto('/#/config');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await page.locator('#form-container .cm-cfg-field').first().waitFor({ state: 'visible' });

        await page.locator('#btn-config-runtime-check').click();
        await expect(page.locator('#runtime-diff-modal.active')).toBeVisible();
        await expect(page.locator('#cm-diff-banner .cm-diff-banner-desc')).toHaveText('1 项已修改');
        await expect(page.locator('#cm-diff-banner .cm-diff-banner-desc')).not.toContainText('0 项');
    });

    test('log pause button label follows paused state', async ({ page }) => {
        await page.addInitScript(() => {
            class MockEventSource {
                url: string;
                onmessage: ((event: MessageEvent) => void) | null = null;
                onerror: (() => void) | null = null;

                constructor(url: string) {
                    this.url = url;
                }

                close() {}
            }

            Object.defineProperty(window, 'EventSource', {
                configurable: true,
                value: MockEventSource
            });
        });
        await mockConfigMateApi(page, { authenticated: true });
        await page.goto('/#/deployment');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await page.waitForFunction(() => {
            return !!(window as typeof window & { __CM__?: unknown }).__CM__;
        });

        await page.evaluate(() => {
            (window as typeof window & { showLogs?: (isManual?: boolean, serviceId?: string) => void }).showLogs?.(true, 'iotcloud');
        });
        await expect(page.locator('#logs-modal.active')).toBeVisible();
        await expect(page.locator('#btn-log-pause')).toHaveText('暂停');

        await page.locator('#btn-log-pause').click();
        await expect(page.locator('#logs-status')).toContainText('已暂停实时刷新');
        await expect(page.locator('#btn-log-pause')).toHaveText('继续');

        await page.locator('#btn-log-pause').click();
        await expect(page.locator('#logs-status')).toContainText('实时监听中');
        await expect(page.locator('#btn-log-pause')).toHaveText('暂停');
    });

    test('install readiness reflects dependency and stage progress', async ({ page }) => {
        const blockedServices = [
            { id: 'postgres', label: 'PostgreSQL', status: 'stopped', running: false },
            { id: 'iotcloud', label: 'IoT Cloud', status: 'stopped', running: false }
        ];
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: ({ pathname }) => {
                if (pathname === '/api/services') return mockJson({ status: 'success', services: blockedServices });
                if (pathname === '/api/plan') {
                    return mockJson({
                        status: 'success',
                        plan: {
                            appService: 'iotcloud',
                            services: [
                                { id: 'postgres', label: 'PostgreSQL', order: 10 },
                                { id: 'iotcloud', label: 'IoT Cloud', order: 20 }
                            ],
                            statuses: blockedServices,
                            missingServices: ['postgres'],
                            warnings: []
                        }
                    });
                }
                return undefined;
            }
        });
        await page.goto('/#/install');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await expect(page.locator('#install-state-badge')).toHaveText('依赖未就绪');
        await expect(page.locator('#install-status-text')).toContainText('PostgreSQL');
        await expect(page.locator('#install-stage-progress')).toHaveText('0 / 6');

        const readyServices = blockedServices.map(service => ({ ...service, status: 'running', running: true }));
        await page.route('**/api/services', route => route.fulfill(mockJson({ status: 'success', services: readyServices })));
        await page.route('**/api/plan', route => route.fulfill(mockJson({
            status: 'success',
            plan: {
                appService: 'iotcloud',
                services: [
                    { id: 'postgres', label: 'PostgreSQL', order: 10 },
                    { id: 'iotcloud', label: 'IoT Cloud', order: 20 }
                ],
                statuses: readyServices,
                missingServices: [],
                warnings: []
            }
        })));
        await page.route('**/api/install', route => route.fulfill({
            status: 200,
            contentType: 'text/plain; charset=utf-8',
            body: '[INFO] 正在执行清理 (Clean up)...\n[INFO] 清理完成。\n[INFO] 正在启动安装 (Start Install)...\n[SUCCESS] 安装完成。\n'
        }));
        await page.reload();
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await expect(page.locator('#install-state-badge')).toHaveText('准备就绪');
        await page.locator('#btn-install-start').click();
        await page.locator('#btn-confirm-yes').click();
        await expect(page.locator('#install-state-badge')).toHaveText('已完成');
        await expect(page.locator('#install-stage-progress')).toHaveText('6 / 6');
    });

    test('history modal', async ({ page }) => {
        await openRoute(page, 'config', '#form-container .cm-cfg-field');
        await page.evaluate(() => {
            (window as typeof window & { openHistoryModal?: () => void }).openHistoryModal?.();
        });
        await page.locator('#history-modal.active #history-list .timeline-item').first().waitFor({ state: 'visible' });
        await stabilizeVisuals(page);
        await expect(page).toHaveScreenshot('history-modal.png', { fullPage: true });
    });

    test('service action buttons stay locked until service status settles', async ({ page }) => {
        let iotcloudRunning = true;
        let stopRequests = 0;
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: async ({ pathname, method }) => {
                if (pathname === '/api/services') {
                    return mockJson({
                        status: 'success',
                        services: [{
                            id: 'iotcloud',
                            label: 'IoT Cloud',
                            tier: 'business',
                            status: iotcloudRunning ? 'running' : 'stopped',
                            running: iotcloudRunning,
                            image: 'sprixin/iotcloud:4.1',
                            portsSummary: '8080, 1883'
                        }]
                    });
                }
                if (pathname === '/api/status') {
                    return mockJson({
                        status: iotcloudRunning ? 'running' : 'stopped',
                        service: 'iotcloud',
                        dockerComposeMissing: false,
                        missingFiles: [],
                        message: iotcloudRunning ? 'running' : 'stopped'
                    });
                }
                if (pathname === '/api/services/iotcloud/down' && method === 'POST') {
                    stopRequests += 1;
                    setTimeout(() => {
                        iotcloudRunning = false;
                    }, 1000);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return mockJson({ status: 'success', message: 'stop submitted' });
                }
                return undefined;
            }
        });
        await page.goto('/#/deployment');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        const stopButton = page.locator('.service-card[data-service-id="iotcloud"] .cm-svc-action-stop');
        await expect(stopButton).toHaveCount(1);
        await expect(stopButton).toBeEnabled();

        await stopButton.click();
        await expect(stopButton).toBeDisabled();
        await page.locator('#btn-confirm-yes').click();
        await expect(stopButton).toBeDisabled();
        await page.waitForTimeout(250);
        expect(stopRequests).toBe(1);

        const startButton = page.locator('.service-card[data-service-id="iotcloud"] .cm-svc-action-start');
        await expect(startButton).toBeEnabled({ timeout: 5000 });
        expect(stopRequests).toBe(1);
    });
});
