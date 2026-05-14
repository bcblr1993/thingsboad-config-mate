const fs = require('fs');
const path = require('path');

function parseEnvContent(content) {
    const result = {};
    String(content || '').split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const parts = trimmed.split('=');
        const key = parts[0].trim();
        if (!key) return;

        let value = parts.slice(1).join('=').trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    });
    return result;
}

function checkDependsOn(dependsOn, config) {
    if (!dependsOn) return true;

    if (dependsOn.key && dependsOn.value !== undefined) {
        const keys = Array.isArray(dependsOn.key) ? dependsOn.key : [dependsOn.key];
        return keys.some(key => config[key] === dependsOn.value);
    }

    if (dependsOn.or) {
        return dependsOn.or.some(condition => checkDependsOn(condition, config));
    }

    if (dependsOn.and) {
        return dependsOn.and.every(condition => checkDependsOn(condition, config));
    }

    return true;
}

function backupTimestamp(date = new Date()) {
    return date.toISOString().replace(/[-:]/g, '').replace('T', '-').split('.')[0];
}

function safeHistoryPath(historyDir, filename) {
    const safeName = path.basename(String(filename || ''));
    if (!safeName || !safeName.startsWith('.env.bak.')) return null;
    return path.join(historyDir, safeName);
}

function ensureParentDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createEnvStore({
    envFilePath,
    historyDir,
    configMeta,
    logger = console,
    maxBackups = 5
}) {
    if (!envFilePath) throw new Error('envFilePath is required');
    if (!historyDir) throw new Error('historyDir is required');

    const metaSource = configMeta || {};

    function parseEnvFile() {
        if (!fs.existsSync(envFilePath)) return {};
        return parseEnvContent(fs.readFileSync(envFilePath, 'utf-8'));
    }

    function listHistory() {
        if (!fs.existsSync(historyDir)) return [];
        return fs.readdirSync(historyDir)
            .filter(file => file.startsWith('.env.bak.'))
            .map(file => {
                const stats = fs.statSync(path.join(historyDir, file));
                return {
                    filename: file,
                    timestamp: stats.mtime.toISOString(),
                    size: stats.size
                };
            })
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    function rotateBackups() {
        const files = listHistory().map(item => ({
            name: item.filename,
            path: path.join(historyDir, item.filename),
            time: new Date(item.timestamp).getTime()
        }));

        files.slice(maxBackups).forEach(file => {
            try {
                fs.unlinkSync(file.path);
                logger.log?.(`[Backup] Rotated/Deleted: ${file.name}`);
            } catch (error) {
                logger.warn?.('[Warn] Failed to delete old backup:', error.message);
            }
        });
    }

    function backupEnv() {
        if (!fs.existsSync(envFilePath)) return null;

        fs.mkdirSync(historyDir, { recursive: true });
        const backupFile = path.join(historyDir, `.env.bak.${backupTimestamp()}`);

        try {
            fs.copyFileSync(envFilePath, backupFile);
            logger.log?.(`[Backup] Created: ${backupFile}`);
            rotateBackups();
            return backupFile;
        } catch (error) {
            logger.warn?.('[Warn] Failed to backup .env:', error.message);
            return null;
        }
    }

    function buildEnvContent(newConfig) {
        const outputLines = [];
        outputLines.push('# ==========================================');
        outputLines.push('# ThingsBoard 配置文件 (自动生成)');
        outputLines.push(`# 更新时间: ${new Date().toLocaleString()}`);
        outputLines.push('# ==========================================');
        outputLines.push('');

        const processedKeys = new Set();
        const config = { ...parseEnvFile(), ...(newConfig || {}) };
        const groups = {};
        const currentAppType = config.APPTYPE || config.APP_TYPE || 'CLOUD';

        Object.keys(metaSource).forEach(key => {
            const meta = metaSource[key];
            const scope = meta.scope || 'common';
            if (scope === 'cloud' && currentAppType !== 'CLOUD') return;
            if (scope === 'edge' && currentAppType !== 'EDGE') return;
            if (!checkDependsOn(meta.dependsOn, config)) return;

            if (!groups[meta.group]) groups[meta.group] = [];
            groups[meta.group].push(key);
        });

        Object.keys(groups).forEach(groupName => {
            outputLines.push(`# === ${groupName} ===`);
            groups[groupName].forEach(key => {
                const meta = metaSource[key];
                const value = config[key] !== undefined ? config[key] : '';
                outputLines.push(meta.comment ? `# ${meta.label} (${meta.comment})` : `# ${meta.label}`);
                outputLines.push(`${key}=${value}`);
                processedKeys.add(key);
            });
            outputLines.push('');
        });

        const customKeys = Object.keys(config).filter(key => !processedKeys.has(key));
        if (customKeys.length > 0) {
            outputLines.push('# === 自定义配置 (其他) ===');
            customKeys.forEach(key => outputLines.push(`${key}=${config[key]}`));
        }

        return outputLines.join('\n');
    }

    function saveEnvFile(newConfig) {
        backupEnv();
        ensureParentDir(envFilePath);
        fs.writeFileSync(envFilePath, buildEnvContent(newConfig), 'utf-8');
    }

    function readRaw() {
        return fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf-8') : '';
    }

    function saveRaw(content) {
        ensureParentDir(envFilePath);
        fs.writeFileSync(envFilePath, String(content || ''), 'utf-8');
    }

    function restoreHistory(filename) {
        const backupPath = safeHistoryPath(historyDir, filename);
        if (!backupPath || !fs.existsSync(backupPath)) {
            return { ok: false, statusCode: 404, message: 'Backup file not found' };
        }

        ensureParentDir(envFilePath);
        fs.copyFileSync(backupPath, envFilePath);
        logger.log?.(`[History] Restored .env from ${path.basename(backupPath)}`);
        return { ok: true, message: 'Restored successfully' };
    }

    function readHistoryContent(filename) {
        const backupPath = safeHistoryPath(historyDir, filename);
        if (!backupPath || !fs.existsSync(backupPath)) {
            return { ok: false, statusCode: 404, message: 'File not found' };
        }

        return { ok: true, content: fs.readFileSync(backupPath, 'utf-8') };
    }

    return {
        parseEnvFile,
        backupEnv,
        rotateBackups,
        saveEnvFile,
        buildEnvContent,
        listHistory,
        restoreHistory,
        readHistoryContent,
        readRaw,
        saveRaw
    };
}

module.exports = {
    createEnvStore,
    parseEnvContent,
    checkDependsOn,
    safeHistoryPath
};
