const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildRuntimeEnvDiff,
    parseRuntimeEnvFromInspect,
    validateConfigValues
} = require('../src/server/routes/config');

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
