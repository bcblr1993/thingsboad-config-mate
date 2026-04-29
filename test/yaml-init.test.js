const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildReverseMapping,
    extractConfigFromYaml,
    flattenYaml,
    resolveSpringPlaceholder
} = require('../src/server/config/yaml-init');

test('flattenYaml converts nested keys to upper underscore paths', () => {
    assert.deepEqual(flattenYaml({
        spring: {
            datasource: {
                url: '${SPRING_DATASOURCE_URL:jdbc:postgresql://postgres:5432/thingsboard}'
            }
        },
        mqtt: {
            bind_port: 1883
        }
    }), {
        SPRING_DATASOURCE_URL: '${SPRING_DATASOURCE_URL:jdbc:postgresql://postgres:5432/thingsboard}',
        MQTT_BIND_PORT: '1883'
    });
});

test('resolveSpringPlaceholder returns defaults and blanks unresolved placeholders', () => {
    assert.equal(resolveSpringPlaceholder('${A:value}'), 'value');
    assert.equal(resolveSpringPlaceholder('${A:}'), '');
    assert.equal(resolveSpringPlaceholder('${A}'), '');
    assert.equal(resolveSpringPlaceholder('plain'), 'plain');
});

test('extractConfigFromYaml uses reverse mapping, manual mapping, and edge legacy values', () => {
    const flattened = {
        SPRING_DATASOURCE_URL: '${SPRING_DATASOURCE_URL:jdbc:postgresql://postgres:5432/thingsboard}',
        REDIS_STANDALONE_HOST: '${REDIS_HOST:redis}',
        TRANSPORT_MQTT_BIND_PORT: '${MQTT_BIND_PORT:1883}'
    };
    const data = {
        cloud: {
            check_status: { baseURL: 'https://cloud.example.com' },
            rpc: { storage: { history_status: true } },
            telemetry: { separation: { enabled: false } }
        }
    };
    const configMeta = {
        SPRING_DATASOURCE_URL: { scope: 'common' },
        REDIS_HOST: { scope: 'common' },
        MQTT_BIND_PORT: { scope: 'common' },
        CLOUD_CHECK_STATUS_BASE_URL: { scope: 'edge' },
        EDGES_STORAGE_HISTORY_STATUS: { scope: 'edge' },
        TELEMETRY_SEPARATION_ENABLED: { scope: 'edge' },
        CLOUD_ONLY: { scope: 'cloud' }
    };

    assert.deepEqual(buildReverseMapping(flattened).REDIS_HOST, '${REDIS_HOST:redis}');
    assert.deepEqual(extractConfigFromYaml({ data, flattened, configMeta, targetAppType: 'EDGE' }), {
        APPTYPE: 'EDGE',
        SPRING_DATASOURCE_URL: 'jdbc:postgresql://postgres:5432/thingsboard',
        REDIS_HOST: 'redis',
        MQTT_BIND_PORT: '1883',
        CLOUD_CHECK_STATUS_BASE_URL: 'https://cloud.example.com',
        EDGES_STORAGE_HISTORY_STATUS: 'true',
        TELEMETRY_SEPARATION_ENABLED: 'false'
    });
});
