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
        await expect(page.locator('#login-overlay')).toBeVisible();
        await expect(page.locator('#login-password')).toBeVisible();
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
        await expect(page.locator('#deployment-panel')).toBeVisible();
        expect(await page.locator('#service-grid .service-card').count()).toBeGreaterThan(0);
    });

    test('overview page', async ({ page }) => {
        await openRoute(page, 'overview', '#overview-kpi-row .cm-kpi');
        await expect(page.locator('#overview-page')).toBeVisible();
        expect(await page.locator('#overview-kpi-row .cm-kpi').count()).toBeGreaterThan(0);
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
        await expect(page.locator('#cm-config-tabs')).toBeVisible();
        expect(await page.locator('#form-container .cm-cfg-field').count()).toBeGreaterThan(0);
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
        await expect(page.locator('#history-modal.active')).toBeVisible();
        expect(await page.locator('#history-list .timeline-item').count()).toBeGreaterThan(0);
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

    async function openDeploymentWithHaServices(page: Page, haServices: unknown[]) {
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: async ({ pathname }) => {
                if (pathname === '/api/services') {
                    return mockJson({
                        status: 'success',
                        conflicts: ['postgres'],
                        services: [
                            {
                                id: 'iotcloud',
                                label: 'IoT Cloud',
                                tier: 'business',
                                status: 'running',
                                running: true,
                                image: 'sprixin/iotcloud:4.1'
                            },
                            ...haServices
                        ]
                    });
                }
                return undefined;
            }
        });
        await page.goto('/#/deployment');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
    }

    test('HA primary card shows role and VIP badges and hides start/stop', async ({ page }) => {
        await openDeploymentWithHaServices(page, [{
            id: 'postgres-ha',
            label: 'PostgreSQL 双机热备',
            kind: 'ha-cluster',
            readOnly: true,
            tier: 'storage',
            status: 'running',
            running: true,
            role: 'primary',
            vip: '192.168.1.100',
            vipHeld: true,
            vipIface: 'ens192'
        }]);

        const card = page.locator('.service-card[data-service-id="postgres-ha"]');
        await expect(card).toHaveCount(1);
        await expect(card.locator('.cm-svc-ha-badge.is-primary')).toHaveText('PRIMARY');
        await expect(card.locator('.cm-svc-ha-badge.is-vip')).toHaveText('VIP');

        // 只读纳管：HA 启停有严格的先主后备顺序，不能从界面触发。
        await expect(card.locator('.cm-svc-readonly-hint')).toBeVisible();
        await expect(card.locator('.cm-svc-action-start')).toHaveCount(0);
        await expect(card.locator('.cm-svc-action-stop')).toHaveCount(0);
        await expect(card.locator('.cm-svc-action-restart')).toHaveCount(0);
    });

    test('HA standby card shows standby role without VIP badge', async ({ page }) => {
        await openDeploymentWithHaServices(page, [{
            id: 'postgres-ha',
            label: 'PostgreSQL 双机热备',
            kind: 'ha-cluster',
            readOnly: true,
            tier: 'storage',
            status: 'running',
            running: true,
            role: 'standby',
            vip: '192.168.1.100',
            vipHeld: false
        }]);

        const card = page.locator('.service-card[data-service-id="postgres-ha"]');
        await expect(card.locator('.cm-svc-ha-badge.is-standby')).toHaveText('STANDBY');
        await expect(card.locator('.cm-svc-ha-badge.is-vip')).toHaveCount(0);
    });

    test('expiring highgo license surfaces a badge on the card', async ({ page }) => {
        await openDeploymentWithHaServices(page, [{
            id: 'highgo-ha',
            label: '瀚高双机热备',
            kind: 'ha-cluster',
            readOnly: true,
            tier: 'storage',
            status: 'running',
            running: true,
            role: 'primary',
            vip: '10.8.8.250',
            vipHeld: true,
            license: { status: 'normal', mode: 'trial', expiry: '2026-10-01', daysRemaining: 5, level: 'critical', products: [] }
        }]);

        // License 到期是静默故障，必须在卡片层面直接可见。
        const badge = page.locator('.service-card[data-service-id="highgo-ha"] .cm-svc-ha-badge.is-license-critical');
        await expect(badge).toHaveText('License 5天');
    });

    async function openDeploymentWithCluster(page: Page, payload: Record<string, unknown>) {
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: async ({ pathname }) => {
                if (pathname === '/api/nodes') return mockJson(payload);
                if (pathname === '/api/nodes/services') return mockJson(payload);
                return undefined;
            }
        });
        await page.goto('/#/deployment');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
    }

    const CLUSTER_PAYLOAD = {
        status: 'success',
        enabled: true,
        localNodeId: 'node-a',
        degraded: false,
        offlineNodeIds: [],
        nodes: [
            { nodeId: 'node-a', nodeLabel: '业务机', endpoint: 'http://10.0.0.1:3300', online: true },
            { nodeId: 'node-b', nodeLabel: '数据机', endpoint: 'http://10.0.0.2:3300', online: true }
        ],
        services: [
            { id: 'iotcloud', label: 'IoT Cloud', tier: 'business', status: 'running', running: true, nodeId: 'node-a', nodeLabel: '业务机', remote: false },
            { id: 'postgres', label: 'PostgreSQL', tier: 'storage', status: 'running', running: true, nodeId: 'node-b', nodeLabel: '数据机', remote: true, readOnly: true }
        ]
    };

    test('cluster banner shows node online status', async ({ page }) => {
        await openDeploymentWithCluster(page, CLUSTER_PAYLOAD);
        const banner = page.locator('#cluster-banner');
        await expect(banner).toBeVisible();
        await expect(banner).toContainText('2 / 2 在线');
        await expect(banner.locator('.cm-node-chip.is-local')).toContainText('业务机');
        await expect(banner.locator('.cm-node-chip.is-online')).toContainText('数据机');
    });

    test('remote services are labelled with their node and hide start/stop', async ({ page }) => {
        await openDeploymentWithCluster(page, CLUSTER_PAYLOAD);
        const remote = page.locator('.service-card[data-service-id="postgres"]');
        await expect(remote.locator('.cm-svc-node-badge.is-remote')).toContainText('数据机');
        // 远端服务不能在本节点操作。
        await expect(remote.locator('.cm-svc-action-start')).toHaveCount(0);
        await expect(remote.locator('.cm-svc-action-stop')).toHaveCount(0);

        const local = page.locator('.service-card[data-service-id="iotcloud"]');
        await expect(local.locator('.cm-svc-node-badge')).toContainText('业务机');
        await expect(local.locator('.cm-svc-node-badge.is-remote')).toHaveCount(0);
    });

    test('an offline node is called out so its services are not read as stopped', async ({ page }) => {
        await openDeploymentWithCluster(page, {
            ...CLUSTER_PAYLOAD,
            degraded: true,
            offlineNodeIds: ['node-b'],
            nodes: [
                { nodeId: 'node-a', nodeLabel: '业务机', endpoint: 'http://10.0.0.1:3300', online: true },
                { nodeId: 'node-b', nodeLabel: '数据机', endpoint: 'http://10.0.0.2:3300', online: false, message: 'ECONNREFUSED' }
            ],
            services: [CLUSTER_PAYLOAD.services[0]]
        });
        const banner = page.locator('#cluster-banner');
        await expect(banner).toContainText('1 / 2 在线');
        await expect(banner.locator('.cm-node-chip.is-offline')).toContainText('数据机');
        await expect(banner).toContainText('部分节点不可达');
    });

    test('a single-node site renders no cluster banner', async ({ page }) => {
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: async ({ pathname }) => (
                pathname === '/api/nodes'
                    ? mockJson({ status: 'success', enabled: false, nodes: [] })
                    : undefined
            )
        });
        await page.goto('/#/deployment');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        // 单机现场界面必须与改造前完全一致。
        await expect(page.locator('#cluster-banner')).toBeHidden();
        await expect(page.locator('.cm-svc-node-badge')).toHaveCount(0);
    });

    test('a site without HA renders no HA badges', async ({ page }) => {
        await openRoute(page, 'deployment', '#service-grid .service-card');
        // 未发现 HA 时界面必须与改造前完全一致。
        await expect(page.locator('.cm-svc-ha-badge')).toHaveCount(0);
        await expect(page.locator('.cm-svc-readonly-hint')).toHaveCount(0);
    });
});

