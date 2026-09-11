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

/**
 * 为 ESM 模块图生成 modulepreload 提示。
 *
 * assets/src 下的 49 个模块是靠嵌套 import 加载的：浏览器要先拿到 main.js、
 * 解析出它的依赖，再去拿下一层。真机实测形成三波串行、跨度 232ms，而这三波
 * 之间纯粹是往返延迟。232ms 这个数就是在现场同网段（10.8.8.x 局域网）实测的，
 * 不是估算，也没有经过 VPN 之类的额外链路。
 *
 * 声明 modulepreload 后浏览器一开始就能并发取回整张图，不必等解析。
 * 这里在启动时扫描目录生成，不需要构建步骤，也不会因为漏改列表而失效。
 */
function buildModulePreloadTags(rootDir, moduleRoot = 'assets/src') {
    const absRoot = path.join(rootDir, moduleRoot);
    const files = [];

    const walk = (absPath, relPath, depth) => {
        if (depth > MAX_DEPTH) return;
        let entries;
        try {
            entries = fs.readdirSync(absPath, { withFileTypes: true });
        } catch (e) {
            return; // 没有该目录就不生成提示，不影响页面。
        }
        entries.forEach(entry => {
            const nextAbs = path.join(absPath, entry.name);
            const nextRel = `${relPath}/${entry.name}`;
            if (entry.isDirectory()) walk(nextAbs, nextRel, depth + 1);
            else if (/\.m?js$/i.test(entry.name)) files.push(nextRel);
        });
    };

    walk(absRoot, moduleRoot, 0);
    // 顺序稳定，便于比对与排查。
    files.sort();
    /* 不能带 ?v=：import 语句请求的是不带查询串的裸路径，预加载一旦用了另一个
       URL，浏览器就当成两个资源，每个模块下载两遍。真机上试过——模块数从 43
       变成 91，DCL 从 250ms 涨到 2479ms，比不加预加载还慢十倍。
       这些模块本来也拿不到版本串（见 static-assets.js），走的是 ETag + 304。 */
    return files
        .map(file => `    <link rel="modulepreload" href="${file}">`)
        .join('\n');
}

/** 把 index.html 中所有本地资源引用改写为同一个版本串。 */
function rewriteAssetVersion(html, version) {
    return String(html)
        .replace(/(\.(?:js|css))\?v=[^"']*/g, `$1?v=${version}`)
        .replace(/(<(?:script|link)[^>]*(?:src|href)="assets\/[^"?]+\.(?:js|css))"/g, `$1?v=${version}"`);
}

/** 把 modulepreload 提示插到 ESM 入口之前；没有入口时原样返回。 */
function injectModulePreloads(html, tags) {
    if (!tags) return html;
    const entryTag = /([ \t]*)<script type="module"([^>]*)>/;
    const match = html.match(entryTag);
    if (!match) return html;

    /* 入口脚本自己就会触发下载，且它带着 ?v=，与裸路径的预加载是两个 URL——
       同时留着会把入口下载两遍。把它从提示里剔掉。 */
    const entrySrc = (match[2].match(/src="([^"?]+)/) || [])[1];
    const kept = tags
        .split('\n')
        .filter(line => !entrySrc || !line.includes(`href="${entrySrc}"`))
        .join('\n');
    if (!kept) return html;

    return html.replace(entryTag, (full, indent) => `${kept}\n${indent}${full.trim()}`);
}

module.exports = { buildModulePreloadTags, computeAssetVersion, injectModulePreloads, rewriteAssetVersion };
