let configMeta = {};

let configValues = {};
let deploymentInfo = null;
let latestServices = [];
let latestPlan = null;
let selectedServiceId = null;
let selectedServiceConfig = null;
let serviceConfigRequestSeq = 0;
let cleanupConfirmResolver = null;
let cleanupConfirmPlan = null;
let cleanupInFlightService = null;
let configScrollObserver = null;
let workbenchNavInitialized = false;
let activeWorkbenchPage = 'deployment-panel';
let activeConfigGroupId = null;
const ALL_CONFIG_GROUPS_ID = '__all_config_groups__';
let servicePollTimer = null;
let statusPollTimer = null;
let currentOperator = '';

// Dirty Check State
let initialConfigValues = {};
let initialSourceContent = null;
let isDirty = false;

// --- UI Helpers ---
const showToast = ConfigMateUi.showToast;
const customConfirm = ConfigMateUi.customConfirm;
const escapeHtml = ConfigMateUi.escapeHtml;
const openModal = ConfigMateUi.openModal;
const closeModal = ConfigMateUi.closeModal;

function resolveConfirm(result) {
    ConfigMateUi.resolveConfirm(result);
}

function stopPollingTimers() {
    if (statusPollTimer) {
        clearInterval(statusPollTimer);
        statusPollTimer = null;
    }
    if (servicePollTimer) {
        clearInterval(servicePollTimer);
        servicePollTimer = null;
    }
}

function getOperatorInitials(name) {
    const text = String(name || '').trim();
    if (!text) return '--';
    const clean = text.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');
    if (!clean) return text.slice(0, 2).toUpperCase();
    return clean.slice(0, 2).toUpperCase();
}

function updateAuthUI(operator = '') {
    currentOperator = operator || '';
    window.__CM__?.stateBridge.pushOperator(currentOperator);
    const userMenu = document.getElementById('user-menu');
    const operatorEl = document.getElementById('current-operator');
    const avatarEl = document.getElementById('user-avatar');
    const projectEl = document.getElementById('user-project');
    if (!userMenu || !operatorEl || !avatarEl) return;

    if (currentOperator) {
        operatorEl.textContent = currentOperator;
        avatarEl.textContent = getOperatorInitials(currentOperator);
        userMenu.style.display = 'flex';
    } else {
        operatorEl.textContent = '未登录';
        avatarEl.textContent = '--';
        userMenu.style.display = 'none';
    }
    if (projectEl) projectEl.textContent = buildUserProjectLabel();
}

function buildUserProjectLabel() {
    if (!deploymentInfo) return '';
    const appType = (deploymentInfo.appType || '').toUpperCase();
    const appService = deploymentInfo.appService || '';
    if (appService) return appType ? `${appType} · ${appService}` : appService;
    if (deploymentInfo.appDir) {
        const parts = deploymentInfo.appDir.replace(/\\/g, '/').split('/').filter(Boolean);
        return parts.slice(-1)[0] || '';
    }
    return '';
}

function showHeaderNotifs() {
    // Lightweight stand-in: surface a toast pointing at the runtime drift page.
    // Replace once a real notification stream exists.
    if (typeof showToast === 'function') {
        showToast('通知中心即将上线。当前可在「运行检查」中查看配置漂移。', 'info');
    }
    if (typeof navigateRoute === 'function') {
        // 不强制跳转，仅提示。
    }
}

function showLoginOverlay(message = '') {
    stopPollingTimers();
    updateAuthUI('');
    const overlay = document.getElementById('login-overlay');
    const operator = document.getElementById('login-operator');
    const password = document.getElementById('login-password');
    if (overlay) overlay.style.display = 'flex';
    if (operator && !operator.value) {
        operator.value = localStorage.getItem('configMateOperator') || '';
    }
    if (password) {
        password.value = '';
        (operator && !operator.value ? operator : password).focus();
    }
    if (message) {
        showToast(message, 'warning');
    }
}

ConfigMateApi.setUnauthorizedHandler(() => showLoginOverlay('登录已过期，请重新登录'));

async function boot() {
    try {
        const res = await ConfigMateApi.authStatus();
        const auth = await res.json();
        if (auth.required && !auth.authenticated) {
            updateAuthUI('');
            showLoginOverlay();
            return;
        }
        updateAuthUI(auth.operator || localStorage.getItem('configMateOperator') || 'operator');
        document.getElementById('login-overlay').style.display = 'none';
        await init();
    } catch (e) {
        showToast('启动失败：' + e.message, 'error');
    }
}