test.describe('服务卡片信息层级', () => {
    const PLAN_WITH_GROUPS = {
        appService: 'iotcloud',
        services: [
            { id: 'postgres', label: 'PostgreSQL', order: 10, capability: 'database' },
            { id: 'postgres-ha', label: 'PostgreSQL 双机热备', order: 11, capability: 'database', readOnly: true },
            { id: 'highgo-ha', label: '瀚高双机热备', order: 12, capability: 'database', readOnly: true },
            { id: 'redis', label: 'Redis', order: 20, capability: 'cache' },
            { id: 'iotcloud', label: 'IoT Cloud', order: 90, capability: '' }
        ],
        dependencyGroups: [
            { capability: 'database', candidates: ['postgres', 'postgres-ha', 'highgo-ha'] },
            { capability: 'cache', candidates: ['redis'] }
        ],
        statuses: [
            { id: 'postgres', label: 'PostgreSQL', status: 'stopped', running: false },
            { id: 'postgres-ha', label: 'PostgreSQL 双机热备', status: 'stopped', running: false },
            { id: 'highgo-ha', label: '瀚高双机热备', status: 'stopped', running: false },
            { id: 'redis', label: 'Redis', status: 'stopped', running: false },
            { id: 'iotcloud', label: 'IoT Cloud', status: 'stopped', running: false }
        ],
        missingServices: ['postgres', 'redis'],
        warnings: []
    };

    async function openWith(page: Page, services: unknown[], plan: unknown = PLAN_WITH_GROUPS) {
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: async ({ pathname }) => {
                if (pathname === '/api/services') return mockJson({ status: 'success', services });
                if (pathname === '/api/plan') return mockJson({ status: 'success', plan });
                return undefined;
            }
        });
        await page.goto('/#/deployment');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
    }

    test('card title shows the readable label, not the raw id', async ({ page }) => {
        await openWith(page, [
            { id: 'postgres-ha', label: 'PostgreSQL 双机热备', tier: 'storage', status: 'stopped', running: false, kind: 'ha-cluster', readOnly: true }
        ]);
        const card = page.locator('.service-card[data-service-id="postgres-ha"]');
        // 原先主标题用 id，postgres-ha 会被截断成「postgre...」。
        await expect(card.locator('.cm-svc-name')).toHaveText('PostgreSQL 双机热备');
        // 容器名不再占卡片正面一行，改由标题 tooltip 承载。
        await expect(card.locator('.cm-svc-name')).toHaveAttribute('title', /postgres-ha/);
    });

    test('the startup-dependency marker appears exactly once', async ({ page }) => {
        await openWith(page, [
            { id: 'redis', label: 'Redis', tier: 'cache', status: 'stopped', running: false }
        ]);
        const card = page.locator('.service-card[data-service-id="redis"]');
        const badge = card.locator('.cm-svc-dependency-badge');
        await expect(badge).toHaveCount(1);
        // 同一信息不应再叠加符号前缀。
        await expect(badge).toHaveText('启动依赖');
        await expect(card.locator('.cm-svc-dependency-star')).toHaveCount(0);
        await expect(card.locator('.cm-svc-name')).not.toContainText('*');
    });

    test('internal english diagnostics are translated for operators', async ({ page }) => {
        await openWith(page, [
            {
                id: 'redis', label: 'Redis', tier: 'cache', status: 'stopped', running: false,
                message: 'matched container belongs to another compose project'
            }
        ]);
        const message = page.locator('.service-card[data-service-id="redis"] .cm-svc-message');
        await expect(message).toContainText('其他部署目录');
        await expect(message).not.toContainText('compose project');
    });

    test('mutually exclusive databases collapse into one dependency chip', async ({ page }) => {
        await openWith(page, [
            { id: 'redis', label: 'Redis', tier: 'cache', status: 'stopped', running: false }
        ]);
        const chips = page.locator('#plan-summary .dependency-status-chip');
        const texts = await chips.allTextContents();
        const joined = texts.join('|');
        // 三个互斥的数据库不应各占一个标签。
        expect(joined).not.toContain('PostgreSQL 双机热备');
        expect(joined).not.toContain('瀚高双机热备');
        expect(joined).toContain('数据库');
    });

    test('a running provider is named directly in the dependency chip', async ({ page }) => {
        const plan = {
            ...PLAN_WITH_GROUPS,
            statuses: PLAN_WITH_GROUPS.statuses.map(s => (
                s.id === 'highgo-ha' ? { ...s, status: 'running', running: true } : s
            ))
        };
        await openWith(page, [
            { id: 'highgo-ha', label: '瀚高双机热备', tier: 'storage', status: 'running', running: true, kind: 'ha-cluster', readOnly: true }
        ], plan);
        const chips = page.locator('#plan-summary .dependency-status-chip');
        // 有服务在提供该能力时，直接显示是谁在提供。
        await expect(chips.filter({ hasText: '瀚高双机热备' })).toHaveCount(1);
    });
});

