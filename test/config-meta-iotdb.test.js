const assert = require('node:assert/strict');
const test = require('node:test');

const cloudMeta = require('../meta/cloud');
const edgeMeta = require('../meta/edge');
const iotdbMeta = require('../meta/iotdb');
const { checkDependsOn } = require('../src/server/config/env-store');

function iotdbKeys(meta) {
    return Object.keys(meta).filter(key => meta[key].group === 'IoTDB');
}

test('cloud and edge expose an identical IoTDB configuration', () => {
    const cloudKeys = iotdbKeys(cloudMeta);
    const edgeKeys = iotdbKeys(edgeMeta);

    assert.deepEqual(cloudKeys, edgeKeys);
    cloudKeys.forEach(key => {
        assert.deepEqual(cloudMeta[key], edgeMeta[key], `${key} must be identical on cloud and edge`);
    });
});

test('both storage selectors offer iotdb', () => {
    [cloudMeta, edgeMeta].forEach(meta => {
        assert.ok(meta.DATABASE_TS_TYPE.options.includes('iotdb'));
        assert.ok(meta.DATABASE_TS_LATEST_TYPE.options.includes('iotdb'));
    });
});

test('IoTDB fields stay hidden until a storage selector picks iotdb', () => {
    const connectionKey = 'IOTDB_NODE_URLS';

    assert.equal(checkDependsOn(iotdbMeta[connectionKey].dependsOn, {
        DATABASE_TS_TYPE: 'cassandra',
        DATABASE_TS_LATEST_TYPE: 'redis'
    }), false);

    assert.equal(checkDependsOn(iotdbMeta[connectionKey].dependsOn, {
        DATABASE_TS_TYPE: 'iotdb',
        DATABASE_TS_LATEST_TYPE: 'redis'
    }), true);

    assert.equal(checkDependsOn(iotdbMeta[connectionKey].dependsOn, {
        DATABASE_TS_TYPE: 'sql',
        DATABASE_TS_LATEST_TYPE: 'iotdb'
    }), true);
});

test('EDQS guards surface only when latest storage is iotdb', () => {
    // 平台在 latest=iotdb 且 EDQS 开启时会拒绝启动，这两项必须固定为 false 且不可编辑
    ['TB_EDQS_SYNC_ENABLED', 'TB_EDQS_API_SUPPORTED'].forEach(key => {
        assert.equal(iotdbMeta[key].type, 'readonly');
        assert.equal(iotdbMeta[key].default, 'false');

        assert.equal(checkDependsOn(iotdbMeta[key].dependsOn, {
            DATABASE_TS_TYPE: 'iotdb',
            DATABASE_TS_LATEST_TYPE: 'redis'
        }), false);

        assert.equal(checkDependsOn(iotdbMeta[key].dependsOn, {
            DATABASE_TS_TYPE: 'iotdb',
            DATABASE_TS_LATEST_TYPE: 'iotdb'
        }), true);
    });
});

test('every IoTDB field carries a label and a default', () => {
    Object.keys(iotdbMeta).forEach(key => {
        const field = iotdbMeta[key];
        assert.ok(field.label, `${key} needs a label`);
        assert.ok(field.group === 'IoTDB', `${key} must belong to the IoTDB group`);
        assert.notEqual(field.default, undefined, `${key} needs a default so .env seeding never writes an empty value`);
        if (field.type === 'number') {
            assert.equal(typeof field.default, 'number', `${key} default must be numeric`);
        }
    });
});
