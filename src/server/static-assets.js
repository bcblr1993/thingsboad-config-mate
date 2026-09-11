const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * 静态资源服务：压缩 + 版本化缓存。
 *
 * 改动前每次加载都是 64 个请求、706KB，且全部未压缩、全部
 * `Cache-Control: no-cache, no-store, must-revalidate`——刷新一次就把 770KB
 * 的 JS/CSS 重新下载一遍。现场经常是通过 VPN 或跳板机访问，这部分开销比
 * 后端那点 docker 调用更明显。
 *
 * 两件事：
 * 1. 文本资源按需 gzip，压缩结果按「路径 + mtime」缓存在内存里，不重复压缩；
 * 2. 带正确 ?v= 的请求按不可变资源缓存一年。这个版本串由 asset-version.js
 *    按文件修改时间生成并注入 index.html，一旦资源变化版本串就变、URL 就变，
 *    所以长缓存不会导致拿到旧代码。版本串不匹配或没带版本时退回不缓存，
 *    避免旧 index.html 把错误的资源永久钉在浏览器里。
 *
 * index.html 自身始终不缓存——它承载版本串，必须每次拿最新的。
 */

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

// 已经是压缩格式的不再压一遍，只会更大更慢。
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg']);

/* 小文件压缩收益不抵开销，且 gzip 有固定头部，太小反而变大。 */
const MIN_COMPRESS_BYTES = 1024;

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/* 注意是 no-cache 而不是 no-store。
   no-store 禁止浏览器留副本，于是每次刷新都要重新全量下载；no-cache 允许留存
   但要求先回源校验，配合 ETag 就变成一个几百字节的 304。
   assets/src/** 的 ESM 模块是靠 import 语句加载的，index.html 的版本号注入
   够不着它们——42 个文件因此拿不到长缓存，只能走这条路。 */
const REVALIDATE = 'no-cache';

function createStaticAssetServer({
    assetRoot,
    assetVersion,
    gzipLevel = zlib.constants.Z_BEST_COMPRESSION,
    logger = console
}) {
    const root = path.resolve(assetRoot);
    /* key = 绝对路径，value = { mtimeMs, size, raw, gzipped }。
       资源在容器里是只读的，但仍以 mtime 做失效判断，方便开发时挂载源码调试。 */
    const cache = new Map();

    function clientAcceptsGzip(req) {
        return /\bgzip\b/.test(String(req.headers?.['accept-encoding'] || ''));
    }

    function load(absPath, ext) {
        let stat;
        try {
            stat = fs.statSync(absPath);
        } catch (e) {
            return null;
        }
        if (!stat.isFile()) return null;

        const hit = cache.get(absPath);
        if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit;

        const raw = fs.readFileSync(absPath);
        /* 弱 ETag：gzip 与原文内容一致，只是编码不同，用同一个标识即可。 */
        const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
        const entry = { mtimeMs: stat.mtimeMs, size: stat.size, etag, raw, gzipped: null };
        if (COMPRESSIBLE.has(ext) && raw.length >= MIN_COMPRESS_BYTES) {
            try {
                const gzipped = zlib.gzipSync(raw, { level: gzipLevel });
                // 压不小就不用，省下解压开销。
                if (gzipped.length < raw.length) entry.gzipped = gzipped;
            } catch (error) {
                logger.warn?.(`[Static] 压缩失败，改为原样返回：${error.message}`);
            }
        }
        cache.set(absPath, entry);
        return entry;
    }

    /**
     * 处理 /assets/** 请求。返回 true 表示已响应。
     * notFound / forbidden 由调用方决定如何回话，保持与原有错误格式一致。
     */
    function serve(req, res, { pathname, search = '', headers = {}, onError }) {
        const relativePath = decodeURIComponent(pathname.replace(/^\/assets\//, ''));
        const absPath = path.resolve(root, relativePath);

        if (!absPath.startsWith(root + path.sep)) {
            onError(403, 'Forbidden');
            return;
        }

        const ext = path.extname(absPath).toLowerCase();
        const entry = load(absPath, ext);
        if (!entry) {
            onError(404, 'Asset not found');
            return;
        }

        /* 只有版本串对得上才敢长缓存：说明这个 URL 是当前 index.html 发出来的，
           资源一变版本串就变，浏览器会去请求新 URL。 */
        const requestedVersion = new URLSearchParams(search.replace(/^\?/, '')).get('v');
        const versioned = !!assetVersion && requestedVersion === assetVersion;

        const cacheControl = versioned ? IMMUTABLE_CACHE : REVALIDATE;

        /* 未变化就回 304，几百字节代替整个文件。 */
        if (!versioned && req.headers?.['if-none-match'] === entry.etag) {
            res.writeHead(304, { ...headers, ETag: entry.etag, 'Cache-Control': cacheControl });
            res.end();
            return;
        }

        const useGzip = !!entry.gzipped && clientAcceptsGzip(req);
        const body = useGzip ? entry.gzipped : entry.raw;

        const responseHeaders = {
            ...headers,
            'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
            'Content-Length': body.length,
            'Cache-Control': cacheControl,
            ETag: entry.etag
        };
        if (entry.gzipped) responseHeaders.Vary = 'Accept-Encoding';
        if (useGzip) responseHeaders['Content-Encoding'] = 'gzip';

        res.writeHead(200, responseHeaders);
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        res.end(body);
    }

    function stats() {
        let raw = 0;
        let gz = 0;
        cache.forEach(entry => {
            raw += entry.raw.length;
            gz += entry.gzipped ? entry.gzipped.length : entry.raw.length;
        });
        return { files: cache.size, rawBytes: raw, servedBytes: gz };
    }

    return { serve, stats };
}

module.exports = {
    COMPRESSIBLE,
    IMMUTABLE_CACHE,
    MIN_COMPRESS_BYTES,
    REVALIDATE,
    createStaticAssetServer
};