test.describe('依赖提示口径', () => {
    const HA_PLAN = {
        appService: 'iotcloud',
        services: [
            { id: 'postgres-ha', label: 'PostgreSQL 双机热备', order: 11, capability: 'database', readOnly: true },
            { id: 'highgo-ha', label: '瀚高双机热备', order: 12, capability: 'database', readOnly: true },
            { id: 'redis', label: 'Redis', order: 20, capability: 'cache' },
            { id: 'iotcloud', label: 'IoT Cloud', order: 90, capability: '' }
        ],
        dependencyGroups: [
            { capability: 'database', candidates: ['postgres-ha', 'highgo-ha'] },
            { capability: 'cache', candidates: ['redis'] }
        ],
        statuses: [
            { id: 'postgres-ha', label: 'PostgreSQL 双机热备', status: 'stopped', running: false, readOnly: true },
            { id: 'highgo-ha', label: '瀚高双机热备', status: 'running', running: true, readOnly: true },
            { id: 'redis', label: 'Redis', status: 'stopped', running: false },
            { id: 'iotcloud', label: 'IoT Cloud', status: 'stopped', running: false }
        ],
        missingServices: ['postgres-ha', 'redis'],
        missingDependencyIds: ['redis'],
        warnings: []
    };

    test('install page does not name a database that is not deployed here', async ({ page }) => {
        /* 现场跑着瀚高 HA 时，安装页不应提示去启动 PostgreSQL 双机热备——
           两者互斥，运维根本没部署那一个。真机上复现过。 */
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: async ({ pathname }) => {
                if (pathname === '/api/plan') return mockJson({ status: 'success', plan: HA_PLAN });
                if (pathname === '/api/services') {
                    return mockJson({
                        status: 'success',
                        services: [
                            { id: 'highgo-ha', label: '瀚高双机热备', tier: 'storage', status: 'running', running: true, kind: 'ha-cluster', readOnly: true },
                            { id: 'redis', label: 'Redis', tier: 'cache', status: 'stopped', running: false }
                        ]
                    });
                }
                return undefined;
            }
        });
        await page.goto('/#/install');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));

        const statusText = page.locator('#install-status-text');
        await expect(statusText).toContainText('Redis');
        await expect(statusText).not.toContainText('PostgreSQL 双机热备');
    });

    test('an all-stopped exclusive group is reported by capability name', async ({ page }) => {
        const plan = {
            ...HA_PLAN,
            statuses: HA_PLAN.statuses.map(s => (s.id === 'highgo-ha' ? { ...s, status: 'stopped', running: false } : s)),
            missingDependencyIds: ['postgres-ha', 'redis']
        };
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: async ({ pathname }) => {
                if (pathname === '/api/plan') return mockJson({ status: 'success', plan });
                if (pathname === '/api/services') return mockJson({ status: 'success', services: [] });
                return undefined;
            }
        });
        await page.goto('/#/install');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));

        // 互斥候选全部未运行时，按能力名提示而不是指定其中一个。
        const statusText = page.locator('#install-status-text');
        await expect(statusText).toContainText('数据库');
        await expect(statusText).not.toContainText('PostgreSQL 双机热备');
    });
});