async function login(event) {
    event.preventDefault();
    const btn = document.getElementById('btn-login');
    const operator = document.getElementById('login-operator').value.trim();
    const password = document.getElementById('login-password').value;
    if (!operator) {
        showToast('请输入操作员名称', 'warning');
        document.getElementById('login-operator').focus();
        return;
    }
    btn.disabled = true;
    btn.textContent = '登录中...';
    try {
        const res = await ConfigMateApi.login({ operator, password });
        const data = await res.json();
        if (!res.ok || data.status !== 'success') {
            showToast(data.message || '登录失败', 'error');
            return;
        }
        localStorage.setItem('configMateOperator', operator);
        updateAuthUI(data.operator || operator);
        ConfigMateApi.resetAuthExpiredNotice();
        stopPollingTimers();
        document.getElementById('login-overlay').style.display = 'none';
        await init();
    } catch (e) {
        showToast('登录失败：' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '登录';
    }
}

async function logout() {
    if (isDirty) {
        const ok = await customConfirm('当前有未保存的修改，退出登录将丢失本次页面修改。确定退出吗？', '退出登录', 'var(--danger)');
        if (!ok) return;
    }
    try {
        await ConfigMateApi.logout();
    } catch (e) {
        // Even if the network request fails, clear local UI state and ask for login again.
    }
    localStorage.removeItem('configMateOperator');
    ConfigMateApi.resetAuthExpiredNotice();
    stopPollingTimers();
    updateAuthUI('');
    showLoginOverlay('已退出登录');
}

async function init() {
    try {
        stopPollingTimers();
        const res = await ConfigMateApi.config();
        if (res.status === 401) {
            showLoginOverlay();
            return;
        }
        const data = await res.json();
        configMeta = data.meta;
        configValues = data.values;
        window.__CM__?.stateBridge.pushConfigMeta(configMeta);
        window.__CM__?.stateBridge.pushConfigValues(configValues, { markClean: true });

        // Deep copy initial state
        initialConfigValues = JSON.parse(JSON.stringify(configValues));
        setDirty(false);

        renderAll();
        checkAllDependencies(); // Initial check
        await refreshDeployment();
        await checkInstallAvailability();
        initWorkbenchNavigation();
        // Default config-view = form (overview/source 通过 segmented 切换).
        if (typeof setConfigView === 'function') setConfigView(configView || 'form');

        // Start Polling Status
        checkStatus();
        if (!statusPollTimer) statusPollTimer = setInterval(checkStatus, 5000);
        if (!servicePollTimer) servicePollTimer = setInterval(refreshServices, 8000);
    } catch (e) { showToast('Init failed: ' + e.message, 'error'); }
}

/* Cloud Console mega-nav · route activation hook.
   Driven by ConfigMateRouter (assets/modules/router.js). Pages with a
   container live in the SPA shell; pages that haven't been migrated yet
   (logs / history / diff / install / overview) fall back to their legacy
   modal openers. */
function navigateRoute(key) {
    if (!window.ConfigMateRouter) return;
    /* Router.onChange (initWorkbenchNavigation) is the single source of
       truth for opening / closing modal-style routes; just point the hash. */
    ConfigMateRouter.navigate(key);
}

let lastRouteKey = null;

function handleRouteTransition(newKey) {
    if (lastRouteKey === newKey) return;

    /* Teardown previous route */
    if (lastRouteKey === 'logs') {
        try { typeof closeLogs === 'function' && closeLogs(); } catch (_) {}
    } else if (lastRouteKey === 'history') {
        try { typeof closeHistoryModal === 'function' && closeHistoryModal(); } catch (_) {}
    } else if (lastRouteKey === 'diff') {
        try { typeof closeRuntimeDiffModal === 'function' && closeRuntimeDiffModal(); } catch (_) {}
    } else if (lastRouteKey === 'install') {
        try { typeof closeInstallModal === 'function' && closeInstallModal(); } catch (_) {}
    }

    /* Setup the new route. Mount-functions talk to the underlying
       controllers directly so that we don't recurse back into navigateRoute. */
    if (newKey === 'logs') {
        mountLogsRoute();
    } else if (newKey === 'history') {
        if (typeof openHistoryModal === 'function') openHistoryModal();
    } else if (newKey === 'diff') {
        if (typeof checkRuntimeSync === 'function') checkRuntimeSync();
    } else if (newKey === 'install') {
        if (typeof checkInstallAndConfirm === 'function') checkInstallAndConfirm();
    } else if (newKey === 'overview') {
        refreshOverview(false);
    }

    lastRouteKey = newKey;
}

let overviewLastFetched = 0;
const OVERVIEW_TTL_MS = 30 * 1000;

async function refreshOverview(force) {
    if (!window.ConfigMateOverviewUi) return;
    if (!force && Date.now() - overviewLastFetched < OVERVIEW_TTL_MS) {
        ConfigMateOverviewUi.mount(buildOverviewSnapshot());
        return;
    }
    overviewLastFetched = Date.now();
    ConfigMateOverviewUi.mount(buildOverviewSnapshot()); // immediate render with cached state

    const [diskRes, driftRes, historyRes] = await Promise.allSettled([
        ConfigMateApi.diskUsage().then(r => r.json()).catch(() => null),
        ConfigMateApi.runtimeDiff().then(r => r.json()).catch(() => null),
        ConfigMateApi.history().then(r => r.json()).catch(() => null)
    ]);

    const disk = diskRes.status === 'fulfilled' ? (diskRes.value?.usage || diskRes.value) : null;
    const driftJson = driftRes.status === 'fulfilled' ? driftRes.value : null;
    const drift = driftJson ? {
        modifiedCount: Array.isArray(driftJson.diffs)
            ? driftJson.diffs.filter(d => d.state === 'MODIFIED').length
            : 0
    } : null;
    const historyJson = historyRes.status === 'fulfilled' ? historyRes.value : null;
    const history = Array.isArray(historyJson?.data) ? historyJson.data
        : Array.isArray(historyJson?.versions) ? historyJson.versions
        : Array.isArray(historyJson) ? historyJson : [];

    ConfigMateOverviewUi.mount(buildOverviewSnapshot({ disk, drift, history }));
}

function buildOverviewSnapshot(extra) {
    return Object.assign({
        services: latestServices || [],
        plan: latestPlan,
        deployment: deploymentInfo || null,
    }, extra || {});
}

function initWorkbenchNavigation() {
    if (!window.ConfigMateRouter) return;
    if (workbenchNavInitialized) return;
    workbenchNavInitialized = true;

    ConfigMateRouter.onChange(key => {
        activeWorkbenchPage = ConfigMateRouter.ROUTES[key]
            ? ConfigMateRouter.ROUTES[key].container.replace('#', '')
            : activeWorkbenchPage;
        const content = document.querySelector('.content');
        if (content) content.scrollTo({ top: 0, behavior: 'auto' });
        handleRouteTransition(key);
    });
    ConfigMateRouter.init();
}

function renderAll() {
    // Group keys
    const groups = {};
    Object.keys(configMeta).forEach(key => {
        const g = configMeta[key].group;
        if (!groups[g]) groups[g] = [];
        groups[g].push(key);
    });

    // Custom Sort Order
    const sortOrder = ['SQL 数据库', '核心设置', 'Edge 连接配置', '云边通信状态检查', '离线恢复策略', 'Edge 遥测分离', '核心存储', 'Cassandra', '缓存配置', '消息队列', 'MQTT 传输', '规则引擎脚本', '高级设置'];
    const groupNames = Object.keys(groups).sort((a, b) => {
        const idxA = sortOrder.indexOf(a);
        const idxB = sortOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    const visibleGroupNames = groupNames.filter(g =>
        groups[g].some(key => !configMeta[key].hidden)
    );

    const configNavList = document.getElementById('config-nav-list');
    const configNavCount = document.getElementById('config-nav-count');
    if (configNavCount) configNavCount.textContent = `${visibleGroupNames.length}/${groupNames.length}`;
    const visibleGroupIds = visibleGroupNames.map(groupDomId);
    const isAllConfigMode = activeConfigGroupId === ALL_CONFIG_GROUPS_ID;
    if (!activeConfigGroupId || (!isAllConfigMode && !visibleGroupIds.includes(activeConfigGroupId))) {
        activeConfigGroupId = visibleGroupIds[0] || null;
    }
    if (configNavList) {
        const totalVisibleFields = visibleGroupNames.reduce((total, g) =>
            total + groups[g].filter(key => !configMeta[key].hidden).length, 0);
        const allConfigItem = `
            <button class="config-nav-item config-nav-item-all ${activeConfigGroupId === ALL_CONFIG_GROUPS_ID ? 'active' : ''}"
                type="button" data-target="${ALL_CONFIG_GROUPS_ID}" onclick="showAllConfigGroups(this)"
                title="查看全部业务配置项">
                <span class="config-nav-name">全部配置</span>
                <span class="config-nav-item-count">${totalVisibleFields}</span>
            </button>
        `;
        const groupItems = visibleGroupNames.map((g) => {
            const groupId = groupDomId(g);
            const count = groups[g].filter(key => !configMeta[key].hidden).length;
            return `
                <button class="config-nav-item ${groupId === activeConfigGroupId ? 'active' : ''}" type="button"
                    data-target="${groupId}" onclick="scrollToConfigGroup('${groupId}', this)">
                    <span class="config-nav-name" title="${escapeHtml(g)}">${escapeHtml(g)}</span>
                    <span class="config-nav-item-count">${count}</span>
                </button>
            `;
        }).join('');
        configNavList.innerHTML = allConfigItem + groupItems;
        configNavList.onclick = (event) => {
            const item = event.target.closest('.config-nav-item');
            if (item && configNavList.contains(item)) {
                event.preventDefault();
                if (item.dataset.target === ALL_CONFIG_GROUPS_ID) {
                    showAllConfigGroups(item);
                } else {
                    scrollToConfigGroup(item.dataset.target, item);
                }
            }
        };
    }

    // Render Form
    const formContainer = document.getElementById('form-container');
    formContainer.classList.toggle('single-group-mode', activeConfigGroupId !== ALL_CONFIG_GROUPS_ID);
    formContainer.innerHTML = visibleGroupNames.map((g) => {
        const visibleKeys = groups[g].filter(key => !configMeta[key].hidden);
        const fieldsHtml = visibleKeys
            .map(key => renderField(key)).join('');

        if (!fieldsHtml) return '';
        const groupId = groupDomId(g);
        const isActiveGroup = activeConfigGroupId === ALL_CONFIG_GROUPS_ID || groupId === activeConfigGroupId;
        const groupStateClass = isActiveGroup ? 'active-group' : 'inactive-group';

        return `
            <div id="${groupId}" class="group-section ${groupStateClass}" data-group-name="${escapeHtml(g)}">
                <div class="group-header" onclick="toggleGroup(this.parentNode)">
                    <div class="group-title-block">
                        <div class="group-title">${escapeHtml(g)}</div>
                        <div class="group-subtitle">当前分组 ${visibleKeys.length} 个配置项</div>
                    </div>
                    <span class="group-field-count">${visibleKeys.length}</span>
                    <svg class="icon-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <div class="group-content">
                    ${fieldsHtml}
                </div>
            </div>
        `;
    }).join('');

    // Update Header Info
    const appType = configValues['APPTYPE'] || 'CLOUD';
    const badgeClass = appType === 'EDGE' ? 'badge-edge' : 'badge-cloud';
    const headerAppTypeEl = document.getElementById('header-app-type');
    if (headerAppTypeEl) headerAppTypeEl.innerHTML = `<span class="${badgeClass}">${appType} 模式</span>`;
    updateAppLayoutLabels();

    // Apply Key Highlights
    // (If any logic needed)

    // Enforce Edit Mode State
    setEditMode(isEditMode);
    initConfigScrollSpy();
    syncConfigTabs();
    refreshAllFieldModifiedFlags();
}

/* Mirror the legacy config-nav list into the cloud-style Segmented tabs
   above the form. The legacy list itself is hidden via CSS but kept in the
   DOM because app.js + initConfigScrollSpy still operate on it. */
function syncConfigTabs() {
    const tabs = document.getElementById('cm-config-tabs');
    const legacyList = document.getElementById('config-nav-list');
    if (!tabs || !legacyList) return;
    const items = Array.from(legacyList.querySelectorAll('.config-nav-item'));
    tabs.innerHTML = items.map(item => {
        const name = item.querySelector('.config-nav-name')?.textContent || item.dataset.target || '';
        const count = item.querySelector('.config-nav-item-count')?.textContent || '';
        const active = item.classList.contains('active') ? ' active' : '';
        const target = item.dataset.target || '';
        return `<button type="button" class="cm-segmented-item${active}" data-target="${escapeHtml(target)}" onclick="activateConfigTab(this)">${escapeHtml(name)}<span class="cm-segmented-count">${escapeHtml(count)}</span></button>`;
    }).join('');
}

function activateConfigTab(btn) {
    if (!btn) return;
    const target = btn.dataset.target;
    if (!target) return;
    document.querySelectorAll('#cm-config-tabs .cm-segmented-item').forEach(el => {
        el.classList.toggle('active', el === btn);
    });
    if (target === ALL_CONFIG_GROUPS_ID) {
        showAllConfigGroups(null);
    } else {
        scrollToConfigGroup(target, null);
    }
}

function markFieldModified(key) {
    const card = document.getElementById('card-' + key);
    if (!card) return;
    const modified = JSON.stringify(configValues[key] || '') !== JSON.stringify(initialConfigValues[key] || '');
    if (modified) {
        card.setAttribute('data-modified', 'true');
        card.classList.add('cm-cfg-field-modified');
    } else {
        card.setAttribute('data-modified', 'false');
        card.classList.remove('cm-cfg-field-modified');
    }
}

function refreshAllFieldModifiedFlags() {
    Object.keys(configMeta || {}).forEach(markFieldModified);
}

function groupDomId(groupName) {
    return `group-${encodeURIComponent(groupName).replace(/%/g, '_')}`;
}

function activateConfigGroup(groupId, button, options = {}) {
    if (groupId === ALL_CONFIG_GROUPS_ID) {
        activeConfigGroupId = ALL_CONFIG_GROUPS_ID;
        const formContainer = document.getElementById('form-container');
        if (formContainer) formContainer.classList.remove('single-group-mode');
        setActiveConfigNav(ALL_CONFIG_GROUPS_ID);
        document.querySelectorAll('.group-section').forEach(section => {
            section.classList.add('active-group');
            section.classList.remove('inactive-group', 'collapsed');
        });
        const toggleAllBtn = document.getElementById('btn-toggle-all');
        if (toggleAllBtn) toggleAllBtn.innerText = '折叠全部';
        isAllCollapsed = false;
        const scroller = document.querySelector('.config-detail-pane');
        if (scroller && options.scroll !== false) {
            scroller.scrollTop = 0;
        }
        initConfigScrollSpy();
        return;
    }

    const target = document.getElementById(groupId);
    if (!target || target.classList.contains('hidden')) return;

    activeConfigGroupId = groupId;
    const formContainer = document.getElementById('form-container');
    if (formContainer) formContainer.classList.add('single-group-mode');
    setActiveConfigNav(groupId);
    if (button) button.classList.add('active');
    document.querySelectorAll('.group-section').forEach(section => {
        const isActive = section.id === groupId;
        section.classList.toggle('active-group', isActive);
        section.classList.toggle('inactive-group', !isActive);
    });

    target.classList.remove('collapsed');
    const scroller = document.querySelector('.config-detail-pane');
    if (scroller && options.scroll !== false) {
        scroller.scrollTop = 0;
    }
    initConfigScrollSpy();
}

function scrollToConfigGroup(groupId, button) {
    activateConfigGroup(groupId, button, { scroll: true });
}

function showAllConfigGroups(button) {
    activateConfigGroup(ALL_CONFIG_GROUPS_ID, button, { scroll: true });
}

function updateConfigNavVisibility() {
    const items = Array.from(document.querySelectorAll('.config-nav-item'));
    const groupItems = items.filter(item => item.dataset.target !== ALL_CONFIG_GROUPS_ID);
    const allItem = items.find(item => item.dataset.target === ALL_CONFIG_GROUPS_ID);
    let visibleCount = 0;
    let visibleFieldCount = 0;
    groupItems.forEach((item) => {
        const target = document.getElementById(item.dataset.target || '');
        const visibleCards = target ? Array.from(target.querySelectorAll('.card'))
            .filter(card => !card.classList.contains('hidden') && !card.classList.contains('filtered-out')) : [];
        const isVisible = target && visibleCards.length > 0 && !target.classList.contains('hidden');
        item.classList.toggle('hidden', !isVisible);
        const countBadge = item.querySelector('.config-nav-item-count');
        if (countBadge) countBadge.textContent = String(visibleCards.length);
        if (isVisible) {
            visibleCount += 1;
            visibleFieldCount += visibleCards.length;
        }
        if (!isVisible) item.classList.remove('active');
    });
    if (allItem) {
        allItem.classList.toggle('hidden', visibleCount === 0);
        const allCountBadge = allItem.querySelector('.config-nav-item-count');
        if (allCountBadge) allCountBadge.textContent = String(visibleFieldCount);
    }
    if (activeConfigGroupId === ALL_CONFIG_GROUPS_ID && visibleCount > 0) {
        activateConfigGroup(ALL_CONFIG_GROUPS_ID, allItem, { scroll: false });
    } else {
        const currentVisible = groupItems.find(item =>
            item.dataset.target === activeConfigGroupId && !item.classList.contains('hidden')
        );
        const nextActive = currentVisible || groupItems.find(item => !item.classList.contains('hidden'));
        if (nextActive) {
            activateConfigGroup(nextActive.dataset.target, nextActive, { scroll: false });
        } else {
            activeConfigGroupId = null;
            document.querySelectorAll('.group-section').forEach(section => {
                section.classList.add('inactive-group');
                section.classList.remove('active-group');
            });
        }
    }
    const countEl = document.getElementById('config-nav-count');
    if (countEl) countEl.textContent = `${visibleCount}/${groupItems.length}`;
}

function initConfigScrollSpy() {
    if (configScrollObserver) {
        configScrollObserver.disconnect();
        configScrollObserver = null;
    }
    const formContainer = document.getElementById('form-container');
    if (formContainer && formContainer.classList.contains('single-group-mode')) return;
    if (activeConfigGroupId === ALL_CONFIG_GROUPS_ID) return;
    if (!('IntersectionObserver' in window)) return;

    const sections = Array.from(document.querySelectorAll('.group-section'));
    if (sections.length === 0) return;

    const scroller = document.querySelector('.config-detail-pane');
    const hasInternalScroll = scroller && scroller.scrollHeight > scroller.clientHeight;

    configScrollObserver = new IntersectionObserver((entries) => {
        const current = entries
            .filter(entry => entry.isIntersecting && !entry.target.classList.contains('hidden'))
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!current) return;
        setActiveConfigNav(current.target.id);
    }, {
        root: hasInternalScroll ? scroller : null,
        rootMargin: hasInternalScroll ? '0px 0px -68% 0px' : '-22% 0px -58% 0px',
        threshold: [0.05, 0.2, 0.45]
    });

    sections.forEach(section => configScrollObserver.observe(section));
}

function setActiveConfigNav(groupId) {
    activeConfigGroupId = groupId;
    document.querySelectorAll('.config-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.target === groupId && !item.classList.contains('hidden'));
    });
    document.querySelectorAll('#cm-config-tabs .cm-segmented-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.target === groupId);
    });
}

async function refreshDeployment() {
    await loadDeploymentInfo();
    await updateDeploymentPlan();
    await refreshServices();
}

async function loadDeploymentInfo() {
    const res = await ConfigMateApi.deployment();
    if (!res.ok) return;
    deploymentInfo = await res.json();
    window.__CM__?.stateBridge.pushDeployment(deploymentInfo);
    const metaEl = document.getElementById('deployment-meta');
    if (!metaEl) return;
    const dockerText = deploymentInfo.docker.available ? 'Docker 可用' : (deploymentInfo.docker.message || 'Docker 不可用');
    metaEl.innerHTML = `
        部署根目录：<span title="${escapeHtml(deploymentInfo.appRoot)}">${escapeHtml(shortPath(deploymentInfo.appRoot))}</span>
        <span class="meta-separator">/</span>
        业务配置：<span title="${escapeHtml(deploymentInfo.envPath)}">${escapeHtml(shortPath(deploymentInfo.envPath))}</span>
        <span class="meta-separator">/</span>
        ${escapeHtml(dockerText)}
    `;
    renderDeploymentDiagnostics(deploymentInfo.diagnostics);
    updateAppLayoutLabels();
    // Refresh user-project label now that deployment context is known.
    const projectEl = document.getElementById('user-project');
    if (projectEl) projectEl.textContent = buildUserProjectLabel();
}

function renderDeploymentDiagnostics(diagnostics) {
    const el = document.getElementById('deployment-diagnostics');
    if (!el) return;
    const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
    if (checks.length === 0) {
        el.textContent = '环境检查暂不可用';
        return;
    }
    const statusLabel = diagnostics.status === 'ok'
        ? '检查通过'
        : diagnostics.status === 'warning'
            ? '存在提醒'
            : '需要处理';
    el.innerHTML = `
        <div class="diagnostics-label">
            <span class="diagnostics-dot ${escapeHtml(diagnostics.status || 'unknown')}"></span>
            环境检查 · ${escapeHtml(statusLabel)}
        </div>
        <div class="diagnostics-list">
            ${checks.map(check => `
                <span class="diagnostic-chip ${escapeHtml(check.state || 'unknown')}" title="${escapeHtml(check.detail || check.target || '')}">
                    <span class="diagnostic-chip-dot"></span>
                    <span class="diagnostic-chip-text">
                        <span class="diagnostic-chip-label">${escapeHtml(check.label || check.id || '')}</span>
                        ${check.target ? `<span class="diagnostic-chip-target">${escapeHtml(check.target)}</span>` : ''}
                    </span>
                </span>
            `).join('')}
        </div>
    `;
}

function getAppDisplayName() {
    const appType = (deploymentInfo?.appType || configValues?.APPTYPE || 'CLOUD').toUpperCase();
    return appType === 'EDGE' ? 'IoT Edge' : 'IoT Cloud';
}

function updateAppLayoutLabels() {
    const appType = (deploymentInfo?.appType || configValues?.APPTYPE || 'CLOUD').toUpperCase();
    const appService = deploymentInfo?.appService || (appType === 'EDGE' ? 'iotedge' : 'iotcloud');
    const appLabel = getAppDisplayName();
    const packageNameEl = document.getElementById('header-package-name');
    const workspaceTitleEl = document.getElementById('config-workspace-title');
    const workspaceMetaEl = document.getElementById('config-workspace-meta');
    const actionTitleEl = document.getElementById('action-title');
    const actionSubtitleEl = document.getElementById('action-subtitle');
    const sourcePanelMetaEl = document.getElementById('source-panel-meta');

    if (packageNameEl) {
        packageNameEl.textContent = `${appType} / ${appService}`;
        if (deploymentInfo?.appRoot) packageNameEl.title = deploymentInfo.appRoot;
    }
    if (workspaceTitleEl) workspaceTitleEl.textContent = `${appLabel} 业务配置`;
    if (workspaceMetaEl) {
        const envPath = deploymentInfo?.envPath ? shortPath(deploymentInfo.envPath) : `${appService}/.env`;
        workspaceMetaEl.textContent = `维护 ${envPath}；服务启停、日志和依赖状态在上方部署控制台中处理。`;
    }
    if (sourcePanelMetaEl) {
        const envPath = deploymentInfo?.envPath ? shortPath(deploymentInfo.envPath) : `${appService}/.env`;
        sourcePanelMetaEl.textContent = `当前文件：${envPath}。修改前请先开启编辑，保存按钮仍在页面底部。`;
    }
    if (actionTitleEl) actionTitleEl.textContent = `${appLabel} 配置动作`;
    if (actionSubtitleEl) actionSubtitleEl.textContent = '修改配置前先开启编辑；保存并重启只会处理当前业务服务，依赖服务请在部署控制台手动处理。';
}

