const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function loadServicesUi() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'assets/modules/services-ui.js'), 'utf8');
    const window = {
        ConfigMateUi: { escapeHtml }
    };
    vm.runInNewContext(source, { window, console, Date, JSON, Math, Number, String, RegExp, Set });
    return window.ConfigMateServicesUi;
}

test('service detail actions keep original section indexes after port and volume sections are filtered', () => {
    const ui = loadServicesUi();
    const html = ui.renderServiceConfig({
        status: 'success',
        service: { id: 'redis', label: 'Redis' },
        composePath: 'services/redis/docker-compose.yml',
        summary: {
            image: 'redis:7.2',
            containerName: 'redis',
            restart: 'always'
        },
        sections: [
            {
                title: '关键配置',
                items: [{ key: 'REDIS_PASSWORD', value: 'eRLvW23KYiAakR', sensitive: true }]
            },
            {
                title: '端口',
                items: [{ key: '', value: '6379:6379' }]
            },
            {
                title: '挂载',
                items: [{ key: '', value: './data:/data' }]
            },
            {
                title: '其他',
                items: [
                    { key: 'command', value: 'redis-server --requirepass eRLvW23KYiAakR', sensitive: true },
                    { key: 'restart', value: 'always', sensitive: false }
                ]
            }
        ]
    }, {
        selectedServiceId: 'redis',
        serviceStatus: { status: 'running', running: true, containerId: '593fb753b7a9' }
    });

    assert.match(html, /command/);
    assert.match(html, /toggleServiceSecret\(3, 0, this\)/);
    assert.doesNotMatch(html, /toggleServiceSecret\(1, 0, this\)/);
});
