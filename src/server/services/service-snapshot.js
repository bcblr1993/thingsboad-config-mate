/**
 * 本机服务状态快照缓存。
 *
 * 每次探测要对每个服务执行 `compose ps` + `inspect`（运行中的还要 `stats`），
 * 十来个服务就是二三十次 docker 调用。前端按秒级轮询、多开几个页面或多节点
 * 互相聚合时，这些调用会成倍放大，实测 20 并发要十几秒。
 *
 * 这里用很短的 TTL 吸收并发峰值，并把同一时刻的并发请求合并成一次探测。
 * TTL 远小于前端轮询间隔，且任何会改变状态的操作（启停、清理、安装）都会
 * 主动失效缓存，因此不会出现「操作完看不到变化」。
 */

const DEFAULT_TTL_MS = 1500;

function createServiceSnapshot({
    collect,
    ttlMs = DEFAULT_TTL_MS,
    now = () => Date.now()
}) {
    if (typeof collect !== 'function') throw new Error('collect is required');

    let cache = null;
    let inflight = null;
    let hits = 0;
    let misses = 0;

    async function get({ force = false } = {}) {
        if (!force && cache && now() - cache.at < ttlMs) {
            hits += 1;
            return cache.value;
        }
        // 并发合并：同一时刻的多个请求只触发一次真实探测。
        if (inflight) {
            hits += 1;
            return inflight;
        }

        misses += 1;
        inflight = Promise.resolve()
            .then(collect)
            .then(value => {
                cache = { at: now(), value };
                return value;
            })
            .finally(() => { inflight = null; });

        return inflight;
    }

    /** 状态被改变后调用，保证下一次读取拿到新值。 */
    function invalidate() {
        cache = null;
    }

    function stats() {
        return { hits, misses, cached: !!cache };
    }

    return { get, invalidate, stats };
}

module.exports = {
    DEFAULT_TTL_MS,
    createServiceSnapshot
};