function shortPath(value) {
    if (!value) return '';
    const parts = value.split('/');
    if (parts.length <= 4) return value;
    return '.../' + parts.slice(-3).join('/');
}

async function updateDeploymentPlan() {
    const summaryEl = document.getElementById('plan-summary');
    try {
        const res = await ConfigMateApi.plan(configValues);
        const json = await res.json();
        if (json.status !== 'success') {
            summaryEl.textContent = '依赖分析失败：' + (json.message || '未知错误');
            return;
        }
        latestPlan = json.plan;
        const warningHtml = (latestPlan.warnings || []).map(w => `<div class="overview-warning">${escapeHtml(w)}</div>`).join('');
        summaryEl.innerHTML = `
            <div class="overview-row">
                <div class="overview-label">
                    <span class="overview-dot"></span>
                    依赖状态
                </div>
                <div class="overview-items dependency-status-list">${renderDependencyStatusChips(latestPlan)}</div>
                ${warningHtml}
            </div>
        `;
        renderServices();
    } catch (e) {
        if (summaryEl) summaryEl.textContent = '依赖分析失败：' + e.message;
    }
}

function renderDependencyStatusChips(plan = {}) {
    return ConfigMateServicesUi.renderDependencyStatusChips(plan);
}

function getServiceDisplayNameById(id) {
    if (!id) return '';
    const planService = (latestPlan?.services || []).find(s => s.id === id);
    if (planService) return planService.label || planService.id;
    const service = (latestServices || []).find(s => s.id === id);
    return service ? (service.label || service.id) : id;
}

function getCurrentAppServiceId() {
    return deploymentInfo?.appService || ((deploymentInfo?.appType || configValues?.APPTYPE || 'CLOUD').toUpperCase() === 'EDGE' ? 'iotedge' : 'iotcloud');
}

function getMissingRequiredDependencies() {
    const appServiceId = getCurrentAppServiceId();
    const planStatuses = Array.isArray(latestPlan?.statuses) ? latestPlan.statuses : [];
    if (planStatuses.length > 0) {
        return planStatuses.filter(s => s.id !== appServiceId && !s.running);
    }

    const requiredIds = (latestPlan?.services || [])
        .map(s => s.id)
        .filter(id => id && id !== appServiceId);
    return requiredIds
        .map(id => latestServices.find(s => s.id === id) || { id, label: getServiceDisplayNameById(id), running: false, status: 'unknown' })
        .filter(s => !s.running);
}

function formatDependencyNames(dependencies) {
    return (dependencies || [])
        .map(dep => dep.label || getServiceDisplayNameById(dep.id) || dep.id)
        .filter(Boolean)
        .join('、');
}

async function showDependencyBlock(dependencies, actionText) {
    const names = formatDependencyNames(dependencies);
    const appName = getAppDisplayName();
    showToast(`请先启动依赖服务：${names}`, 'warning');
    await customConfirm(`
        <b>暂不能${escapeHtml(actionText)}</b><br><br>
        ${escapeHtml(appName)} 依赖服务尚未全部启动：<br>
        <b>${escapeHtml(names)}</b><br><br>
        请先在上方部署控制台启动这些服务，等待状态变为 <code>running</code> 后再继续操作。
    `, '知道了', '#F59E0B');
}

async function ensureRequiredDependenciesRunning(actionText) {
    await updateDeploymentPlan();
    const missingDependencies = getMissingRequiredDependencies();
    if (missingDependencies.length === 0) return true;
    await showDependencyBlock(missingDependencies, actionText);
    return false;
}

async function handleDependencyBlockedResponse(data, actionText) {
    if (data?.code !== 'DEPENDENCIES_NOT_RUNNING') return false;
    const dependencies = data.missingDependencies || (data.missingDependencyIds || []).map(id => ({
        id,
        label: getServiceDisplayNameById(id)
    }));
    await showDependencyBlock(dependencies, actionText);
    if (data.plan) {
        latestPlan = data.plan;
        renderServices();
    }
    return true;
}

function renderServiceStatus(status) {
    return ConfigMateServicesUi.renderServiceStatus(status);
}

function setHeaderStatus(state, label) {
    const badge = document.querySelector('.status-badge');
    if (!badge) return;
    badge.className = `status-badge ${state}`;
    badge.removeAttribute('style');
    badge.innerHTML = `<span class="status-dot"></span>${label}`;
}

async function refreshServices() {
    try {
        const res = await ConfigMateApi.services();
        const json = await res.json();
        if (json.status !== 'success') return;
        latestServices = json.services || [];
        window.__CM__?.stateBridge.pushServices(latestServices);
        renderServices();
    } catch (e) {
        console.error('Service refresh failed', e);
    }
}

function renderServices() {
    const grid = document.getElementById('service-grid');
    if (!grid || !latestServices) return;
    const countEl = document.getElementById('service-count');
    if (latestServices.length === 0) {
        if (countEl) {
            countEl.textContent = '--';
            countEl.title = '正在读取服务状态';
        }
        grid.innerHTML = '<div class="service-loading">正在读取服务状态...</div>';
        renderServiceConfigState('等待服务状态返回...');
        updateDeploymentTierCounts([]);
        return;
    }
    if (countEl) {
        const runningCount = latestServices.filter(s => s.running).length;
        countEl.textContent = `${runningCount}/${latestServices.length}`;
        countEl.title = `运行中 ${runningCount} 个，共 ${latestServices.length} 个服务`;
    }
    grid.innerHTML = ConfigMateServicesUi.renderServiceCards({
        services: latestServices,
        requiredIds: new Set((latestPlan?.services || []).map(s => s.id)),
        selectedServiceId,
        portsByService: deploymentPortsCache
    });
    ensureSelectedService();
    updateDeploymentTierCounts(latestServices);
    applyDeploymentFilters();
    renderDeploymentSummary();
    updateDeploymentBreadcrumb();
}

// Map of serviceId → comma-separated port digest (lazily filled when
// each service's compose config is fetched). Card metrics row reads from
// this cache instead of triggering N parallel fetches up-front.
const deploymentPortsCache = Object.create(null);

function updateDeploymentBreadcrumb() {
    const el = document.getElementById('deployment-breadcrumb-third');
    if (!el) return;
    const appType = deploymentInfo?.appType || configValues?.APPTYPE || 'Cloud';
    const total = (latestServices || []).length;
    const label = `${appType.charAt(0) + appType.slice(1).toLowerCase()} · ${total || '--'} 服务`;
    el.textContent = label;
}

async function restartAllServices() {
    if (!Array.isArray(latestServices) || latestServices.length === 0) {
        showToast('暂无服务可重启', 'info');
        return;
    }
    const candidates = latestServices.filter(s => s.running && !['missing', 'missing-image', 'unsupported', 'unknown'].includes(s.status));
    if (candidates.length === 0) {
        showToast('没有正在运行的服务可重启', 'info');
        return;
    }
    const ok = await customConfirm(`将依次重启 ${candidates.length} 个运行中服务：${candidates.map(s => s.id).join(' / ')}`, '全部重启', 'var(--danger)');
    if (!ok) return;
    for (const svc of candidates) {
        try {
            const res = await ConfigMateApi.serviceAction(svc.id, 'restart');
            const data = await res.json();
            if (data.status === 'success') {
                showToast(`重启 ${svc.id} 成功`, 'success');
            } else {
                showToast(`重启 ${svc.id} 失败：${data.message || data.output || '未知错误'}`, 'error');
            }
        } catch (e) {
            showToast(`重启 ${svc.id} 失败：${e.message}`, 'error');
        }
    }
    await refreshDeployment();
}

function updateDeploymentTierCounts(services) {
    const tiers = ['business', 'storage', 'cache', 'queue', 'monitor'];
    const counts = Object.fromEntries(tiers.map(t => [t, 0]));
    (services || []).forEach(s => {
        const tier = ConfigMateServicesUi.inferTier(s);
        if (counts[tier] != null) counts[tier] += 1;
    });
    const allEl = document.getElementById('deployment-tier-count-all');
    if (allEl) allEl.textContent = String((services || []).length);
    tiers.forEach(t => {
        const el = document.getElementById(`deployment-tier-count-${t}`);
        if (el) el.textContent = String(counts[t]);
    });
}

let deploymentActiveTier = 'all';
let deploymentSearchTerm = '';

function filterDeploymentTier(btn) {
    if (!btn) return;
    document.querySelectorAll('#deployment-tier-filter .cm-segmented-item').forEach(el => {
        el.classList.toggle('active', el === btn);
    });
    deploymentActiveTier = btn.dataset.tier || 'all';
    applyDeploymentFilters();
}

function filterDeploymentSearch(text) {
    deploymentSearchTerm = String(text || '').trim().toLowerCase();
    applyDeploymentFilters();
}

function applyDeploymentFilters() {
    const grid = document.getElementById('service-grid');
    if (!grid) return;
    const tier = deploymentActiveTier;
    const term = deploymentSearchTerm;
    grid.querySelectorAll('.service-card').forEach(card => {
        const cardTier = card.dataset.tier || 'business';
        const id = (card.dataset.serviceId || '').toLowerCase();
        const image = (card.querySelector('.cm-svc-image')?.textContent || '').toLowerCase();
        const tierOk = tier === 'all' || cardTier === tier;
        const termOk = !term || id.includes(term) || image.includes(term);
        card.classList.toggle('is-filtered', !(tierOk && termOk));
    });
}

function renderDeploymentSummary() {
    const el = document.getElementById('cm-deployment-summary');
    if (!el) return;
    const plan = latestPlan;
    if (!plan) {
        el.innerHTML = '';
        return;
    }
    const statuses = Array.isArray(plan.statuses) && plan.statuses.length
        ? plan.statuses
        : (plan.services || []);
    const chipsHtml = statuses.length === 0
        ? '<span class="cm-summary-chip unknown">无依赖</span>'
        : statuses.map(item => {
            const running = !!item.running;
            const status = item.status || (running ? 'running' : 'pending');
            const state = running ? 'ok' : (status === 'missing' || status === 'unknown' ? 'unknown' : 'pending');
            const label = item.label || item.id || 'service';
            return `<span class="cm-summary-chip ${state}" title="${escapeHtml(label)}：${escapeHtml(status)}">
                <span class="cm-summary-chip-dot"></span>${escapeHtml(label)}
            </span>`;
        }).join('');
    const warningsHtml = (plan.warnings || [])
        .map(w => `<div class="cm-summary-warning">${escapeHtml(w)}</div>`).join('');
    const meta = deploymentInfo
        ? `${escapeHtml(deploymentInfo.appType || '—')} · ${escapeHtml(deploymentInfo.appService || '—')} · ${escapeHtml(shortPath(deploymentInfo.appRoot || ''))}`
        : '正在识别部署环境...';
    el.innerHTML = `
        <div class="cm-summary-line">
            <span class="cm-summary-label">部署环境</span>
            <span class="cm-summary-meta">${meta}</span>
        </div>
        <div class="cm-summary-line">
            <span class="cm-summary-label">依赖服务</span>
            <span class="cm-summary-chips">${chipsHtml}</span>
        </div>
        ${warningsHtml}
    `;
}

function getDefaultSelectedServiceId() {
    if (!latestServices || latestServices.length === 0) return null;
    const appService = deploymentInfo?.appService;
    const requiredIds = (latestPlan?.services || []).map(s => s.id).filter(id => id !== appService);
    const required = latestServices.find(s => requiredIds.includes(s.id));
    if (required) return required.id;
    const nonApp = latestServices.find(s => s.id !== appService);
    return nonApp ? nonApp.id : latestServices[0].id;
}

function ensureSelectedService() {
    if (!latestServices || latestServices.length === 0) {
        renderServiceConfigState('暂无服务配置');
        return;
    }

    const exists = selectedServiceId && latestServices.some(s => s.id === selectedServiceId);
    if (!exists) {
        selectedServiceId = getDefaultSelectedServiceId();
        selectedServiceConfig = null;
    }

    if (selectedServiceId && (!selectedServiceConfig || selectedServiceConfig.service?.id !== selectedServiceId)) {
        loadServiceConfig(selectedServiceId);
    } else if (selectedServiceConfig) {
        renderServiceConfig(selectedServiceConfig);
    }
}

function selectService(serviceId) {
    if (!serviceId) return;
    if (selectedServiceId === serviceId) {
        if (selectedServiceConfig) renderServiceConfig(selectedServiceConfig);
        else loadServiceConfig(serviceId);
        return;
    }
    selectedServiceId = serviceId;
    selectedServiceConfig = null;
    window.__CM__?.stateBridge.pushSelectedService(serviceId, null);
    renderServices();
}

async function loadServiceConfig(serviceId) {
    const requestSeq = ++serviceConfigRequestSeq;
    renderServiceConfigState('正在读取 compose 配置...');
    try {
        const res = await ConfigMateApi.serviceConfig(serviceId);
        const data = await res.json();
        if (requestSeq !== serviceConfigRequestSeq) return;
        if (!res.ok || data.status !== 'success') {
            renderServiceConfigState(data.message || '服务配置读取失败', 'error');
            return;
        }
        selectedServiceConfig = data;
        renderServiceConfig(data);
    } catch (e) {
        if (requestSeq === serviceConfigRequestSeq) {
            renderServiceConfigState('服务配置读取失败：' + e.message, 'error');
        }
    }
}

function renderServiceConfigState(message, type = '') {
    const panel = document.getElementById('service-config-panel');
    if (!panel) return;
    panel.style.display = 'block';
    panel.innerHTML = `<div class="service-config-state ${type}">${escapeHtml(message)}</div>`;
}

