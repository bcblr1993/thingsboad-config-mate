const assert = require('node:assert/strict');
const test = require('node:test');

const { createContainerIndex, containerBelongsToDefinition } = require('../src/server/services/container-index');

const PG_DEF = {
    id: 'postgres',
    composeService: 'postgres',
    composeAbsPath: '/root/sprixin-iotcloud/services/postgres/docker-compose.yml'
};

function container(overrides = {}) {
    return {
        Id: 'abc123',
        Name: '/postgres',
        State: { Running: true, StartedAt: '2026-09-11T00:00:00Z' },
        Config: {
            Labels: {
                'com.docker.compose.service': 'postgres',
                'com.docker.compose.project.working_dir': '/root/sprixin-iotcloud/services/postgres',
                'com.docker.compose.project.config_files': '/root/sprixin-iotcloud/services/postgres/docker-compose.yml'
            }
        },
        ...overrides
    };
}

function createDocker(handler) {
    return {
        dockerPath: '/usr/bin/docker',
        calls: [],
        async exec(cmd, args, options) {
            this.calls.push({ args });
            return handler(args, options);
        }
    };
}

function dockerWith(containers, images = ['postgres:15.4', 'redis:7.2']) {
    return createDocker(args => {
        if (args[0] === 'ps') return { stdout: containers.map(c => c.Id).join('\n') + '\n', stderr: '', error: null };
        if (args[0] === 'inspect') return { stdout: JSON.stringify(containers), stderr: '', error: null };
        if (args[0] === 'images') return { stdout: images.join('\n') + '\n', stderr: '', error: null };
        return { stdout: '', stderr: '', error: null };
    });
}

test('the whole index costs three calls regardless of service count', async () => {
    /* 原来是每个服务一次 compose ps（容器内实测 8 个并发 831ms），
       外加每个停止服务一次 image inspect、每个 HA 变体一次 inspect。
       现在固定三次：ps + inspect + images，与服务数量无关。 */
    const docker = dockerWith([container(), container({ Id: 'def456', Name: '/redis' })]);
    const index = await createContainerIndex({ docker }).get();
    const kinds = docker.calls.map(c => c.args[0]).sort();
    assert.deepEqual(kinds, ['images', 'inspect', 'ps']);
    assert.equal(index.containers.length, 2);
});

test('the image list answers existence without a per-service inspect', async () => {
    const docker = dockerWith([container()], ['postgres:15.4', 'cassandra:4.1.3', 'nginx:latest']);
    const index = await createContainerIndex({ docker }).get();
    assert.equal(index.hasImage('postgres:15.4'), true);
    assert.equal(index.hasImage('cassandra:4.1.3'), true);
    // 不带 tag 的引用按 :latest 处理，与 docker 的默认行为一致。
    assert.equal(index.hasImage('nginx'), true);
    assert.equal(index.hasImage('kafka:3.9'), false);
});

test('an unavailable image list yields null so the caller falls back', async () => {
    // 宁可退回逐个 image inspect，也不能把「查不到清单」当成「镜像不存在」。
    const docker = createDocker(args => {
        if (args[0] === 'ps') return { stdout: 'abc123\n', stderr: '', error: null };
        if (args[0] === 'inspect') return { stdout: JSON.stringify([container()]), stderr: '', error: null };
        return { stdout: '', stderr: 'boom', error: new Error('exit 1') };
    });
    const index = await createContainerIndex({ docker, logger: { error() {} } }).get();
    assert.ok(index, '镜像清单失败不应连容器快照一起作废');
    assert.equal(index.hasImage('postgres:15.4'), null);
});

test('<none> images are ignored', async () => {
    const docker = dockerWith([container()], ['<none>:<none>', 'postgres:15.4']);
    const index = await createContainerIndex({ docker }).get();
    assert.equal(index.hasImage('<none>:<none>'), false);
    assert.equal(index.hasImage('postgres:15.4'), true);
});

test('a definition matches its own compose container', async () => {
    const index = await createContainerIndex({ docker: dockerWith([container()]) }).get();
    const found = index.findForDefinition(PG_DEF, null);
    assert.equal(found?.Id, 'abc123');
});

test('a same-named container from another deployment is not claimed', async () => {
    /* 现场可能同时存在另一套部署的 postgres。原路径靠 compose ps 选出候选再校验，
       这里是从全部容器里挑，必须自己把住这一关。 */
    const other = container({
        Id: 'other1',
        Config: { Labels: {
            'com.docker.compose.service': 'postgres',
            'com.docker.compose.project.working_dir': '/opt/another-deploy/services/postgres',
            'com.docker.compose.project.config_files': '/opt/another-deploy/services/postgres/docker-compose.yml'
        } }
    });
    const index = await createContainerIndex({ docker: dockerWith([other]) }).get();
    assert.equal(index.findForDefinition(PG_DEF, null), null);
});

