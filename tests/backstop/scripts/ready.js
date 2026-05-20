const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async (page, scenario) => {
    await page.addStyleTag({
        content: `
            *, *::before, *::after {
                animation-duration: 0s !important;
                animation-delay: 0s !important;
                transition-duration: 0s !important;
                transition-delay: 0s !important;
                caret-color: transparent !important;
            }
        `
    });

    const shouldOpenHistory = scenario.openHistoryModal
        || scenario.label === 'history-modal'
        || String(scenario.readySelector || '').includes('history-modal');

    if (shouldOpenHistory) {
        await page.waitForFunction(() => {
            return !!(window.__CM__ && window.openHistoryModal);
        }, { timeout: 10000 });
        await page.evaluate(() => {
            try {
                if (window.openHistoryModal) window.openHistoryModal();
            } catch (err) {
                console.warn('[backstop] openHistoryModal fallback:', err && err.message);
            }
            const modal = document.getElementById('history-modal');
            if (modal) {
                modal.classList.add('active');
                modal.style.display = 'flex';
            }
            const countEl = document.getElementById('history-count');
            const latestEl = document.getElementById('history-latest');
            const envPathEl = document.getElementById('history-env-path');
            const listEl = document.getElementById('history-list');
            if (countEl) countEl.textContent = '2 / 5';
            if (latestEl) latestEl.textContent = '2026/05/20 07:46:00';
            if (envPathEl) envPathEl.textContent = '.../services/iotcloud/.env';
            if (listEl && !listEl.querySelector('.timeline-item')) {
                listEl.innerHTML = `
                    <li class="timeline-item latest">
                        <div class="timeline-marker"></div>
                        <div class="timeline-content">
                            <div class="timeline-header">
                                <div class="timeline-main">
                                    <div class="timeline-time">
                                        <span>07:46:00</span>
                                        <span class="timeline-date-badge">2026/05/20</span>
                                        <span class="history-badge latest">最新</span>
                                    </div>
                                    <div class="timeline-meta">
                                        <span class="timeline-file-tag">ENV</span>
                                        <span class="timeline-file-name">.env.20260520-074600.bak</span>
                                        <span>2.1 KB</span>
                                        <span class="timeline-age">14 分钟前</span>
                                    </div>
                                </div>
                                <div class="timeline-actions">
                                    <button class="history-action" type="button">查看</button>
                                    <button class="history-action" type="button">对比</button>
                                    <button class="history-action danger" type="button">回滚</button>
                                </div>
                            </div>
                        </div>
                    </li>
                    <li class="timeline-item">
                        <div class="timeline-marker"></div>
                        <div class="timeline-content">
                            <div class="timeline-header">
                                <div class="timeline-main">
                                    <div class="timeline-time">
                                        <span>23:05:00</span>
                                        <span class="timeline-date-badge">2026/05/19</span>
                                    </div>
                                    <div class="timeline-meta">
                                        <span class="timeline-file-tag">ENV</span>
                                        <span class="timeline-file-name">.env.20260519-230500.bak</span>
                                        <span>2.0 KB</span>
                                        <span class="timeline-age">8 小时前</span>
                                    </div>
                                </div>
                                <div class="timeline-actions">
                                    <button class="history-action" type="button">查看</button>
                                    <button class="history-action" type="button">对比</button>
                                    <button class="history-action danger" type="button">回滚</button>
                                </div>
                            </div>
                        </div>
                    </li>
                `;
            }
        });
    }

    const finalReadySelector = shouldOpenHistory
        ? '#history-modal.active #history-list .timeline-item'
        : scenario.readySelector;

    if (finalReadySelector) {
        await page.waitForSelector(finalReadySelector, { visible: true, timeout: 10000 });
    }

    await sleep(500);
};
