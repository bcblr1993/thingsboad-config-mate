const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildReverseMapping,
    extractAllPlaceholderConfig,
    extractConfigFromYaml,
    extractEnvPlaceholders,
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
    assert.equal(resolveSpringPlaceholder('${SECURITY_JAVA_CACERTS_PATH:${java.home}/lib/security/cacerts}'), '${java.home}/lib/security/cacerts');
    assert.equal(resolveSpringPlaceholder('plain'), 'plain');
});

test('extractEnvPlaceholders reads all uppercase spring env keys from yaml values', () => {
    assert.deepEqual(extractEnvPlaceholders('jdbc://${DB_HOST:postgres}:${DB_PORT:5432}/thingsboard'), [
        {
            key: 'DB_HOST',
            raw: '${DB_HOST:postgres}',
            hasDefault: true,
            defaultValue: 'postgres'
        },
        {
            key: 'DB_PORT',
            raw: '${DB_PORT:5432}',
            hasDefault: true,
            defaultValue: '5432'
        }
    ]);
    assert.deepEqual(extractEnvPlaceholders('${SECURITY_JAVA_CACERTS_PATH:${java.home}/lib/security/cacerts}'), [
        {
            key: 'SECURITY_JAVA_CACERTS_PATH',
            raw: '${SECURITY_JAVA_CACERTS_PATH:${java.home}/lib/security/cacerts}',
            hasDefault: true,
            defaultValue: '${java.home}/lib/security/cacerts'
        }
    ]);
});

test('extractAllPlaceholderConfig keeps non-ui yaml placeholders for first env generation', () => {
    assert.deepEqual(extractAllPlaceholderConfig({
        SERVER_PORT: '${HTTP_BIND_PORT:8080}',
        JDBC_URL: 'jdbc:postgresql://${PG_HOST:postgres}:${PG_PORT:5432}/thingsboard',
        NO_DEFAULT: '${CUSTOM_REQUIRED_KEY}'
    }), {
        HTTP_BIND_PORT: '8080',
        PG_HOST: 'postgres',
        PG_PORT: '5432',
        CUSTOM_REQUIRED_KEY: ''
    });
});

test('extractConfigFromYaml uses reverse mapping, manual mapping, and edge legacy values', () => {
    const flattened = {
        SPRING_DATASOURCE_URL: '${SPRING_DATASOURCE_URL:jdbc:postgresql://postgres:5432/thingsboard}',
        REDIS_STANDALONE_HOST: '${REDIS_HOST:redis}',
        TRANSPORT_MQTT_BIND_PORT: '${MQTT_BIND_PORT:1883}',
        HTTP_BIND_PORT: '${HTTP_BIND_PORT:8080}',
        CUSTOM_RUNTIME_KEY: '${CUSTOM_RUNTIME_KEY:custom-value}'
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
        HTTP_BIND_PORT: '8080',
        CUSTOM_RUNTIME_KEY: 'custom-value',
        CLOUD_CHECK_STATUS_BASE_URL: 'https://cloud.example.com',
        EDGES_STORAGE_HISTORY_STATUS: 'true',
        TELEMETRY_SEPARATION_ENABLED: 'false'
    });
});
