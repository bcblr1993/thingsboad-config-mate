const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSettingsStore, normalizeBoolean } = require('../src/server/config/settings-store');

function tmpSettingsFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-settings-'));
    return path.join(dir, '.config-mate', 'settings.json');
}

test('strict dependency check defaults to enabled', () => {
    const store = createSettingsStore({ settingsFile: tmpSettingsFile(), env: {} });
    assert.equal(store.get().strictDependencyCheck, true);
    assert.equal(store.isStrictDependencyCheck(), true);
});

test('environment variable can preset the default', () => {
    const store = createSettingsStore({
        settingsFile: tmpSettingsFile(),
        env: { CONFIG_MATE_STRICT_DEPENDENCY: 'false' }
    });
    assert.equal(store.isStrictDependencyCheck(), false);
});

test('update persists across store instances', () => {
    const file = tmpSettingsFile();
    const first = createSettingsStore({ settingsFile: file, env: {} });
    first.update({ strictDependencyCheck: false });

    // 容器重建后重新读取，设置必须保留。
    const second = createSettingsStore({ settingsFile: file, env: {} });
    assert.equal(second.isStrictDependencyCheck(), false);
});

test('stored value wins over the environment default', () => {
    const file = tmpSettingsFile();
    createSettingsStore({ settingsFile: file, env: {} }).update({ strictDependencyCheck: false });

    const store = createSettingsStore({
        settingsFile: file,
        env: { CONFIG_MATE_STRICT_DEPENDENCY: 'true' }
    });
    assert.equal(store.isStrictDependencyCheck(), false);
});

test('normalizeBoolean accepts the usual textual forms', () => {
    ['1', 'true', 'yes', 'on', 'TRUE'].forEach(v => assert.equal(normalizeBoolean(v, false), true, v));
    ['0', 'false', 'no', 'off', 'FALSE'].forEach(v => assert.equal(normalizeBoolean(v, true), false, v));
    // 无法识别的值不应静默翻转开关。
    assert.equal(normalizeBoolean('maybe', true), true);
    assert.equal(normalizeBoolean(undefined, true), true);
});

test('a corrupted settings file falls back to defaults instead of crashing', () => {
    const file = tmpSettingsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json');

    const store = createSettingsStore({ settingsFile: file, env: {}, logger: { warn() {} } });
    assert.equal(store.isStrictDependencyCheck(), true);
});

test('unrelated keys in the payload are ignored', () => {
    const store = createSettingsStore({ settingsFile: tmpSettingsFile(), env: {} });
    const next = store.update({ strictDependencyCheck: false, somethingElse: 'x' });
    assert.equal(next.strictDependencyCheck, false);
    assert.equal(next.somethingElse, undefined);
});
