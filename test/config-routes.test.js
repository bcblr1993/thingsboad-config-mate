const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildRuntimeEnvDiff,
    parseRuntimeEnvFromInspect
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