function renderServiceConfig(data) {
    const panel = document.getElementById('service-config-panel');
    if (!panel) return;
    selectedServiceConfig = data;
    const serviceId = data.service?.id || selectedServiceId || '';
    const serviceStatus = (latestServices || []).find(s => s.id === serviceId);
    panel.style.display = 'block';
    panel.innerHTML = ConfigMateServicesUi.renderServiceConfig(data, {
        selectedServiceId,
        serviceStatus,
        cleanupInFlightService,
        dependencyServices: latestServices || [],
        appServiceId: deploymentInfo?.appService || ''
    });
    // Cache port digest used by service-card metric row.
    const portsText = ConfigMateServicesUi.summarizePorts(data.sections);
    if (serviceId) deploymentPortsCache[serviceId] = portsText;
    loadRecentLogsPreview(serviceId);
}

let recentLogsPreviewSource = null;
function loadRecentLogsPreview(serviceId) {
    const body = document.querySelector('#cm-detail-recent-logs .cm-detail-recent-logs-body');
    if (!body || !serviceId) return;
    // 上一个 preview 流先关掉,避免在快速切换服务时叠加事件回调.
    if (recentLogsPreviewSource) {
        try { recentLogsPreviewSource.close(); } catch (e) { /* noop */ }
        recentLogsPreviewSource = null;
    }
    body.dataset.state = 'loading';
    body.textContent = '正在读取最近日志...';
    const collected = [];
    let stopped = false;
    const finalize = (label) => {
        if (stopped) return;
        stopped = true;
        if (recentLogsPreviewSource) {
            try { recentLogsPreviewSource.close(); } catch (e) { /* noop */ }
            recentLogsPreviewSource = null;
        }
        if (collected.length === 0) {
            body.textContent = label || '暂无日志输出';
            body.dataset.state = 'empty';
            return;
        }
        body.innerHTML = collected.slice(-8).map(raw => {
            const level = /\bERROR\b|\bERR\b/i.test(raw) ? 'error'
                : /\bWARN\b/i.test(raw) ? 'warn'
                : /\bINFO\b/i.test(raw) ? 'info'
                : '';
            return `<div class="cm-detail-recent-log-line${level ? ' cm-detail-recent-log-' + level : ''}">${escapeHtml(raw)}</div>`;
        }).join('');
        body.dataset.state = 'loaded';
    };
    try {
        recentLogsPreviewSource = new EventSource(ConfigMateApi.logsUrl(serviceId));
        recentLogsPreviewSource.onmessage = (ev) => {
            if (ev?.data) collected.push(ev.data);
            if (collected.length >= 8) finalize();
        };
        recentLogsPreviewSource.onerror = () => finalize('日志流暂不可用');
        // 1.5s 内仍未收到则按已有数据收尾.
        setTimeout(() => finalize(), 1500);
    } catch (e) {
        body.textContent = '加载日志失败：' + e.message;
        body.dataset.state = 'error';
    }
}

function toggleServiceSecret(sectionIndex, itemIndex, btn) {
    ConfigMateServicesUi.toggleServiceSecretItem(selectedServiceConfig, sectionIndex, itemIndex, btn);
}

async function copyServiceConfigValue(sectionIndex, itemIndex) {
    const item = selectedServiceConfig?.sections?.[sectionIndex]?.items?.[itemIndex];
    const value = item?.value === undefined || item?.value === null ? '' : String(item.value);
    if (!item || !value) {
        showToast('当前配置值为空，无法复制', 'info');
        return;
    }
    await writeClipboardText(value, `已复制 ${item.key || '配置值'}`);
}

async function writeClipboardText(text, successMessage = '已复制') {
    await ConfigMateUi.copyText(text, successMessage);
}

function isCleanupSupportedService(serviceId) {
    return ConfigMateServicesUi.isCleanupSupportedService(serviceId);
}

function setCleanupModalText(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value || '--';
        el.title = value || '';
    }
}

function syncCleanupConfirmButton() {
    const input = document.getElementById('cleanup-confirm-input');
    const btn = document.getElementById('btn-cleanup-confirm');
    const serviceId = cleanupConfirmPlan?.service?.id || '';
    if (!input || !btn) return;
    btn.disabled = input.value.trim() !== serviceId || !!cleanupConfirmPlan?.appServiceRunning;
}

function confirmCleanup(plan) {
    cleanupConfirmPlan = plan;
    setCleanupModalText('cleanup-service-label', `${plan.service?.label || plan.service?.id || ''} (${plan.service?.id || ''})`);
    setCleanupModalText('cleanup-source-path', plan.dataPath || plan.dataDir || '');
    setCleanupModalText('cleanup-backup-root', plan.backupRoot || '');
    setCleanupModalText('cleanup-backup-dir', plan.backupDir || '');
    const serviceCode = document.getElementById('cleanup-confirm-service-code');
    if (serviceCode) serviceCode.textContent = plan.service?.id || '';

    const input = document.getElementById('cleanup-confirm-input');
    if (input) {
        input.value = '';
        input.placeholder = plan.service?.id || '';
    }

    const note = document.getElementById('cleanup-block-note');
    if (note) {
        if (plan.appServiceRunning) {
            note.style.display = 'block';
            note.textContent = `当前业务服务 ${plan.appService || 'iotcloud/iotedge'} 正在运行。请先停止业务服务，再执行数据清理。`;
        } else {
            note.style.display = 'none';
            note.textContent = '';
        }
    }

    syncCleanupConfirmButton();
    openModal('cleanup-modal');
    setTimeout(() => input?.focus(), 60);

    return new Promise(resolve => {
        cleanupConfirmResolver = resolve;
    });
}

function resolveCleanupConfirm(result) {
    closeModal('cleanup-modal', {
        delay: 180,
        afterClose: () => {
            const resolver = cleanupConfirmResolver;
            cleanupConfirmResolver = null;
            if (resolver) resolver(result);
        }
    });
}

async function cleanupService(serviceId) {
    if (!isCleanupSupportedService(serviceId)) return;
    try {
        const planRes = await ConfigMateApi.cleanupPlan(serviceId);
        const plan = await planRes.json();
        if (!planRes.ok || plan.status !== 'success') {
            showToast(plan.message || '清理计划读取失败', 'error');
            return;
        }

        const confirmed = await confirmCleanup(plan);
        if (!confirmed) return;

        cleanupInFlightService = serviceId;
        renderServices();
        if (selectedServiceId === serviceId && selectedServiceConfig) renderServiceConfig(selectedServiceConfig);
        const confirmServiceId = document.getElementById('cleanup-confirm-input')?.value.trim() || '';
        const res = await ConfigMateApi.cleanup(serviceId, confirmServiceId);
        const data = await res.json();
        if (data.status === 'success') {
            const extra = serviceId === 'postgres' ? '。PostgreSQL 已为空库，如需业务表结构，请手动执行初始化安装。' : '';
            showToast(`清理 ${getServiceDisplayNameById(serviceId)} 成功，备份目录：${data.backupDir}${extra}`, 'success');
            await refreshDeployment();
            if (selectedServiceId === serviceId) loadServiceConfig(serviceId);
        } else if (data.code === 'APP_SERVICE_RUNNING') {
            showToast(data.message || '请先停止业务服务再清理', 'warning');
        } else {
            showToast(`清理失败：\n${data.message || data.output || '未知错误'}`, 'error');
        }
    } catch (e) {
        showToast(`清理失败：${e.message}`, 'error');
    } finally {
        cleanupInFlightService = null;
        renderServices();
        if (selectedServiceId === serviceId && selectedServiceConfig) renderServiceConfig(selectedServiceConfig);
    }
}

async function startAllServices() {
    if (!Array.isArray(latestServices) || latestServices.length === 0) {
        showToast('暂无服务可启动', 'info');
        return;
    }
    const candidates = latestServices.filter(s => !s.running && !['missing', 'missing-image', 'unsupported', 'unknown'].includes(s.status));
    if (candidates.length === 0) {
        showToast('全部服务都已在运行中', 'info');
        return;
    }
    const ok = await customConfirm(`将依次启动 ${candidates.length} 个未运行服务：${candidates.map(s => s.id).join(' / ')}`, '启动全部', 'var(--primary)');
    if (!ok) return;
    for (const svc of candidates) {
        try {
            const res = await ConfigMateApi.serviceAction(svc.id, 'up');
            const data = await res.json();
            if (data.status === 'success') {
                showToast(`启动 ${svc.id} 成功`, 'success');
            } else {
                showToast(`启动 ${svc.id} 失败：${data.message || data.output || '未知错误'}`, 'error');
            }
        } catch (e) {
            showToast(`启动 ${svc.id} 失败：${e.message}`, 'error');
        }
    }
    await refreshDeployment();
}

async function serviceAction(serviceId, action) {
    const actionText = action === 'up' ? '启动' : (action === 'down' ? '停止' : '重启');
    if (serviceId === getCurrentAppServiceId() && (action === 'up' || action === 'restart')) {
        const ok = await ensureRequiredDependenciesRunning(`${actionText} ${getServiceDisplayNameById(serviceId)}`);
        if (!ok) return;
    }
    if (!await customConfirm(`确定要${actionText} ${serviceId} 吗？`, actionText, action === 'down' ? 'var(--danger)' : 'var(--primary)')) return;
    try {
        const res = await ConfigMateApi.serviceAction(serviceId, action);
        const data = await res.json();
        if (data.status === 'success') {
            showToast(`${actionText} ${serviceId} 成功`, 'success');
            await refreshDeployment();
        } else if (await handleDependencyBlockedResponse(data, `${actionText} ${getServiceDisplayNameById(serviceId)}`)) {
            return;
        } else {
            showToast(`${actionText}失败：\n${data.output || data.message || ''}`, 'error');
        }
    } catch (e) {
        showToast(`${actionText}失败：${e.message}`, 'error');
    }
}

