/**
 * 容器 CPU / 内存采样缓存。
 *
 * `docker stats --no-stream` 必须采样一段 CPU 间隔才能算出百分比，单次调用
 * 实测约 1.5–2 秒，且与容器数量几乎无关（真机上 1 个容器 1583ms、3 个并行
 * 2600ms、一次拿全部 2030ms）。原先按服务逐个调用并 await，于是整个
 * /api/services 被这一项拖到 3 秒以上——而其余探测（compose ps + inspect）
 * 全部并行也只要 125ms。
 *
 * 这里做两件事：
 * 1. 合并成一次 `docker stats` 拿全部容器，避免 N 次调用互相争抢 docker 守护进程；
 * 2. 读取永不阻塞——立刻返回上一次样本，同时在后台补一次刷新。
 *
 * 代价是 CPU / 内存最多有 ttlMs 的滞后。这对运维界面上的资源占用展示完全够用：
 * docker 自己的一次采样窗口就已经是 1.5 秒量级。真正决定界面能否操作的是
 * 运行/停止状态，那部分仍是每次实时探测，没有变化。
 */

const DEFAULT_TTL_MS = 8000;
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * 解析批量输出，按容器 id 建索引。
 * parseEntry 由调用方注入，复用 runtime.js 里既有的解析与格式化逻辑，
 * 避免这里另写一份导致界面上的数值格式发生变化。
 */
function parseStatsOutput(stdout, parseEntry) {
    const byId = new Map();
    String(stdout || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .forEach(line => {
            let data = null;
            try {
                data = JSON.parse(line);
            } catch (e) {
                return; // 单行异常不影响其余容器。
            }
            const id = String(data.ID || data.Container || '').trim();
            if (!id) return;
            byId.set(id, parseEntry(line));
        });
    return byId;
}

function createContainerStatsCache({
    docker,
    parseEntry,
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    logger = console,
    now = () => Date.now()
}) {
    if (typeof parseEntry !== 'function') throw new Error('parseEntry is required');

    let byId = new Map();
    let fetchedAt = 0;
    let inflight = null;
    let hits = 0;
    let refreshes = 0;

    function isStale() {
        return fetchedAt === 0 || now() - fetchedAt >= ttlMs;
    }

    /** 触发一次批量采样。并发调用合并为一次。 */
    function refresh() {
        if (inflight) return inflight;
        refreshes += 1;
        inflight = Promise.resolve()
            .then(() => docker.exec(
                docker.dockerPath,
                ['stats', '--no-stream', '--format', '{{json .}}'],
                { timeout: timeoutMs }
            ))
            .then(result => {
                // 采样失败时保留上一次的值：显示略旧的数据好过突然清空。
                if (result.error) {
                    logger.warn?.(`[Stats] 采样失败，沿用上次结果：${result.error.message}`);
                    return;
                }
                byId = parseStatsOutput(result.stdout, parseEntry);
                fetchedAt = now();
            })
            .catch(error => {
                logger.warn?.(`[Stats] 采样异常，沿用上次结果：${error.message}`);
            })
            .finally(() => { inflight = null; });
        return inflight;
    }

    /**
     * 读取某个容器的资源占用。永不阻塞：立刻返回已有样本，
     * 样本过期时顺带在后台补一次刷新，供下一次读取使用。
     */
    function get(containerId) {
        if (isStale()) refresh();
        if (!containerId) return {};
        hits += 1;
        const id = String(containerId);
        const exact = byId.get(id);
        if (exact) return { ...exact };
        // docker stats 输出 12 位短 id，而这里拿到的通常是 64 位全 id。
        for (const [key, value] of byId) {
            if (id.startsWith(key) || key.startsWith(id)) return { ...value };
        }
        return {};
    }

    /** 启停等操作后调用，让下一次读取重新采样。 */
    function invalidate() {
        fetchedAt = 0;
    }

    function stats() {
        return { hits, refreshes, size: byId.size, fetchedAt };
    }

    return { get, refresh, invalidate, stats };
}

module.exports = {
    DEFAULT_TTL_MS,
    createContainerStatsCache,
    parseStatsOutput
};
