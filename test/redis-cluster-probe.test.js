const assert = require('node:assert/strict');
const test = require('node:test');

const {
    createRedisClusterProbe,
    parseClusterContainers,
    parseClusterInfo,
    parseClusterNodeName,
    parseClusterNodes
} = require('../src/server/services/redis-cluster-probe');

function createDockerMock(handler) {
    const calls = [];
    return {
        calls,
        dockerPath: '/usr/bin/docker',
        dockerComposeCmd: '/usr/bin/docker',
        readyMessage: () => null,
        async exec(cmd, args) {
            calls.push(args);
            return handler ? (handler(args) || { stdout: '', stderr: '', error: null })
                : { stdout: '', stderr: '', error: null };
        }
    };
}

test('parseClusterNodeName recognizes compose-generated container names', () => {
    // redis-cluster.sh 生成的 compose 项目名取自目录名 redis-cluster。
    assert.deepEqual(parseClusterNodeName('redis-cluster-redis1-1'), {
        container: 'redis-cluster-redis1-1',
        index: 1
    });
    // 旧版 docker-compose 使用下划线分隔。
    assert.deepEqual(parseClusterNodeName('redis-cluster_redis3_1'), {
        container: 'redis-cluster_redis3_1',
        index: 3
    });
    assert.equal(parseClusterNodeName('redis-redis-1'), null);
    assert.equal(parseClusterNodeName('postgres'), null);
});

test('parseClusterContainers filters unrelated containers and sorts by node index', () => {
    const stdout = [
        'iotcloud',
        'redis-cluster-redis3-1',
        'redis-redis-1',
        'redis-cluster-redis1-1',
        'postgres-ha',
        'redis-cluster-redis2-1'
    ].join('\n');

    assert.deepEqual(parseClusterContainers(stdout).map(item => item.index), [1, 2, 3]);
});

test('parseClusterInfo reads key/value lines', () => {
    const info = parseClusterInfo('cluster_state:ok\r\ncluster_slots_assigned:16384\r\ncluster_known_nodes:6\r\n');
    assert.equal(info.cluster_state, 'ok');
    assert.equal(info.cluster_slots_assigned, '16384');
    assert.equal(info.cluster_known_nodes, '6');
});

test('parseClusterNodes extracts role, link state and slots', () => {
    const stdout = [
        'a1b2c3d4e5f6 127.0.0.1:7001@17001 myself,master - 0 0 1 connected 0-5460',
        'b2c3d4e5f6a1 127.0.0.1:7002@17002 slave a1b2c3d4e5f6 0 0 2 connected'
    ].join('\n');

    const nodes = parseClusterNodes(stdout);
    assert.equal(nodes.length, 2);
    assert.equal(nodes[0].role, 'master');
    assert.equal(nodes[0].myself, true);
    assert.equal(nodes[0].address, '127.0.0.1:7001');
    assert.equal(nodes[0].slots, '0-5460');
    assert.equal(nodes[1].role, 'replica');
    assert.equal(nodes[1].myself, false);
});

test('probe reports missing when no cluster container exists', async () => {
    const docker = createDockerMock(args => {
        if (args[0] === 'ps') return { stdout: 'iotcloud\nredis-redis-1\n', stderr: '', error: null };
        return null;
    });

    const result = await createRedisClusterProbe({ docker }).probe();
    assert.equal(result.exists, false);
    assert.equal(result.status, 'missing');
    assert.deepEqual(result.nodes, []);
});

test('probe aggregates node states and cluster info', async () => {
    const docker = createDockerMock(args => {
        if (args[0] === 'ps') {
            return { stdout: 'redis-cluster-redis1-1\nredis-cluster-redis2-1\n', stderr: '', error: null };
        }
        if (args[0] === 'inspect') {
            return {
                stdout: JSON.stringify([{
                    State: { Running: true, StartedAt: '2026-09-09T10:00:00Z' },
                    Config: { Cmd: ['redis-server', '--port', '7001', '--requirepass', 'secret'] }
                }]),
                stderr: '',
                error: null
            };
        }
        const joined = args.join(' ');
        if (joined.includes('cluster info')) {
            return { stdout: 'cluster_state:ok\ncluster_slots_assigned:16384\ncluster_size:3\n', stderr: '', error: null };
        }
        if (joined.includes('cluster nodes')) {
            return {
                stdout: 'a1b2c3d4e5f6 127.0.0.1:7001@17001 myself,master - 0 0 1 connected 0-5460',
                stderr: '',
                error: null
            };
        }
        return null;
    });

    const result = await createRedisClusterProbe({ docker }).probe();
    assert.equal(result.exists, true);
    assert.equal(result.status, 'running');
    assert.equal(result.nodeCount, 2);
    assert.equal(result.runningCount, 2);
    assert.equal(result.clusterState, 'ok');
    assert.equal(result.clusterNodes.length, 1);
    assert.equal(result.nodes[0].port, 7001);
});

test('probe marks a partially running cluster as degraded', async () => {
    let inspected = 0;
    const docker = createDockerMock(args => {
        if (args[0] === 'ps') {
            return { stdout: 'redis-cluster-redis1-1\nredis-cluster-redis2-1\n', stderr: '', error: null };
        }
        if (args[0] === 'inspect') {
            inspected += 1;
            return {
                stdout: JSON.stringify([{
                    State: { Running: inspected === 1, StartedAt: '' },
                    Config: { Cmd: ['redis-server', '--port', '7001'] }
                }]),
                stderr: '',
                error: null
            };
        }
        return null;
    });

    const result = await createRedisClusterProbe({ docker }).probe();
    assert.equal(result.status, 'degraded');
    assert.equal(result.runningCount, 1);
    assert.equal(result.nodeCount, 2);
});

test('probe reports stopped when every node is down', async () => {
    const docker = createDockerMock(args => {
        if (args[0] === 'ps') return { stdout: 'redis-cluster-redis1-1\n', stderr: '', error: null };
        if (args[0] === 'inspect') {
            return {
                stdout: JSON.stringify([{ State: { Running: false, StartedAt: '' }, Config: { Cmd: [] } }]),
                stderr: '',
                error: null
            };
        }
        return null;
    });

    const result = await createRedisClusterProbe({ docker }).probe();
    assert.equal(result.status, 'stopped');
    assert.equal(result.running, false);
});

test('discover returns the service id only when containers are present', async () => {
    const empty = createDockerMock(args => (args[0] === 'ps' ? { stdout: 'iotcloud\n', stderr: '', error: null } : null));
    assert.deepEqual(await createRedisClusterProbe({ docker: empty }).discover(), []);

    const present = createDockerMock(args => (
        args[0] === 'ps' ? { stdout: 'redis-cluster-redis1-1\n', stderr: '', error: null } : null
    ));
    assert.deepEqual(await createRedisClusterProbe({ docker: present }).discover(), ['redis-cluster']);
});
