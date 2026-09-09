const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    buildReverseMapping,
    extractConfigFromYaml,
    extractEnvPlaceholders,
    findYamlPath,
    flattenYaml,
    resolveSpringPlaceholder
} = require('../src/server/config/yaml-init');

test('findYamlPath only looks inside the deployment package', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-mate-yaml-scope-'));
    const appDir = path.join(root, 'services', 'iotedge');
    const toolDir = path.join(root, 'opt', 'tb-config-mate');
    fs.mkdirSync(path.join(appDir, 'conf'), { recursive: true });
    fs.mkdirSync(path.join(toolDir, 'conf'), { recursive: true });

    // 工具自身安装目录下夹带的样例配置不能被当成现场配置
    fs.writeFileSync(path.join(toolDir, 'conf', 'thingsboard.yml'), 'spring: {}\n');

    assert.equal(findYamlPath({ yamlConfigPath: null, appDir, appRoot: root }), null);

    const packaged = path.join(appDir, 'conf', 'tb-edge.yml');
    fs.writeFileSync(packaged, 'spring: {}\n');
    assert.equal(findYamlPath({ yamlConfigPath: null, appDir, appRoot: root }), packaged);

    fs.rmSync(root, { recursive: true, force: true });
});

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
        CLOUD_CHECK_STATUS_BASE_URL: 'https://cloud.example.com',
        EDGES_STORAGE_HISTORY_STATUS: 'true',
        TELEMETRY_SEPARATION_ENABLED: 'false'
    });
});

test('extractConfigFromYaml ignores placeholders outside the supported config metadata', () => {
    const flattened = {
        SPRING_DATASOURCE_URL: '${SPRING_DATASOURCE_URL:jdbc:postgresql://postgres:5432/thingsboard}',
        SERVER_PORT: '${HTTP_BIND_PORT:8080}',
        JDBC_URL: 'jdbc:postgresql://${PG_HOST:postgres}:${PG_PORT:5432}/thingsboard',
        CUSTOM_RUNTIME_KEY: '${CUSTOM_RUNTIME_KEY:custom-value}'
    };
    const configMeta = {
        SPRING_DATASOURCE_URL: { scope: 'common' }
    };

    assert.deepEqual(extractConfigFromYaml({ data: {}, flattened, configMeta, targetAppType: 'CLOUD' }), {
        APPTYPE: 'CLOUD',
        SPRING_DATASOURCE_URL: 'jdbc:postgresql://postgres:5432/thingsboard'
    });
});