test.describe('集群模式下的总览口径', () => {
    const LOCAL_NODE = 'node-a';
    const NODES = [
        { nodeId: 'node-a', nodeLabel: '业务机', endpoint: 'http://a:3301', online: true, local: true },
        { nodeId: 'node-b', nodeLabel: '数据机', endpoint: 'http://b:3301', online: true }
    ];
    // 两个节点各有同名的一套服务，这正是重复计数的来源。
    const perNode = (nodeId: string, running: boolean) => [
        { id: 'postgres', label: 'PostgreSQL', tier: 'storage', status: running ? 'running' : 'stopped', running, nodeId },
        { id: 'redis', label: 'Redis', tier: 'cache', status: 'running', running: true, nodeId }
    ];

    async function mockCluster(page: Page) {
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: async ({ pathname }) => {
                if (pathname === '/api/nodes') {
                    return mockJson({
                        status: 'success', enabled: true, clusterId: 'lab',
                        localNodeId: LOCAL_NODE, degraded: false, offlineNodeIds: [], nodes: NODES
                    });
                }
                if (pathname === '/api/nodes/services') {
                    return mockJson({
                        status: 'success', degraded: false, offlineNodeIds: [], nodes: NODES,
                        services: [...perNode('node-a', false), ...perNode('node-b', true)]
                    });
                }
                // 本机接口只返回本节点的两个服务。
                if (pathname === '/api/services') {
                    return mockJson({ status: 'success', services: perNode('node-a', false) });
                }
                return undefined;
            }
        });
    }

    test('overview counts stay node-local after visiting the services page', async ({ page }) => {
        /* 曾经总览与服务管理共用一个 latestServices，分别由本机接口和聚合接口
           写入。走「总览 → 服务管理 → 30 秒缓存期内回总览」，总览会用缓存里的
           聚合结果渲染：服务总数翻倍，每个服务 id 出现两次。真机上稳定复现。 */
        await mockCluster(page);
        await page.goto('/#/overview');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));

        const tiles = page.locator('#overview-services .cm-service-tile');
        await expect(tiles).toHaveCount(2);

        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '服务管理');
            (btn as HTMLButtonElement | undefined)?.click();
        });
        await expect(page.locator('#service-grid .service-card, #service-grid [data-service-id]')).toHaveCount(4);

        // 回到总览：仍应只统计本节点，而不是缓存里的聚合结果。
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '总览');
            (btn as HTMLButtonElement | undefined)?.click();
        });
        await expect(tiles).toHaveCount(2);

        const ids = await tiles.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-service-id')));
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('overview states that its numbers cover only this node', async ({ page }) => {
        // 不说清范围，运维会把总览的数字当成全集群的。
        await mockCluster(page);
        await page.goto('/#/overview');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await expect(page.locator('#overview-services-meta')).toContainText('仅本节点');
    });
});

