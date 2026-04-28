const fs = require('fs');
const os = require('os');
const { execFile, execFileSync } = require('child_process');

function createDockerComposeRuntime({ appRoot, env = process.env, platform = os.platform(), logger = console }) {
    const state = {
        dockerPath: null,
        dockerComposeCmd: null,
        dockerComposeCmdArgs: []
    };

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

    function composeArgsFor(def, args) {
        return [...state.dockerComposeCmdArgs, '-f', def.composeAbsPath, ...args];
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
    createDockerComposeRuntime
};
