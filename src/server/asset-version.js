const fs = require('fs');
const path = require('path');

/* 前端资源缓存版本。
   index.html 里原本是手写的 ?v=20260521-xxx 版本串：改了 JS/CSS 却忘了同步
   版本串，浏览器就会继续用旧缓存——容器都重建了界面还是旧逻辑，这个坑在
   2.0.3 出过一次事故。改为按资源修改时间自动生成，代码一变版本串就变。 */

// 资源树很浅，限制层数避免异常目录结构把启动拖住。
const MAX_DEPTH = 6;
const VERSIONED_EXT = /\.(?:js|css|html)$/i;

/**
 * 计算资源版本串（秒级时间戳）。
 *
 * 必须逐个文件取 mtime，不能对目录 statSync：目录的 mtime 只在增删条目时更新，
 * 就地改一个 assets/modules/*.js 的内容目录时间戳不动，版本号就漏了更新——恰好
 * 是这个机制要防的那种情况。rsync 因为写临时文件再重命名会带动目录时间戳，看着
 * 像是能用，但 docker cp、就地编辑、rsync --inplace 都不会。
 */
function computeAssetVersion(rootDir, roots = ['index.html', 'assets']) {
    let newest = 0;

    const walk = (absPath, depth) => {
        if (depth > MAX_DEPTH) return;
        let stat;
        try {
            stat = fs.statSync(absPath);
        } catch (e) {
            return; // 缺失的入口不参与计算。
        }
        if (stat.isFile()) {
            if (VERSIONED_EXT.test(absPath)) newest = Math.max(newest, stat.mtimeMs);
            return;
        }
        if (!stat.isDirectory()) return;
        try {
            fs.readdirSync(absPath).forEach(name => walk(path.join(absPath, name), depth + 1));
        } catch (e) {
            // 不可读目录跳过，不影响其余资源。
        }
    };

    roots.forEach(entry => walk(path.join(rootDir, entry), 0));
    // 一个资源都没扫到时退化为启动时间：宁可多刷一次缓存，也不要给出固定版本串。
    return newest > 0 ? String(Math.floor(newest / 1000)) : String(Date.now());
}

/** 把 index.html 中所有本地资源引用改写为同一个版本串。 */
function rewriteAssetVersion(html, version) {
    return String(html)
        .replace(/(\.(?:js|css))\?v=[^"']*/g, `$1?v=${version}`)
        .replace(/(<(?:script|link)[^>]*(?:src|href)="assets\/[^"?]+\.(?:js|css))"/g, `$1?v=${version}"`);
}

module.exports = { computeAssetVersion, rewriteAssetVersion };
