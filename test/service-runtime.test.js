const assert = require('node:assert/strict');
const test = require('node:test');

const {
    composeContainerMatchesDefinition,
    createServiceRuntime
} = require('../src/server/services/runtime');

function createDockerMock(overrides = {}) {
    const calls = [];
    const docker = {
        calls,
        dockerPath: '/usr/bin/docker',
        dockerComposeCmd: '/usr/bin/docker',
        composeArgsFor(def, args) {
            return ['compose', '-f', def.composeAbsPath, ...args];
        },
        readyMessage() {
            return null;
        },
        async exec(cmd, args) {
            calls.push({ cmd, args });
            return { stdout: '', stderr: '', error: null };
        },
        ...overrides
    };
    return docker;
}

const postgresDef = {
    id: 'postgres',
    label: 'PostgreSQL',
    composePath: 'services/postgres/docker-compose.yml',
    composeAbsPath: '/tmp/services/postgres/docker-compose.yml',
    composeService: 'postgres',
    exists: true
};

test('getServiceStatus returns missing for absent service definition', async () => {
    const runtime = createServiceRuntime({
        docker: createDockerMock(),
        getServiceDefinition: () => null
    });

    const status = await runtime.getServiceStatus(null);

    assert.equal(status.status, 'missing');
    assert.equal(status.running, false);
});

test('getServiceStatus reports docker readiness issue', async () => {
    const docker = createDockerMock({
        readyMessage() {
            return 'Docker Compose is not available.';
        }
    });
    const runtime = createServiceRuntime({ docker, getServiceDefinition: () => postgresDef });

    const status = await runtime.getServiceStatus(postgresDef);

    assert.equal(status.status, 'unknown');
    assert.equal(status.message, 'Docker Compose is not available.');
});

test('getServiceStatus returns stopped when compose has no container id', async () => {
    const docker = createDockerMock();
    const runtime = createServiceRuntime({ docker, getServiceDefinition: () => postgresDef });

    const status = await runtime.getServiceStatus(postgresDef);

    assert.equal(status.status, 'stopped');
    assert.equal(status.running, false);
    assert.equal(status.containerId, '');
});

test('getServiceStatus does not mark existing non-arm image as unsupported', async () => {
    const docker = createDockerMock({
        async exec(cmd, args) {
            this.calls.push({ cmd, args });
            if (args.includes('ps')) return { stdout: '', stderr: '', error: null };
            if (args.includes('image') && args.includes('inspect')) return { stdout: 'linux/amd64\n', stderr: '', error: null };
            return { stdout: '', stderr: '', error: null };
        }
    });
    const runtime = createServiceRuntime({
        docker,
        getServiceDefinition: () => ({ ...postgresDef, image: 'postgres:15.4' })
    });

    const status = await runtime.getServiceStatus({ ...postgresDef, image: 'postgres:15.4' });

    assert.equal(status.status, 'stopped');
    assert.equal(status.running, false);
});

test('getServiceStatus inspects running container', async () => {
    const docker = createDockerMock({
        async exec(cmd, args) {
            this.calls.push({ cmd, args });
            if (args.includes('ps')) return { stdout: 'container-1\n', stderr: '', error: null };
            if (args.includes('inspect')) {
                return {
                    stdout: JSON.stringify([{
                        State: { Running: true },
                        Config: {
                            Labels: {
                                'com.docker.compose.service': 'postgres',
                                'com.docker.compose.project.working_dir': '/tmp/services/postgres',
                                'com.docker.compose.project.config_files': '/tmp/services/postgres/docker-compose.yml'
                            }
                        }
                    }]),
                    stderr: '',
                    error: null
                };
            }
            return { stdout: '', stderr: '', error: null };
        }
    });
    const runtime = createServiceRuntime({ docker, getServiceDefinition: () => postgresDef });

    const status = await runtime.getServiceStatus(postgresDef);

    assert.equal(status.status, 'running');
    assert.equal(status.running, true);
    assert.equal(status.containerId, 'container-1');
});

test('getServiceStatus ignores a same-name container from another compose project', async () => {
    const docker = createDockerMock({
        async exec(cmd, args) {
            this.calls.push({ cmd, args });
            if (args.includes('ps')) return { stdout: 'container-1\n', stderr: '', error: null };
            if (args.includes('inspect')) {
                return {
                    stdout: JSON.stringify([{
                        State: { Running: true },
                        Config: {
                            Labels: {
                                'com.docker.compose.service': 'postgres',
                                'com.docker.compose.project.working_dir': '/Users/chenxu/Documents/docker/postgres',
                                'com.docker.compose.project.config_files': '/Users/chenxu/Documents/docker/postgres/docker-compose.yml'
                            }
                        }
                    }]),
                    stderr: '',
                    error: null
                };
            }
            return { stdout: '', stderr: '', error: null };
        }
    });
    const runtime = createServiceRuntime({ docker, getServiceDefinition: () => postgresDef });

    const status = await runtime.getServiceStatus(postgresDef);

    assert.equal(status.status, 'stopped');
    assert.equal(status.running, false);
    assert.equal(status.containerId, '');
    assert.equal(status.message, 'matched container belongs to another compose project');
});

test('composeContainerMatchesDefinition accepts sanitized runtime compose file', () => {
    assert.equal(composeContainerMatchesDefinition(postgresDef, {
        Config: {
            Labels: {
                'com.docker.compose.service': 'postgres',
                'com.docker.compose.project.working_dir': '/tmp/services/postgres',
                'com.docker.compose.project.config_files': '/tmp/.config-mate/compose/postgres-docker-compose.yml'
            }
        }
    }, {
        composeAbsPath: '/tmp/.config-mate/compose/postgres-docker-compose.yml',
        originalComposeAbsPath: '/tmp/services/postgres/docker-compose.yml'
    }), true);
});

test('runComposeAction lets docker decide whether existing image can run', async () => {
    const docker = createDockerMock({
        async exec(cmd, args) {
            this.calls.push({ cmd, args });
            if (args.includes('image') && args.includes('inspect')) return { stdout: 'linux/amd64\n', stderr: '', error: null };
            return { stdout: '', stderr: '', error: null };
        }
    });
    const runtime = createServiceRuntime({
        docker,
        getServiceDefinition: id => (id === 'postgres' ? { ...postgresDef, image: 'postgres:15.4' } : null)
    });

    const result = await runtime.runComposeAction('postgres', 'up');

    assert.equal(result.status, 'success');
    assert.deepEqual(docker.calls.map(call => call.args), [
        ['image', 'inspect', 'postgres:15.4', '--format', '{{.Os}}/{{.Architecture}}'],
        ['compose', '-f', postgresDef.composeAbsPath, 'up', '-d']
    ]);
});

test('runComposeAction executes restart as down then up', async () => {
    const docker = createDockerMock();
    const runtime = createServiceRuntime({
        docker,
        getServiceDefinition: id => (id === 'postgres' ? postgresDef : null)
    });

    const result = await runtime.runComposeAction('postgres', 'restart');

    assert.equal(result.status, 'success');
    assert.deepEqual(docker.calls.map(call => call.args), [
        ['compose', '-f', postgresDef.composeAbsPath, 'down'],
        ['compose', '-f', postgresDef.composeAbsPath, 'up', '-d']
    ]);
});

test('runComposeAction refuses unknown action', async () => {
    const runtime = createServiceRuntime({
        docker: createDockerMock(),
        getServiceDefinition: () => postgresDef
    });

    const result = await runtime.runComposeAction('postgres', 'invalid');

    assert.equal(result.status, 'error');
    assert.equal(result.message, 'Unsupported action');
});
