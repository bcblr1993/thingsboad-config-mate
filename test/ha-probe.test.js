const assert = require('node:assert/strict');
const test = require('node:test');

const {
    createHaProbe,
    getHaVariant,
    isHaServiceId,
    listHaVariants,
    parseHighgoLicense,
    parseRepmgrClusterShow,
    parseReplicationRows,
    parseVipPresence
} = require('../src/server/services/ha-probe');

/* 取自现场运维手册的真实 repmgr 输出格式。 */
const CLUSTER_SHOW_OUTPUT = `
 ID | Name     | Role    | Status    | Upstream | Location | Priority
----+----------+---------+-----------+----------+----------+----------
  1 | pg-node1 | primary | * running |          | default  | 100
  2 | pg-node2 | standby |   running | pg-node1 | default  | 100
`;

function createDockerMock(handler) {
    const calls = [];
    return {
        calls,
        dockerPath: '/usr/bin/docker',
        dockerComposeCmd: '/usr/bin/docker',
        readyMessage: () => null,
        async exec(cmd, args) {
            calls.push(args);
            const result = handler ? handler(args) : null;
            return result || { stdout: '', stderr: '', error: null };
        }
    };
}

function inspectPayload(overrides = {}) {
    return JSON.stringify([{
        Id: 'abcdef1234567890',
        State: { Running: true, StartedAt: '2026-09-09T10:00:00Z' },
        Config: {
            Env: [
                'NODE_VIP=192.168.1.100',
                'NODE_IP=192.168.1.11',
                'PARTNER_IP=192.168.1.12',
                'NODE_NAME=pg-node1',
                'POSTGRES_DB=thingsboard',
                'PG_PORT=5432',
                'POSTGRES_PASSWORD=secret',
                'PATH=/usr/local/bin'
            ],
            Labels: { 'com.docker.compose.project.working_dir': '/opt/postgres-ha' }
        },
        ...overrides
    }]);
}

test('parseRepmgrClusterShow extracts nodes and marks the connected one', () => {
    const nodes = parseRepmgrClusterShow(CLUSTER_SHOW_OUTPUT);
    assert.equal(nodes.length, 2);
    assert.deepEqual(nodes[0], {
        id: 1,
        name: 'pg-node1',
        role: 'primary',
        status: 'running',
        connected: true,
        reachable: true,
        upstream: ''
    });
    assert.equal(nodes[1].role, 'standby');
    assert.equal(nodes[1].upstream, 'pg-node1');
    assert.equal(nodes[1].connected, false);
});

test('parseRepmgrClusterShow handles the real-world left-aligned ID column', () => {
    /* 取自 10.8.8.157 真实环境：ID 列左对齐，且多出 Location/Priority/
       Timeline/Connection string 四列。 */
    const realOutput = ' ID | Name     | Role    | Status    | Upstream | Location | Priority | Timeline | Connection string\n'
        + '----+----------+---------+-----------+----------+----------+----------+----------+------------------\n'
        + ' 1  | pg-node1 | primary | * running |          | default  | 100      | 1        | host=10.8.8.157 user=repmgr dbname=repmgr connect_timeout=2 port=5432 application_name=pg-node1\n'
        + ' 2  | pg-node2 | standby |   running | pg-node1 | default  | 100      | 1        | host=10.8.8.235 user=repmgr dbname=repmgr connect_timeout=2 port=5432 application_name=pg-node2';

    const nodes = parseRepmgrClusterShow(realOutput);
    assert.equal(nodes.length, 2);
    assert.equal(nodes[0].name, 'pg-node1');
    assert.equal(nodes[0].role, 'primary');
    assert.equal(nodes[0].status, 'running');
    assert.equal(nodes[1].name, 'pg-node2');
    assert.equal(nodes[1].upstream, 'pg-node1');
});

test('parseRepmgrClusterShow ignores header and separator rows', () => {
    assert.deepEqual(parseRepmgrClusterShow(' ID | Name | Role\n----+------+-----\n'), []);
    assert.deepEqual(parseRepmgrClusterShow(''), []);
});