test.describe('部署类型未知时不猜', () => {
    test('install page never names the wrong product while deployment info is loading', async ({ page }) => {
        /* 边缘端直接打开 #/install（或在该页刷新）时，部署信息还没到，原来按
           CLOUD 兜底：页面显示「执行 IoT Cloud 的安装初始化任务」和
           iotcloud/docker-compose-install.yml，要切走再切回才纠正——等于告诉
           运维他们要初始化的是另一个产品。真机 10.8.8.157（EDGE）上复现过。 */
        let releaseDeployment: (() => void) | null = null;
        const deploymentGate = new Promise<void>(resolve => { releaseDeployment = resolve; });

        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: async ({ pathname }) => {
                if (pathname === '/api/deployment') {
                    await deploymentGate; // 卡住，模拟部署信息尚未返回
                    return mockJson({
                        status: 'success', appRoot: '/root/sprixin-iotedge',
                        appDir: '/root/sprixin-iotedge/services/iotedge',
                        appType: 'EDGE', appService: 'iotedge',
                        envPath: '/root/sprixin-iotedge/services/iotedge/.env',
                        yamlPath: '', authRequired: true,
                        docker: { available: true, message: '' }, diagnostics: []
                    });
                }
                return undefined;
            }
        });

        await page.goto('/#/install');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));

        const subtitle = page.locator('#install-subtitle');
        const composeLabel = page.locator('#install-compose-label');
        // 关键断言：宁可显示占位，也不能显示另一个产品。
        await expect(subtitle).not.toContainText('IoT Cloud');
        await expect(composeLabel).not.toContainText('iotcloud');

        releaseDeployment!();
        // 部署信息到达后必须自行纠正，而不是等用户切走再切回。
        await expect(subtitle).toContainText('IoT Edge');
        await expect(composeLabel).toContainText('iotedge/docker-compose-install.yml');
    });

    test('the services breadcrumb never claims Cloud on an edge deployment', async ({ page }) => {
        // 面包屑的静态初值原本写死 Cloud · -- 服务，边缘端首屏即是错的。
        let releaseDeployment: (() => void) | null = null;
        const deploymentGate = new Promise<void>(resolve => { releaseDeployment = resolve; });

        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: async ({ pathname }) => {
                if (pathname === '/api/deployment') {
                    await deploymentGate;
                    return mockJson({
                        status: 'success', appRoot: '/root/sprixin-iotedge',
                        appDir: '/root/sprixin-iotedge/services/iotedge',
                        appType: 'EDGE', appService: 'iotedge',
                        envPath: '/root/sprixin-iotedge/services/iotedge/.env',
                        yamlPath: '', authRequired: true,
                        docker: { available: true, message: '' }, diagnostics: []
                    });
                }
                return undefined;
            }
        });

        await page.goto('/#/deployment');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));

        const crumb = page.locator('#deployment-breadcrumb-third');
        await expect(crumb).not.toContainText('Cloud');

        releaseDeployment!();
        await expect(crumb).toContainText('Edge');
    });
});

