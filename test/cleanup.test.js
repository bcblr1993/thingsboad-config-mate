const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createCleanupService, sanitizePathSegment } = require('../src/server/services/cleanup');

function createTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'config-mate-cleanup-'));
}

function touch(filePath, content = '') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

function readAuditEntries(auditLogFile) {
    return fs.readFileSync(auditLogFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
}

function createService(root, overrides = {}) {
    const runtimeDir = path.join(root, '.config-mate');
    const backupRoot = overrides.backupRoot || path.join(root, 'services/config-mate/backups');
    const auditLogFile = overrides.auditLogFile || path.join(backupRoot, 'audit.log');
    const dockerCalls = [];

    const getServiceDefinition = id => {
        if (id === 'postgres') {
            return {
                id: 'postgres',
                label: 'PostgreSQL',
                composePath: 'services/postgres/docker-compose.yml',
                composeAbsPath: path.join(root, 'services/postgres/docker-compose.yml'),
                composeService: 'postgres',
                exists: fs.existsSync(path.join(root, 'services/postgres/docker-compose.yml'))
            };
        }
        if (id === 'kafka') {
            return {
                id: 'kafka',
                label: 'Kafka',
                composePath: 'services/kafka/docker-compose.yml',
                composeAbsPath: path.join(root, 'services/kafka/docker-compose.yml'),
                composeService: 'kafka',
                exists: fs.existsSync(path.join(root, 'services/kafka/docker-compose.yml'))
            };
        }
        if (id === 'iotcloud') {
            return {
                id: 'iotcloud',
                label: 'IoT Cloud',
                composePath: 'services/iotcloud/docker-compose.yml',
                composeAbsPath: path.join(root, 'services/iotcloud/docker-compose.yml'),
                composeService: 'iotcloud',
                exists: true
            };
        }
        return null;
    };

    const service = createCleanupService({
        appRoot: root,
        runtimeDir,
        backupRoot,
        auditLogFile,
        cleanupServiceDataDirs: { postgres: 'services/postgres/data', ...overrides.cleanupServiceDataDirs },
        cleanupServiceDataDirModes: overrides.cleanupServiceDataDirModes || {},
        getServiceDefinition,
        getPackageServiceId: () => 'iotcloud',
        getServiceStatus: overrides.getServiceStatus || (async () => ({ status: 'stopped', running: false, containerId: '' })),
        docker: overrides.docker || {
            dockerComposeCmd: '/usr/bin/docker',
            readyMessage: () => null,
            composeArgsFor(def, args) {
                return ['compose', '-f', def.composeAbsPath, ...args];
            },
            async exec(cmd, args) {
                dockerCalls.push({ cmd, args });
                return { stdout: '', stderr: '', error: null };
            }
        },
        logger: { log() {}, error() {} }
    });

    return { auditLogFile, backupRoot, dockerCalls, service };
}

const actor = {
    operator: 'chen yn',
    sessionId: 'session-1',
    ip: '127.0.0.1'
};

test('sanitizePathSegment makes operator safe for backup paths', () => {
    assert.equal(sanitizePathSegment(' chen yn/测试 '), 'chen_yn');
});

test('buildCleanupPlan returns fixed paths under config-mate service dir', () => {
    const root = createTempRoot();
    touch(path.join(root, 'services/postgres/docker-compose.yml'));
    const { backupRoot, service } = createService(root);

    const plan = service.buildCleanupPlan('postgres', actor);

    assert.equal(plan.status, 'success');
    assert.equal(plan.dataPath, path.join(root, 'services/postgres/data'));
    assert.equal(plan.backupRoot, path.resolve(backupRoot));
    assert.equal(plan.backupRoot, path.join(root, 'services/config-mate/backups'));
    assert.match(plan.backupDir, /postgres-chen_yn/);
});

test('buildCleanupPlan rejects unsupported services', () => {
    const root = createTempRoot();
    const { service } = createService(root);

    const plan = service.buildCleanupPlan('netdata', actor);

    assert.equal(plan.status, 'error');
    assert.match(plan.message, /不支持一键清理/);
});

test('runCleanupService rejects confirmation mismatch and audits failure', async () => {
    const root = createTempRoot();
    touch(path.join(root, 'services/postgres/docker-compose.yml'));
    const { auditLogFile, service } = createService(root);

    const result = await service.runCleanupService('postgres', 'redis', actor);
    const audit = readAuditEntries(auditLogFile);

    assert.equal(result.code, 'CONFIRMATION_MISMATCH');
    assert.equal(audit[0].status, 'failure');
    assert.equal(audit[0].reason, 'CONFIRMATION_MISMATCH');
});

test('runCleanupService blocks while app service is running', async () => {
    const root = createTempRoot();
    touch(path.join(root, 'services/postgres/docker-compose.yml'));
    const { auditLogFile, service } = createService(root, {
        getServiceStatus: async def => ({
            status: def.id === 'iotcloud' ? 'running' : 'stopped',
            running: def.id === 'iotcloud',
            containerId: def.id
        })
    });

    const result = await service.runCleanupService('postgres', 'postgres', actor);
    const audit = readAuditEntries(auditLogFile);

    assert.equal(result.code, 'APP_SERVICE_RUNNING');
    assert.equal(audit[0].status, 'blocked');
    assert.equal(audit[0].reason, 'APP_SERVICE_RUNNING');
});

test('runCleanupService blocks while target service is running', async () => {
    const root = createTempRoot();
    touch(path.join(root, 'services/postgres/docker-compose.yml'));
    touch(path.join(root, 'services/postgres/data/current.txt'), 'current-data');
    const { auditLogFile, dockerCalls, service } = createService(root, {
        getServiceStatus: async def => ({
            status: def.id === 'postgres' ? 'running' : 'stopped',
            running: def.id === 'postgres',
            containerId: def.id
        })
    });

    const result = await service.runCleanupService('postgres', 'postgres', actor);
    const audit = readAuditEntries(auditLogFile);

    assert.equal(result.code, 'TARGET_SERVICE_RUNNING');
    assert.equal(audit[0].status, 'blocked');
    assert.equal(audit[0].reason, 'TARGET_SERVICE_RUNNING');
    assert.equal(fs.existsSync(path.join(root, 'services/postgres/data/current.txt')), true);
    assert.equal(dockerCalls.length, 0);
});

test('runCleanupService archives stopped service data directory and writes manifest', async () => {
    const root = createTempRoot();
    touch(path.join(root, 'services/postgres/docker-compose.yml'));
    touch(path.join(root, 'services/postgres/data/current.txt'), 'current-data');
    const { auditLogFile, backupRoot, dockerCalls, service } = createService(root);

    const result = await service.runCleanupService('postgres', 'postgres', actor);
    const backupDirs = fs.readdirSync(backupRoot)
        .filter(name => fs.statSync(path.join(backupRoot, name)).isDirectory());
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    const audit = readAuditEntries(auditLogFile);

    assert.equal(result.status, 'success');
    assert.equal(result.archived, true);
    assert.equal(backupDirs.length, 1);
    assert.equal(fs.readFileSync(path.join(result.backupDir, 'data/current.txt'), 'utf8'), 'current-data');
    assert.equal(result.backupDir.startsWith(path.join(root, 'services/config-mate/backups')), true);
    assert.equal(fs.existsSync(path.join(root, 'services/postgres/data')), true);
    assert.equal(manifest.result, 'success');
    assert.deepEqual(audit.map(entry => entry.status), ['pending', 'success']);
    assert.equal(dockerCalls.length, 0);
});

test('runCleanupService recreates kafka data directory with required mode', async () => {
    const root = createTempRoot();
    touch(path.join(root, 'services/kafka/docker-compose.yml'));
    touch(path.join(root, 'services/kafka/kafka_0_data/current.log'), 'kafka-data');
    const { service } = createService(root, {
        cleanupServiceDataDirs: { kafka: 'services/kafka/kafka_0_data' },
        cleanupServiceDataDirModes: { kafka: 0o777 }
    });

    const result = await service.runCleanupService('kafka', 'kafka', actor);
    const recreatedMode = fs.statSync(path.join(root, 'services/kafka/kafka_0_data')).mode & 0o777;
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));

    assert.equal(result.status, 'success');
    assert.equal(recreatedMode, 0o777);
    assert.equal(manifest.recreatedDirMode, 0o777);
    assert.equal(fs.readFileSync(path.join(result.backupDir, 'kafka_0_data/current.log'), 'utf8'), 'kafka-data');
});

test('cleanup path must stay inside app root', () => {
    const root = createTempRoot();
    touch(path.join(root, 'services/postgres/docker-compose.yml'));
    const { service } = createService(root, {
        cleanupServiceDataDirs: { postgres: '../outside' }
    });

    assert.throws(() => service.buildCleanupPlan('postgres', actor), /Unsafe path outside APP_ROOT/);
});