function renderField(key) {
    const meta = configMeta[key];
    const val = configValues[key] || '';
    const reqClass = 'required'; // Force all fields to be visually required per user request
    const safeKey = escapeHtml(key);
    const safeValue = escapeHtml(val);
    const safeLabel = escapeHtml(meta.label || key);
    const safeComment = escapeHtml(meta.comment || '');
    const initial = initialConfigValues[key];
    const isModified = initial !== undefined && String(initial || '') !== String(val);

    let inputHtml = '';
    if (meta.type === 'select') {
        inputHtml = `<select class="field-input" onchange="updateValue('${key}', this.value)">
            ${meta.options.map(o => `<option value="${escapeHtml(o)}" ${val === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
        </select>`;
    } else if (meta.type === 'password') {
        inputHtml = `
        <div class="password-wrapper">
            <input type="password" id="input-${key}" class="field-input field-input-secret" value="${safeValue}" onchange="updateValue('${key}', this.value)">
            <button class="toggle-btn" tabindex="-1" onclick="togglePassword('input-${key}', this)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </button>
        </div>`;
    } else if (meta.type === 'readonly') {
        inputHtml = `<input type="text" class="field-input field-input-readonly" value="${safeValue}" disabled>`;
    } else {
        const minAttr = meta.min !== undefined ? `min="${meta.min}"` : '';
        const maxAttr = meta.max !== undefined ? `max="${meta.max}"` : '';
        inputHtml = `<input type="${meta.type || 'text'}" class="field-input" value="${safeValue}" ${minAttr} ${maxAttr}
            oninput="validateField('${key}', this)"
            onchange="updateValue('${key}', this.value)">`;
    }

    // Cloud Console 字段卡: 上下结构 (label+badge / input / key+hint).
    return `
    <div class="card config-field-card cm-cfg-field${isModified ? ' cm-cfg-field-modified' : ''}" id="card-${key}" data-key="${safeKey}" data-modified="${isModified ? 'true' : 'false'}">
        <div class="cm-cfg-field-head">
            <div class="cm-cfg-field-label-wrap">
                <span class="field-label ${reqClass}">${safeLabel}</span>
            </div>
            <span class="cm-cfg-field-mod-badge" aria-label="已修改">MODIFIED</span>
        </div>
        <div class="cm-cfg-field-input">
            ${inputHtml}
            <div class="field-error" id="error-${key}"></div>
        </div>
        <div class="cm-cfg-field-foot">
            <code class="var-code" title="${safeKey}">${safeKey}</code>
            <span class="field-desc" title="${safeComment}">${safeComment}</span>
        </div>
    </div>`;
}

function validateField(key, input) {
    const meta = configMeta[key];
    const val = parseFloat(input.value);
    const errorEl = document.getElementById('error-' + key);

    if (!errorEl) return;

    // Check for empty
    if (val === undefined || val === null || (typeof input.value === 'string' && input.value.trim() === '')) {
        errorEl.innerText = `${meta.label} 不能为空`;
        errorEl.style.display = 'block';
        input.classList.add('is-invalid');
        return;
    }

    if (meta.min !== undefined && val < meta.min) {
        errorEl.innerText = `值不能小于 ${meta.min}`;
        errorEl.style.display = 'block';
        input.classList.add('is-invalid');
    } else if (meta.max !== undefined && val > meta.max) {
        errorEl.innerText = `值不能大于 ${meta.max}`;
        errorEl.style.display = 'block';
        input.classList.add('is-invalid');
    } else {
        errorEl.style.display = 'none';
        input.classList.remove('is-invalid');
    }
}

function updateValue(key, val) {
    configValues[key] = val;

    // Apply Custom Business Logic
    applyBusinessLogic(key, val);

    checkAllDependencies(); // Re-evaluate whenever a value changes
    checkDirtyState();
    markFieldModified(key);
    updateDeploymentPlan();
}

function applyBusinessLogic(key, val) {
    // 1. If History Storage is Cassandra -> Latest Storage MUST be Cassandra
    if (key === 'DATABASE_TS_TYPE' && val === 'cassandra') {
        updateFieldProgrammatically('DATABASE_TS_LATEST_TYPE', 'cassandra');
    }

    // 2. If Latest Storage is Redis -> Cache=Redis, Conn=Standalone
    if (key === 'DATABASE_TS_LATEST_TYPE' && val === 'redis') {
        updateFieldProgrammatically('CACHE_TYPE', 'redis');
        updateFieldProgrammatically('REDIS_CONNECTION_TYPE', 'standalone');
    }

    // 3. If Latest Storage is Redis Cluster -> Cache=Redis, Conn=Cluster
    if (key === 'DATABASE_TS_LATEST_TYPE' && val === 'redis-cluster') {
        updateFieldProgrammatically('CACHE_TYPE', 'redis');
        updateFieldProgrammatically('REDIS_CONNECTION_TYPE', 'cluster');
    }

    // 4. Constraint: If TS Latest is Redis/RedisCluster, CACHE_TYPE CANNOT be caffeine
    if (key === 'CACHE_TYPE' && val === 'caffeine') {
        const tsLatest = configValues['DATABASE_TS_LATEST_TYPE'];
        if (tsLatest === 'redis' || tsLatest === 'redis-cluster') {
            showToast('当最新数据存储为 Redis 时，必须使用 Redis 缓存', 'warning');
            updateFieldProgrammatically('CACHE_TYPE', 'redis');
        }
    }
}

function updateFieldProgrammatically(targetKey, targetVal) {
    // Update value in memory
    configValues[targetKey] = targetVal;

    // Update UI element if it exists
    const card = document.getElementById('card-' + targetKey);
    if (card) {
        const input = card.querySelector('.field-input');
        if (input) {
            input.value = targetVal;
        }
    }
}

function checkDirtyState() {
    if (isSourceMode) {
        const currentContent = document.getElementById('source-editor').value;
        setDirty(currentContent !== initialSourceContent);
    } else {
        // Simple deep comparison for UI mode
        const isChanged = JSON.stringify(configValues) !== JSON.stringify(initialConfigValues);
        setDirty(isChanged);
    }
}

function setDirty(dirty) {
    isDirty = dirty;
    const btnSaveOnly = document.getElementById('btn-save-only');
    const btnSaveApply = document.getElementById('btn-save-apply');

    if (btnSaveOnly) {
        if (isDirty) {
            btnSaveOnly.disabled = false;
            btnSaveOnly.textContent = "保存配置 *";
        } else {
            btnSaveOnly.disabled = true;
            btnSaveOnly.textContent = "仅保存配置";
        }
    }
    if (btnSaveApply) {
        btnSaveApply.disabled = !isDirty;
    }

    // Cloud Console 顶栏的 "仅保存" / "保存并重启"
    const cfgSaveOnly = document.getElementById('btn-cfg-save-only');
    const cfgSaveApply = document.getElementById('btn-cfg-save-apply');
    if (cfgSaveOnly) cfgSaveOnly.classList.toggle('is-hidden', !isDirty);
    if (cfgSaveApply) cfgSaveApply.classList.toggle('is-hidden', !isDirty);

    // 字段卡 modified 高亮 + 右侧 pending 面板
    if (typeof refreshAllFieldModifiedFlags === 'function') refreshAllFieldModifiedFlags();
    renderConfigPendingPanel();
}

function renderConfigPendingPanel() {
    const panel = document.getElementById('cm-config-pending-panel');
    const list = document.getElementById('cm-config-pending-list');
    const count = document.getElementById('cm-config-pending-count');
    if (!panel || !list) return;
    const diff = [];
    Object.keys(configMeta || {}).forEach(key => {
        const initial = initialConfigValues[key];
        const current = configValues[key];
        if (initial === undefined) return;
        if (String(initial || '') === String(current || '')) return;
        if (configMeta[key].hidden) return;
        diff.push({ key, group: configMeta[key].group || '其他', before: initial, after: current });
    });
    if (diff.length === 0) {
        panel.hidden = true;
        list.innerHTML = '';
        if (count) count.textContent = '0';
        return;
    }
    panel.hidden = false;
    if (count) count.textContent = String(diff.length);
    list.innerHTML = diff.map(d => `
        <li class="cm-cfg-pending-item">
            <div class="cm-cfg-pending-group">${escapeHtml(d.group)}</div>
            <code class="cm-cfg-pending-key">${escapeHtml(d.key)}</code>
            <div class="cm-cfg-pending-diff">
                <span class="cm-cfg-pending-before" title="${escapeHtml(d.before || '')}">${escapeHtml(d.before || '(空)')}</span>
                <span class="cm-cfg-pending-arrow">→</span>
                <span class="cm-cfg-pending-after" title="${escapeHtml(d.after || '')}">${escapeHtml(d.after || '(空)')}</span>
            </div>
        </li>`).join('');
}

let configView = 'form';
function setConfigView(mode) {
    if (mode !== 'overview' && mode !== 'form' && mode !== 'source') return;
    configView = mode;
    document.body.dataset.configView = mode;
    document.querySelectorAll('[data-config-view]').forEach(el => {
        const isActive = el.dataset.configView === mode;
        el.classList.toggle('active', isActive);
        if (isActive) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    if (mode === 'source') {
        if (!isSourceMode && typeof toggleSourceMode === 'function') toggleSourceMode();
    } else {
        if (isSourceMode && typeof toggleSourceMode === 'function') toggleSourceMode();
    }
    const chips = document.getElementById('cm-config-anchor-chips');
    if (mode === 'overview') {
        if (typeof showAllConfigGroups === 'function') showAllConfigGroups(null);
        syncConfigAnchorChips();
        if (chips) chips.hidden = false;
    } else {
        if (chips) chips.hidden = true;
    }
}

function syncConfigAnchorChips() {
    const host = document.getElementById('cm-config-anchor-chips');
    if (!host) return;
    const groups = Array.from(document.querySelectorAll('#form-container .group-section'));
    if (groups.length === 0) {
        host.innerHTML = '';
        return;
    }
    host.innerHTML = groups.map((g, idx) => {
        const name = g.dataset.groupName || g.querySelector('.group-title')?.textContent || `分组 ${idx + 1}`;
        const count = g.querySelectorAll('.cm-cfg-field').length;
        const modified = g.querySelectorAll('.cm-cfg-field-modified').length;
        return `<button class="cm-config-anchor-chip" type="button" onclick="document.getElementById('${g.id}').scrollIntoView({behavior:'smooth', block:'start'})">
            <span class="cm-config-anchor-idx">${String(idx + 1).padStart(2, '0')}</span>
            <span class="cm-config-anchor-name">${escapeHtml(name)}</span>
            <span class="cm-config-anchor-count">${count}</span>
            ${modified > 0 ? `<span class="cm-config-anchor-mod">${modified}</span>` : ''}
        </button>`;
    }).join('');
}

// Prevent accidental close
window.onbeforeunload = function (e) {
    if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
    }
};

function checkAllDependencies() {
    Object.keys(configMeta).forEach(key => {
        const meta = configMeta[key];
        const card = document.getElementById('card-' + key);

        if (!card) return; // Skip if element doesn't exist (e.g. hidden)
        if (!meta.dependsOn) {
            card.classList.remove('hidden');
            return;
        }

        // Evaluate Dependency
        const isMatch = evaluateDependency(meta.dependsOn);
        if (isMatch) {
            card.classList.remove('hidden');
        } else {
            card.classList.add('hidden');
        }
    });

    // Post-check: Hide empty groups
    document.querySelectorAll('.group-section').forEach(group => {
        const visibleCards = Array.from(group.querySelectorAll('.card'))
            .filter(card => !card.classList.contains('hidden') && !card.classList.contains('filtered-out'));

        if (visibleCards.length === 0) {
            group.classList.add('hidden');
        } else {
            group.classList.remove('hidden');
        }
    });

    updateConfigNavVisibility();
}

function evaluateDependency(rule) {
    // Rule structure: { key: "PARENT", value: "val" } OR { or: [...] } OR { and: [...] }
    if (rule.or) {
        return rule.or.some(subRule => evaluateDependency(subRule));
    }

    if (rule.and) {
        return rule.and.every(subRule => evaluateDependency(subRule));
    }

    const parentKey = rule.key; // Can be string or array
    const targetVal = rule.value;

    if (Array.isArray(parentKey)) {
        // If any parent matches targetVal
        return parentKey.some(pk => configValues[pk] === targetVal);
    } else {
        return configValues[parentKey] === targetVal;
    }
}

function togglePassword(id, btn) {
    const input = document.getElementById(id);
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
        btn.style.color = 'var(--primary)';
    } else {
        input.type = 'password';
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        btn.style.color = '';
    }
}

function toggleGroup(groupElement) {
    groupElement.classList.toggle('collapsed');
}

function filterConfig(query) {
    query = query.toLowerCase().trim();
    const cards = document.querySelectorAll('.card');

    cards.forEach(card => {
        // Should we filter matching dependsOn hidden items? 
        // Let's assume we filter ALL items, but visibility is ultimately decided by BOTH search and dependency.
        // But generally, search shouldn't reveal items hidden by business logic. 
        // So search only applies 'filtered-out' class, checkAllDependencies handles 'hidden'.

        const text = card.textContent.toLowerCase();
        const isMatch = text.includes(query);

        if (isMatch) {
            card.classList.remove('filtered-out');
            // Auto-expand group if searching
            if (query.length > 0) {
                const group = card.closest('.group-section');
                if (group && group.classList.contains('collapsed')) {
                    group.classList.remove('collapsed');
                }
            }
        } else {
            card.classList.add('filtered-out');
        }
    });

    // Re-run group visibility check to hide empty groups
    checkAllDependencies();
}

let isAllCollapsed = false;
function toggleAllGroups() {
    const btn = document.getElementById('btn-toggle-all');
    const groups = document.querySelectorAll('.group-section');

    if (isAllCollapsed) {
        // Expand All
        groups.forEach(g => g.classList.remove('collapsed'));
        btn.innerText = "折叠全部";
        isAllCollapsed = false;
    } else {
        // Collapse All
        groups.forEach(g => g.classList.add('collapsed'));
        btn.innerText = "展开全部";
        isAllCollapsed = true;
    }
}

// --- Source Mode ---
let isSourceMode = false;
let isSourceFullscreen = false;

async function toggleSourceMode() {
    const nextMode = !isSourceMode;
    const btn = document.getElementById('btn-source-mode');
    const searchInput = document.querySelector('.search-input');
    const toggleAllBtn = document.getElementById('btn-toggle-all');
    const formContainer = document.getElementById('form-container');
    const sourcePanel = document.getElementById('source-panel');
    const editor = document.getElementById('source-editor');

    // Check for unsaved changes before switching
    if (isDirty) {
        if (!await customConfirm('当前有未保存的修改，切换模式将丢失这些修改。是否继续？', '丢弃并切换', 'var(--danger)')) {
            return;
        }
    }

    if (nextMode) {
        try {
            const res = await ConfigMateApi.rawEnv();
            const text = await res.text();
            editor.value = text;
            initialSourceContent = text; // Set initial state
            setDirty(false);
            editor.oninput = checkDirtyState;
            isSourceMode = true;

            btn.innerText = "UI 模式";
            btn.classList.add('btn-active');

            if (searchInput) searchInput.disabled = true;
            if (toggleAllBtn) toggleAllBtn.style.display = 'none';
            if (formContainer) formContainer.style.display = 'none';
            if (sourcePanel) sourcePanel.classList.add('active');
            document.body.classList.add('source-mode-active');
        } catch (e) {
            showToast('Failed to load raw config: ' + e.message, 'error');
        }
    } else {
        isSourceMode = false;
        setSourceFullscreen(false);

        btn.innerText = "源码模式";
        btn.classList.remove('btn-active');

        if (searchInput) searchInput.disabled = false;
        if (toggleAllBtn) toggleAllBtn.style.display = 'block';
        if (formContainer) formContainer.style.display = 'block';
        if (sourcePanel) sourcePanel.classList.remove('active');
        document.body.classList.remove('source-mode-active');

        // Reload UI config to reflect any changes
        init();
    }
}

function toggleSourceFullscreen() {
    setSourceFullscreen(!isSourceFullscreen);
}

function setSourceFullscreen(enabled) {
    isSourceFullscreen = !!enabled;
    const sourcePanel = document.getElementById('source-panel');
    const btn = document.getElementById('btn-source-fullscreen');
    if (sourcePanel) sourcePanel.classList.toggle('fullscreen', isSourceFullscreen);
    if (btn) btn.innerText = isSourceFullscreen ? '退出全屏' : '全屏';
}

function validateConfig() {
    const errors = [];
    // Elements with .card.hidden are hidden by dependency logic
    // We should only validate visible cards

    Object.keys(configMeta).forEach(key => {
        const meta = configMeta[key];
        const card = document.getElementById('card-' + key);

        // Skip if card doesn't exist or is hidden by dependency/search
        if (!card || card.classList.contains('hidden') || card.classList.contains('filtered-out')) return;

        // Enforce required for all visible fields
        // Check for empty string, null, or undefined. 0 is valid for numbers.
        const val = configValues[key];
        if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
            errors.push(`${meta.label} (必填)`);
            highlightError(card);
            return; // Skip range check if empty
        }

        // Check min/max validation
        if (meta.type === 'number') {
            const val = parseFloat(configValues[key]);
            if (!isNaN(val)) {
                if (meta.min !== undefined && val < meta.min) {
                    errors.push(`${meta.label} (不能小于 ${meta.min})`);
                    highlightError(card);
                } else if (meta.max !== undefined && val > meta.max) {
                    errors.push(`${meta.label} (不能大于 ${meta.max})`);
                    highlightError(card);
                }
            }
        }
    });
    return errors;

    function highlightError(card) {
        const input = card.querySelector('.field-input');
        if (input) {
            input.classList.add('is-invalid');
            input.addEventListener('input', function () {
                this.classList.remove('is-invalid');
            }, { once: true });
        }
    }
    return errors;
}

async function saveConfig(silent = false) {
    // Validation step
    const errors = validateConfig();
    if (errors.length > 0) {
        showToast(`❌ 保存失败：配置校验未通过：\n${errors.join('\n')}`, 'error');
        return;
    }

    try {
        if (isSourceMode) {
            const rawContent = document.getElementById('source-editor').value;
            const res = await ConfigMateApi.saveRaw(rawContent);
            if (!res.ok) throw new Error(await res.text());
        } else {
            const res = await ConfigMateApi.saveConfig(configValues);
            if (!res.ok) throw new Error(await res.text());
            initialConfigValues = JSON.parse(JSON.stringify(configValues)); // Update initial state
        }

        if (!silent) {
            if (isSourceMode) {
                initialSourceContent = document.getElementById('source-editor').value;
            }
            setDirty(false);
            setEditMode(false);
            showToast('✅ 配置保存成功', 'success');
        }
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

async function saveAndApplyPlan() {
    const errors = validateConfig();
    if (errors.length > 0) {
        showToast(`❌ 应用失败：配置校验未通过：\n${errors.join('\n')}`, 'error');
        return;
    }

    const appServiceId = getCurrentAppServiceId();
    const appServiceName = getServiceDisplayNameById(appServiceId) || '当前业务服务';
    const dependenciesReady = await ensureRequiredDependenciesRunning(`保存并重启 ${appServiceName}`);
    if (!dependenciesReady) return;

    const missingDependencyNames = (latestPlan?.missingServices || [])
        .filter(id => id !== appServiceId)
        .map(getServiceDisplayNameById);
    const missingNote = missingDependencyNames.length
        ? `\n\n当前仍有依赖服务未运行：${missingDependencyNames.join('、')}。本操作不会自动启动它们。`
        : '';
    if (!await customConfirm(`将保存配置，并只重启：${appServiceName}。${missingNote}`, '保存并重启', '#00B894')) return;

    try {
        const res = await ConfigMateApi.applyPlan(configValues, true);
        const data = await res.json();
        if (data.status === 'success') {
            initialConfigValues = JSON.parse(JSON.stringify(configValues));
            setDirty(false);
            setEditMode(false);
            showToast(`✅ 配置已保存，已重启 ${getServiceDisplayNameById(data.restartedService || appServiceId)}`, 'success');
            await refreshDeployment();
            showLogs(true, deploymentInfo?.appService || null);
        } else if (await handleDependencyBlockedResponse(data, `保存并重启 ${appServiceName}`)) {
            return;
        } else {
            showToast('❌ 应用失败：\n' + (data.output || data.message || ''), 'error');
        }
    } catch (e) {
        showToast('❌ 应用失败：' + e.message, 'error');
    }
}

// Logs Viewer Functions
let logsController = null;

function getLogsController() {
    if (!logsController) {
        logsController = window.__CM__.components.logViewer.createLogViewer({
            logsUrl: serviceId => ConfigMateApi.logsUrl(serviceId),
            showToast
        });
    }
    return logsController;
}

let pendingLogsParams = null;

function showLogs(isManual = false, serviceId = null) {
    pendingLogsParams = { isManual, serviceId };
    if (window.ConfigMateRouter && ConfigMateRouter.hasContainer('logs')) {
        if (ConfigMateRouter.currentRoute() === 'logs') {
            mountLogsRoute();
            return;
        }
        ConfigMateRouter.navigate('logs');
        return;
    }
    /* Pre-router fallback (boot-time call before initWorkbenchNavigation). */
    mountLogsRoute();
}

function mountLogsRoute() {
    const params = pendingLogsParams || { isManual: true, serviceId: null };
    pendingLogsParams = null;
    const targetServiceId = params.serviceId || deploymentInfo?.appService || null;
    getLogsController().show({
        isManual: params.isManual,
        serviceId: params.serviceId,
        defaultServiceId: deploymentInfo?.appService || null
    });
    renderLogsSourceList(targetServiceId);
    updateLogsPageSubtitle(targetServiceId);
    resetLogsLevelDistribution();
    // 监听 #logs-content 变化以更新统计 (一次性绑定).
    ensureLogsLevelObserver();
}

function renderLogsSourceList(currentServiceId) {
    const list = document.getElementById('cm-logs-sources-list');
    const sub = document.getElementById('cm-logs-sources-sub');
    if (!list) return;
    const services = (latestServices || []);
    if (sub) sub.textContent = `${services.length} 个容器`;
    if (services.length === 0) {
        list.innerHTML = '<div class="cm-logs-empty">暂无服务可选</div>';
        return;
    }
    list.innerHTML = services.map(s => {
        const id = String(s.id || '');
        const idArg = JSON.stringify(id).replace(/"/g, '&quot;');
        const isActive = currentServiceId === id;
        const running = !!s.running;
        const image = s.image || s.composeService || s.label || '';
        return `<button type="button" class="cm-logs-source-item${isActive ? ' active' : ''}" data-service-id="${escapeHtml(id)}" onclick="showLogs(true, ${idArg})">
            <span class="cm-logs-source-running ${running ? 'on' : 'off'}"></span>
            <span class="cm-logs-source-meta">
                <span class="cm-logs-source-name">${escapeHtml(id)}</span>
                <span class="cm-logs-source-desc">${escapeHtml(image)}</span>
            </span>
        </button>`;
    }).join('');
}

function updateLogsPageSubtitle(serviceId) {
    const text = document.getElementById('logs-page-subtitle-text');
    if (!text) return;
    if (!serviceId) {
        text.textContent = '选择左侧服务源开始查看实时日志';
        return;
    }
    text.textContent = `${serviceId} · stdout`;
}

function resetLogsLevelDistribution() {
    ['error', 'warn', 'success', 'info'].forEach(lvl => {
        const el = document.getElementById('cm-logs-level-count-' + lvl);
        if (el) el.textContent = '0';
    });
}

let logsLevelObserverBound = false;
function ensureLogsLevelObserver() {
    if (logsLevelObserverBound) return;
    const content = document.getElementById('logs-content');
    if (!content) return;
    logsLevelObserverBound = true;
    const counts = { error: 0, warn: 0, success: 0, info: 0 };
    const writeCounts = () => {
        Object.entries(counts).forEach(([lvl, n]) => {
            const el = document.getElementById('cm-logs-level-count-' + lvl);
            if (el) el.textContent = String(n);
        });
    };
    const observer = new MutationObserver(records => {
        for (const r of records) {
            r.addedNodes.forEach(n => {
                if (!(n instanceof Element)) return;
                if (!n.classList || !n.classList.contains('log-line')) return;
                if (n.classList.contains('error')) counts.error += 1;
                else if (n.classList.contains('warn')) counts.warn += 1;
                else if (n.classList.contains('success')) counts.success += 1;
                else counts.info += 1;
            });
        }
        writeCounts();
    });
    observer.observe(content, { childList: true });
    // Reset hook when clearLogs sets innerHTML = ''.
    const resetObserver = new MutationObserver(records => {
        if (content.children.length === 0) {
            counts.error = counts.warn = counts.success = counts.info = 0;
            writeCounts();
        }
    });
    resetObserver.observe(content, { childList: true });
}

function closeLogs() {
    getLogsController().close();
}

function clearLogs() {
    getLogsController().clear();
}

function toggleLogWrap() {
    getLogsController().toggleWrap();
}

function toggleLogPause() {
    getLogsController().togglePause();
}

function toggleLogFollow() {
    getLogsController().toggleFollow();
}

function toggleLogFullscreen() {
    getLogsController().toggleFullscreen();
}

function handleLogSearch(value) {
    getLogsController().search(value);
}

function clearLogSearch() {
    getLogsController().clearSearch();
}

function setLogLevelFilter(value) {
    getLogsController().setLevelFilter(value);
}

async function copyVisibleLogs() {
    await getLogsController().copyVisible();
}

let isActionPending = false; // Global flag to prevent checkStatus updates during user actions

let hasShownMissingAlert = false;

function closeMissingAlertModal() {
    document.getElementById('missing-alert-modal').classList.remove('active');
}

async function checkStatus() {
    if (isActionPending) return; // Skip updates during user actions

    try {
        const res = await ConfigMateApi.status();
        const data = await res.json();
        console.log('[Debug] Status Check:', data.status);

        const badge = document.querySelector('.status-badge');
        const btnStop = document.getElementById('btn-stop');
        const btnRestart = document.getElementById('btn-restart-only');

        // Safety check if element exists
        if (!badge) return;

        const missingAlert = document.getElementById('docker-compose-missing-alert');
        // Check for missing files (array)
        if (data.missingFiles && data.missingFiles.length > 0) {
            if (missingAlert) missingAlert.style.display = 'block';

            // Show Modal only once
            if (!hasShownMissingAlert) {
                hasShownMissingAlert = true;
                const modal = document.getElementById('missing-alert-modal');
                const msgEl = modal.querySelector('.confirm-message');

                // Dynamic message
                const fileList = data.missingFiles.map(f => `<b>${escapeHtml(f)}</b>`).join(' 和 ');
                if (msgEl) {
                    msgEl.innerHTML = `
                        <div class="confirm-callout confirm-callout-danger">
                            当前目录缺失关键配置文件：<br>
                            ${fileList}
                        </div>
                        <div class="confirm-note-list">
                            <div>核心功能（如启动、停止服务）将 <b>不可用</b>。</div>
                            <div>但您仍可继续 <b>浏览或编辑</b> 历史配置与模板。</div>
                        </div>
                    `;
                }

                openModal(modal, '');
            }

            // Disable buttons
            if (btnStop) {
                btnStop.disabled = true;
                btnStop.style.opacity = '0.5';
                btnStop.style.cursor = 'not-allowed';
                btnStop.innerText = '停止服务';
            }
            if (btnRestart) {
                btnRestart.disabled = true;
                btnRestart.style.opacity = '0.5';
                btnRestart.style.cursor = 'not-allowed';
                btnRestart.innerText = "启动服务";
            }
            setHeaderStatus('unknown', 'Unknown');

            const btnLogs = document.getElementById('btn-header-logs');
            if (btnLogs) {
                btnLogs.disabled = true;
                btnLogs.style.opacity = '0.5';
                btnLogs.style.cursor = 'not-allowed';
                btnLogs.style.pointerEvents = 'none';
            }

            return;
        } else {
            if (missingAlert) missingAlert.style.display = 'none';
        }

        if (data.status === 'running') {
            setHeaderStatus('running', 'Running');

            // 运行中：显示停止和重启，隐藏启动
            if (btnStop) {
                btnStop.style.display = 'inline-block';
                btnStop.disabled = false;
                btnStop.style.opacity = '1';
                btnStop.style.cursor = 'pointer';
            }
            if (btnRestart) {
                btnRestart.style.display = 'inline-block';
                btnRestart.disabled = false;
                btnRestart.innerText = "重启服务";
                btnRestart.classList.remove('btn-success');
                btnRestart.classList.add('btn-warning');
                btnRestart.style.opacity = '1';
                btnRestart.style.cursor = 'pointer';
            }

            const btnLogs = document.getElementById('btn-header-logs');
            if (btnLogs) {
                btnLogs.disabled = false;
                btnLogs.style.opacity = '1';
                btnLogs.style.cursor = 'pointer';
                btnLogs.style.pointerEvents = 'auto';
            }
        } else {
            setHeaderStatus('stopped', 'Stopped');

            // 已停止：隐藏停止和重启，显示启动
            if (btnStop) {
                btnStop.style.display = 'none';
            }
            if (btnRestart) {
                btnRestart.style.display = 'inline-block';
                btnRestart.disabled = false;
                btnRestart.innerText = "启动服务";
                btnRestart.classList.remove('btn-warning');
                btnRestart.classList.add('btn-success');
                btnRestart.style.opacity = '1';
                btnRestart.style.cursor = 'pointer';
            }

            const btnLogs = document.getElementById('btn-header-logs');
            if (btnLogs) {
                btnLogs.disabled = false;
                btnLogs.style.opacity = '1';
                btnLogs.style.cursor = 'pointer';
                btnLogs.style.pointerEvents = 'auto';
            }
        }
    } catch (e) {
        console.error('Status check failed', e);
    }
}

boot();
async function stopService(event) {
    if (!await customConfirm('确认要停止服务吗？此操作将停止容器。', '停止服务', '#D63031')) return;

    const btn = event.target;
    const originalText = btn.innerText;
    btn.innerText = '停止中...';
    btn.disabled = true;
    isActionPending = true;

    try {
        const res = await ConfigMateApi.stopAppService();
        const data = await res.json();
        if (data.status === 'success') {
            showToast('✅ 服务已停止', 'success');
            checkStatus(); // Update badge
        } else {
            showToast('❌ 停止失败：\n' + data.output, 'error');
        }
    } catch (e) {
        showToast('❌ 请求失败：' + e.message, 'error');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
        isActionPending = false;
        setTimeout(checkStatus, 1000); // Resume polling
    }
}

async function restartServiceOnly(event) {
    const btn = event.target;
    const isStart = btn.innerText.includes('启动');
    const msg = isStart ? '确定要启动服务吗？' : '确定要重启服务吗？重启将重新加载最新的配置。';
    const title = isStart ? '启动服务' : '重启服务';
    const color = isStart ? '#2ecc71' : '#FDCB6E'; // Green for Start, Orange for Restart
    const dependencyAction = `${isStart ? '启动' : '重启'} ${getServiceDisplayNameById(getCurrentAppServiceId()) || getAppDisplayName()}`;

    if (!await ensureRequiredDependenciesRunning(dependencyAction)) return;

    if (!await customConfirm(msg, title, color)) return;


    const originalText = btn.innerText;
    btn.innerText = '重启中...';
    btn.disabled = true;
    isActionPending = true;

    try {
        // Clear logs before restart to show fresh status
        clearLogs();

        const res = await ConfigMateApi.restartAppService();
        const data = await res.json();

        if (data.status === 'success') {
            showLogs(true, deploymentInfo?.appService || null); // Open logs in manual mode to monitor
            checkStatus();
        } else if (await handleDependencyBlockedResponse(data, dependencyAction)) {
            return;
        } else {
            showToast('❌ 重启失败：\n' + data.output, 'error');
        }
    } catch (e) {
        showToast('❌ 请求失败：' + e.message, 'error');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
        isActionPending = false;
        setTimeout(checkStatus, 1000);
    }
}

async function restartService() {
    const dependencyAction = `重启 ${getServiceDisplayNameById(getCurrentAppServiceId()) || getAppDisplayName()}`;
    if (!await ensureRequiredDependenciesRunning(dependencyAction)) return;

    if (!await customConfirm('确定要重启服务以应用更改吗？', '重启服务', '#FDCB6E')) return;

    const btn = document.getElementById('btn-restart-from-diff');
    const originalText = btn ? btn.innerText : '立即重启服务';
    if (btn) {
        btn.innerText = '重启中...';
        btn.disabled = true;
    }
    isActionPending = true;

    try {
        // Clear logs before restart to show fresh status
        clearLogs();

        const res = await ConfigMateApi.restartAppService();
        const data = await res.json();

        if (data.status === 'success') {
            showLogs(true, deploymentInfo?.appService || null); // Open logs in manual mode to monitor
            checkStatus();
            // Close the modal upon successful restart initiation
            closeRuntimeDiffModal();
        } else if (await handleDependencyBlockedResponse(data, dependencyAction)) {
            return;
        } else {
            showToast('❌ 重启失败：\n' + data.output, 'error');
        }
    } catch (e) {
        showToast('❌ 请求失败：' + e.message, 'error');
    } finally {
        if (btn) {
            btn.innerText = originalText;
            btn.disabled = false;
        }
        isActionPending = false;
        setTimeout(checkStatus, 1000);
    }
}
// --- History Feature ---
let historyUi = null;

function getHistoryUi() {
    if (!historyUi) {
        historyUi = window.__CM__.components.historyViewer.createHistoryUi({
            api: ConfigMateApi,
            customConfirm,
            getEnvPath: () => ({
                full: deploymentInfo?.envPath || '.env',
                short: deploymentInfo?.envPath ? shortPath(deploymentInfo.envPath) : '.env'
            }),
            showToast,
            reload: () => location.reload()
        });
    }
    return historyUi;
}

function openHistoryModal() {
    getHistoryUi().open();
}

function closeHistoryModal() {
    getHistoryUi().close();
}

function handleHistoryAction(event) {
    getHistoryUi().handleAction(event);
}

function closeDiffModal() {
    getHistoryUi().closeDiff();
}

// Initialize Modal Listeners
window.addEventListener('DOMContentLoaded', () => {
    // 加载并显示版本号
    ConfigMateApi.version()
        .then(res => res.json())
        .then(data => {
            const versionBadge = document.getElementById('app-version');
            if (versionBadge && data.version) {
                versionBadge.textContent = 'v' + data.version;
            }
        })
        .catch(err => console.error('获取版本号失败:', err));

    const historyModal = document.getElementById('history-modal');
    const diffModal = document.getElementById('diff-modal');

    /* 
     * User requested to disable click-outside-to-close for History Modal
     * to prevent accidental closing.
    if (historyModal) {
        historyModal.addEventListener('click', (e) => {
            if (e.target === historyModal) closeHistoryModal();
        });
    }
    */

    if (diffModal) {
        diffModal.addEventListener('click', (e) => {
            if (e.target === diffModal) closeDiffModal();
        });
    }
});

// --- Global Edit Mode Logic ---
let isEditMode = false;

function setEditMode(enabled) {
    isEditMode = enabled;

    // 1. Toggle Button Visibility
    const btnEdit = document.getElementById('btn-edit');
    const btnCancel = document.getElementById('btn-cancel-edit');
    const btnSaveOnly = document.getElementById('btn-save-only');
    const btnSaveApply = document.getElementById('btn-save-apply');

    if (btnEdit) btnEdit.classList.toggle('is-hidden', enabled);
    if (btnCancel) btnCancel.classList.toggle('is-hidden', !enabled);
    if (btnSaveOnly) btnSaveOnly.classList.toggle('is-hidden', !enabled);
    if (btnSaveApply) btnSaveApply.classList.toggle('is-hidden', !enabled);

    // 2. Toggle Inputs State
    // Select all inputs, selects, textareas 
    // Note: source-editor is textarea but has specific id
    const inputs = document.querySelectorAll('#form-container input, #form-container select, #source-editor');
    inputs.forEach(el => el.disabled = !enabled);
}

async function cancelEdit() {
    if (isDirty) {
        if (!await customConfirm('当前有未保存的修改，取消将丢失这些修改并重置配置。确定吗？', '确认取消', 'var(--danger)')) return;
    }

    // Reset mode and reload
    isEditMode = false;
    // setEditMode(false) will be called by renderAll() inside init()
    await init();
}

// --- Installation Feature Logic ---

// Check if install file exists
// --- Runtime Config Diff Logic ---
async function checkRuntimeSync() {
    /* Legacy spinner target lived on a .btn-header that has been replaced
       by the cloud-style mega-nav action; this lookup may now return null. */
    const btn = document.querySelector('.btn-header[onclick="checkRuntimeSync()"]');
    const originalHtml = btn ? btn.innerHTML : '';

    try {
        if (btn) {
            btn.innerHTML = '<svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>';
            btn.disabled = true;
        }

        const res = await ConfigMateApi.runtimeDiff();
        const json = await res.json();

        console.log("Runtime Check Response:", json);
        if (json.status === 'success') {
            renderRuntimeDiff(json);
        } else if (json.status === 'not_running') {
            showToast('⚠️ 服务未运行，无法获取运行时配置', 'error');
        } else {
            showToast('❌ 检查失败: ' + json.message, 'error');
        }
    } catch (e) {
        console.error("Diff check failed", e);
        showToast('❌ 请求失败: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    }
}

function renderRuntimeDiff(data) {
    const modal = document.getElementById('runtime-diff-modal');
    const tbody = document.getElementById('runtime-diff-tbody');
    const statusDiv = document.getElementById('diff-status-bar');
    const banner = document.getElementById('cm-diff-banner');
    const loadingDiv = document.getElementById('runtime-diff-loading');
    const resultDiv = document.getElementById('runtime-diff-result');
    const restartBtn = document.getElementById('btn-restart-from-diff');

    openModal(modal);

    loadingDiv.classList.add('is-hidden');
    resultDiv.classList.remove('is-hidden');
    tbody.innerHTML = '';

    const diffs = data.diffs || [];
    const counts = { mod: 0, new: 0, deleted: 0 };
    diffs.forEach(d => {
        if (d.state === 'MODIFIED') counts.mod += 1;
        else if (d.state === 'NEW') counts.new += 1;
        else if (d.state === 'DELETED') counts.deleted += 1;
    });
    // 与 C 方案 4 KPI 对齐 (MATCH / MODIFIED / ONLY LOCAL / ONLY RUNTIME):
    // - MODIFIED 对应 state="MODIFIED"
    // - ONLY LOCAL = NEW (本地存在但运行时缺失)
    // - ONLY RUNTIME = DELETED (运行时仍存在但本地已删)
    const setKpi = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val);
    };
    // 真实"一致" count 未由后端返回, 这里用 0 占位; 横幅 + 表格已表达状态.
    setKpi('cm-diff-kpi-match', '—');
    setKpi('cm-diff-kpi-mod', counts.mod);
    setKpi('cm-diff-kpi-onlylocal', counts.new);
    setKpi('cm-diff-kpi-onlyruntime', counts.deleted);

    const needRestart = counts.mod > 0;
    const synced = diffs.length === 0;

    if (banner) {
        banner.className = 'cm-diff-banner';
        if (synced) {
            banner.classList.add('is-ok');
            banner.innerHTML = `
                <div class="cm-diff-banner-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <div class="cm-diff-banner-body">
                    <div class="cm-diff-banner-title">本地配置与运行时一致 · 无需操作</div>
                    <div class="cm-diff-banner-desc">所有比对项均已同步生效</div>
                </div>`;
        } else if (needRestart) {
            banner.classList.add('is-warn');
            banner.innerHTML = `
                <div class="cm-diff-banner-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                </div>
                <div class="cm-diff-banner-body">
                    <div class="cm-diff-banner-title">检测到运行时配置漂移 · 需要重启服务才能生效</div>
                    <div class="cm-diff-banner-desc">${counts.mod} 项已修改 · ${counts.new} 项仅本地 · ${counts.deleted} 项仅运行时</div>
                </div>`;
        } else {
            banner.classList.add('is-info');
            banner.innerHTML = `
                <div class="cm-diff-banner-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                </div>
                <div class="cm-diff-banner-body">
                    <div class="cm-diff-banner-title">${diffs.length} 个键存在差异 · 无需重启</div>
                    <div class="cm-diff-banner-desc">${counts.new} 项仅本地 · ${counts.deleted} 项仅运行时</div>
                </div>`;
        }
    }
    if (statusDiv) statusDiv.innerHTML = '';

    if (synced) {
        tbody.innerHTML = '<tr><td colspan="4" class="runtime-empty-cell">所有配置项均已同步生效。</td></tr>';
        if (restartBtn) restartBtn.style.display = 'none';
    } else {
        if (restartBtn) restartBtn.style.display = needRestart ? '' : 'none';
        tbody.innerHTML = diffs.map(diff => {
            let runtimeClass = '';
            let localClass = '';
            let stateTag = '';
            let rowState = 'mod';

            if (diff.state === 'MODIFIED') {
                runtimeClass = 'diff-val-del';
                localClass = 'diff-val-new';
                stateTag = '<span class="diff-tag diff-tag-mod">MODIFIED</span>';
                rowState = 'mod';
            } else if (diff.state === 'NEW') {
                runtimeClass = '';
                localClass = 'diff-val-new';
                stateTag = '<span class="diff-tag diff-tag-new">ONLY LOCAL</span>';
                rowState = 'missing_runtime';
            } else if (diff.state === 'DELETED') {
                runtimeClass = 'diff-val-del';
                localClass = '';
                stateTag = '<span class="diff-tag diff-tag-del">ONLY RUNTIME</span>';
                rowState = 'missing_local';
            }

            return `
                <tr data-state="${rowState}">
                    <td class="runtime-key-cell"><code>${escapeHtml(diff.key)}</code></td>
                    <td><span class="${runtimeClass}">${escapeHtml(diff.runtimeVal)}</span></td>
                    <td><span class="${localClass}">${escapeHtml(diff.localVal)}</span></td>
                    <td>${stateTag}</td>
                </tr>
            `;
        }).join('');
    }
}

function closeRuntimeDiffModal() {
    closeModal('runtime-diff-modal', {
        afterClose: () => {
            document.getElementById('runtime-diff-result').classList.add('is-hidden');
            document.getElementById('runtime-diff-loading').classList.remove('is-hidden');
        }
    });
}

const INSTALL_STEPS = ['cleanup', 'compose', 'schema', 'data', 'assets', 'finish'];
let installRunning = false;
let installStartedAt = 0;
let installTimer = null;
let installFollowLogs = true;
let installLogRemainder = '';
let installHadError = false;

async function checkInstallAvailability() {
    const btn = document.getElementById('btn-install-init');
    if (!btn) return;

    try {
        const res = await ConfigMateApi.checkInstall();
        if (res.status === 401) {
            btn.style.display = 'none';
            return;
        }
        const data = await res.json();
        btn.style.display = data.exists ? 'block' : 'none';
    } catch (e) {
        btn.style.display = 'none';
        console.error("Failed to check install availability", e);
    }
}

async function checkInstallAndConfirm() {
    const appName = getAppDisplayName();
    if (!await ensureRequiredDependenciesRunning(`初始化安装 ${appName}`)) return;

    const message = `
        <b>初始化安装确认</b><br><br>
        将执行 ${appName} 的 <code>docker-compose-install.yml</code> 初始化任务。<br>
        这个流程通常只在首次部署或需要补齐系统数据时执行；如果数据库已初始化，控制台会识别并按完成处理。<br><br>
        <b>执行期间请保持页面打开，并在日志窗口确认最终状态。</b>
    `;
    try {
        // customConfirm(message, btnText, btnColor)
        const confirmed = await customConfirm(message, "开始初始化", "#0F766E");
        if (confirmed) {
            startInstallService();
        }
    } catch (e) {
        console.error("Confirmation error", e);
    }
}

function closeInstallModal() {
    if (installRunning) {
        showToast('初始化仍在执行，完成后才能关闭窗口', 'info');
        return;
    }
    closeModal('install-modal', { display: '' });
}

async function startInstallService() {
    openModal('install-modal', '');
    resetInstallUi();
    setInstallState('running', '运行中');
    setInstallProgress(3, '准备启动安装任务', 'cleanup');
    startInstallTimer();
    appendInstallLine('[INFO] 初始化任务已创建，正在连接安装接口...', 'system');

    let alreadyInitialized = false;
    installRunning = true;
    installHadError = false;

    try {
        const response = await ConfigMateApi.install();
        if (!response.ok || !response.body) {
            const text = await response.text();
            try {
                const json = JSON.parse(text);
                if (await handleDependencyBlockedResponse(json, `初始化安装 ${getAppDisplayName()}`)) {
                    finishInstallUi('error', '已阻止', '依赖服务未启动，初始化安装没有执行。');
                    return;
                }
            } catch (parseError) {
                // Non-JSON response, fall through to generic error.
            }
            throw new Error(text || `安装接口返回异常：${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });

            // Check for specific "System Already Initialized" error signal
            if (chunk.includes("already present in database") || chunk.includes("sysadmin@thingsboard.org")) {
                alreadyInitialized = true;
            }

            appendInstallOutput(chunk);
            parseInstallProgress(chunk);
        }

        flushInstallLogRemainder();

        if (alreadyInitialized) {
            setInstallProgress(100, '系统已初始化，无需重复安装', 'finish', 'success');
            appendInstallLine('[TIP] 检测到系统数据已存在，初始化流程视为完成。', 'success');
            finishInstallUi('success', '已完成', '初始化数据已存在，本次流程已安全结束。');
        } else if (installHadError) {
            setInstallProgress(getCurrentInstallPercent(), '初始化失败，请查看错误日志', 'finish', 'error');
            finishInstallUi('error', '失败', '初始化流程未完成，请根据红色日志处理后重试。');
        } else {
            setInstallProgress(100, '初始化安装完成', 'finish', 'success');
            finishInstallUi('success', '已完成', '初始化流程已结束，可以关闭窗口。');
        }

    } catch (error) {
        console.error("Install Error", error);
        appendInstallLine(`[System Error] ${error.message}`, 'error');
        setInstallProgress(getCurrentInstallPercent(), '初始化请求失败', 'finish', 'error');
        finishInstallUi('error', '失败', '请求安装接口失败，请检查 Docker 与安装 compose 文件。');
    }
}

