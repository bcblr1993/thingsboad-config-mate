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
    const backupRoot = path.join(runtimeDir, 'backups');
    const auditLogFile = path.join(runtimeDir, 'audit.log');
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

test('buildCleanupPlan returns fixed paths under app root', () => {
    const root = createTempRoot();
    touch(path.join(root, 'services/postgres/docker-compose.yml'));
    const { backupRoot, service } = createService(root);

    const plan = service.buildCleanupPlan('postgres', actor);

    assert.equal(plan.status, 'success');
    assert.equal(plan.dataPath, path.join(root, 'services/postgres/data'));
    assert.equal(plan.backupRoot, backupRoot);
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

test('runCleanupService archives data directory and writes manifest', async () => {
    const root = createTempRoot();
    touch(path.join(root, 'services/postgres/docker-compose.yml'));
    touch(path.join(root, 'services/postgres/data/current.txt'), 'current-data');
    const { auditLogFile, backupRoot, dockerCalls, service } = createService(root);

    const result = await service.runCleanupService('postgres', 'postgres', actor);
    const backupDirs = fs.readdirSync(backupRoot);
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    const audit = readAuditEntries(auditLogFile);

    assert.equal(result.status, 'success');
    assert.equal(result.archived, true);
    assert.equal(backupDirs.length, 1);
    assert.equal(fs.readFileSync(path.join(result.backupDir, 'data/current.txt'), 'utf8'), 'current-data');
    assert.equal(fs.existsSync(path.join(root, 'services/postgres/data')), true);
    assert.equal(manifest.result, 'success');
    assert.deepEqual(audit.map(entry => entry.status), ['pending', 'success']);
    assert.deepEqual(dockerCalls.map(call => call.args), [
        ['compose', '-f', path.join(root, 'services/postgres/docker-compose.yml'), 'down'],
        ['compose', '-f', path.join(root, 'services/postgres/docker-compose.yml'), 'up', '-d']
    ]);
});

test('cleanup path must stay inside app root', () => {
    const root = createTempRoot();
    touch(path.join(root, 'services/postgres/docker-compose.yml'));
    const { service } = createService(root, {
        cleanupServiceDataDirs: { postgres: '../outside' }
    });

    assert.throws(() => service.buildCleanupPlan('postgres', actor), /Unsafe path outside APP_ROOT/);
});