test.describe('集群模式下的卡片标题', () => {
    test('service names stay readable when node and HA badges are present', async ({ page }) => {
        /* 卡片标题行原为 nowrap，徽章都是 flex:0 0 auto 不收缩，唯一能收缩的
           服务名被挤掉：集群模式叠加节点徽章后 PostgreSQL 只剩「P...」，
           瀚高双机热备的标题宽度直接是 0px。真机 10.8.8.157 上截图确认过。 */
        const NODES = [
            { nodeId: 'node-a', nodeLabel: '业务机(157)', endpoint: 'http://a:3301', online: true, local: true },
            { nodeId: 'node-b', nodeLabel: '数据机(235)', endpoint: 'http://b:3301', online: true }
        ];
        const services = [
            { id: 'postgres-ha', label: 'PostgreSQL 双机热备', tier: 'storage', status: 'stopped', running: false, readOnly: true, kind: 'ha-cluster', nodeId: 'node-a', nodeLabel: '业务机(157)' },
            { id: 'highgo-ha', label: '瀚高双机热备', tier: 'storage', status: 'running', running: true, readOnly: true, kind: 'ha-cluster', nodeId: 'node-a', nodeLabel: '业务机(157)', ha: { role: 'primary', vipHeld: true, vip: '10.8.8.200' } },
            { id: 'redis', label: 'Redis', tier: 'cache', status: 'running', running: true, nodeId: 'node-b', nodeLabel: '数据机(235)' }
        ];

        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: async ({ pathname }) => {
                if (pathname === '/api/nodes') {
                    return mockJson({ status: 'success', enabled: true, clusterId: 'lab', localNodeId: 'node-a', degraded: false, offlineNodeIds: [], nodes: NODES });
                }
                if (pathname === '/api/nodes/services') {
                    return mockJson({ status: 'success', degraded: false, offlineNodeIds: [], nodes: NODES, services });
                }
                if (pathname === '/api/services') return mockJson({ status: 'success', services });
                return undefined;
            }
        });

        await page.goto('/#/deployment');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await expect(page.locator('#service-grid [data-service-id]').first()).toBeVisible();

        const names = page.locator('#service-grid .cm-svc-name');
        const count = await names.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i += 1) {
            const box = await names.nth(i).boundingBox();
            const text = (await names.nth(i).textContent())?.trim() || '';
            // 标题不能被挤成 0 宽或窄到放不下一个字。
            expect(box, `「${text}」没有布局盒`).not.toBeNull();
            expect(box!.width, `「${text}」的标题宽度被挤没了`).toBeGreaterThan(24);
        }

        // 最长的那个名字必须完整可见——被截掉的正好是区分它的部分。
        const haName = page.locator('#service-grid [data-service-id="postgres-ha"] .cm-svc-name');
        const clipped = await haName.evaluate(el => el.scrollHeight > el.clientHeight + 1);
        expect(clipped, '「PostgreSQL 双机热备」仍被截断').toBe(false);
    });
});

