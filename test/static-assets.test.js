const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { createStaticAssetServer, IMMUTABLE_CACHE, REVALIDATE } = require('../src/server/static-assets');

function makeAssets() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-static-'));
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
    // 大于压缩阈值，模拟真实的 app.js / styles.css
    fs.writeFileSync(path.join(root, 'app.js'), '// x\n'.repeat(4000));
    fs.writeFileSync(path.join(root, 'tiny.js'), 'a');
    fs.writeFileSync(path.join(root, 'logo.png'), Buffer.alloc(4096, 7));
    fs.writeFileSync(path.join(root, 'sub', 'page.css'), '.a{color:red}\n'.repeat(400));
    return root;
}

function fakeRes() {
    return {
        statusCode: 0,
        headers: null,
        body: null,
        writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
        end(body) { this.body = body; }
    };
}

function request(server, pathname, { search = '', gzip = true, br = false, method = 'GET', ifNoneMatch = null } = {}) {
    const headers = {};
    if (br) headers['accept-encoding'] = 'gzip, deflate, br';
    else if (gzip) headers['accept-encoding'] = 'gzip, deflate';
    if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
    const req = { method, headers };
    const res = fakeRes();
    const errors = [];
    server.serve(req, res, {
        pathname,
        search,
        headers: {},
        onError: (status, message) => errors.push({ status, message })
    });
    return { res, errors };
}

const VERSION = '1789000000';
const build = root => createStaticAssetServer({ assetRoot: root, assetVersion: VERSION, logger: { warn() {} } });

