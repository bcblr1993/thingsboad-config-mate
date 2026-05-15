const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const yaml = require('js-yaml');

function quoteEnvValueForCompose(value) {
    const text = String(value ?? '');
    if (!text.includes('$')) return text;
    return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function sanitizeEnvFileForCompose(content) {
    return String(content || '').split(/\r?\n/).map(line => {
        if (!line || /^\s*#/.test(line) || !line.includes('=')) return line;
        const match = line.match(/^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(.*)$/);
        if (!match) return line;
        return match[1] + quoteEnvValueForCompose(match[2]);
    }).join('\n');
}

function shouldReplaceEnvFile(entry) {
    if (typeof entry === 'string') {
        return path.basename(entry.replace(/^['"]|['"]$/g, '')) === '.env';
    }
    if (entry && typeof entry === 'object' && typeof entry.path === 'string') {
        return path.basename(entry.path.replace(/^['"]|['"]$/g, '')) === '.env';
    }
    return false;
}

function replaceServiceEnvFile(composeDoc, serviceName, safeEnvFile) {
    const service = composeDoc?.services?.[serviceName];
    if (!service) return false;

    if (Array.isArray(service.env_file)) {
        let replaced = false;
        service.env_file = service.env_file.map(entry => {
            if (!shouldReplaceEnvFile(entry)) return entry;
            replaced = true;
            return typeof entry === 'string' ? safeEnvFile : { ...entry, path: safeEnvFile };
        });
        return replaced;
    }

    if (service.env_file && shouldReplaceEnvFile(service.env_file)) {
        service.env_file = typeof service.env_file === 'string'
            ? safeEnvFile
            : { ...service.env_file, path: safeEnvFile };
        return true;
    }

    return false;
}

function createDockerComposeRuntime({ appRoot, runtimeDir = path.join(appRoot, '.config-mate'), env = process.env, platform = os.platform(), logger = console }) {
    const state = {
        dockerPath: null,
        dockerComposeCmd: null,
        dockerComposeCmdArgs: []
    };
    const preparedComposeCache = new Map();

    function detect() {
        state.dockerPath = null;
        state.dockerComposeCmd = null;
        state.dockerComposeCmdArgs = [];

        const commonDockerPaths = [
            env.DOCKER_BIN,
            '/usr/bin/docker',
            '/usr/local/bin/docker',
            '/snap/bin/docker',
            '/opt/docker/bin/docker',
            'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'
        ].filter(Boolean);

        for (const candidate of commonDockerPaths) {
            try {
                fs.accessSync(candidate, fs.constants.X_OK);
                state.dockerPath = candidate;
                logger.log(`[Info] Found docker at: ${candidate}`);
                break;
            } catch (e) {
                // Continue.
            }
        }

        if (!state.dockerPath) {
            logger.error('[Error] Docker not found in common paths');
            logger.error('[Info] Searched paths:', commonDockerPaths);
            return state;
        }

        try {
            execFileSync(state.dockerPath, ['compose', 'version'], { stdio: 'ignore' });
            logger.log('[Info] Using: docker compose (new format)');
            state.dockerComposeCmd = state.dockerPath;
            state.dockerComposeCmdArgs = ['compose'];
            return state;
        } catch (error) {
            const dockerComposePaths = [
                env.DOCKER_COMPOSE_BIN,
                '/usr/bin/docker-compose',
                '/usr/local/bin/docker-compose'
            ].filter(Boolean);

            for (const candidate of dockerComposePaths) {
                try {
                    fs.accessSync(candidate, fs.constants.X_OK);
                    logger.log('[Info] Using: docker-compose (legacy format)');
                    state.dockerComposeCmd = candidate;
                    state.dockerComposeCmdArgs = [];
                    return state;
                } catch (e) {
                    // Continue.
                }
            }

            logger.error('[Error] Neither "docker compose" nor "docker-compose" is available!');
            return state;
        }
    }

    function readyMessage() {
        if (!state.dockerPath) return 'Docker CLI not found in Config Mate container.';
        if (!state.dockerComposeCmd) return 'Docker Compose is not available.';
        if (!fs.existsSync('/var/run/docker.sock') && platform !== 'win32') {
            return 'Docker socket /var/run/docker.sock is not mounted.';
        }
        return null;
    }

    function prepareComposeDefinition(def) {
        const composeAbsPath = def?.composeAbsPath;
        if (!composeAbsPath) return { composeAbsPath, projectDirectory: appRoot, envFile: null };

        const projectDirectory = path.dirname(composeAbsPath);
        const envFile = path.join(projectDirectory, '.env');
        if (!fs.existsSync(envFile)) {
            return { composeAbsPath, projectDirectory, envFile: null };
        }

        const cacheKey = `${composeAbsPath}\n${def.composeService || ''}\n${envFile}`;
        const composeStat = fs.statSync(composeAbsPath);
        const envStat = fs.statSync(envFile);
        const cached = preparedComposeCache.get(cacheKey);
        if (cached && cached.composeMtimeMs === composeStat.mtimeMs && cached.envMtimeMs === envStat.mtimeMs) {
            return cached.result;
        }

        const serviceName = def.composeService || def.id;
        const safeDir = path.join(runtimeDir, 'compose');
        fs.mkdirSync(safeDir, { recursive: true });

        const safeEnvFile = path.join(safeDir, `${def.id || serviceName}.env.compose`);
        fs.writeFileSync(safeEnvFile, sanitizeEnvFileForCompose(fs.readFileSync(envFile, 'utf8')), 'utf8');

        let preparedComposeAbsPath = composeAbsPath;
        try {
            const composeDoc = yaml.load(fs.readFileSync(composeAbsPath, 'utf8')) || {};
            if (replaceServiceEnvFile(composeDoc, serviceName, safeEnvFile)) {
                preparedComposeAbsPath = path.join(safeDir, `${def.id || serviceName}-${path.basename(composeAbsPath)}`);
                fs.writeFileSync(preparedComposeAbsPath, yaml.dump(composeDoc, { lineWidth: 120 }), 'utf8');
            }
        } catch (e) {
            logger.error?.(`[Error] Failed to prepare compose file ${composeAbsPath}: ${e.message}`);
            preparedComposeAbsPath = composeAbsPath;
        }

        const result = {
            composeAbsPath: preparedComposeAbsPath,
            originalComposeAbsPath: composeAbsPath,
            projectDirectory,
            envFile: safeEnvFile
        };
        preparedComposeCache.set(cacheKey, {
            composeMtimeMs: composeStat.mtimeMs,
            envMtimeMs: envStat.mtimeMs,
            result
        });
        return result;
    }

    function composeArgsFor(def, args) {
        const prepared = prepareComposeDefinition(def);
        const composeArgs = [...state.dockerComposeCmdArgs];
        if (prepared.envFile) composeArgs.push('--env-file', prepared.envFile);
        if (prepared.projectDirectory) composeArgs.push('--project-directory', prepared.projectDirectory);
        return [...composeArgs, '-f', prepared.composeAbsPath, ...args];
    }

    function exec(cmd, args, options = {}) {
        return new Promise(resolve => {
            execFile(cmd, args, { cwd: appRoot, ...options }, (error, stdout, stderr) => {
                resolve({ error, stdout: stdout || '', stderr: stderr || '' });
            });
        });
    }

    return {
        detect,
        readyMessage,
        composeArgsFor,
        prepareComposeDefinition,
        exec,
        get dockerPath() {
            return state.dockerPath;
        },
        get dockerComposeCmd() {
            return state.dockerComposeCmd;
        },
        get dockerComposeCmdArgs() {
            return [...state.dockerComposeCmdArgs];
        }
    };
}

module.exports = {
    createDockerComposeRuntime,
    quoteEnvValueForCompose,
    sanitizeEnvFileForCompose
};
