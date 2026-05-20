import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.CONFIG_MATE_UI_PORT || 3311);
const baseURL = process.env.CONFIG_MATE_UI_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: './tests/ui',
    snapshotDir: './tests/ui/__screenshots__',
    fullyParallel: false,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [['list'], ['html', { outputFolder: 'tests/ui/report', open: 'never' }]],
    webServer: {
        command: `NO_BROWSER=1 PORT=${port} CONFIG_MATE_PASSWORD=123456 node tb-config-src.js --dev`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000
    },
    use: {
        baseURL,
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        colorScheme: 'light',
        deviceScaleFactor: 1,
        screenshot: 'only-on-failure',
        trace: 'on-first-retry'
    },
    expect: {
        toHaveScreenshot: {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.01,
            threshold: 0.2
        }
    },
    projects: [
        {
            name: 'desktop-chromium',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1440, height: 1000 },
                deviceScaleFactor: 1
            }
        },
        {
            name: 'mobile-chromium',
            use: {
                ...devices['Pixel 5'],
                viewport: { width: 390, height: 844 },
                deviceScaleFactor: 1
            }
        }
    ]
});