test('text assets are gzipped for clients that accept it', () => {
    const root = makeAssets();
    try {
        const { res } = request(build(root), '/assets/app.js');
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['Content-Encoding'], 'gzip');
        assert.equal(res.headers.Vary, 'Accept-Encoding');
        const raw = fs.readFileSync(path.join(root, 'app.js'));
        assert.ok(res.body.length < raw.length / 2, `压缩后 ${res.body.length} 未显著小于原始 ${raw.length}`);
        assert.equal(zlib.gunzipSync(res.body).toString(), raw.toString(), '解压后必须与原文件一致');
        assert.equal(res.headers['Content-Length'], res.body.length);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a client that does not accept gzip still gets the file', () => {
    const root = makeAssets();
    try {
        const { res } = request(build(root), '/assets/app.js', { gzip: false });
        assert.equal(res.headers['Content-Encoding'], undefined);
        assert.equal(res.body.toString(), fs.readFileSync(path.join(root, 'app.js')).toString());
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('already-compressed and tiny files are not gzipped', () => {
    const root = makeAssets();
    try {
        const png = request(build(root), '/assets/logo.png').res;
        assert.equal(png.headers['Content-Encoding'], undefined, 'png 不应再压一遍');
        const tiny = request(build(root), '/assets/tiny.js').res;
        assert.equal(tiny.headers['Content-Encoding'], undefined, '小文件压缩不划算');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a matching version gets an immutable long cache', () => {
    /* ?v= 由 asset-version.js 按文件修改时间生成并注入 index.html，
       资源一变版本串就变、URL 就变，所以长缓存拿不到旧代码。 */
    const root = makeAssets();
    try {
        const { res } = request(build(root), '/assets/app.js', { search: `?v=${VERSION}` });
        assert.equal(res.headers['Cache-Control'], IMMUTABLE_CACHE);
        assert.equal(res.headers.Pragma, undefined);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a stale or missing version revalidates instead of caching forever', () => {
    // 长缓存只给版本对得上的，否则旧 index.html 会把错误的资源永久钉在浏览器里。
    const root = makeAssets();
    try {
        const server = build(root);
        assert.equal(request(server, '/assets/app.js').res.headers['Cache-Control'], REVALIDATE);
        assert.equal(request(server, '/assets/app.js', { search: '?v=999' }).res.headers['Cache-Control'], REVALIDATE);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an unchanged unversioned asset comes back as 304', () => {
    /* assets/src/** 的 ESM 模块是靠 import 加载的，拿不到 ?v=。
       此前它们是 no-store，每次刷新都全量重下（实测 42 个文件）。
       改为 no-cache + ETag 后走 304，只剩几百字节。 */
    const root = makeAssets();
    try {
        const server = build(root);
        const first = request(server, '/assets/app.js').res;
        const etag = first.headers.ETag;
        assert.ok(etag, '必须给出 ETag，否则浏览器无从校验');

        const second = request(server, '/assets/app.js', { ifNoneMatch: etag }).res;
        assert.equal(second.statusCode, 304);
        assert.equal(second.body, undefined, '304 不应带正文');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a changed asset does not answer 304 to the old ETag', () => {
    const root = makeAssets();
    try {
        const server = build(root);
        const etag = request(server, '/assets/sub/page.css').res.headers.ETag;
        const later = new Date(Date.now() + 5000);
        fs.writeFileSync(path.join(root, 'sub', 'page.css'), '.b{color:blue}\n'.repeat(400));
        fs.utimesSync(path.join(root, 'sub', 'page.css'), later, later);

        const res = request(server, '/assets/sub/page.css', { ifNoneMatch: etag }).res;
        assert.equal(res.statusCode, 200, '文件已变，必须回完整内容');
        assert.match(zlib.gunzipSync(res.body).toString(), /color:blue/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a changed file invalidates the compressed copy', () => {
    // 开发时挂载源码调试，改了文件不能还发旧的压缩结果。
    const root = makeAssets();
    try {
        const server = build(root);
        const first = request(server, '/assets/sub/page.css').res.body;
        const later = new Date(Date.now() + 5000);
        fs.writeFileSync(path.join(root, 'sub', 'page.css'), '.b{color:blue}\n'.repeat(400));
        fs.utimesSync(path.join(root, 'sub', 'page.css'), later, later);
        const second = request(server, '/assets/sub/page.css').res.body;
        assert.notEqual(zlib.gunzipSync(first).toString(), zlib.gunzipSync(second).toString());
        assert.match(zlib.gunzipSync(second).toString(), /color:blue/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('path traversal is refused', () => {
    const root = makeAssets();
    try {
        const { errors } = request(build(root), '/assets/../../etc/passwd');
        assert.deepEqual(errors, [{ status: 403, message: 'Forbidden' }]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a missing asset reports 404', () => {
    const root = makeAssets();
    try {
        const { errors } = request(build(root), '/assets/nope.js');
        assert.equal(errors[0].status, 404);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('HEAD returns headers without a body', () => {
    const root = makeAssets();
    try {
        const { res } = request(build(root), '/assets/app.js', { method: 'HEAD' });
        assert.equal(res.statusCode, 200);
        assert.ok(res.headers['Content-Length'] > 0);
        assert.equal(res.body, undefined);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('brotli wins when the client supports it', () => {
    /* 同一批资源实测 brotli 比 gzip 再小 19%（app.js 46KB→37KB）。
       省下的字节直接体现在首屏等待上。 */
    const root = makeAssets();
    try {
        const server = build(root);
        const br = request(server, '/assets/app.js', { br: true }).res;
        const gz = request(server, '/assets/app.js', { gzip: true }).res;
        assert.equal(br.headers['Content-Encoding'], 'br');
        assert.equal(gz.headers['Content-Encoding'], 'gzip');
        assert.ok(br.body.length < gz.body.length, `brotli ${br.body.length} 未小于 gzip ${gz.body.length}`);
        assert.equal(zlib.brotliDecompressSync(br.body).toString(), fs.readFileSync(path.join(root, 'app.js')).toString());
        assert.equal(br.headers['Content-Length'], br.body.length);
        assert.equal(br.headers.Vary, 'Accept-Encoding');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a client that only speaks gzip never receives brotli', () => {
    const root = makeAssets();
    try {
        const res = request(build(root), '/assets/app.js', { gzip: true }).res;
        assert.equal(res.headers['Content-Encoding'], 'gzip');
        assert.equal(zlib.gunzipSync(res.body).toString(), fs.readFileSync(path.join(root, 'app.js')).toString());
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('warmUp precompresses everything so the first visitor does not pay for it', async () => {
    /* 压缩是惰性的：不预热则重启后第一个访问者要为每个资源等一次 brotli
       （q11 对 192KB 的 app.js 并不便宜）。 */
    const root = makeAssets();
    try {
        const server = build(root);
        assert.equal(server.stats().files, 0, '预热前不应有任何缓存');

        const result = await server.warmUp();
        assert.ok(result.files >= 2, `只预热了 ${result.files} 个文件`);
        assert.ok(result.servedBytes < result.rawBytes, '预热后应已产生压缩副本');

        // 预热过的资源不再需要现压
        const res = request(server, '/assets/app.js', { br: true }).res;
        assert.equal(res.headers['Content-Encoding'], 'br');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
