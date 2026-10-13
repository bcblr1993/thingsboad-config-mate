const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServiceRegistry } = require('../src/server/services/registry');
const { createCleanupService } = require('../src/server/services/cleanup');

for (const appType of ['CLOUD', 'EDGE']) {
    test(`IoTDB cleanup guards and archive work with the ${appType} registry`, async t => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-mate-iotdb-cleanup-'));
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        const registry = createServiceRegistry({ appRoot: root, appType });
        const dataDir = path.join(root, registry.cleanupServiceDataDirs.iotdb);
        const composePath = registry.getServiceDefinition('iotdb').composeAbsPath;
        const backupRoot = path.join(root, 'services/config-mate/backups');
        const auditLogFile = path.join(backupRoot, 'audit.log');
        fs.mkdirSync(path.join(dataDir, 'datanode'), { recursive: true });
        fs.mkdirSync(path.join(dataDir, 'confignode'), { recursive: true });
        fs.writeFileSync(composePath, 'services: {}\n');
        fs.writeFileSync(path.join(dataDir, 'datanode/series.tsfile'), 'timeseries');
        fs.writeFileSync(path.join(dataDir, 'confignode/system.bin'), 'metadata');
        const actor = { operator: 'test', sessionId: 'test-session', ip: '127.0.0.1' };
        let runningId = '';
        const cleanup = createCleanupService({
            appRoot: root,
            backupRoot,
            auditLogFile,
            cleanupServiceDataDirs: registry.cleanupServiceDataDirs,
            getServiceDefinition: registry.getServiceDefinition,
            getPackageServiceId: registry.getPackageServiceId,
            getServiceStatus: async def => ({
                status: def.id === runningId ? 'running' : 'stopped',
                running: def.id === runningId
            }),
            docker: { readyMessage: () => null },
            logger: { log() {}, error() {} }
        });
        const plan = cleanup.buildCleanupPlan('iotdb', actor);
        assert.equal(plan.status, 'success');
        assert.equal(plan.dataPath, dataDir);
        assert.equal(plan.appService, registry.getPackageServiceId());

        for (const [confirmId, activeId, code] of [
            ['redis', '', 'CONFIRMATION_MISMATCH'],
            ['iotdb', registry.getPackageServiceId(), 'APP_SERVICE_RUNNING'],
            ['iotdb', 'iotdb', 'TARGET_SERVICE_RUNNING']
        ]) {
            runningId = activeId;
            const result = await cleanup.runCleanupService('iotdb', confirmId, actor);
            assert.equal(result.code, code);
            assert.equal(fs.readFileSync(path.join(dataDir, 'datanode/series.tsfile'), 'utf8'), 'timeseries');
            assert.equal(fs.existsSync(plan.backupDir), false);
        }

        runningId = '';
        const result = await cleanup.runCleanupService('iotdb', 'iotdb', actor, { backupDir: plan.backupDir });
        assert.equal(result.status, 'success');
        assert.equal(result.archived, true);
        assert.equal(result.backupDir, plan.backupDir);
        assert.deepEqual(fs.readdirSync(dataDir), []);
        assert.equal(fs.readFileSync(path.join(result.backupDir, 'data/datanode/series.tsfile'), 'utf8'), 'timeseries');
        assert.equal(fs.readFileSync(path.join(result.backupDir, 'data/confignode/system.bin'), 'utf8'), 'metadata');
        assert.equal(fs.readFileSync(composePath, 'utf8'), 'services: {}\n');
        const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
        assert.equal(manifest.result, 'success');
        assert.equal(manifest.serviceId, 'iotdb');
        assert.equal(manifest.sourcePath, dataDir);
        const audit = fs.readFileSync(auditLogFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
        assert.deepEqual(audit.map(entry => entry.status), ['failure', 'blocked', 'blocked', 'pending', 'success']);
    });
}
