const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildRuntimeEnvDiff,
    parseRuntimeEnvFromInspect,
    validateConfigValues
} = require('../src/server/routes/config');
const cloudMeta = require('../meta/cloud');
const edgeMeta = require('../meta/edge');

test('parseRuntimeEnvFromInspect converts docker inspect env list to map', () => {
    const runtime = parseRuntimeEnvFromInspect(JSON.stringify([
        {
            Config: {
                Env: [
                    'A=1',
                    'B=value=with=equals',
                    'EMPTY='
                ]
            }
        }
    ]));

    assert.deepEqual(runtime, {
        A: '1',
        B: 'value=with=equals',
        EMPTY: ''
    });
});

test('buildRuntimeEnvDiff ignores runtime defaults and reports local changes', () => {
    const diffs = buildRuntimeEnvDiff(
        {
            PATH: '/usr/bin',
            DATABASE_TS_TYPE: 'cassandra',
            SPRING_DATASOURCE_USERNAME: 'postgres',
            NEW_ONLY: 'local'
        },
        {
            PATH: '/bin',
            DATABASE_TS_TYPE: 'sql',
            SPRING_DATASOURCE_USERNAME: 'postgres'
        }
    );

    assert.deepEqual(diffs, [
        {
            key: 'DATABASE_TS_TYPE',
            runtimeVal: 'sql',
            localVal: 'cassandra',
            state: 'MODIFIED'
        },
        {
            key: 'NEW_ONLY',
            runtimeVal: '(missing)',
            localVal: 'local',
            state: 'DELETED'
        }
    ]);
});

test('validateConfigValues enforces required, number range, and select options', () => {
    const meta = {
        CACHE_TYPE: {
            label: '缓存类型',
            type: 'select',
            options: ['caffeine', 'redis'],
            required: true
        },
        REDIS_PORT: {
            label: 'Redis 端口',
            type: 'number',
            min: 1,
            max: 65535,
            dependsOn: { key: 'CACHE_TYPE', value: 'redis' }
        },
        TB_QUEUE_TYPE: {
            label: '队列类型',
            type: 'select',
            options: ['kafka', 'in-memory'],
            required: true
        }
    };

    assert.deepEqual(validateConfigValues(meta, {
        CACHE_TYPE: 'caffeine',
        REDIS_PORT: 'not-used',
        TB_QUEUE_TYPE: 'in-memory'
    }), []);

    assert.deepEqual(validateConfigValues(meta, {
        CACHE_TYPE: 'redis',
        REDIS_PORT: 'abc',
        TB_QUEUE_TYPE: 'rocketmq'
    }), [
        { key: 'REDIS_PORT', label: 'Redis 端口', message: 'Redis 端口必须是数字' },
        { key: 'TB_QUEUE_TYPE', label: '队列类型', message: '队列类型只能是：kafka / in-memory' }
    ]);

    assert.deepEqual(validateConfigValues(meta, {
        CACHE_TYPE: '',
        TB_QUEUE_TYPE: 'kafka'
    }), [
        { key: 'CACHE_TYPE', label: '缓存类型', message: '缓存类型不能为空' }
    ]);
});

test('form metadata rejects negative values for non-negative numeric keys', () => {
    const nonNegativeKeys = [
        'CLOUD_CHECK_STATUS_PERIOD_MIN',
        'EDGES_STORAGE_MAX_READ_HISTORY_COUNT',
        'EDGES_STORAGE_KAFKA_BACKFILL_THRESHOLD_MS',
        'TB_QUEUE_TELEMETRY_TS_KV_CLOUD_EVENT_PARTITIONS',
        'TS_KV_TTL',
        'REDIS_PORT',
        'REDIS_DB',
        'SQL_TTL_CLOUD_EVENTS_EXECUTION_INTERVAL',
        'SQL_TTL_CLOUD_EVENTS_TTL',
        'TB_QUEUE_KAFKA_CLOUD_EVENT_MAX_POLL_RECORDS',
        'TB_QUEUE_KAFKA_CLOUD_EVENT_TS_MAX_POLL_RECORDS',
        'TB_QUEUE_KAFKA_TELEMETRY_TS_KV_CLOUD_EVENT_MAX_POLL_RECORDS',
        'MQTT_BIND_PORT',
        'NETTY_MAX_PAYLOAD_SIZE',
        'TBEL_MAX_TOTAL_ARGS_SIZE',
        'TBEL_MAX_RESULT_SIZE',
        'TBEL_MAX_SCRIPT_BODY_SIZE',
        'JS_MAX_TOTAL_ARGS_SIZE',
        'JS_MAX_RESULT_SIZE',
        'JS_MAX_SCRIPT_BODY_SIZE',
        'SQL_TTL_TS_EXECUTION_INTERVAL',
        'SQL_TTL_TS_TS_KEY_VALUE_TTL'
    ];
    const metaSources = { CLOUD: cloudMeta, EDGE: edgeMeta };

    for (const [appType, metaSource] of Object.entries(metaSources)) {
        for (const key of nonNegativeKeys) {
            if (!metaSource[key]) continue;

            assert.equal(metaSource[key].type, 'number', `${appType} ${key} should be numeric`);
            assert.ok(
                metaSource[key].min !== undefined && Number(metaSource[key].min) >= 0,
                `${appType} ${key} should define a non-negative minimum`
            );

            const meta = {
                [key]: {
                    ...metaSource[key],
                    dependsOn: undefined,
                    required: false
                }
            };
            const errors = validateConfigValues(meta, { APPTYPE: appType, [key]: '-1' });

            assert.deepEqual(errors, [{
                key,
                label: metaSource[key].label,
                message: `${metaSource[key].label}不能小于 ${metaSource[key].min}`
            }], `${appType} ${key} should reject -1`);
        }
    }
});
