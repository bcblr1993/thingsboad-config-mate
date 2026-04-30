(function () {
    const MAX_LOG_LINES = 800;
    const MAX_LOG_STORE = 3000;
    const MAX_BUFFERED_LOGS = 1500;
    const LOG_FLUSH_BATCH_SIZE = 120;
    const MAX_MSG_LENGTH = 2000;

    function createLogViewer(options = {}) {
        let selectedLogService = null;
        let logsEventSource = null;
        let startupDetected = false;
        let logReconnectTimer = null;
        let logEntries = [];
        let logBuffer = [];
        let isFlushing = false;
        let droppedBufferedLogs = 0;
        let droppedStoredLogs = 0;
        let logSeq = 0;
        let isWrapMode = true;
        let isLogPaused = false;
        let autoScrollLogs = true;
        let isLogFullscreen = false;
        let currentLogSearch = '';
        let currentLogLevel = 'all';
        let pendingLogRerender = false;
        let pendingLogMetaUpdate = false;
        let isProgrammaticLogScroll = false;

        function notify(message, type = 'info') {
            if (typeof options.showToast === 'function') options.showToast(message, type);
        }

        function getLogsUrl(serviceId) {
            if (typeof options.logsUrl === 'function') return options.logsUrl(serviceId);
            const query = serviceId ? `?service=${encodeURIComponent(serviceId)}` : '';
            return `/api/logs${query}`;
        }

        function show({ isManual = false, serviceId = null, defaultServiceId = null } = {}) {
            selectedLogService = serviceId || selectedLogService || defaultServiceId || null;
            const modal = document.getElementById('logs-modal');
            const serviceLabel = selectedLogService ? ` - ${selectedLogService}` : '';
            const titleText = document.getElementById('logs-title-text');

            if (titleText) {
                titleText.textContent = `${isManual ? '实时容器日志' : '服务重启日志'}${serviceLabel}`;
            }

            if (modal) modal.classList.add('active');
            reset();
            connectStream();
        }

        function reset() {
            const content = document.getElementById('logs-content');
            const searchInput = document.getElementById('logs-search-input');
            const levelFilter = document.getElementById('logs-level-filter');

            closeStream();
            startupDetected = false;
            logEntries = [];
            logBuffer = [];
            isFlushing = false;
            droppedBufferedLogs = 0;
            droppedStoredLogs = 0;
            logSeq = 0;
            isLogPaused = false;
            autoScrollLogs = true;
            currentLogSearch = '';
            currentLogLevel = 'all';
            pendingLogRerender = false;
            pendingLogMetaUpdate = false;

            if (content) {
                content.innerHTML = '';
                content.classList.toggle('wrap-mode', isWrapMode);
                bindScrollWatcher(content);
            }
            if (searchInput) searchInput.value = '';
            if (levelFilter) levelFilter.value = 'all';

            updateControls();
            updateStatus('实时监听中...', 'live');
            updateMeta();
        }

        function close() {
            const modal = document.getElementById('logs-modal');
            if (modal) {
                modal.classList.remove('active');
                modal.classList.remove('fullscreen');
            }
            closeStream();
            logBuffer = [];
            droppedBufferedLogs = 0;
            isLogPaused = false;
            isLogFullscreen = false;
            updateControls();
        }

        function clear() {
            const content = document.getElementById('logs-content');
            if (content) content.innerHTML = '';
            logEntries = [];
            logBuffer = [];
            droppedBufferedLogs = 0;
            droppedStoredLogs = 0;
            logSeq = 0;
            updateMeta();
            updateStatus(logsEventSource ? '实时监听中...' : '日志已清空', logsEventSource ? 'live' : 'paused');
        }

        function closeStream() {
            if (logReconnectTimer) {
                clearTimeout(logReconnectTimer);
                logReconnectTimer = null;
            }
            if (logsEventSource) {
                logsEventSource.close();
                logsEventSource = null;
            }
        }

        function toggleWrap() {
            isWrapMode = !isWrapMode;
            const content = document.getElementById('logs-content');
            if (content) content.classList.toggle('wrap-mode', isWrapMode);
            updateControls();
        }

        function togglePause() {
            isLogPaused = !isLogPaused;
            updateControls();

            if (isLogPaused) {
                logBuffer = [];
                updateStatus('已暂停实时刷新', 'paused');
                updateMeta();
                return;
            }

            updateStatus('实时监听中...', 'live');
            renderFiltered();
        }

        function toggleFollow() {
            autoScrollLogs = !autoScrollLogs;
            updateControls();
            if (autoScrollLogs) scrollToBottom();
        }

        function toggleFullscreen() {
            const modal = document.getElementById('logs-modal');
            isLogFullscreen = !isLogFullscreen;
            if (modal) modal.classList.toggle('fullscreen', isLogFullscreen);
            updateControls();
            if (autoScrollLogs) requestAnimationFrame(scrollToBottom);
        }

        function search(value) {
            currentLogSearch = (value || '').trim().toLowerCase();
            updateControls();
            scheduleRerender();
        }

        function clearSearch() {
            const input = document.getElementById('logs-search-input');
            if (input) input.value = '';
            search('');
        }

        function setLevelFilter(value) {
            currentLogLevel = value || 'all';
            scheduleRerender();
        }

        async function copyVisible() {
            const visibleLogs = getFilteredEntries().slice(-MAX_LOG_LINES).map(entry => entry.message).join('\n');
            if (!visibleLogs) {
                notify('当前没有可复制的日志', 'info');
                return;
            }

            try {
                await navigator.clipboard.writeText(visibleLogs);
                notify(`已复制 ${visibleLogs.split('\n').length} 行日志`, 'success');
            } catch (e) {
                const textarea = document.createElement('textarea');
                textarea.value = visibleLogs;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
                notify('已复制当前日志', 'success');
            }
        }

        function connectStream() {
            closeStream();

            logsEventSource = new EventSource(getLogsUrl(selectedLogService));
            updateStatus('实时监听中...', 'live');

            logsEventSource.onmessage = (event) => {
                let data;
                try {
                    data = JSON.parse(event.data);
                } catch (e) {
                    data = { type: 'error', message: '[日志解析失败] ' + e.message };
                }
                handleData(data);
            };

            logsEventSource.onerror = () => {
                handleData({ type: 'error', message: '[连接错误] 实时日志连接中断，3 秒后尝试重连...' });
                updateStatus('连接中断，准备重连...', 'error');
                closeStream();
                logReconnectTimer = setTimeout(() => {
                    logReconnectTimer = null;
                    if (document.getElementById('logs-modal')?.classList.contains('active')) {
                        connectStream();
                    }
                }, 3000);
            };
        }

        function handleData(data) {
            const entry = normalizeEntry(data);
            storeEntry(entry);

            if (entry.type === 'close') {
                closeStream();
                updateStatus(`连接已关闭，退出代码: ${data.code ?? 0}`, 'paused');
            }

            if (entry.level === 'success' && !startupDetected) {
                startupDetected = true;
                updateStatus('启动成功', 'success');
                setTimeout(() => {
                    if (!isLogPaused && logsEventSource) updateStatus('实时监听中...', 'live');
                }, 5000);
            }

            if (!isLogPaused && entryMatchesFilters(entry)) {
                enqueueEntry(entry);
            } else {
                scheduleMetaUpdate();
            }
        }

        function normalizeEntry(data) {
            const fallbackMessage = data.type === 'close' ? `[连接已关闭，退出代码: ${data.code ?? 0}]` : '';
            const rawMessage = typeof data.message === 'string' ? data.message : String(data.message ?? fallbackMessage);
            let message = rawMessage;
            let truncated = false;

            if (message.length > MAX_MSG_LENGTH) {
                message = `${message.slice(0, MAX_MSG_LENGTH)} ... [已截断, 原文长度: ${rawMessage.length} chars]`;
                truncated = true;
            }

            return {
                id: ++logSeq,
                type: data.type || 'log',
                level: classifyLevel(data, message),
                message,
                truncated,
                rawLength: rawMessage.length
            };
        }

        function classifyLevel(data, message) {
            if (data.type === 'error') return 'error';
            if (data.type === 'warn') return 'warn';
            if (isSuccessMessage(message)) return 'success';

            const explicitLevel = getExplicitLevel(message);
            if (explicitLevel) {
                if (explicitLevel === 'ERROR' || explicitLevel === 'FATAL') return 'error';
                if (explicitLevel === 'WARN' || explicitLevel === 'WARNING') return 'warn';
                return 'info';
            }

            if (isStrongErrorMessage(message)) return 'error';
            if (message.includes('[日志过多]') || /\bWARNING\b|\bWARN\b/i.test(message)) return 'warn';
            return 'info';
        }

        function isSuccessMessage(message) {
            return message.includes('Started ThingsBoard')
                || message.includes('启动成功')
                || message.includes('Installation finished successfully');
        }

        function getExplicitLevel(message) {
            const normalized = message.replace(/^\S+\s+\|\s*/, '');
            const match = normalized.match(/\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b/i);
            return match ? match[1].toUpperCase() : '';
        }

        function isStrongErrorMessage(message) {
            return message.includes('[错误]')
                || /\bEXCEPTION IN THREAD\b/i.test(message)
                || /\bCAUSED BY:/i.test(message)
                || /\bTRACEBACK\b/i.test(message)
                || /\b[A-Z0-9_.]+EXCEPTION(?::|\s|$)/i.test(message);
        }

        function storeEntry(entry) {
            logEntries.push(entry);
            if (logEntries.length > MAX_LOG_STORE) {
                const dropCount = logEntries.length - MAX_LOG_STORE;
                logEntries.splice(0, dropCount);
                droppedStoredLogs += dropCount;
            }
        }

        function enqueueEntry(entry) {
            if (logBuffer.length >= MAX_BUFFERED_LOGS) {
                const dropCount = logBuffer.length - MAX_BUFFERED_LOGS + 1;
                logBuffer.splice(0, dropCount);
                droppedBufferedLogs += dropCount;
            }
            logBuffer.push(entry);
            requestFlush();
        }

        function requestFlush() {
            if (isFlushing || isLogPaused) return;
            isFlushing = true;
            requestAnimationFrame(flush);
        }

        function flush() {
            const content = document.getElementById('logs-content');

            if (!content || logBuffer.length === 0) {
                isFlushing = false;
                updateMeta();
                return;
            }

            const fragment = document.createDocumentFragment();
            const batch = logBuffer.splice(0, LOG_FLUSH_BATCH_SIZE);

            if (droppedBufferedLogs > 0) {
                fragment.appendChild(renderLine({
                    id: ++logSeq,
                    type: 'system',
                    level: 'warn',
                    message: `[日志过多] 已跳过 ${droppedBufferedLogs} 条待渲染日志，继续显示最新内容。`
                }));
                droppedBufferedLogs = 0;
            }

            batch.forEach(entry => fragment.appendChild(renderLine(entry)));
            content.appendChild(fragment);

            const excess = content.children.length - MAX_LOG_LINES;
            if (excess > 0) {
                const range = document.createRange();
                range.setStartBefore(content.firstChild);
                range.setEndAfter(content.children[excess - 1]);
                range.deleteContents();
                range.detach();
            }

            if (autoScrollLogs) scrollToBottom();

            isFlushing = false;
            updateMeta();

            if (logBuffer.length > 0) {
                requestFlush();
            }
        }

        function renderFiltered() {
            const content = document.getElementById('logs-content');
            if (!content) return;

            const fragment = document.createDocumentFragment();
            const entries = getFilteredEntries().slice(-MAX_LOG_LINES);
            content.innerHTML = '';
            entries.forEach(entry => fragment.appendChild(renderLine(entry)));
            content.appendChild(fragment);
            if (autoScrollLogs) scrollToBottom();
            updateMeta();
        }

        function scheduleRerender() {
            if (pendingLogRerender) return;
            pendingLogRerender = true;
            requestAnimationFrame(() => {
                pendingLogRerender = false;
                renderFiltered();
            });
        }

        function renderLine(entry) {
            const line = document.createElement('div');
            const levelClass = entry.type === 'system' || entry.type === 'close' ? 'system' : entry.level;
            line.className = `log-line ${levelClass || ''}`.trim();
            if (entry.truncated) line.title = '日志过长已截断';

            appendHighlightedMessage(line, entry.message);
            return line;
        }

        function appendHighlightedMessage(container, message) {
            if (!currentLogSearch) {
                container.textContent = message;
                return;
            }

            const lowerMessage = message.toLowerCase();
            let start = 0;
            let matchIndex = lowerMessage.indexOf(currentLogSearch, start);
            let matchCount = 0;

            while (matchIndex !== -1 && matchCount < 80) {
                if (matchIndex > start) {
                    container.appendChild(document.createTextNode(message.slice(start, matchIndex)));
                }
                const mark = document.createElement('mark');
                mark.className = 'log-match';
                mark.textContent = message.slice(matchIndex, matchIndex + currentLogSearch.length);
                container.appendChild(mark);
                start = matchIndex + currentLogSearch.length;
                matchIndex = lowerMessage.indexOf(currentLogSearch, start);
                matchCount += 1;
            }

            if (start < message.length) {
                container.appendChild(document.createTextNode(message.slice(start)));
            }
        }

        function getFilteredEntries() {
            return logEntries.filter(entry => entryMatchesFilters(entry));
        }

        function entryMatchesFilters(entry) {
            if (currentLogLevel !== 'all' && entry.level !== currentLogLevel) return false;
            if (currentLogSearch && !entry.message.toLowerCase().includes(currentLogSearch)) return false;
            return true;
        }

        function isNearBottom() {
            const content = document.getElementById('logs-content');
            if (!content) return true;
            return content.scrollHeight - content.scrollTop - content.clientHeight < 80;
        }

        function bindScrollWatcher(content) {
            if (!content || content.dataset.scrollWatcherBound === 'true') return;
            content.dataset.scrollWatcherBound = 'true';
            content.addEventListener('scroll', () => {
                if (isProgrammaticLogScroll) return;
                const shouldFollow = isNearBottom();
                if (autoScrollLogs !== shouldFollow) {
                    autoScrollLogs = shouldFollow;
                    updateControls();
                    scheduleMetaUpdate();
                }
            }, { passive: true });
        }

        function scrollToBottom() {
            const content = document.getElementById('logs-content');
            if (!content) return;
            isProgrammaticLogScroll = true;
            content.scrollTop = content.scrollHeight;
            requestAnimationFrame(() => {
                isProgrammaticLogScroll = false;
            });
        }

        function updateStatus(text, state = 'live') {
            const statusEl = document.getElementById('logs-status');
            if (!statusEl) return;
            statusEl.classList.remove('success', 'paused', 'error');
            if (state && state !== 'live') statusEl.classList.add(state);
            const span = statusEl.querySelector('span');
            if (span) span.textContent = text;
        }

        function updateControls() {
            const wrapBtn = document.getElementById('btn-wrap-toggle');
            const followBtn = document.getElementById('btn-log-follow');
            const pauseBtn = document.getElementById('btn-log-pause');
            const fullscreenBtn = document.getElementById('btn-log-fullscreen');
            const searchClear = document.getElementById('logs-search-clear');

            setToolButtonState(wrapBtn, isWrapMode, isWrapMode ? '换行' : '不换行');
            setToolButtonState(followBtn, autoScrollLogs, autoScrollLogs ? '跟随' : '不跟随');
            setToolButtonState(fullscreenBtn, isLogFullscreen, isLogFullscreen ? '退出全屏' : '全屏');
            setToolButtonState(pauseBtn, isLogPaused, isLogPaused ? '继续' : '暂停');
            if (pauseBtn) pauseBtn.classList.toggle('warn', isLogPaused);
            if (searchClear) searchClear.style.display = currentLogSearch ? 'inline-flex' : 'none';
        }

        function setToolButtonState(button, isActive, label) {
            if (!button) return;
            button.classList.toggle('active', isActive);
            const span = button.querySelector('span');
            if (span) span.textContent = label;
        }

        function updateMeta() {
            const meta = document.getElementById('logs-meta');
            if (!meta) return;
            const matched = getFilteredEntries().length;
            const visible = Math.min(matched, MAX_LOG_LINES);
            const totalReceived = logEntries.length + droppedStoredLogs;
            const parts = [`显示 ${visible}`, `匹配 ${matched}`, `已接收 ${totalReceived}`];
            if (droppedStoredLogs > 0) parts.push(`已归档丢弃 ${droppedStoredLogs}`);
            if (isLogPaused) parts.push('暂停中');
            if (!autoScrollLogs) parts.push('未跟随');
            meta.textContent = parts.join(' / ');
        }

        function scheduleMetaUpdate() {
            if (pendingLogMetaUpdate) return;
            pendingLogMetaUpdate = true;
            requestAnimationFrame(() => {
                pendingLogMetaUpdate = false;
                updateMeta();
            });
        }

        return {
            show,
            close,
            clear,
            closeStream,
            toggleWrap,
            togglePause,
            toggleFollow,
            toggleFullscreen,
            search,
            clearSearch,
            setLevelFilter,
            copyVisible
        };
    }

    window.ConfigMateLogsUi = { createLogViewer };
})();
