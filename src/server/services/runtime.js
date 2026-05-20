const path = require('path');

function splitComposeConfigFiles(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function composeContainerMatchesDefinition(def, inspectData, preparedDefinition = null) {
    const labels = inspectData?.Config?.Labels || {};
    const service = labels['com.docker.compose.service'];
    if (service && def.composeService && service !== def.composeService) return false;

    const workingDir = labels['com.docker.compose.project.working_dir'];
    if (workingDir && path.resolve(workingDir) !== path.resolve(path.dirname(def.composeAbsPath))) return false;

    const configFiles = splitComposeConfigFiles(labels['com.docker.compose.project.config_files']);
    if (configFiles.length > 0) {
        const expectedComposes = [
            def.composeAbsPath,
            preparedDefinition?.composeAbsPath,
            preparedDefinition?.originalComposeAbsPath
        ].filter(Boolean).map(file => path.resolve(file));
        return configFiles.some(file => expectedComposes.includes(path.resolve(file)));
    }

    return true;
}

function parseDockerPercent(value) {
    const n = parseFloat(String(value || '').replace('%', '').trim());
    return Number.isFinite(n) ? n : null;
}

function parseDockerSize(value) {
    const match = String(value || '').trim().match(/^([0-9.]+)\s*([KMGTPE]?i?B?)$/i);
    if (!match) return null;
    const n = parseFloat(match[1]);
    if (!Number.isFinite(n)) return null;
    const unit = match[2].toUpperCase();
    const multipliers = {
        B: 1,
        KB: 1000,
        MB: 1000 ** 2,
        GB: 1000 ** 3,
        TB: 1000 ** 4,
        KIB: 1024,
        MIB: 1024 ** 2,
        GIB: 1024 ** 3,
        TIB: 1024 ** 4
    };
    return Math.round(n * (multipliers[unit] || 1));
}

function formatRuntimeBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : 1;
    return `${value.toFixed(digits)} ${units[unit]}`;
}

function parseDockerStatsPayload(stdout) {
    const raw = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
    if (!raw) return {};
    let data = null;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        return {};
    }
    const cpuPercent = parseDockerPercent(data.CPUPerc);
    const memoryPercent = parseDockerPercent(data.MemPerc);
    const [memoryUsedRaw, memoryLimitRaw] = String(data.MemUsage || '').split('/').map(v => v && v.trim());
    const memoryBytes = parseDockerSize(memoryUsedRaw);
    const memoryLimitBytes = parseDockerSize(memoryLimitRaw);
    return {
        cpu: cpuPercent == null ? '' : `${cpuPercent.toFixed(cpuPercent >= 10 ? 1 : 2)}%`,
        cpuPercent,
        memory: formatRuntimeBytes(memoryBytes),
        memoryUsage: formatRuntimeBytes(memoryBytes),
        memoryBytes,
        memoryLimitBytes,
        memoryPercent
    };
}

function createServiceRuntime({ docker, getServiceDefinition }) {
    async function getContainerStats(containerId) {
        if (!containerId) return {};
        const stats = await docker.exec(
            docker.dockerPath,
            ['stats', '--no-stream', '--format', '{{json .}}', containerId],
            { timeout: 4500 }
        );
        if (stats.error) return {};
        return parseDockerStatsPayload(stats.stdout);
    }

    async function getServiceStatus(def) {
        if (!def) {
            return { id: 'unknown', label: 'Unknown', status: 'missing', running: false, containerId: '', message: 'service definition missing' };
        }
        if (!def.exists) {
            return { ...def, status: 'missing', running: false, containerId: '', message: 'compose file missing' };
        }

        const dockerIssue = docker.readyMessage();
        if (dockerIssue) {
            return { ...def, status: 'unknown', running: false, containerId: '', message: dockerIssue };
        }

        const preparedDefinition = typeof docker.prepareComposeDefinition === 'function'
            ? docker.prepareComposeDefinition(def)
            : null;
        const ps = await docker.exec(docker.dockerComposeCmd, docker.composeArgsFor(def, ['ps', '-q', def.composeService]));
        const containerId = ps.stdout.trim().split('\n').filter(Boolean)[0] || '';

        if (!containerId && def.image) {
            const image = await docker.exec(docker.dockerPath, ['image', 'inspect', def.image, '--format', '{{.Os}}/{{.Architecture}}']);
            if (image.error) {
                return { ...def, status: 'missing-image', running: false, containerId: '', message: def.missingImageMessage || `Image not found: ${def.image}` };
            }
        }

        if (!containerId) {
            return { ...def, status: 'stopped', running: false, containerId: '' };
        }

        const inspect = await docker.exec(docker.dockerPath, ['inspect', containerId]);
        if (inspect.error) {
            return { ...def, status: 'unknown', running: false, containerId, message: inspect.error.message };
        }

        let inspectData = null;
        try {
            inspectData = JSON.parse(inspect.stdout || '[]')?.[0] || null;
        } catch (e) {
            return { ...def, status: 'unknown', running: false, containerId, message: 'Failed to parse container inspect output' };
        }

        if (!composeContainerMatchesDefinition(def, inspectData, preparedDefinition)) {
            return {
                ...def,
                status: 'stopped',
                running: false,
                containerId: '',
                message: 'matched container belongs to another compose project'
            };
        }

        const running = !!inspectData?.State?.Running;
        const startedAt = inspectData?.State?.StartedAt || '';
        const runtimeStats = running ? await getContainerStats(containerId) : {};
        return { ...def, status: running ? 'running' : 'stopped', running, containerId, startedAt, ...runtimeStats };
    }

    async function runComposeAction(id, action) {
        const def = getServiceDefinition(id);
        if (!def) return { status: 'error', message: 'Unknown service' };
        if (!def.exists) return { status: 'error', message: `Compose file not found: ${def.composePath}` };

        const dockerIssue = docker.readyMessage();
        if (dockerIssue) return { status: 'error', message: dockerIssue };

        if (action !== 'down' && def.image) {
            const image = await docker.exec(docker.dockerPath, ['image', 'inspect', def.image, '--format', '{{.Os}}/{{.Architecture}}']);
            if (image.error) {
                return { status: 'error', message: def.missingImageMessage || `Image not found: ${def.image}` };
            }
        }

        const commands = [];
        if (action === 'up') commands.push(['up', '-d']);
        else if (action === 'down') commands.push(['down']);
        else if (action === 'restart') commands.push(['down'], ['up', '-d']);
        else return { status: 'error', message: 'Unsupported action' };

        let output = '';
        for (const cmdArgs of commands) {
            const result = await docker.exec(docker.dockerComposeCmd, docker.composeArgsFor(def, cmdArgs));
            output += result.stdout + result.stderr;
            if (result.error) {
                return { status: 'error', message: result.error.message, output };
            }
        }

        return { status: 'success', output };
    }

    return {
        getServiceStatus,
        runComposeAction
    };
}

module.exports = {
    composeContainerMatchesDefinition,
    parseDockerStatsPayload,
    createServiceRuntime
};
