const fs = require('fs');
const path = require('path');

function sanitizePathSegment(value) {
    const text = String(value || '').trim() || 'operator';
    return text.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'operator';
}

function summarizeServiceStatus(status) {
    if (!status) return null;
    return {
        status: status.status || 'unknown',
        running: !!status.running,
        containerId: status.containerId || ''
    };
}

function formatTimestampForPath(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('') + '-' + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join('');
}

function createCleanupService({
    appRoot,
    runtimeDir,
    backupRoot,
    auditLogFile,
    cleanupServiceDataDirs,
    cleanupServiceDataDirModes = {},
    getServiceDefinition,
    getPackageServiceId,
    getServiceStatus,
    docker,
    logger = console
}) {
    let activeCleanupService = null;

    function toAppRootPath(relativePath) {
        const abs = path.resolve(appRoot, relativePath);
        const root = path.resolve(appRoot);
        const rel = path.relative(root, abs);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new Error(`Unsafe path outside APP_ROOT: ${relativePath}`);
        }
        return abs;
    }

    function getCleanupDefinition(serviceId) {
        const def = getServiceDefinition(serviceId);
        const dataDir = cleanupServiceDataDirs[serviceId];
        if (!def || !dataDir) return null;

        const dataAbsPath = toAppRootPath(dataDir);
        const resolvedBackupRoot = path.resolve(backupRoot);
        const root = path.resolve(appRoot);
        const rel = path.relative(root, resolvedBackupRoot);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new Error('Cleanup backup root must be inside APP_ROOT');
        }

        return {
            ...def,
            dataDir,
            dataAbsPath,
            dataDirMode: cleanupServiceDataDirModes[serviceId],
            backupRoot: resolvedBackupRoot
        };
    }

    function buildCleanupBackupDir(serviceId, actor, date = new Date()) {
        const segment = `${formatTimestampForPath(date)}-${serviceId}-${sanitizePathSegment(actor.operator)}`;
        return path.join(backupRoot, segment);
    }

    function getUniqueBackupDir(preferredDir) {
        if (!fs.existsSync(preferredDir)) return preferredDir;
        for (let i = 2; i < 1000; i += 1) {
            const candidate = `${preferredDir}-${i}`;
            if (!fs.existsSync(candidate)) return candidate;
        }
        throw new Error('无法创建唯一备份目录，请检查备份目录是否异常。');
    }

    function buildCleanupPlan(serviceId, actor = { operator: 'operator' }) {
        const def = getCleanupDefinition(serviceId);
        if (!def) {
            return { status: 'error', message: '该服务不支持一键清理。仅支持 postgres、redis、kafka、cassandra。' };
        }
        if (!def.exists) return { status: 'error', message: `Compose file not found: ${def.composePath}` };

        const backupDir = buildCleanupBackupDir(serviceId, actor);
        return {
            status: 'success',
            service: { id: def.id, label: def.label },
            appService: getPackageServiceId(),
            dataDir: def.dataDir,
            dataPath: def.dataAbsPath,
            dataDirMode: def.dataDirMode,
            backupRoot,
            backupDir,
            composePath: def.composePath,
            requiresAppStopped: true,
            appServiceRunning: false,
            warnings: [
                '该操作会停止目标服务并归档当前数据目录。',
                '业务服务正在运行时禁止清理，请先停止 IoT Cloud/IoT Edge。',
                '清理后不会自动执行 ThingsBoard 初始化安装。'
            ]
        };
    }

    function appendAuditLog(entry) {
        try {
            fs.mkdirSync(runtimeDir, { recursive: true });
            fs.appendFileSync(auditLogFile, JSON.stringify(entry) + '\n');
        } catch (e) {
            logger.error(`[Audit] Failed to write audit log: ${e.message}`);
        }
    }

    function buildAuditEntry(status, serviceId, actor, fields = {}) {
        return {
            timestamp: new Date().toISOString(),
            event: 'service_cleanup',
            status,
            serviceId,
            operator: actor.operator,
            sessionId: actor.sessionId,
            ip: actor.ip,
            ...fields
        };
    }

    function safeMovePath(source, destination) {
        if (!fs.existsSync(source)) return false;
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.renameSync(source, destination);
        return true;
    }

    function writeCleanupManifest(manifestPath, manifest) {
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }

    function recreateDataDir(def) {
        fs.mkdirSync(def.dataAbsPath, { recursive: true });
        if (def.dataDirMode !== undefined && def.dataDirMode !== null) {
            fs.chmodSync(def.dataAbsPath, def.dataDirMode);
        }
    }

    async function runCleanupService(serviceId, confirmServiceId, actor) {
        const def = getCleanupDefinition(serviceId);
        if (!def) {
            appendAuditLog(buildAuditEntry('failure', serviceId, actor, {
                reason: 'UNSUPPORTED_SERVICE',
                error: 'Unsupported cleanup service'
            }));
            logger.log(`[Audit] Cleanup failure operator=${actor.operator} service=${serviceId} source=n/a backup=n/a status=failure error=UNSUPPORTED_SERVICE`);
            return { status: 'error', message: '该服务不支持一键清理。仅支持 postgres、redis、kafka、cassandra。' };
        }

        if (confirmServiceId !== serviceId) {
            appendAuditLog(buildAuditEntry('failure', serviceId, actor, {
                reason: 'CONFIRMATION_MISMATCH',
                sourcePath: def.dataAbsPath,
                backupDir: '',
                composePath: def.composePath,
                error: `confirmServiceId mismatch: ${confirmServiceId || ''}`
            }));
            logger.log(`[Audit] Cleanup failure operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=n/a status=failure error=CONFIRMATION_MISMATCH`);
            return { status: 'error', code: 'CONFIRMATION_MISMATCH', message: `请输入 ${serviceId} 才能执行清理。` };
        }

        if (!def.exists) {
            appendAuditLog(buildAuditEntry('failure', serviceId, actor, {
                reason: 'COMPOSE_MISSING',
                sourcePath: def.dataAbsPath,
                backupDir: '',
                composePath: def.composePath,
                error: `Compose file not found: ${def.composePath}`
            }));
            logger.log(`[Audit] Cleanup failure operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=n/a status=failure error=COMPOSE_MISSING`);
            return { status: 'error', message: `Compose file not found: ${def.composePath}` };
        }

        const dockerIssue = docker.readyMessage();
        if (dockerIssue) {
            appendAuditLog(buildAuditEntry('failure', serviceId, actor, {
                reason: 'DOCKER_UNAVAILABLE',
                sourcePath: def.dataAbsPath,
                backupDir: '',
                composePath: def.composePath,
                error: dockerIssue
            }));
            logger.log(`[Audit] Cleanup failure operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=n/a status=failure error=DOCKER_UNAVAILABLE`);
            return { status: 'error', message: dockerIssue };
        }

        if (activeCleanupService) {
            appendAuditLog(buildAuditEntry('failure', serviceId, actor, {
                reason: 'CLEANUP_RUNNING',
                sourcePath: def.dataAbsPath,
                backupDir: '',
                composePath: def.composePath,
                activeCleanupService
            }));
            logger.log(`[Audit] Cleanup failure operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=n/a status=failure error=CLEANUP_RUNNING`);
            return { status: 'error', code: 'CLEANUP_RUNNING', message: `已有清理任务正在执行：${activeCleanupService}` };
        }

        const appStatus = await getServiceStatus(getServiceDefinition(getPackageServiceId()));
        if (appStatus.running) {
            const blocked = buildAuditEntry('blocked', serviceId, actor, {
                reason: 'APP_SERVICE_RUNNING',
                appService: getPackageServiceId(),
                sourcePath: def.dataAbsPath,
                backupDir: '',
                composePath: def.composePath
            });
            appendAuditLog(blocked);
            logger.log(`[Audit] Cleanup blocked operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=n/a status=blocked reason=APP_SERVICE_RUNNING`);
            return {
                status: 'error',
                code: 'APP_SERVICE_RUNNING',
                message: `请先停止 ${getPackageServiceId()}，再清理 ${def.label} 数据。`
            };
        }

        activeCleanupService = serviceId;
        const startedAt = new Date();
        const targetStatusBefore = await getServiceStatus(def);
        const backupDir = getUniqueBackupDir(buildCleanupBackupDir(serviceId, actor, startedAt));
        const archivedDataPath = path.join(backupDir, path.basename(def.dataAbsPath));
        const manifestPath = path.join(backupDir, 'manifest.json');
        const sourceExisted = fs.existsSync(def.dataAbsPath);
        const manifest = {
            serviceId,
            serviceLabel: def.label,
            operator: actor.operator,
            sessionId: actor.sessionId,
            ip: actor.ip,
            startedAt: startedAt.toISOString(),
            appRoot,
            appService: getPackageServiceId(),
            composePath: def.composePath,
            sourcePath: def.dataAbsPath,
            recreatedDirMode: def.dataDirMode,
            backupDir,
            archivedDataPath,
            sourceExisted,
            targetStatusBefore: summarizeServiceStatus(targetStatusBefore),
            result: 'pending'
        };

        appendAuditLog(buildAuditEntry('pending', serviceId, actor, {
            sourcePath: def.dataAbsPath,
            backupDir,
            composePath: def.composePath,
            sourceExisted,
            targetStatusBefore: summarizeServiceStatus(targetStatusBefore)
        }));
        logger.log(`[Audit] Cleanup pending operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=${backupDir} status=pending`);

        let output = '';
        try {
            fs.mkdirSync(backupDir, { recursive: true });
            writeCleanupManifest(manifestPath, manifest);

            const down = await docker.exec(docker.dockerComposeCmd, docker.composeArgsFor(def, ['down']));
            output += down.stdout + down.stderr;
            if (down.error) throw new Error(down.error.message);

            const archived = safeMovePath(def.dataAbsPath, archivedDataPath);
            recreateDataDir(def);

            const up = await docker.exec(docker.dockerComposeCmd, docker.composeArgsFor(def, ['up', '-d']));
            output += up.stdout + up.stderr;
            if (up.error) throw new Error(up.error.message);

            const targetStatusAfter = await getServiceStatus(def);
            manifest.finishedAt = new Date().toISOString();
            manifest.result = 'success';
            manifest.archived = archived;
            manifest.targetStatusAfter = summarizeServiceStatus(targetStatusAfter);
            manifest.output = output.slice(-8000);
            writeCleanupManifest(manifestPath, manifest);

            appendAuditLog(buildAuditEntry('success', serviceId, actor, {
                sourcePath: def.dataAbsPath,
                backupDir,
                archived,
                composePath: def.composePath,
                targetStatusAfter: summarizeServiceStatus(targetStatusAfter)
            }));
            logger.log(`[Audit] Cleanup success operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=${backupDir} status=success`);

            return {
                status: 'success',
                service: { id: def.id, label: def.label },
                sourcePath: def.dataAbsPath,
                backupDir,
                archived,
                manifestPath,
                output
            };
        } catch (e) {
            let targetStatusAfterFailure = null;
            try {
                targetStatusAfterFailure = await getServiceStatus(def);
            } catch (statusError) {
                targetStatusAfterFailure = { status: 'unknown', running: false, containerId: '', message: statusError.message };
            }
            manifest.finishedAt = new Date().toISOString();
            manifest.result = 'failure';
            manifest.error = e.message;
            manifest.targetStatusAfter = summarizeServiceStatus(targetStatusAfterFailure);
            manifest.output = output.slice(-8000);
            try { writeCleanupManifest(manifestPath, manifest); } catch (manifestError) { logger.error(`[Audit] Failed to update cleanup manifest: ${manifestError.message}`); }

            appendAuditLog(buildAuditEntry('failure', serviceId, actor, {
                sourcePath: def.dataAbsPath,
                backupDir,
                composePath: def.composePath,
                error: e.message,
                targetStatusAfter: summarizeServiceStatus(targetStatusAfterFailure)
            }));
            logger.log(`[Audit] Cleanup failure operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=${backupDir} status=failure error=${e.message}`);

            return {
                status: 'error',
                message: e.message,
                sourcePath: def.dataAbsPath,
                backupDir,
                manifestPath,
                output
            };
        } finally {
            activeCleanupService = null;
        }
    }

    return {
        buildCleanupPlan,
        getCleanupDefinition,
        runCleanupService
    };
}

module.exports = {
    createCleanupService,
    formatTimestampForPath,
    sanitizePathSegment,
    summarizeServiceStatus
};