test('a container without compose labels is never claimed', async () => {
    /* 这是与 compose ps 路径的唯一语义差别，也是必须严格的地方：
       放行的话，任何手工创建的无标签容器都会匹配上每一个服务。 */
    const manual = container({ Id: 'manual', Config: { Labels: {} } });
    const index = await createContainerIndex({ docker: dockerWith([manual]) }).get();
    assert.equal(index.findForDefinition(PG_DEF, null), null);
    // 只有服务名标签、没有任何目录信息，同样不认领。
    const nameOnly = container({ Id: 'nameonly', Config: { Labels: { 'com.docker.compose.service': 'postgres' } } });
    const index2 = await createContainerIndex({ docker: dockerWith([nameOnly]) }).get();
    assert.equal(index2.findForDefinition(PG_DEF, null), null);
});

test('a different service in the same deployment is not claimed', async () => {
    const redis = container({
        Id: 'redis1',
        Config: { Labels: {
            'com.docker.compose.service': 'redis',
            'com.docker.compose.project.working_dir': '/root/sprixin-iotcloud/services/redis',
            'com.docker.compose.project.config_files': '/root/sprixin-iotcloud/services/redis/docker-compose.yml'
        } }
    });
    const index = await createContainerIndex({ docker: dockerWith([redis]) }).get();
    assert.equal(index.findForDefinition(PG_DEF, null), null);
});

test('a sanitized runtime compose file still matches', async () => {
    // prepareComposeDefinition 会生成一份清洗过的 compose，标签指向原始路径。
    const prepared = { composeAbsPath: '/root/.config-mate/runtime/postgres.yml', originalComposeAbsPath: PG_DEF.composeAbsPath };
    const c = container({ Config: { Labels: {
        'com.docker.compose.service': 'postgres',
        'com.docker.compose.project.working_dir': '/root/sprixin-iotcloud/services/postgres',
        'com.docker.compose.project.config_files': '/root/.config-mate/runtime/postgres.yml'
    } } });
    const index = await createContainerIndex({ docker: dockerWith([c]) }).get();
    assert.equal(index.findForDefinition(PG_DEF, prepared)?.Id, 'abc123');
});

test('lookup by container name serves HA discovery', async () => {
    const ha = container({ Id: 'ha1', Name: '/highgo-ha', Config: { Labels: {} } });
    const index = await createContainerIndex({ docker: dockerWith([ha]) }).get();
    assert.equal(index.findByName('highgo-ha')?.Id, 'ha1');
    assert.equal(index.findByName('/highgo-ha')?.Id, 'ha1');
    assert.equal(index.findByName('postgres-ha'), null);
});

test('concurrent reads collapse into one collection', async () => {
    let calls = 0;
    const docker = createDocker(args => {
        if (args[0] === 'ps') { calls += 1; return { stdout: 'abc123\n', stderr: '', error: null }; }
        return { stdout: JSON.stringify([container()]), stderr: '', error: null };
    });
    const index = createContainerIndex({ docker });
    await Promise.all(Array.from({ length: 10 }, () => index.get()));
    assert.equal(calls, 1, `十个服务同时探测应只采集一次，实际 ${calls} 次`);
});

test('a docker failure yields null so the caller can fall back', async () => {
    // 拿不到快照不能报错，要退回原来的逐服务探测。
    const docker = createDocker(() => ({ stdout: '', stderr: 'daemon down', error: new Error('exit 1') }));
    const index = await createContainerIndex({ docker, logger: { error() {} } }).get();
    assert.equal(index, null);
});

test('an empty host yields an empty index rather than null', async () => {
    const docker = createDocker(args => (args[0] === 'ps'
        ? { stdout: '\n', stderr: '', error: null }
        : { stdout: '[]', stderr: '', error: null }));
    const index = await createContainerIndex({ docker }).get();
    assert.ok(index, '没有容器不等于采集失败');
    assert.equal(index.containers.length, 0);
    assert.equal(index.findForDefinition(PG_DEF, null), null);
});

test('invalidate forces a fresh collection', async () => {
    let calls = 0;
    let clock = 1000;
    const docker = createDocker(args => {
        if (args[0] === 'ps') { calls += 1; return { stdout: 'abc123\n', stderr: '', error: null }; }
        return { stdout: JSON.stringify([container()]), stderr: '', error: null };
    });
    const index = createContainerIndex({ docker, now: () => clock });
    await index.get();
    await index.get();
    assert.equal(calls, 1, 'TTL 内应复用');
    // 启停后容器变了，必须重采
    index.invalidate();
    await index.get();
    assert.equal(calls, 2);
});

test('containerBelongsToDefinition is exported for direct use', () => {
    assert.equal(containerBelongsToDefinition(container(), PG_DEF, null), true);
    assert.equal(containerBelongsToDefinition(null, PG_DEF, null), false);
    assert.equal(containerBelongsToDefinition(container(), null, null), false);
});
