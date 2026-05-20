/**
 * History viewer component (ESM port of legacy /assets/modules/history-ui.js).
 *
 * Same factory contract:
 *   const viewer = createHistoryUi({ api, customConfirm, getEnvPath, reload });
 *   viewer.open();
 *   viewer.close();
 *   viewer.fetchHistory();
 *   viewer.handleAction(event);
 *   viewer.closeDiff();
 *
 * Business logic intentionally identical to legacy module.
 *
 * External dependencies (still global for now):
 *   window.ConfigMateUi.{openModal, closeModal, escapeHtml}  — see ui-core.js
 *   window.ConfigMateApi  — legacy api default when options.api not provided
 *
 * DOM contract (unchanged): expects #history-modal, #history-list,
 * #history-count, #history-latest, #history-env-path, #diff-title,
 * #diff-modal, #diff-content.
 */

const escapeHtml = (text) => {
    // Defer to ui-core.js if available, fall back to a local copy.
    if (typeof window !== 'undefined' && window.ConfigMateUi?.escapeHtml) {
        return window.ConfigMateUi.escapeHtml(text);
    }
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

export function createHistoryUi(options = {}) {
    function getApi() {
        return options.api || window.ConfigMateApi;
    }

    function notify(message, type = 'info') {
        const showToast = options.showToast || window.ConfigMateUi?.showToast;
        if (typeof showToast === 'function') showToast(message, type);
    }

    function open() {
        const modal = document.getElementById('history-modal');
        if (!modal) return;
        window.ConfigMateUi.openModal(modal);
        fetchHistory();
    }

    function close() {
        const modal = document.getElementById('history-modal');
        if (!modal) return;
        window.ConfigMateUi.closeModal(modal);
    }

    async function fetchHistory() {
        const listEl = document.getElementById('history-list');
        if (!listEl) {
            console.error('history-list element not found!');
            return;
        }
        renderLoading();
        try {
            const res = await getApi().history();
            const json = await res.json();

            if (json.status === 'success') {
                render(json.data);
            } else {
                renderState('读取失败', json.message || '历史记录接口返回异常', 'error');
            }
        } catch (e) {
            console.error(e);
            renderState('请求失败', e.message, 'error');
        }
    }

    function renderLoading() {
        updateSummary([]);
        const listEl = document.getElementById('history-list');
        if (!listEl) return;
        listEl.innerHTML = `
            <li class="history-state">
                <div class="history-state-card">
                    <div class="history-state-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2" style="animation: spin 1s linear infinite;">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                        </svg>
                    </div>
                    <div class="history-state-title">加载中</div>
                    <div class="history-state-desc">正在读取历史记录</div>
                </div>
            </li>
        `;
    }

    function renderState(title, message, type = '') {
        const listEl = document.getElementById('history-list');
        if (!listEl) return;
        const iconColor = type === 'error' ? '#B91C1C' : '#64748B';
        listEl.innerHTML = `
            <li class="history-state">
                <div class="history-state-card">
                    <div class="history-state-icon" style="color:${iconColor};">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                    </div>
                    <div class="history-state-title">${escapeHtml(title)}</div>
                    <div class="history-state-desc">${escapeHtml(message || '')}</div>
                </div>
            </li>
        `;
    }

    function updateSummary(files) {
        const countEl = document.getElementById('history-count');
        const latestEl = document.getElementById('history-latest');
        const envPathEl = document.getElementById('history-env-path');
        const count = Array.isArray(files) ? files.length : 0;
        if (countEl) countEl.textContent = `${count} / 5`;
        if (latestEl) latestEl.textContent = count ? formatDate(files[0].timestamp, 'datetime') : '暂无记录';
        if (envPathEl) {
            const envPath = typeof options.getEnvPath === 'function' ? options.getEnvPath() : '.env';
            envPathEl.textContent = envPath.short || envPath.full || '.env';
            if (envPath.full) envPathEl.title = envPath.full;
        }
    }

    function render(files) {
        const listEl = document.getElementById('history-list');
        updateSummary(files || []);
        if (!files || files.length === 0) {
            renderState('暂无历史版本', '保存配置后会在这里显示备份记录');
            return;
        }
        if (!listEl) return;

        listEl.innerHTML = files.map((file, index) => {
            const dateObj = new Date(file.timestamp);
            const timeStr = dateObj.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            const dateStr = dateObj.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
            const isLatest = index === 0;
            const filename = String(file.filename || '');
            const safeFilename = escapeHtml(filename);
            const relative = formatRelative(file.timestamp);
            const size = formatSize(file.size);

            return `
                <li class="timeline-item ${isLatest ? 'latest' : ''}">
                    <div class="timeline-marker"></div>
                    <div class="timeline-content">
                        <div class="timeline-header">
                            <div class="timeline-main">
                                <div class="timeline-time">
                                    <span>${timeStr}</span>
                                    <span class="timeline-date-badge">${dateStr}</span>
                                    ${isLatest ? '<span class="history-badge latest">最新</span>' : ''}
                                </div>
                                <div class="timeline-meta">
                                    <span class="timeline-file-tag">ENV</span>
                                    <span class="timeline-file-name" title="${safeFilename}">${safeFilename}</span>
                                    <span>${escapeHtml(size)}</span>
                                    <span class="timeline-age">${escapeHtml(relative)}</span>
                                </div>
                            </div>
                            <div class="timeline-actions">
                                <button class="history-action" type="button" data-history-action="view" data-history-file="${safeFilename}" title="查看内容">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                        stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                    查看
                                </button>
                                <button class="history-action" type="button" data-history-action="compare" data-history-file="${safeFilename}" title="与当前配置对比">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                        stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M9 21H4v-5"></path></svg>
                                    对比
                                </button>
                                <button class="history-action danger" type="button" data-history-action="restore" data-history-file="${safeFilename}" title="回滚到此版本">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                        stroke-width="2"><path d="M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8"></path></svg>
                                    回滚
                                </button>
                            </div>
                        </div>
                    </div>
                </li>
            `;
        }).join('');
    }

    function handleAction(event) {
        const button = event.target.closest('[data-history-action]');
        if (!button) return;
        const filename = button.dataset.historyFile || '';
        if (!filename) return;
        const action = button.dataset.historyAction;
        if (action === 'view') viewContent(filename);
        else if (action === 'compare') compare(filename);
        else if (action === 'restore') restore(filename);
    }

    function formatDate(isoStr, mode = 'short') {
        const date = new Date(isoStr);
        if (Number.isNaN(date.getTime())) return '--';
        if (mode === 'datetime') {
            return date.toLocaleString('zh-CN', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
            });
        }
        return date.toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
    }

    function formatRelative(isoStr) {
        const time = new Date(isoStr).getTime();
        if (!time) return '';
        const diffSeconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
        if (diffSeconds < 60) return '刚刚';
        const diffMinutes = Math.floor(diffSeconds / 60);
        if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) return `${diffHours} 小时前`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} 天前`;
    }

    function formatSize(size) {
        const bytes = Number(size || 0);
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function openDiff(title) {
        const titleEl = document.getElementById('diff-title');
        const modal = document.getElementById('diff-modal');
        if (titleEl) titleEl.innerText = title;
        if (!modal) return;
        window.ConfigMateUi.openModal(modal);
    }

    function closeDiff() {
        const modal = document.getElementById('diff-modal');
        if (!modal) return;
        window.ConfigMateUi.closeModal(modal);
    }

    async function viewContent(filename) {
        try {
            const res = await getApi().historyContent(filename);
            const json = await res.json();
            if (json.status === 'success') {
                const contentEl = document.getElementById('diff-content');
                if (contentEl) {
                    contentEl.innerHTML = json.content.split('\n').map(line =>
                        `<div class="diff-line">${escapeHtml(line)}</div>`
                    ).join('');
                }
                openDiff(`文件内容: ${filename}`);
            } else {
                notify('获取失败: ' + json.message, 'error');
            }
        } catch (e) {
            notify('请求失败: ' + e.message, 'error');
        }
    }

    async function compare(filename) {
        try {
            const resHist = await getApi().historyContent(filename);
            const jsonHist = await resHist.json();
            const resCurr = await getApi().rawEnv();
            const textCurr = await resCurr.text();

            if (jsonHist.status === 'success') {
                renderDiff(jsonHist.content, textCurr);
                openDiff(`配置对比 (${filename} vs 当前)`);
            } else {
                notify('获取历史文件失败: ' + jsonHist.message, 'error');
            }
        } catch (e) {
            notify('请求失败: ' + e.message, 'error');
        }
    }

    function renderDiff(oldText, newText) {
        const oldMap = parseEnvLines(oldText.split('\n'));
        const newMap = parseEnvLines(newText.split('\n'));
        const allKeys = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
        const sortedKeys = Array.from(allKeys).sort();
        let html = '';

        sortedKeys.forEach(key => {
            const oldVal = oldMap[key];
            const newVal = newMap[key];

            if (oldVal === undefined) {
                html += `<div class="diff-line diff-added">+ ${escapeHtml(key)}=${escapeHtml(newVal)}</div>`;
            } else if (newVal === undefined) {
                html += `<div class="diff-line diff-removed">- ${escapeHtml(key)}=${escapeHtml(oldVal)}</div>`;
            } else if (oldVal !== newVal) {
                html += `<div class="diff-line diff-removed">- ${escapeHtml(key)}=${escapeHtml(oldVal)}</div>`;
                html += `<div class="diff-line diff-added">+ ${escapeHtml(key)}=${escapeHtml(newVal)}</div>`;
            } else {
                html += `<div class="diff-line">  ${escapeHtml(key)}=${escapeHtml(newVal)}</div>`;
            }
        });

        const content = document.getElementById('diff-content');
        if (content) content.innerHTML = html;
    }

    function parseEnvLines(lines) {
        const map = {};
        lines.forEach(line => {
            const trim = line.trim();
            if (!trim || trim.startsWith('#')) return;
            const parts = trim.split('=');
            const key = parts[0].trim();
            const val = parts.slice(1).join('=').trim();
            map[key] = val;
        });
        return map;
    }

    async function restore(filename) {
        const confirm = options.customConfirm || (() => Promise.resolve(window.confirm(`确定要将配置回滚到 ${filename} 吗？`)));
        if (!await confirm(`确定要将配置回滚到 ${filename} 吗？\n\n当前未保存的修改将会丢失。`, '确认回滚', 'var(--danger)')) return;

        try {
            const res = await getApi().restoreHistory(filename);
            const json = await res.json();

            if (json.status === 'success') {
                notify('回滚成功，页面将刷新以加载新配置。', 'success');
                if (typeof options.reload === 'function') options.reload();
                else location.reload();
            } else {
                notify('回滚失败: ' + json.message, 'error');
            }
        } catch (e) {
            notify('请求失败: ' + e.message, 'error');
        }
    }

    return {
        open,
        close,
        fetchHistory,
        handleAction,
        closeDiff
    };
}
