const assert = require('node:assert/strict');
const test = require('node:test');

const { createContainerStatsCache, parseStatsOutput } = require('../src/server/services/container-stats');
const { parseDockerStatsPayload } = require('../src/server/services/runtime');

/* 真机 10.8.8.235 上 `docker stats --no-stream --format '{{json .}}'` 的实际输出。 */
const REAL_OUTPUT = [
    '{"BlockIO":"36.7MB / 406kB","CPUPerc":"12.79%","Container":"6a691cb54711","ID":"6a691cb54711","MemPerc":"13.03%","MemUsage":"1.016GiB / 7.8GiB","Name":"iotcloud","NetIO":"192kB / 128kB","PIDs":"197"}',
    '{"BlockIO":"1.75MB / 16.4kB","CPUPerc":"0.00%","Container":"538a8f09d70d","ID":"538a8f09d70d","MemPerc":"0.37%","MemUsage":"29.39MiB / 7.8GiB","Name":"tb-config-mate","NetIO":"360kB / 2.44MB","PIDs":"7"}',
    '{"BlockIO":"1.21MB / 242MB","CPUPerc":"2.08%","Container":"dd1f8220291c","ID":"dd1f8220291c","MemPerc":"1.22%","MemUsage":"97.46MiB / 7.8GiB","Name":"postgres","NetIO":"58.9MB / 2.48MB","PIDs":"22"}'
].join('\n');

function createDocker(handler) {
    return {
        dockerPath: '/usr/bin/docker',
        calls: [],
        async exec(cmd, args, options) {
            this.calls.push({ cmd, args, options });
            return handler(args, options);
        }
    };
}

/* refresh() 里的 docker.exec 在微任务里执行：调用计数要等一轮事件循环
   才会递增。合并与去重本身是同步生效的（inflight 立即赋值）。 */
const flush = () => new Promise(resolve => setImmediate(resolve));

function createCache(docker, extra = {}) {
    return createContainerStatsCache({
        docker,
        parseEntry: parseDockerStatsPayload,
        logger: { warn() {} },
        ...extra
    });
}

test('parseStatsOutput indexes every container of a real batch sample', () => {
    const byId = parseStatsOutput(REAL_OUTPUT, parseDockerStatsPayload);
    assert.deepEqual([...byId.keys()], ['6a691cb54711', '538a8f09d70d', 'dd1f8220291c']);
    assert.equal(byId.get('6a691cb54711').cpu, '12.8%');
    assert.equal(byId.get('dd1f8220291c').cpuPercent, 2.08);
});

test('parseStatsOutput skips malformed lines without losing the rest', () => {
    const byId = parseStatsOutput(`not json\n${REAL_OUTPUT}\n{"no":"id"}`, parseDockerStatsPayload);
    assert.equal(byId.size, 3);
});

test('one batched call covers every container', async () => {
    const docker = createDocker(() => ({ stdout: REAL_OUTPUT, stderr: '', error: null }));
    const cache = createCache(docker);
    await cache.refresh();

    assert.equal(docker.calls.length, 1, '应只发一次 docker stats');
    assert.deepEqual(docker.calls[0].args, ['stats', '--no-stream', '--format', '{{json .}}']);
    assert.equal(cache.get('6a691cb54711').cpu, '12.8%');
    assert.equal(cache.get('dd1f8220291c').memoryPercent, 1.22);
});

test('a full 64-char container id matches the short id docker reports', async () => {
    // compose ps 给的是 64 位全 id，docker stats 输出的是 12 位短 id。
    const docker = createDocker(() => ({ stdout: REAL_OUTPUT, stderr: '', error: null }));
    const cache = createCache(docker);
    await cache.refresh();

    const fullId = '6a691cb54711' + 'f'.repeat(52);
    assert.equal(cache.get(fullId).cpu, '12.8%');
});

test('get returns immediately while the sample is still running', async () => {
    /* 这是本次改动的要点：docker stats 单次 1.5-2 秒，读取绝不能等它。 */
    let release = null;
    const gate = new Promise(resolve => { release = resolve; });
    const docker = createDocker(async () => {
        await gate;
        return { stdout: REAL_OUTPUT, stderr: '', error: null };
    });
    const cache = createCache(docker);

    const started = Date.now();
    const value = cache.get('6a691cb54711');
    const elapsed = Date.now() - started;

    assert.deepEqual(value, {}, '还没有样本时返回空对象');
    assert.ok(elapsed < 50, `读取不应等待采样，实际耗时 ${elapsed}ms`);

    release();
});

test('concurrent reads collapse into a single sample', async () => {
    let calls = 0;
    let release = null;
    const gate = new Promise(resolve => { release = resolve; });
    const docker = createDocker(async () => {
        calls += 1;
        await gate;
        return { stdout: REAL_OUTPUT, stderr: '', error: null };
    });
    const cache = createCache(docker);

    // 十来个服务同时探测，不能变成十来次 docker stats。
    for (let i = 0; i < 12; i += 1) cache.get('6a691cb54711');
    await flush();
    assert.equal(calls, 1, `并发读取应合并为一次采样，实际 ${calls} 次`);

    release();
});

test('a fresh sample is reused within the ttl', async () => {
    let calls = 0;
    let clock = 1000;
    const docker = createDocker(() => {
        calls += 1;
        return { stdout: REAL_OUTPUT, stderr: '', error: null };
    });
    const cache = createCache(docker, { ttlMs: 8000, now: () => clock });

    await cache.refresh();
    assert.equal(calls, 1);

    clock += 5000;
    cache.get('6a691cb54711');
    await flush();
    assert.equal(calls, 1, 'TTL 内不应重新采样');

    clock += 4000;
    cache.get('6a691cb54711');
    await flush();
    assert.equal(calls, 2, 'TTL 过期后应在后台补一次采样');
});

test('a failed sample keeps the previous values instead of blanking the cards', async () => {
    let fail = false;
    const docker = createDocker(() => (fail
        ? { stdout: '', stderr: 'daemon busy', error: new Error('exit 1') }
        : { stdout: REAL_OUTPUT, stderr: '', error: null }));
    const cache = createCache(docker);

    await cache.refresh();
    assert.equal(cache.get('6a691cb54711').cpu, '12.8%');

    fail = true;
    await cache.refresh();
    assert.equal(cache.get('6a691cb54711').cpu, '12.8%', '采样失败应沿用上次结果');
});

test('invalidate forces the next read to resample', async () => {
    let calls = 0;
    let clock = 1000;
    const docker = createDocker(() => {
        calls += 1;
        return { stdout: REAL_OUTPUT, stderr: '', error: null };
    });
    const cache = createCache(docker, { now: () => clock });

    await cache.refresh();
    assert.equal(calls, 1);

    // 启停后容器换了 id，旧样本必须作废。
    cache.invalidate();
    cache.get('6a691cb54711');
    await flush();
    assert.equal(calls, 2);
});

test('an unknown container yields no stats rather than another container reading', async () => {
    const docker = createDocker(() => ({ stdout: REAL_OUTPUT, stderr: '', error: null }));
    const cache = createCache(docker);
    await cache.refresh();

    assert.deepEqual(cache.get('ffffffffffff'), {});
    assert.deepEqual(cache.get(''), {});
});
