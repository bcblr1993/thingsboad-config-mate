const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const {
    createServiceComposeConfigBuilder,
    extractRedisPassword,
    filterServiceEnvironmentEntries,
    normalizeComposeEnvironment,
    resolveComposeVariableString
} = require('../src/server/services/compose-config');

function tempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'config-mate-compose-config-'));
}

function write(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
}

test('normalizes compose environment and resolves compose variables', () => {
    assert.deepEqual(normalizeComposeEnvironment(['A=1=2', 'B']), [
        { key: 'A', value: '1=2' },
        { key: 'B', value: '' }
    ]);
    assert.equal(resolveComposeVariableString('${APP_IMAGE:-fallback}', { APP_IMAGE: 'local/app:1' }, {}), 'local/app:1');
    assert.equal(resolveComposeVariableString('${APP_IMAGE:-fallback}', {}, {}), 'fallback');
});

test('extractRedisPassword supports space, equals, and quoted commands', () => {
    assert.equal(extractRedisPassword('redis-server --requirepass secret'), 'secret');
    assert.equal(extractRedisPassword('redis-server --requirepass="quoted secret"'), 'quoted secret');
    assert.equal(extractRedisPassword(['redis-server', '--requirepass', 'array-secret']), 'array-secret');
});

test('filterServiceEnvironmentEntries hides noisy Kafka keys', () => {
    const visible = filterServiceEnvironmentEntries('kafka', [
        { key: 'KAFKA_ENABLE_KRAFT', value: 'yes' },
        { key: 'KAFKA_CFG_LISTENERS', value: 'PLAINTEXT://:9092' }
    ]);
    assert.deepEqual(visible, [{ key: 'KAFKA_CFG_LISTENERS', value: 'PLAINTEXT://:9092' }]);
});

test('buildServiceComposeConfig returns curated postgres config and resolved app image', () => {
    const root = tempRoot();
    const composePath = path.join(root, 'docker-compose.yml');
    write(composePath, `
services:
  postgres:
    image: postgres:15.4
    container_name: postgres
    restart: always
    ports:
      - "5432:5432"
    volumes:
      - ./data:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: thingsboard
  iotcloud:
    image: \${APP_IMAGE}
    container_name: iotcloud
    restart: always
    env_file:
      - ./.env
`);

    const definitions = {
        postgres: {
            id: 'postgres',
            label: 'PostgreSQL',
            exists: true,
            composePath: 'docker-compose.yml',
            composeAbsPath: composePath,
            composeService: 'postgres'
        },
        iotcloud: {
            id: 'iotcloud',
            label: 'IoT Cloud',
            exists: true,
            composePath: 'docker-compose.yml',
            composeAbsPath: composePath,
            composeService: 'iotcloud'
        }
    };

    const builder = createServiceComposeConfigBuilder({
        yaml,
        getPackageServiceId: () => 'iotcloud',
        getServiceDefinition: id => definitions[id],
        envProvider: () => ({ APP_IMAGE: 'tb-cloud:test' })
    });

    const postgres = builder.buildServiceComposeConfig('postgres');
    assert.equal(postgres.status, 'success');
    assert.deepEqual(postgres.sections[0].items, [
        { key: 'POSTGRES_USER', value: 'postgres', sensitive: false },
        { key: 'POSTGRES_PASSWORD', value: 'secret', sensitive: true },
        { key: 'POSTGRES_DB', value: 'thingsboard', sensitive: false }
    ]);
    assert.deepEqual(postgres.sections.map(section => section.title), ['关键配置', '端口', '挂载', '其他']);
    assert.deepEqual(postgres.sections.find(section => section.title === '其他').items, [
        { key: 'restart', value: 'always', sensitive: false }
    ]);

    const app = builder.buildServiceComposeConfig('iotcloud');
    assert.equal(app.summary.image, 'tb-cloud:test');
    assert.equal(app.sections[0].title, '说明');
});
