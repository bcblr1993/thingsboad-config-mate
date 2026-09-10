const assert = require('node:assert/strict');
const test = require('node:test');

/* 复刻 tb-config-src.js 中的改写规则，验证「改了资源却忘改版本串」
   这一类缓存事故不会再发生（2.0.3 曾因此导致容器重建后仍加载旧逻辑）。 */
function rewriteAssetVersion(html, version) {
    return html
        .replace(/(\.(?:js|css))\?v=[^"']*/g, `$1?v=${version}`)
        .replace(/(<(?:script|link)[^>]*(?:src|href)="assets\/[^"?]+\.(?:js|css))"/g, `$1?v=${version}"`);
}

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
