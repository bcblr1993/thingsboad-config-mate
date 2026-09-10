const assert = require('node:assert/strict');
const test = require('node:test');

const {
    composeContainerMatchesDefinition,
    parseDockerStatsPayload,
    createServiceRuntime
} = require('../src/server/services/runtime');
const { createContainerStatsCache } = require('../src/server/services/container-stats');

/** 用真实的采样缓存，只把 docker 换成 mock。 */
function createStatsCache(docker, options = {}) {
    return createContainerStatsCache({
        docker,
        parseEntry: parseDockerStatsPayload,
        logger: { warn() {} },
        ...options
    });
}

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
            if (args.includes('stats')) {
                return {
                    // 批量采样靠 ID 对应到容器，缺 ID 的行会被丢弃。
                    stdout: '{"ID":"container-1","CPUPerc":"0.42%","MemUsage":"128MiB / 2GiB","MemPerc":"6.25%"}\n',
                    stderr: '',
                    error: null
                };
            }
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
    const containerStats = createStatsCache(docker);
    // 采样是异步补齐的：先预热一次，再断言数值。
    await containerStats.refresh();
    const runtime = createServiceRuntime({ docker, getServiceDefinition: () => postgresDef, containerStats });

    const status = await runtime.getServiceStatus(postgresDef);

    assert.equal(status.status, 'running');
    assert.equal(status.running, true);
    assert.equal(status.containerId, 'container-1');
    assert.equal(status.cpu, '0.42%');
    assert.equal(status.cpuPercent, 0.42);
    assert.equal(status.memoryUsage, '128 MB');
    assert.equal(status.memoryBytes, 134217728);
});

test('a slow docker stats never delays the service status', async () => {
    /* docker stats --no-stream 单次要 1.5-2 秒（真机实测），按服务逐个 await
       会把 /api/services 拖到 3 秒以上。这里让 stats 一直挂住：状态探测必须
       照样立刻返回，采样只在后台补。 */
    let statsCalls = 0;
    let releaseStats = null;
    const statsGate = new Promise(resolve => { releaseStats = resolve; });

    const docker = createDockerMock({
        async exec(cmd, args) {
            this.calls.push({ cmd, args });
            if (args.includes('stats')) {
                statsCalls += 1;
                await statsGate; // 永远不返回，直到测试放行
                return { stdout: '', stderr: '', error: null };
            }
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
    const containerStats = createStatsCache(docker);
    const runtime = createServiceRuntime({ docker, getServiceDefinition: () => postgresDef, containerStats });

    // 卡住的采样不能挡住状态返回。
    const status = await runtime.getServiceStatus(postgresDef);
    assert.equal(status.running, true);

    // 多个服务同时探测时，后台采样也只会发起一次，不会 N 次争抢 docker。
    await Promise.all([
        runtime.getServiceStatus(postgresDef),
        runtime.getServiceStatus(postgresDef),
        runtime.getServiceStatus(postgresDef)
    ]);
    assert.equal(statsCalls, 1, `并发探测应合并为一次采样，实际 ${statsCalls} 次`);

    releaseStats();
});

test('a service status still resolves when stats have not been sampled yet', async () => {
    // 首次访问时缓存是空的，不能因此报错或阻塞，只是暂时没有 CPU / 内存。
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
    const runtime = createServiceRuntime({
        docker,
        getServiceDefinition: () => postgresDef,
        containerStats: createStatsCache(docker)
    });

    const status = await runtime.getServiceStatus(postgresDef);

    assert.equal(status.running, true, '没有采样也必须给出运行状态');
    assert.equal(status.cpu, undefined);
});

test('parseDockerStatsPayload extracts CPU and memory metrics', () => {
    const stats = parseDockerStatsPayload('{"CPUPerc":"12.31%","MemUsage":"1.5GiB / 8GiB","MemPerc":"18.75%"}\n');

    assert.equal(stats.cpu, '12.3%');
    assert.equal(stats.cpuPercent, 12.31);
    assert.equal(stats.memoryUsage, '1.5 GB');
    assert.equal(stats.memoryBytes, 1610612736);
    assert.equal(stats.memoryLimitBytes, 8589934592);
    assert.equal(stats.memoryPercent, 18.75);
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
