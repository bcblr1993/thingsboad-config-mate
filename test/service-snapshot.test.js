const assert = require('node:assert/strict');
const test = require('node:test');

const { createServiceSnapshot } = require('../src/server/services/service-snapshot');

test('repeated reads within the TTL hit the cache', async () => {
    let calls = 0;
    let clock = 1000;
    const snap = createServiceSnapshot({
        collect: async () => { calls += 1; return { n: calls }; },
        ttlMs: 1500,
        now: () => clock
    });

    assert.deepEqual(await snap.get(), { n: 1 });
    assert.deepEqual(await snap.get(), { n: 1 });
    assert.equal(calls, 1);

    clock += 1600;
    assert.deepEqual(await snap.get(), { n: 2 });
    assert.equal(calls, 2);
});

test('concurrent reads are coalesced into one probe', async () => {
    let calls = 0;
    const snap = createServiceSnapshot({
        collect: async () => {
            calls += 1;
            await new Promise(r => setTimeout(r, 20));
            return { n: calls };
        },
        ttlMs: 1500
    });

    /* 探测一次要几十个 docker 调用，20 个并发若各探一次会放大成几百次。 */
    const results = await Promise.all(Array.from({ length: 20 }, () => snap.get()));
    assert.equal(calls, 1);
    results.forEach(r => assert.deepEqual(r, { n: 1 }));
});

test('invalidate forces the next read to re-probe', async () => {
    let calls = 0;
    const snap = createServiceSnapshot({ collect: async () => ({ n: ++calls }), ttlMs: 60_000 });

    await snap.get();
    snap.invalidate();
    await snap.get();
    // 启停后必须立刻能读到新状态，否则界面会显示操作前的旧值。
    assert.equal(calls, 2);
});

test('force bypasses the cache without invalidating it', async () => {
    let calls = 0;
    const snap = createServiceSnapshot({ collect: async () => ({ n: ++calls }), ttlMs: 60_000 });

    await snap.get();
    await snap.get({ force: true });
    assert.equal(calls, 2);
});

test('a failed probe is not cached', async () => {
    let calls = 0;
    const snap = createServiceSnapshot({
        collect: async () => {
            calls += 1;
            if (calls === 1) throw new Error('docker unavailable');
            return { ok: true };
        },
        ttlMs: 60_000
    });

    await assert.rejects(() => snap.get(), /docker unavailable/);
    // 失败不应被缓存，否则 docker 恢复后界面会一直显示错误。
    assert.deepEqual(await snap.get(), { ok: true });
    assert.equal(calls, 2);
});

test('collect is required', () => {
    assert.throws(() => createServiceSnapshot({}), /collect is required/);
});
