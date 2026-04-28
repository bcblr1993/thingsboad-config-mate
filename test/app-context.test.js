const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { normalizeAppType, parseEnvFileAt, resolveAppContext } = require('../src/server/app-context');

function createTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'config-mate-app-context-'));
}

function touch(filePath, content = '') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

test('normalizes app type values', () => {
    assert.equal(normalizeAppType('cloud'), 'CLOUD');
    assert.equal(normalizeAppType(' EDGE '), 'EDGE');
    assert.equal(normalizeAppType('unknown'), '');
});

test('parses env files with quoted values', () => {
    const root = createTempRoot();
    const envPath = path.join(root, '.env');
    touch(envPath, [
        'APP_TYPE="EDGE"',
        'SPRING_DATASOURCE_PASSWORD=abc=123',
        '# comment',
        ''
    ].join('\n'));

    assert.deepEqual(parseEnvFileAt(envPath), {
        APP_TYPE: 'EDGE',
        SPRING_DATASOURCE_PASSWORD: 'abc=123'
    });
});

test('detects direct cloud package from services/iotcloud', () => {
    const root = createTempRoot();
    touch(path.join(root, 'services', 'iotcloud', 'conf', 'thingsboard.yml'));

    const context = resolveAppContext(root, {});

    assert.equal(context.appType, 'CLOUD');
    assert.equal(context.appId, 'iotcloud');
    assert.equal(context.mode, 'package');
    assert.equal(context.appDir, path.join(root, 'services', 'iotcloud'));
});

test('detects direct edge package from services/iotedge .env APP_TYPE', () => {
    const root = createTempRoot();
    touch(path.join(root, 'services', 'iotcloud', 'conf', 'thingsboard.yml'));
    touch(path.join(root, 'services', 'iotedge', '.env'), 'APP_TYPE=EDGE\n');

    const context = resolveAppContext(root, {});

    assert.equal(context.appType, 'EDGE');
    assert.equal(context.appId, 'iotedge');
    assert.equal(context.appDir, path.join(root, 'services', 'iotedge'));
});

test('honors explicit APP_TYPE when both package directories exist', () => {
    const root = createTempRoot();
    touch(path.join(root, 'services', 'iotcloud', 'conf', 'thingsboard.yml'));
    touch(path.join(root, 'services', 'iotedge', 'conf', 'tb-edge.yml'));

    const context = resolveAppContext(root, { APP_TYPE: 'EDGE' });

    assert.equal(context.appType, 'EDGE');
    assert.equal(context.appDir, path.join(root, 'services', 'iotedge'));
});

test('detects nested sprixin package from development workspace', () => {
    const root = createTempRoot();
    const nestedRoot = path.join(root, 'sprixin-iotedge');
    touch(path.join(nestedRoot, 'services', 'iotedge', 'conf', 'tb-edge.yml'));

    const context = resolveAppContext(root, {});

    assert.equal(context.appType, 'EDGE');
    assert.equal(context.appRoot, nestedRoot);
    assert.equal(context.appDir, path.join(nestedRoot, 'services', 'iotedge'));
});

test('keeps legacy root mode for old single-package layout', () => {
    const root = createTempRoot();
    touch(path.join(root, 'conf', 'thingsboard.yml'));

    const context = resolveAppContext(root, {});

    assert.equal(context.appType, 'CLOUD');
    assert.equal(context.mode, 'legacy');
    assert.equal(context.appDir, root);
});