test('parseVipPresence matches the VIP on any interface, not just eth0', () => {
    // 现场网卡名不固定，运维手册也提示需要替换网卡名，因此不能写死 eth0。
    const output = [
        '1: lo    inet 127.0.0.1/8 scope host lo',
        '2: ens192    inet 192.168.1.11/24 brd 192.168.1.255 scope global ens192',
        '3: ens192    inet 192.168.1.100/24 scope global secondary ens192'
    ].join('\n');

    assert.deepEqual(parseVipPresence(output, '192.168.1.100'), { held: true, iface: 'ens192' });
    assert.deepEqual(parseVipPresence(output, '192.168.1.200'), { held: false, iface: '' });
    assert.deepEqual(parseVipPresence(output, ''), { held: false, iface: '' });
});

test('parseVipPresence does not match a VIP that is only a prefix of another address', () => {
    const output = '2: eth0    inet 192.168.1.1000/24 scope global eth0';
    assert.equal(parseVipPresence(output, '192.168.1.100').held, false);
});

test('parseReplicationRows parses lag and drops blank lines', () => {
    const rows = parseReplicationRows('pg-node2|streaming|async|4096\n\n');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
        applicationName: 'pg-node2',
        state: 'streaming',
        syncState: 'async',
        lagBytes: 4096
    });
});

test('parseHighgoLicense extracts expiry and grades remaining days', () => {
    const future = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const output = [
        'License ID: B2025',
        'License status: normal',
        'License mode: trial',
        '-----------------------------------------------------------------',
        'PRODUCT          VERSION                    EXPIRY DATE',
        '-----------------------------------------------------------------',
        `DATABASE         HGDB-SEE-V4.5              ${future}`,
        'HA_CLUSTER       ALL                        NULL'
    ].join('\n');

    const license = parseHighgoLicense(output);
    assert.equal(license.status, 'normal');
    assert.equal(license.mode, 'trial');
    assert.equal(license.expiry, future);
    assert.equal(license.level, 'ok');
    assert.equal(license.products.length, 2);
    // 无期限的产品到期日归一化为空字符串。
    assert.equal(license.products.find(p => p.product === 'HA_CLUSTER').expiry, '');
});

test('parseHighgoLicense flags an expired license', () => {
    const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const license = parseHighgoLicense(`License status: normal\nDATABASE         HGDB-SEE-V4.5              ${past}`);
    assert.equal(license.level, 'expired');
    assert.ok(license.daysRemaining < 0);
});

test('parseHighgoLicense warns within 30 days and escalates within 7', () => {
    const soon = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    const critical = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    assert.equal(parseHighgoLicense(`DATABASE  V4.5  ${soon}`).level, 'warning');
    assert.equal(parseHighgoLicense(`DATABASE  V4.5  ${critical}`).level, 'critical');
});

test('ha variants cover postgres and highgo with only parameter differences', () => {
    const variants = listHaVariants();
    assert.deepEqual(variants.map(v => v.id).sort(), ['highgo-ha', 'postgres-ha']);

    const pg = getHaVariant('postgres-ha');
    const hg = getHaVariant('highgo-ha');
    assert.equal(pg.dbUser, 'postgres');
    assert.equal(pg.defaultPort, 5432);
    assert.equal(pg.license, null);
    assert.equal(hg.dbUser, 'highgo');
    assert.equal(hg.defaultPort, 5866);
    assert.equal(hg.license.command, 'hg_lic');

    assert.equal(isHaServiceId('postgres-ha'), true);
    assert.equal(isHaServiceId('postgres'), false);
});

test('probe reports missing when the HA container does not exist', async () => {
    const docker = createDockerMock(() => ({ stdout: '', stderr: 'No such object', error: new Error('not found') }));
    const probe = createHaProbe({ docker });

    const result = await probe.probe('postgres-ha');
    assert.equal(result.exists, false);
    assert.equal(result.status, 'missing');
    assert.equal(result.running, false);
});

test('probe returns role, vip and topology for a running primary', async () => {
    const docker = createDockerMock(args => {
        if (args[0] === 'inspect') return { stdout: inspectPayload(), stderr: '', error: null };
        const joined = args.join(' ');
        if (joined.includes('pg_is_in_recovery')) return { stdout: 'f\n', stderr: '', error: null };
        if (joined.includes('ip -o addr show') || args.includes('addr')) {
            return { stdout: '2: eth0    inet 192.168.1.100/24 scope global eth0', stderr: '', error: null };
        }
        if (joined.includes('cluster show')) return { stdout: CLUSTER_SHOW_OUTPUT, stderr: '', error: null };
        if (joined.includes('pg_stat_replication')) return { stdout: 'pg-node2|streaming|async|0', stderr: '', error: null };
        return { stdout: '', stderr: '', error: null };
    });

    const result = await createHaProbe({ docker }).probe('postgres-ha');
    assert.equal(result.status, 'running');
    assert.equal(result.role, 'primary');
    assert.equal(result.writable, true);
    assert.equal(result.vip, '192.168.1.100');
    assert.equal(result.vipHeld, true);
    assert.equal(result.database, 'thingsboard');
    assert.equal(result.workingDir, '/opt/postgres-ha');
    assert.equal(result.topology.nodes.length, 2);
    assert.equal(result.replication[0].applicationName, 'pg-node2');
    // PostgreSQL 变体没有 License 概念。
    assert.equal(result.license, null);
});

