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

test.describe('Config Mate UI consistency', () => {
    test('login page', async ({ page }) => {
        await mockConfigMateApi(page, { authenticated: false });
        await page.goto('/');
        await page.locator('#login-overlay').waitFor({ state: 'visible' });
        await stabilizeVisuals(page);
        await expect(page).toHaveScreenshot('login-page.png', { fullPage: true });
    });

    test('deployment page', async ({ page }) => {
        await openRoute(page, 'deployment', '#service-grid .service-card');
        await expect(page).toHaveScreenshot('deployment-page.png', { fullPage: true });
    });

    test('overview page', async ({ page }) => {
        await openRoute(page, 'overview', '#overview-kpi-row .cm-kpi');
        await expect(page).toHaveScreenshot('overview-page.png', { fullPage: true });
    });

    test('config page', async ({ page }) => {
        await openRoute(page, 'config', '#form-container .cm-cfg-field');
        await expect(page).toHaveScreenshot('config-page.png', { fullPage: true });
    });

    test('install route', async ({ page }) => {
        await openRoute(page, 'install', '#install-logs .install-log-line');
        await expect(page).toHaveScreenshot('install-route.png', { fullPage: true });
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
});
