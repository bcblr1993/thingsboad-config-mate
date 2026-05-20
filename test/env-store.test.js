const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    checkDependsOn,
    createEnvStore,
    parseEnvContent,
    safeHistoryPath
} = require('../src/server/config/env-store');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'config-mate-env-store-'));
}

function write(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
}

test('parseEnvContent preserves equals and removes matching quotes', () => {
    assert.deepEqual(parseEnvContent([
        'APP_TYPE="CLOUD"',
        'SPRING_DATASOURCE_PASSWORD=abc=123',
        'EMPTY=',
        '# comment',
        ''
    ].join('\n')), {
        APP_TYPE: 'CLOUD',
        SPRING_DATASOURCE_PASSWORD: 'abc=123',
        EMPTY: ''
    });
});

test('checkDependsOn supports nested boolean conditions', () => {
    const config = { A: 'yes', B: 'no', C: 'on' };
    assert.equal(checkDependsOn({ key: 'A', value: 'yes' }, config), true);
    assert.equal(checkDependsOn({ key: ['X', 'B'], value: 'no' }, config), true);
    assert.equal(checkDependsOn({ and: [{ key: 'A', value: 'yes' }, { key: 'C', value: 'on' }] }, config), true);
    assert.equal(checkDependsOn({ or: [{ key: 'A', value: 'no' }, { key: 'B', value: 'no' }] }, config), true);
});

test('saveEnvFile writes scoped grouped config and keeps custom keys', () => {
    const root = tempDir();
    const envPath = path.join(root, 'services/iotcloud/.env');
    const historyDir = path.join(root, 'services/iotcloud/.env_history');
    const store = createEnvStore({
        envFilePath: envPath,
        historyDir,
        logger: {},
        configMeta: {
            APPTYPE: { group: '核心', label: '应用类型' },
            CLOUD_ONLY: { group: '核心', label: '云端字段', scope: 'cloud' },
            EDGE_ONLY: { group: '核心', label: '边缘字段', scope: 'edge' },
            REDIS_ONLY: {
                group: '缓存',
                label: 'Redis 字段',
                dependsOn: { key: 'CACHE_TYPE', value: 'redis' }
            }
        }
    });

    store.saveEnvFile({
        APPTYPE: 'CLOUD',
        CLOUD_ONLY: 'cloud-value',
        EDGE_ONLY: 'edge-value',
        CACHE_TYPE: 'redis',
        REDIS_ONLY: 'redis-value',
        CUSTOM_KEY: 'custom'
    });

    const content = fs.readFileSync(envPath, 'utf-8');
    assert.match(content, /# === 核心 ===/);
    assert.match(content, /CLOUD_ONLY=cloud-value/);
    assert.match(content, /REDIS_ONLY=redis-value/);
    assert.match(content, /# === 自定义配置 \(其他\) ===/);
    assert.match(content, /EDGE_ONLY=edge-value/);
    assert.match(content, /CUSTOM_KEY=custom/);
});

test('saveEnvFile skips history when values are unchanged', () => {
    const root = tempDir();
    const envPath = path.join(root, '.env');
    const historyDir = path.join(root, '.env_history');
    write(envPath, 'A=1\n');

    const store = createEnvStore({
        envFilePath: envPath,
        historyDir,
        logger: {},
        configMeta: {
            A: { group: '基础', label: 'A' }
        }
    });

    const result = store.saveEnvFile({ A: '1' });

    assert.deepEqual(result, { changed: false, backupPath: null });
    assert.equal(store.listHistory().length, 0);
    assert.equal(fs.readFileSync(envPath, 'utf-8'), 'A=1\n');
});

test('history backup, content read, and restore stay inside history directory', () => {
    const root = tempDir();
    const envPath = path.join(root, '.env');
    const historyDir = path.join(root, '.env_history');
    write(envPath, 'A=1\n');

    const store = createEnvStore({
        envFilePath: envPath,
        historyDir,
        logger: {},
        configMeta: {
            A: { group: '基础', label: 'A' }
        }
    });

    store.saveEnvFile({ A: '2' });

    const history = store.listHistory();
    assert.equal(history.length, 1);
    assert.equal(store.readHistoryContent(history[0].filename).content, 'A=1\n');

    const outside = safeHistoryPath(historyDir, '../../etc/passwd');
    assert.equal(outside, null);
    assert.equal(store.restoreHistory('../../etc/passwd').statusCode, 404);

    const restored = store.restoreHistory(history[0].filename);
    assert.equal(restored.ok, true);
    assert.equal(fs.readFileSync(envPath, 'utf-8'), 'A=1\n');
});