test('probe reports standby role and does not require replication rows', async () => {
    const docker = createDockerMock(args => {
        if (args[0] === 'inspect') return { stdout: inspectPayload(), stderr: '', error: null };
        if (args.join(' ').includes('pg_is_in_recovery')) return { stdout: 't\n', stderr: '', error: null };
        return { stdout: '', stderr: '', error: null };
    });

    const result = await createHaProbe({ docker }).probe('postgres-ha');
    assert.equal(result.role, 'standby');
    assert.equal(result.writable, false);
});

test('probe skips sub-probes for a stopped container', async () => {
    const docker = createDockerMock(args => {
        if (args[0] === 'inspect') {
            return { stdout: inspectPayload({ State: { Running: false, StartedAt: '' } }), stderr: '', error: null };
        }
        return { stdout: '', stderr: '', error: null };
    });

    const probe = createHaProbe({ docker });
    const result = await probe.probe('postgres-ha');
    assert.equal(result.status, 'stopped');
    assert.equal(result.running, false);
    // 容器没跑时不应再去 exec，避免无谓的超时等待。
    assert.equal(docker.calls.filter(args => args[0] === 'exec').length, 0);
});

test('probe uses the configured port for highgo instead of the psql default', async () => {
    const execArgs = [];
    const docker = createDockerMock(args => {
        if (args[0] === 'inspect') {
            return {
                stdout: JSON.stringify([{
                    Id: 'hg1',
                    State: { Running: true, StartedAt: '' },
                    Config: { Env: ['NODE_VIP=10.8.8.250', 'PG_PORT=5866'], Labels: {} }
                }]),
                stderr: '',
                error: null
            };
        }
        execArgs.push(args.join(' '));
        return { stdout: '', stderr: '', error: null };
    });

    await createHaProbe({ docker }).probe('highgo-ha');
    const psqlCall = execArgs.find(args => args.includes('pg_is_in_recovery'));
    // 瀚高端口非默认，必须显式带 -p，不能依赖容器内 PGPORT。
    assert.ok(psqlCall.includes('-p 5866'), `expected explicit port in: ${psqlCall}`);
    assert.ok(execArgs.some(args => args.includes('su - highgo')));
});

test('discover only reports HA variants whose container exists', async () => {
    const docker = createDockerMock(args => {
        if (args[0] === 'inspect' && args[1] === 'postgres-ha') {
            return { stdout: inspectPayload(), stderr: '', error: null };
        }
        return { stdout: '', stderr: '', error: new Error('not found') };
    });

    assert.deepEqual(await createHaProbe({ docker }).discover(), ['postgres-ha']);
});

test('discover returns empty on a site without any HA deployment', async () => {
    const docker = createDockerMock(() => ({ stdout: '', stderr: '', error: new Error('not found') }));
    assert.deepEqual(await createHaProbe({ docker }).discover(), []);
});

test('parseRepmgrClusterShow strips the unreachable marker from a failed node', () => {
    /* 主备切换演练中真实出现过的输出：旧主停止后 Status 列为「- failed」。
       前导 - 表示不可达，必须剥离，否则界面显示「- failed」。 */
    const output = ' ID | Name     | Role    | Status    | Upstream | Location\n'
        + '----+----------+---------+-----------+----------+----------\n'
        + ' 1  | pg-node1 | primary | - failed  | ?        | default\n'
        + ' 2  | pg-node2 | primary | * running |          | default';

    const nodes = parseRepmgrClusterShow(output);
    assert.equal(nodes[0].status, 'failed');
    assert.equal(nodes[0].reachable, false);
    assert.equal(nodes[0].connected, false);
    assert.equal(nodes[1].status, 'running');
    assert.equal(nodes[1].reachable, true);
    assert.equal(nodes[1].connected, true);
});