function resetInstallUi() {
    installLogRemainder = '';
    installFollowLogs = true;
    installHadError = false;

    const logsContainer = document.getElementById('install-logs');
    const closeBtn = document.getElementById('btn-close-install');
    const followBtn = document.getElementById('btn-install-follow');
    const subtitle = document.getElementById('install-subtitle');
    const composeLabel = document.getElementById('install-compose-label');
    const elapsedEl = document.getElementById('install-elapsed');
    const footerNote = document.getElementById('install-footer-note');
    const progressBar = document.getElementById('install-progress-bar');

    if (logsContainer) logsContainer.innerHTML = '';
    if (followBtn) followBtn.classList.add('active');
    if (elapsedEl) elapsedEl.textContent = '00:00';
    if (footerNote) footerNote.textContent = '初始化执行期间请保持页面打开；完成后可关闭窗口。';
    if (closeBtn) {
        closeBtn.disabled = true;
        closeBtn.textContent = '运行中';
        closeBtn.style.display = 'block';
    }
    if (subtitle) subtitle.textContent = `执行 ${getAppDisplayName()} 的安装初始化任务`;
    if (composeLabel) {
        const appService = deploymentInfo?.appService || ((deploymentInfo?.appType || configValues?.APPTYPE || 'CLOUD').toUpperCase() === 'EDGE' ? 'iotedge' : 'iotcloud');
        composeLabel.textContent = `${appService}/docker-compose-install.yml`;
        composeLabel.title = composeLabel.textContent;
    }
    if (progressBar) progressBar.classList.remove('error');
    setInstallState('idle', '准备就绪');
    setInstallProgress(0, '等待开始', 'cleanup');
    updateInstallSteps('', '');
}

