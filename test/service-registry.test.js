const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createServiceRegistry } = require('../src/server/services/registry');

function createTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'config-mate-service-registry-'));
}

function touch(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '', 'utf8');
}

test('returns only cloud app service in cloud mode', () => {
    const root = createTempRoot();
    touch(path.join(root, 'services', 'iotcloud', 'docker-compose.yml'));

    const registry = createServiceRegistry({ appRoot: root, appType: 'CLOUD' });
    const ids = registry.listServiceDefinitions().map(service => service.id);

    assert.equal(registry.getPackageServiceId(), 'iotcloud');
    assert.ok(ids.includes('iotcloud'));
    assert.ok(!ids.includes('iotedge'));
});

test('returns only edge app service in edge mode', () => {
    const root = createTempRoot();
    touch(path.join(root, 'services', 'iotedge', 'docker-compose.yml'));

    const registry = createServiceRegistry({ appRoot: root, appType: 'EDGE' });
    const ids = registry.listServiceDefinitions().map(service => service.id);

    assert.equal(registry.getPackageServiceId(), 'iotedge');
    assert.ok(ids.includes('iotedge'));
    assert.ok(!ids.includes('iotcloud'));
});

test('resolves compose paths under app root', () => {
    const root = createTempRoot();
    const composePath = path.join(root, 'services', 'postgres', 'docker-compose.yml');
    touch(composePath);

    const registry = createServiceRegistry({ appRoot: root, appType: 'CLOUD' });
    const postgres = registry.getServiceDefinition('postgres');

    assert.equal(postgres.composeAbsPath, composePath);
    assert.equal(postgres.exists, true);
});

test('exposes cleanup data directory whitelist', () => {
    const root = createTempRoot();
    const registry = createServiceRegistry({ appRoot: root, appType: 'CLOUD' });

    assert.deepEqual(registry.cleanupServiceDataDirs, {
        postgres: 'services/postgres/data',
        redis: 'services/redis/data',
        kafka: 'services/kafka/kafka_0_data',
        cassandra: 'services/cassandra/cassandra_node1_data'
    });
});

test('exposes cleanup data directory mode whitelist', () => {
    const root = createTempRoot();
    const registry = createServiceRegistry({ appRoot: root, appType: 'CLOUD' });

    assert.deepEqual(registry.cleanupServiceDataDirModes, {
        kafka: 0o777
    });
});
