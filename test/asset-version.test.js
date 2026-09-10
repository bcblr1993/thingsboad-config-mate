const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* 验证「改了资源却忘改版本串」这一类缓存事故不会再发生
   （2.0.3 曾因此导致容器重建后仍加载旧逻辑）。
   注意这里直接引用实现，不复刻规则——复刻的测试只能证明副本自洽。 */
const { computeAssetVersion, rewriteAssetVersion } = require('../src/server/asset-version');

function makeAssetTree() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-assets-'));
    fs.mkdirSync(path.join(root, 'assets/modules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'assets/styles/pages'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<script src="assets/app.js"></script>');
    fs.writeFileSync(path.join(root, 'assets/app.js'), 'a');
    fs.writeFileSync(path.join(root, 'assets/modules/services-ui.js'), 'b');
    fs.writeFileSync(path.join(root, 'assets/styles/pages/deployment.css'), 'c');
    return root;
}

/** 把一个文件的 mtime 往后推，模拟「改了这个文件」。 */
function touchLater(file, seconds) {
    const when = new Date(Date.now() + seconds * 1000);
    fs.utimesSync(file, when, when);
}

test('editing a nested asset changes the version', () => {
    /* 曾经对 assets/modules 这类目录 statSync：目录 mtime 只在增删条目时更新，
       就地改文件内容时间戳不动，版本号漏更新——正好是这个机制要防的情况。
       rsync 写临时文件再重命名会带动目录时间戳，看着像能用，实际不可依赖。 */
    const root = makeAssetTree();
    try {
        const before = computeAssetVersion(root);
        touchLater(path.join(root, 'assets/modules/services-ui.js'), 120);
        assert.notEqual(computeAssetVersion(root), before, '嵌套资源变更必须反映到版本号');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('the version tracks the newest asset across the whole tree', () => {
    const root = makeAssetTree();
    try {
        touchLater(path.join(root, 'assets/styles/pages/deployment.css'), 300);
        const expected = String(Math.floor(fs.statSync(path.join(root, 'assets/styles/pages/deployment.css')).mtimeMs / 1000));
        assert.equal(computeAssetVersion(root), expected);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('an unchanged tree yields a stable version', () => {
    // 每次请求都换版本号等于关掉缓存，静态资源会被反复下载。
    const root = makeAssetTree();
    try {
        assert.equal(computeAssetVersion(root), computeAssetVersion(root));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a missing asset tree falls back instead of throwing', () => {
    const version = computeAssetVersion(path.join(os.tmpdir(), 'cm-assets-does-not-exist'));
    assert.match(version, /^\d+$/);
});

test('non-asset files do not affect the version', () => {
    const root = makeAssetTree();
    try {
        const before = computeAssetVersion(root);
        fs.writeFileSync(path.join(root, 'assets/logo.png'), 'x');
        touchLater(path.join(root, 'assets/logo.png'), 600);
        assert.equal(computeAssetVersion(root), before);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('existing hand-written versions are replaced', () => {
    const html = '<script src="assets/app.js?v=20260522-install-state"></script>';
    assert.equal(rewriteAssetVersion(html, '999'), '<script src="assets/app.js?v=999"></script>');
});

test('assets without any version get one', () => {
    const html = '<link rel="stylesheet" href="assets/styles/login.css">';
    assert.equal(rewriteAssetVersion(html, '999'), '<link rel="stylesheet" href="assets/styles/login.css?v=999">');
});

test('every asset in a realistic head is versioned consistently', () => {
    const html = [
        '<link rel="stylesheet" href="assets/styles/tokens.css">',
        '<link rel="stylesheet" href="assets/styles.css?v=old-1">',
        '<script src="assets/api.js"></script>',
        '<script src="assets/modules/ui-core.js?v=old-2"></script>',
        '<script type="module" src="assets/src/main.js?v=old-3"></script>'
    ].join('\n');

    const out = rewriteAssetVersion(html, '777');
    // 不能残留任何旧版本串——新旧脚本混用正是事故根源。
    assert.equal(/v=old-/.test(out), false);
    assert.equal((out.match(/\?v=777/g) || []).length, 5);
});

test('non-asset urls are left alone', () => {
    const html = '<link rel="icon" href="data:image/svg+xml,%3Csvg/%3E"><script src="https://cdn.example.com/x.js"></script>';
    assert.equal(rewriteAssetVersion(html, '999'), html);
});

test('rewriting is idempotent', () => {
    const html = '<script src="assets/app.js"></script>';
    const once = rewriteAssetVersion(html, '111');
    assert.equal(rewriteAssetVersion(once, '111'), once);
    // 版本变化时应整体切换，不叠加。
    assert.equal(rewriteAssetVersion(once, '222'), '<script src="assets/app.js?v=222"></script>');
});

test('the shipped index.html has every asset versioned by the server', () => {
    // 端到端口径：真实 index.html 经改写后不应残留任何未带版本的本地资源引用。
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');
    const out = rewriteAssetVersion(html, '424242');
    const unversioned = out.match(/(?:src|href)="assets\/[^"?]+\.(?:js|css)"/g) || [];
    assert.deepEqual(unversioned, [], `以下资源未带版本号：${unversioned.join(', ')}`);
    assert.ok((out.match(/\?v=424242/g) || []).length > 5);
});