function startInstallTimer() {
    stopInstallTimer();
    installStartedAt = Date.now();
    updateInstallElapsed();
    installTimer = setInterval(updateInstallElapsed, 1000);
}

function stopInstallTimer() {
    if (installTimer) {
        clearInterval(installTimer);
        installTimer = null;
    }
}

function updateInstallElapsed() {
    const elapsedEl = document.getElementById('install-elapsed');
    if (!elapsedEl || !installStartedAt) return;
    elapsedEl.textContent = formatInstallElapsed(Date.now() - installStartedAt);
}

function formatInstallElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function setInstallState(state, label) {
    const badge = document.getElementById('install-state-badge');
    if (!badge) return;
    badge.className = `install-state-badge ${state || ''}`.trim();
    badge.textContent = label || '准备就绪';
}

function finishInstallUi(state, badgeText, note) {
    installRunning = false;
    stopInstallTimer();
    setInstallState(state, badgeText);
    updateInstallSteps('finish', state === 'error' ? 'error' : 'success');

    const closeBtn = document.getElementById('btn-close-install');
    const footerNote = document.getElementById('install-footer-note');
    if (closeBtn) {
        closeBtn.disabled = false;
        closeBtn.textContent = '关闭';
    }
    if (footerNote) footerNote.textContent = note;
}