test.describe('卡片正面只留服务名', () => {
    const services = [
        { id: 'cassandra', label: 'Cassandra', tier: 'storage', status: 'stopped', running: false },
        { id: 'iotcloud', label: 'IoT Cloud', tier: 'business', status: 'running', running: true },
        { id: 'postgres-ha', label: 'PostgreSQL 双机热备', tier: 'storage', status: 'stopped', running: false, readOnly: true, kind: 'ha-cluster' },
        { id: 'wechat', label: '企业微信告警', tier: 'business', status: 'stopped', running: false, image: 'wechat-messenger:v2.1.0' }
    ];

    async function open(page: Page) {
        await mockConfigMateApi(page, {
            authenticated: true,
            apiHandler: async ({ pathname }) => {
                if (pathname === '/api/services') return mockJson({ status: 'success', services });
                return undefined;
            }
        });
        await page.goto('/#/deployment');
        await page.waitForFunction(() => !document.body.hasAttribute('data-route-booting'));
        await expect(page.locator('#service-grid [data-service-id]').first()).toBeVisible();
    }

    test('no card repeats an id under the name', async ({ page }) => {
        /* 名称下面原本还有一行服务 id。多数服务的 id 就是名字的小写形式
           （Cassandra / cassandra、IoT Cloud / iotcloud），每张卡都把同一个词
           重复一遍；少数不同的又让各卡高矮不一。统一去掉。 */
        await open(page);
        await expect(page.locator('#service-grid .cm-svc-image')).toHaveCount(0);
    });

    test('the container name and image stay reachable from the tooltip', async ({ page }) => {
        // 去掉的只是重复展示，信息本身不能丢——去命令行看日志要用容器名。
        await open(page);
        const title = (id: string) => page.locator(`#service-grid [data-service-id="${id}"] .cm-svc-name`);
        await expect(title('postgres-ha')).toHaveAttribute('title', /postgres-ha/);
        await expect(title('wechat')).toHaveAttribute('title', /wechat-messenger:v2\.1\.0/);
        // 名称与 id 等价时，tooltip 里也不重复一遍。
        await expect(title('cassandra')).toHaveAttribute('title', 'Cassandra');
    });

    test('filtering still matches id and image, and now the display name too', async ({ page }) => {
        /* 筛选原本从副标题元素读文字，卡片正面不再显示 id / 镜像后会失效。
           顺带修掉一个既有问题：输入框写「筛选服务名 / 镜像」，但原来不匹配
           显示名，输入「瀚高」「PostgreSQL」筛不出任何东西。 */
        await open(page);
        const box = page.locator('#deployment-search, input[placeholder*="筛选"]').first();
        const visible = () => page.locator('#service-grid .service-card:not(.is-filtered)');

        await box.fill('wechat-messenger');           // 按镜像
        await expect(visible()).toHaveCount(1);

        await box.fill('postgres-ha');                // 按 id
        await expect(visible()).toHaveCount(1);

        await box.fill('双机热备');                    // 按显示名
        await expect(visible()).toHaveCount(1);

        await box.fill('');
        await expect(visible()).toHaveCount(services.length);
    });
});
