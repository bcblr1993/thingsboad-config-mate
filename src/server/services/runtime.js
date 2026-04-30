function createServiceRuntime({ docker, getServiceDefinition }) {
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

        const inspect = await docker.exec(docker.dockerPath, ['inspect', '-f', '{{.State.Running}}', containerId]);
        const running = inspect.stdout.trim() === 'true';
        return { ...def, status: running ? 'running' : 'stopped', running, containerId };
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
    createServiceRuntime
};