function setInstallProgress(pct, message, stepId, state = 'running') {
    const progressBar = document.getElementById('install-progress-bar');
    const statusText = document.getElementById('install-status-text');
    const percentText = document.getElementById('install-percent');
    const currentStage = document.getElementById('install-current-stage');
    const nextPct = Math.max(0, Math.min(100, Math.max(getCurrentInstallPercent(), pct || 0)));

    if (progressBar) {
        progressBar.style.width = `${nextPct}%`;
        progressBar.classList.toggle('error', state === 'error');
    }
    if (statusText) statusText.textContent = message;
    if (percentText) percentText.textContent = `${nextPct}%`;
    if (currentStage) currentStage.textContent = message;
    updateInstallSteps(stepId, state);
}

function getCurrentInstallPercent() {
    const percentText = document.getElementById('install-percent');
    const value = percentText ? parseInt(percentText.textContent, 10) : 0;
    return Number.isFinite(value) ? value : 0;
}

function updateInstallSteps(activeStep, state = 'running') {
    const activeIndex = INSTALL_STEPS.indexOf(activeStep);
    document.querySelectorAll('.install-step').forEach(step => {
        const stepId = step.dataset.step;
        const idx = INSTALL_STEPS.indexOf(stepId);
        step.classList.remove('active', 'done', 'error');
        if (activeIndex === -1) return;
        if (state === 'success') {
            step.classList.add('done');
        } else if (state === 'error') {
            if (idx < activeIndex) step.classList.add('done');
            else if (idx === activeIndex) step.classList.add('error');
        } else if (idx < activeIndex) {
            step.classList.add('done');
        } else if (idx === activeIndex) {
            step.classList.add('active');
        }
    });
}

function appendInstallOutput(text) {
    const combined = installLogRemainder + text;
    const lines = combined.split(/\r?\n/);
    installLogRemainder = lines.pop() || '';
    lines.forEach(line => appendInstallLine(line));
}

function flushInstallLogRemainder() {
    if (!installLogRemainder) return;
    appendInstallLine(installLogRemainder);
    installLogRemainder = '';
}

function appendInstallLine(line, forcedLevel = '') {
    const logsContainer = document.getElementById('install-logs');
    if (!logsContainer) return;
    const div = document.createElement('div');
    const level = forcedLevel || classifyInstallLogLine(line);
    if (level === 'error') installHadError = true;
    div.className = `install-log-line ${level}`;
    div.textContent = line || ' ';
    logsContainer.appendChild(div);

    const excess = logsContainer.children.length - 1200;
    if (excess > 0) {
        for (let i = 0; i < excess; i += 1) {
            logsContainer.firstChild?.remove();
        }
    }

    if (installFollowLogs) {
        logsContainer.scrollTop = logsContainer.scrollHeight;
    }
}

function classifyInstallLogLine(line) {
    const text = line || '';
    const explicit = getExplicitInstallLogLevel(text);
    if (explicit) {
        if (explicit === 'ERROR' || explicit === 'FATAL') return 'error';
        if (explicit === 'WARN' || explicit === 'WARNING') return 'warn';
        if (explicit === 'SUCCESS') return 'success';
        return 'info';
    }
    if (/Installation finished successfully|安装完成|already present in database|sysadmin@thingsboard\.org/i.test(text)) return 'success';
    if (/\b[A-Z0-9_.]+Exception\b|Exception in thread|Caused by:|Traceback|\bERROR\b|\[错误\]/i.test(text)) return 'error';
    if (/\bWARN(?:ING)?\b|\[日志过多\]/i.test(text)) return 'warn';
    return 'info';
}

function getExplicitInstallLogLevel(line) {
    const normalized = (line || '').replace(/^\S+\s+\|\s*/, '').trim();
    const bracket = normalized.match(/^\[(INFO|WARN|WARNING|ERROR|FATAL|SUCCESS|TIP)\]/i);
    if (bracket) return bracket[1].toUpperCase();
    const token = normalized.match(/\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b/i);
    return token ? token[1].toUpperCase() : '';
}

function toggleInstallFollow() {
    installFollowLogs = !installFollowLogs;
    const btn = document.getElementById('btn-install-follow');
    if (btn) btn.classList.toggle('active', installFollowLogs);
    if (installFollowLogs) {
        const logsContainer = document.getElementById('install-logs');
        if (logsContainer) logsContainer.scrollTop = logsContainer.scrollHeight;
    }
}

async function copyInstallLogs() {
    const logs = Array.from(document.querySelectorAll('#install-logs .install-log-line'))
        .map(line => line.textContent)
        .join('\n');
    if (!logs) {
        showToast('当前没有可复制的安装日志', 'info');
        return;
    }
    await ConfigMateUi.copyText(logs, '安装日志已复制');
}

function clearInstallLogs() {
    const logsContainer = document.getElementById('install-logs');
    if (logsContainer) logsContainer.innerHTML = '';
    installLogRemainder = '';
}

function parseInstallProgress(text) {
    const milestones = [
        { key: '正在执行清理', pct: 5, msg: '清理旧的安装任务', step: 'cleanup' },
        { key: '清理完成', pct: 12, msg: '清理完成，准备启动安装容器', step: 'cleanup' },
        { key: '正在启动安装', pct: 18, msg: '启动安装容器', step: 'compose' },
        { key: 'Installing DataBase schema for entities', pct: 35, msg: '安装实体数据库结构', step: 'schema' },
        { key: 'Installing DataBase schema for timeseries', pct: 48, msg: '安装时序数据库结构', step: 'schema' },
        { key: 'Loading system data', pct: 60, msg: '导入系统数据', step: 'data' },
        { key: 'Loading system widgets', pct: 72, msg: '加载系统部件库', step: 'assets' },
        { key: 'Loading system SCADA symbols', pct: 82, msg: '加载 SCADA 符号', step: 'assets' },
        { key: 'Loading system images', pct: 90, msg: '加载系统图片', step: 'assets' },
        { key: 'Installation finished successfully', pct: 100, msg: '初始化安装完成', step: 'finish', state: 'success' },
        { key: '[SUCCESS] 安装完成', pct: 100, msg: '初始化安装完成', step: 'finish', state: 'success' }
    ];

    if (text.includes('[ERROR]') || text.includes('安装初始化流程失败')) {
        installHadError = true;
        setInstallProgress(getCurrentInstallPercent(), '初始化失败，请查看错误日志', 'finish', 'error');
        return;
    }

    if (text.includes('already present in database') || text.includes('sysadmin@thingsboard.org')) {
        setInstallProgress(100, '系统已初始化，无需重复安装', 'finish', 'success');
        return;
    }

    for (const m of milestones) {
        if (text.includes(m.key)) {
            setInstallProgress(m.pct, m.msg, m.step, m.state || 'running');
            break;
        }
    }
}

// Initialize check
window.addEventListener('load', () => {
    // Run after existing init
    setTimeout(() => {
        checkInstallAvailability();
        checkEnvConfigValidation();
    }, 500);
});

// Startup Validation Check
async function checkEnvConfigValidation() {
    try {
        const res = await ConfigMateApi.validateCompose();
        const data = await res.json();

        const listEl = document.getElementById('validate-files-list');
        const modal = document.getElementById('validate-modal');
        const titleEl = document.getElementById('validate-modal-title');
        const msgEl = document.getElementById('validate-modal-msg');
        const closeBtn = document.getElementById('validate-modal-close');
        const actionBtn = document.getElementById('validate-modal-btn');
        const hintEl = document.getElementById('validate-modal-hint');

        if (data.status === 'missing') {
            // Scenario A: Missing Files -> Do NOTHING.
            // Let the existing 'missing-alert-modal' handle this case to avoid double alerts.
            return;
        } else if (data.status === 'config_missing') {
            // Scenario B: Missing ThingsBoard Config -> Blocking Error
            listEl.style.display = 'none';
            hintEl.style.display = 'none';

            titleEl.textContent = '关键配置缺失';

            msgEl.innerHTML = `
                <div class="confirm-callout confirm-callout-danger">
                    <div class="confirm-callout-title">未找到 ThingsBoard 配置文件：</div>
                    <div>请确保 <code>conf/thingsboard.yml</code></div>
                    <div>或 <code>conf/tb-edge.yml</code> 存在。</div>
                </div>
                <div class="confirm-note-list">
                    <div>本工具依赖配置文件来生成元数据。</div>
                    <div>请检查 <code>conf/</code> 目录是否完整。</div>
                    <div><b>工具将会暂停</b>，直到问题修复。</div>
                </div>
            `;

            closeBtn.style.display = 'none';

            actionBtn.textContent = '已修复，刷新页面重试 (Reload)';
            actionBtn.classList.remove('btn-ghost');
            actionBtn.classList.add('btn-confirm', 'btn-confirm-danger');
            actionBtn.style.backgroundColor = '';
            actionBtn.onclick = () => location.reload();

            openModal(modal);
            return;
        } else if (data.status === 'error' && data.errors.length > 0) {
            // Hide the raw list and hint, we will use msgEl for everything
            listEl.style.display = 'none';
            hintEl.style.display = 'none';

            // Build styled error list
            const errorItems = data.errors.map(err =>
                `<div><b>${ConfigMateUi.escapeHtml(err.file)}</b>: ${ConfigMateUi.escapeHtml(err.msg.replace('Missing env_file property', '未配置 env_file'))}</div>`
            ).join('');

            // Blocking Mode
            titleEl.textContent = '严重配置错误';

            msgEl.innerHTML = `
                <div class="confirm-callout confirm-callout-danger">
                    <div class="confirm-callout-title">检测到以下文件配置不正确：</div>
                    ${errorItems}
                </div>
                <div class="confirm-note-list">
                    <div>本工具依赖 <code>env_file</code> 配置来加载环境变量。</div>
                    <div>请在上述文件中添加 <code>env_file: [.env]</code> 配置项。</div>
                    <div>为了数据安全，<b>工具将暂停运行</b>，直到问题修复。</div>
                </div>
            `;

            // Hide close button
            closeBtn.style.display = 'none';

            // Change action button to Reload
            actionBtn.textContent = '已修复，刷新页面重试 (Reload)';
            actionBtn.classList.remove('btn-ghost');
            actionBtn.classList.add('btn-confirm', 'btn-confirm-danger');
            actionBtn.style.backgroundColor = '';
            actionBtn.onclick = () => location.reload();

            openModal(modal);
        }
    } catch (e) {
        console.error("Validation check failed", e);
    }
}

function closeValidateModal() {
    closeModal('validate-modal', { delay: 0 });
}
