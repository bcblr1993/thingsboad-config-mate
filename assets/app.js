let configMeta = {};

let configValues = {};
let deploymentInfo = null;
let latestServices = [];
let latestPlan = null;
let selectedLogService = null;
let selectedServiceId = null;
let selectedServiceConfig = null;
let serviceConfigRequestSeq = 0;
let cleanupConfirmResolver = null;
let cleanupConfirmPlan = null;
let cleanupInFlightService = null;
let configScrollObserver = null;
let workbenchNavInitialized = false;
let workbenchNavFrame = null;
let workbenchNavPinnedTarget = null;
let workbenchNavPinnedTimer = null;
let activeConfigGroupId = null;
let servicePollTimer = null;
let statusPollTimer = null;
let currentOperator = '';

// Dirty Check State
let initialConfigValues = {};
let initialSourceContent = null;
let isDirty = false;

// --- UI Helpers ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = '';
    if (type === 'success') icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    else if (type === 'error') icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    else icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

    toast.innerHTML = `${icon}<div class="toast-content">${message.replace(/\n/g, '<br>')}</div>`;
    container.appendChild(toast);

    // Auto Remove
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
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
    const userMenu = document.getElementById('user-menu');
    const operatorEl = document.getElementById('current-operator');
    const avatarEl = document.getElementById('user-avatar');
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

let confirmResolver = null;
function customConfirm(message, confirmBtnText = '确定', confirmBtnColor = 'var(--primary)') {
    return new Promise((resolve) => {
        confirmResolver = resolve;
        // Support newline in message
        document.getElementById('confirm-message').innerHTML = message.replace(/\n/g, '<br>');
        const modal = document.getElementById('confirm-modal');
        const btnYes = document.getElementById('btn-confirm-yes');

        btnYes.innerText = confirmBtnText;

        // Keep color logic
        if (confirmBtnColor.startsWith('var') || confirmBtnColor.startsWith('#')) {
            btnYes.style.background = confirmBtnColor;
        } else {
            btnYes.style.background = confirmBtnColor;
        }

        // Force reflow
        modal.style.display = 'flex'; // Reset display property overwritten by close
        void modal.offsetWidth;
        modal.classList.add('active');
    });
}

function resolveConfirm(result) {
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        if (confirmResolver) {
            confirmResolver(result);
            confirmResolver = null;
        }
    }, 200);
}

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

        // Deep copy initial state
        initialConfigValues = JSON.parse(JSON.stringify(configValues));
        setDirty(false);

        renderAll();
        checkAllDependencies(); // Initial check
        await refreshDeployment();
        initWorkbenchNavigation();

        // Start Polling Status
        checkStatus();
        if (!statusPollTimer) statusPollTimer = setInterval(checkStatus, 5000);
        if (!servicePollTimer) servicePollTimer = setInterval(refreshServices, 8000);
    } catch (e) { showToast('Init failed: ' + e.message, 'error'); }
}

function setWorkbenchNavActive(targetId) {
    document.querySelectorAll('.workbench-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.workbenchTarget === targetId);
    });
}

function pinWorkbenchNav(targetId) {
    workbenchNavPinnedTarget = targetId;
    if (workbenchNavPinnedTimer) clearTimeout(workbenchNavPinnedTimer);
    workbenchNavPinnedTimer = setTimeout(() => {
        workbenchNavPinnedTarget = null;
    }, 1200);
}

function getSectionTopWithinContent(target, content) {
    let top = 0;
    let node = target;
    while (node && node !== content) {
        top += node.offsetTop || 0;
        node = node.offsetParent;
    }
    if (node === content) return top;

    const contentRect = content.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    return content.scrollTop + targetRect.top - contentRect.top;
}

function scrollToWorkbenchSection(event, targetId) {
    if (event) event.preventDefault();
    const target = document.getElementById(targetId);
    if (!target) return;
    setWorkbenchNavActive(targetId);
    pinWorkbenchNav(targetId);
    const content = document.querySelector('.content');
    if (content) {
        const nextTop = targetId === 'deployment-panel'
            ? 0
            : Math.max(0, target.offsetTop - content.offsetTop - 10);
        content.scrollTo({ top: nextTop, behavior: 'auto' });
    } else {
        target.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
    }
    history.replaceState(null, '', `#${targetId}`);
}

function initWorkbenchNavigation() {
    const content = document.querySelector('.content');
    const deployment = document.getElementById('deployment-panel');
    const config = document.getElementById('config-workspace');
    if (!content || !deployment || !config) return;

    const syncActive = () => {
        if (workbenchNavPinnedTarget) {
            setWorkbenchNavActive(workbenchNavPinnedTarget);
            return;
        }
        const contentTop = content.getBoundingClientRect().top;
        const configTop = config.getBoundingClientRect().top;
        setWorkbenchNavActive(configTop <= contentTop + 80 ? 'config-workspace' : 'deployment-panel');
    };

    if (!workbenchNavInitialized) {
        content.addEventListener('scroll', () => {
            if (workbenchNavFrame) cancelAnimationFrame(workbenchNavFrame);
            workbenchNavFrame = requestAnimationFrame(syncActive);
        }, { passive: true });
        window.addEventListener('resize', syncActive);
        workbenchNavInitialized = true;
    }

    const hashTarget = (location.hash || '').replace('#', '');
    if (hashTarget === 'deployment-panel' || hashTarget === 'config-workspace') {
        setTimeout(() => {
            const currentHashTarget = (location.hash || '').replace('#', '');
            if (currentHashTarget === hashTarget) {
                scrollToWorkbenchSection(null, hashTarget);
            }
        }, 80);
    } else {
        syncActive();
    }
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
    if (!activeConfigGroupId || !visibleGroupIds.includes(activeConfigGroupId)) {
        activeConfigGroupId = visibleGroupIds[0] || null;
    }
    if (configNavList) {
        configNavList.innerHTML = visibleGroupNames.map((g, index) => {
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
        configNavList.onclick = (event) => {
            const item = event.target.closest('.config-nav-item');
            if (item && configNavList.contains(item)) {
                event.preventDefault();
                scrollToConfigGroup(item.dataset.target, item);
            }
        };
    }

    // Render Form
    const formContainer = document.getElementById('form-container');
    formContainer.classList.add('single-group-mode');
    formContainer.innerHTML = visibleGroupNames.map((g) => {
        const fieldsHtml = groups[g]
            .filter(key => !configMeta[key].hidden)
            .map(key => renderField(key)).join('');

        if (!fieldsHtml) return '';
        const groupId = groupDomId(g);
        const groupStateClass = groupId === activeConfigGroupId ? 'active-group' : 'inactive-group';

        return `
            <div id="${groupId}" class="group-section ${groupStateClass}" data-group-name="${escapeHtml(g)}">
                <div class="group-header" onclick="toggleGroup(this.parentNode)">
                    <div class="group-title">${escapeHtml(g)}</div>
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
}

function groupDomId(groupName) {
    return `group-${encodeURIComponent(groupName).replace(/%/g, '_')}`;
}

function activateConfigGroup(groupId, button, options = {}) {
    const target = document.getElementById(groupId);
    if (!target || target.classList.contains('hidden')) return;

    activeConfigGroupId = groupId;
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
}

function scrollToConfigGroup(groupId, button) {
    activateConfigGroup(groupId, button, { scroll: true });
}

function updateConfigNavVisibility() {
    const items = Array.from(document.querySelectorAll('.config-nav-item'));
    let visibleCount = 0;
    items.forEach((item, index) => {
        const target = document.getElementById(item.dataset.target || '');
        const isVisible = target && !target.classList.contains('hidden');
        item.classList.toggle('hidden', !isVisible);
        if (isVisible) visibleCount += 1;
        if (!isVisible) item.classList.remove('active');
    });
    const currentVisible = items.find(item =>
        item.dataset.target === activeConfigGroupId && !item.classList.contains('hidden')
    );
    const nextActive = currentVisible || items.find(item => !item.classList.contains('hidden'));
    if (nextActive) {
        activateConfigGroup(nextActive.dataset.target, nextActive, { scroll: false });
    } else {
        activeConfigGroupId = null;
        document.querySelectorAll('.group-section').forEach(section => {
            section.classList.add('inactive-group');
            section.classList.remove('active-group');
        });
    }
    const countEl = document.getElementById('config-nav-count');
    if (countEl) countEl.textContent = `${visibleCount}/${items.length}`;
}

function initConfigScrollSpy() {
    if (configScrollObserver) {
        configScrollObserver.disconnect();
        configScrollObserver = null;
    }
    const formContainer = document.getElementById('form-container');
    if (formContainer && formContainer.classList.contains('single-group-mode')) return;
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
                <span class="diagnostic-chip ${escapeHtml(check.state || 'unknown')}" title="${escapeHtml(check.detail || '')}">
                    <span class="diagnostic-chip-dot"></span>
                    ${escapeHtml(check.label || check.id || '')}
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
    const statuses = Array.isArray(plan.statuses) && plan.statuses.length
        ? plan.statuses
        : (plan.services || []).map(service => ({
            ...service,
            running: !(plan.missingServices || []).includes(service.id),
            status: (plan.missingServices || []).includes(service.id) ? 'stopped' : 'running'
        }));
    if (!statuses.length) {
        return '<span class="dependency-status-chip empty">无依赖</span>';
    }
    return statuses.map(item => {
        const state = item.running ? 'running'
            : (['missing', 'unknown', 'missing-image', 'unsupported'].includes(item.status) ? 'unknown' : 'pending');
        const statusText = item.running ? '运行中' : (state === 'unknown' ? '异常' : '待启动');
        const label = item.label || item.id || 'service';
        return `
            <span class="dependency-status-chip ${state}" title="${escapeHtml(label)}：${escapeHtml(item.status || statusText)}">
                <span class="dependency-status-dot"></span>
                <span class="dependency-status-name">${escapeHtml(label)}</span>
            </span>
        `;
    }).join('');
}

function renderDependencyChips(items, type = '') {
    if (!items || items.length === 0) {
        return '<span class="dependency-chip empty">无</span>';
    }
    return items.map(item => `
        <span class="dependency-chip ${escapeHtml(type)}">${escapeHtml(item)}</span>
    `).join('');
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
    return `
        <span class="service-status ${escapeHtml(status || 'unknown')}">
            <span class="service-status-dot"></span>${escapeHtml(status || 'unknown')}
        </span>
    `;
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
        return;
    }
    if (countEl) {
        const runningCount = latestServices.filter(s => s.running).length;
        countEl.textContent = `${runningCount}/${latestServices.length}`;
        countEl.title = `运行中 ${runningCount} 个，共 ${latestServices.length} 个服务`;
    }
    const requiredIds = new Set((latestPlan?.services || []).map(s => s.id));
    grid.innerHTML = latestServices.map(s => {
        const required = requiredIds.has(s.id);
        const disabled = ['missing', 'unknown', 'missing-image', 'unsupported'].includes(s.status);
        const canStart = !disabled && !s.running;
        const canOperateRunning = !disabled && s.running;
        const messageHtml = s.message ? `<div class="service-message">${escapeHtml(s.message)}</div>` : '';
        const selected = selectedServiceId === s.id;
        return `
            <div class="service-card ${required ? 'required' : ''} ${selected ? 'selected' : ''}" data-service-id="${escapeHtml(s.id)}" onclick="selectService('${s.id}')">
                <div class="service-top">
                    <div class="service-name" title="${escapeHtml(s.label || s.id)}">${required ? '<span class="service-required-tag">*</span>' : ''}${escapeHtml(s.label || s.id)}</div>
                    <div class="service-state-row">
                        ${renderServiceStatus(s.status)}
                    </div>
                </div>
                ${messageHtml}
                <div class="service-actions">
                    <button onclick="event.stopPropagation(); serviceAction('${s.id}', 'up')" ${canStart ? '' : 'disabled'}>启动</button>
                    <button onclick="event.stopPropagation(); serviceAction('${s.id}', 'restart')" ${canOperateRunning ? '' : 'disabled'}>重启</button>
                    <button onclick="event.stopPropagation(); serviceAction('${s.id}', 'down')" ${canOperateRunning ? '' : 'disabled'}>停止</button>
                    <button onclick="event.stopPropagation(); showLogs(true, '${s.id}')" ${disabled ? 'disabled' : ''}>日志</button>
                </div>
            </div>
        `;
    }).join('');
    ensureSelectedService();
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
    const summary = data.summary || {};
    const serviceId = data.service?.id || selectedServiceId || '';
    const chips = [
        summary.image ? `镜像: ${summary.image}` : '',
        summary.containerName ? `容器: ${summary.containerName}` : '',
        summary.restart ? `重启: ${summary.restart}` : ''
    ].filter(Boolean);
    const serviceStatus = (latestServices || []).find(s => s.id === serviceId);
    const cleanupDisabled = !isCleanupSupportedService(serviceId)
        || ['missing', 'unknown', 'missing-image', 'unsupported'].includes(serviceStatus?.status)
        || !!cleanupInFlightService;
    const cleanupButton = isCleanupSupportedService(serviceId)
        ? `<button class="service-detail-cleanup-btn" type="button" onclick="cleanupService('${serviceId}')" ${cleanupDisabled ? 'disabled' : ''}>${cleanupInFlightService === serviceId ? '清理中' : '数据清理'}</button>`
        : '';

    panel.style.display = 'block';
    panel.innerHTML = `
        <div class="service-config-header">
            <div>
                <div class="service-config-title">服务配置：${escapeHtml(data.service?.label || data.service?.id || selectedServiceId || '')}</div>
                <div class="service-config-path">${escapeHtml(data.composePath || '')}</div>
            </div>
            <div class="service-config-summary">
                ${cleanupButton}
                ${chips.map(chip => `<span class="deployment-chip">${escapeHtml(chip)}</span>`).join('')}
            </div>
        </div>
        <div class="service-config-body">
            <div class="service-config-sections ${getServiceConfigSectionsClass(data.sections || [])}">
                ${(data.sections || []).map((section, sectionIndex) => renderServiceConfigSection(section, sectionIndex, serviceId)).join('')}
            </div>
        </div>
    `;
}

function getServiceConfigSectionsClass(sections) {
    const titles = new Set((sections || []).map(section => section.title || ''));
    return [
        titles.has('端口') ? 'has-port' : '',
        titles.has('其他') ? 'has-other' : ''
    ].filter(Boolean).join(' ');
}

function getServiceConfigSectionClass(sectionTitle, isWide) {
    const classes = ['service-config-section'];
    if (isWide) classes.push('wide');
    if (sectionTitle === '关键配置') classes.push('section-key');
    if (sectionTitle === '环境变量') classes.push('section-env');
    if (sectionTitle === '端口') classes.push('section-port');
    if (sectionTitle === '挂载') classes.push('section-volume');
    if (sectionTitle === '其他') classes.push('section-other');
    return classes.join(' ');
}

function renderServiceConfigSection(section, sectionIndex, serviceId = '') {
    const items = section.items || [];
    const sectionTitle = section.title || '配置';
    const isWide = sectionTitle === '环境变量' && items.length > 6;
    const rows = items.length
        ? items.map((item, itemIndex) => renderServiceConfigItem(item, sectionIndex, itemIndex, serviceId, sectionTitle)).join('')
        : '<tr><td colspan="2"><div class="service-config-empty">无配置</div></td></tr>';
    return `
        <div class="${getServiceConfigSectionClass(sectionTitle, isWide)}">
            <div class="service-config-section-title">${escapeHtml(sectionTitle)}</div>
            <table class="service-config-table"><tbody>${rows}</tbody></table>
        </div>
    `;
}

function renderServiceConfigItem(item, sectionIndex, itemIndex, serviceId = '', sectionTitle = '') {
    const key = item.key || '';
    const value = item.value === undefined || item.value === null ? '' : String(item.value);
    const displayValue = item.sensitive && value ? '******' : value;
    const toggle = item.sensitive && value
        ? `<button class="secret-toggle" type="button" title="显示" aria-label="显示 ${escapeHtml(key || '敏感配置')}" onclick="toggleServiceSecret(${sectionIndex}, ${itemIndex}, this)">${renderServiceSecretIcon(false)}</button>`
        : '';
    const copyButton = shouldShowServiceConfigCopy(item, serviceId, sectionTitle)
        ? `<button class="copy-config-value" type="button" title="复制 ${escapeHtml(key || '配置值')}" aria-label="复制 ${escapeHtml(key || '配置值')}" onclick="copyServiceConfigValue(${sectionIndex}, ${itemIndex})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>复制</span>
            </button>`
        : '';
    if (!key) {
        return `
        <tr>
            <td class="service-config-list-value" colspan="2">
                <div class="service-config-list-scroll" title="${escapeHtml(displayValue)}">${escapeHtml(displayValue)}</div>
            </td>
        </tr>
    `;
    }
    return `
        <tr>
            <td class="service-config-key" title="${key ? escapeHtml(key) : '-'}">${key ? escapeHtml(key) : '-'}</td>
            <td class="service-config-value">
                <div class="service-config-value-wrap">
                    <span class="service-config-value-text" title="${escapeHtml(displayValue)}">${escapeHtml(displayValue)}</span>${toggle}${copyButton}
                </div>
            </td>
        </tr>
    `;
}

function shouldShowServiceConfigCopy(item, serviceId = '', sectionTitle = '') {
    if (sectionTitle === '其他') return false;
    const currentServiceId = serviceId || selectedServiceConfig?.service?.id || selectedServiceId;
    const copyEnabledServices = new Set(['postgres', 'redis', 'kafka', 'cassandra', 'wechat']);
    const value = item?.value === undefined || item?.value === null ? '' : String(item.value);
    return copyEnabledServices.has(currentServiceId) && !!item?.key && value.length > 0 && value !== '无环境变量';
}

function renderServiceSecretIcon(isVisible) {
    if (isVisible) {
        return `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path>
                <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
        `;
    }
    return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
        </svg>
    `;
}

function toggleServiceSecret(sectionIndex, itemIndex, btn) {
    const item = selectedServiceConfig?.sections?.[sectionIndex]?.items?.[itemIndex];
    if (!item) return;
    const valueEl = btn?.parentElement?.querySelector('.service-config-value-text');
    if (!valueEl) return;
    const nextVisible = valueEl.textContent === '******';
    valueEl.textContent = nextVisible ? (item.value || '') : '******';
    valueEl.title = nextVisible ? (item.value || '') : '******';
    btn.innerHTML = renderServiceSecretIcon(nextVisible);
    const nextLabel = nextVisible ? '隐藏' : '显示';
    btn.title = nextLabel;
    btn.setAttribute('aria-label', `${nextLabel} ${item.key || '敏感配置'}`);
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
    try {
        await navigator.clipboard.writeText(text);
        showToast(successMessage, 'success');
    } catch (e) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        showToast(successMessage, 'success');
    }
}

function isCleanupSupportedService(serviceId) {
    return ['postgres', 'redis', 'kafka', 'cassandra'].includes(serviceId);
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
    const modal = document.getElementById('cleanup-modal');
    modal.style.display = 'flex';
    void modal.offsetWidth;
    modal.classList.add('active');
    setTimeout(() => input?.focus(), 60);

    return new Promise(resolve => {
        cleanupConfirmResolver = resolve;
    });
}

function resolveCleanupConfirm(result) {
    const modal = document.getElementById('cleanup-modal');
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        const resolver = cleanupConfirmResolver;
        cleanupConfirmResolver = null;
        if (resolver) resolver(result);
    }, 180);
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

    let inputHtml = '';
    if (meta.type === 'select') {
        inputHtml = `<select class="field-input" onchange="updateValue('${key}', this.value)">
            ${meta.options.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>`;
    } else if (meta.type === 'password') {
        inputHtml = `
        <div class="password-wrapper">
            <input type="password" id="input-${key}" class="field-input" value="${val}" onchange="updateValue('${key}', this.value)" style="padding-right: 35px;">
            <button class="toggle-btn" tabindex="-1" onclick="togglePassword('input-${key}', this)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </button>
        </div>`;
    } else if (meta.type === 'readonly') {
        inputHtml = `<input type="text" class="field-input" value="${val}" disabled style="background:#eee; cursor:not-allowed; color:#666;">`;
    } else {
        const minAttr = meta.min !== undefined ? `min="${meta.min}"` : '';
        const maxAttr = meta.max !== undefined ? `max="${meta.max}"` : '';
        inputHtml = `<input type="${meta.type || 'text'}" class="field-input" value="${val}" ${minAttr} ${maxAttr} 
            oninput="validateField('${key}', this)" 
            onchange="updateValue('${key}', this.value)">`;
    }

    return `
    <div class="card" id="card-${key}">
        <div class="form-row">
            <div class="label-area">
                <div class="field-label ${reqClass}">${meta.label}</div>
                <span class="var-code" title="${key}">${key}</span>
            </div>
             <div>
                ${inputHtml}
                <div class="field-error" id="error-${key}" style="color: #ff4d4f; font-size: 12px; margin-top: 4px; display: none;"></div>
                <div class="field-desc">${meta.comment || ''}</div>
            </div>
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
        input.style.borderColor = '#ff4d4f';
        return;
    }

    if (meta.min !== undefined && val < meta.min) {
        errorEl.innerText = `值不能小于 ${meta.min}`;
        errorEl.style.display = 'block';
        input.style.borderColor = '#ff4d4f';
    } else if (meta.max !== undefined && val > meta.max) {
        errorEl.innerText = `值不能大于 ${meta.max}`;
        errorEl.style.display = 'block';
        input.style.borderColor = '#ff4d4f';
    } else {
        errorEl.style.display = 'none';
        input.style.borderColor = '';
    }
}

function updateValue(key, val) {
    configValues[key] = val;

    // Apply Custom Business Logic
    applyBusinessLogic(key, val);

    checkAllDependencies(); // Re-evaluate whenever a value changes
    checkDirtyState();
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

    // Safety check
    if (!btnSaveOnly) return;

    if (isDirty) {
        // Enabled
        btnSaveOnly.disabled = false;
        btnSaveOnly.textContent = "保存配置 *";
        btnSaveOnly.style.opacity = "1";
        btnSaveOnly.style.cursor = "pointer";
        if (btnSaveApply) {
            btnSaveApply.disabled = false;
            btnSaveApply.style.opacity = "1";
            btnSaveApply.style.cursor = "pointer";
        }
    } else {
        // Disabled
        btnSaveOnly.disabled = true;
        btnSaveOnly.textContent = "仅保存配置";
        btnSaveOnly.style.opacity = "0.5";
        btnSaveOnly.style.cursor = "not-allowed";
        if (btnSaveApply) {
            btnSaveApply.disabled = false;
            btnSaveApply.style.opacity = "1";
            btnSaveApply.style.cursor = "pointer";
        }
    }
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
            btn.style.background = "#E3F2FD";
            btn.style.color = "var(--primary)";

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
        btn.style.background = "";
        btn.style.color = "";

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
            input.style.borderColor = 'var(--danger)';
            input.style.backgroundColor = '#FFF0F0';
            input.addEventListener('input', function () {
                this.style.borderColor = '';
                this.style.backgroundColor = '';
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

const MAX_LOG_LINES = 800;
const MAX_LOG_STORE = 3000;
const MAX_BUFFERED_LOGS = 1500;
const LOG_FLUSH_BATCH_SIZE = 120;
const MAX_MSG_LENGTH = 2000;

function showLogs(isManual = false, serviceId = null) {
    selectedLogService = serviceId || selectedLogService || deploymentInfo?.appService || null;
    const modal = document.getElementById('logs-modal');
    const serviceLabel = selectedLogService ? ` - ${selectedLogService}` : '';
    const titleText = document.getElementById('logs-title-text');

    if (titleText) {
        titleText.textContent = `${isManual ? '实时容器日志' : '服务重启日志'}${serviceLabel}`;
    }

    modal.classList.add('active');
    resetLogViewerState();

    connectLogsStream();
}

function resetLogViewerState() {
    const content = document.getElementById('logs-content');
    const searchInput = document.getElementById('logs-search-input');
    const levelFilter = document.getElementById('logs-level-filter');

    closeLogsStream();
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
        bindLogScrollWatcher(content);
    }
    if (searchInput) searchInput.value = '';
    if (levelFilter) levelFilter.value = 'all';

    updateLogControls();
    updateLogStatus('实时监听中...', 'live');
    updateLogMeta();
}

function closeLogs() {
    const modal = document.getElementById('logs-modal');
    modal.classList.remove('active');
    closeLogsStream();
    logBuffer = [];
    droppedBufferedLogs = 0;
    isLogPaused = false;
    isLogFullscreen = false;
    modal.classList.remove('fullscreen');
    updateLogControls();
}

function clearLogs() {
    const content = document.getElementById('logs-content');
    if (content) content.innerHTML = '';
    logEntries = [];
    logBuffer = [];
    droppedBufferedLogs = 0;
    droppedStoredLogs = 0;
    logSeq = 0;
    updateLogMeta();
    updateLogStatus(logsEventSource ? '实时监听中...' : '日志已清空', logsEventSource ? 'live' : 'paused');
}

function closeLogsStream() {
    if (logReconnectTimer) {
        clearTimeout(logReconnectTimer);
        logReconnectTimer = null;
    }
    if (logsEventSource) {
        logsEventSource.close();
        logsEventSource = null;
    }
}

function toggleLogWrap() {
    isWrapMode = !isWrapMode;
    const content = document.getElementById('logs-content');
    if (content) content.classList.toggle('wrap-mode', isWrapMode);
    updateLogControls();
}

function toggleLogPause() {
    isLogPaused = !isLogPaused;
    updateLogControls();

    if (isLogPaused) {
        logBuffer = [];
        updateLogStatus('已暂停实时刷新', 'paused');
        updateLogMeta();
        return;
    }

    updateLogStatus('实时监听中...', 'live');
    renderFilteredLogs();
}

function toggleLogFollow() {
    autoScrollLogs = !autoScrollLogs;
    updateLogControls();
    if (autoScrollLogs) scrollLogsToBottom();
}

function toggleLogFullscreen() {
    const modal = document.getElementById('logs-modal');
    isLogFullscreen = !isLogFullscreen;
    if (modal) modal.classList.toggle('fullscreen', isLogFullscreen);
    updateLogControls();
    if (autoScrollLogs) requestAnimationFrame(scrollLogsToBottom);
}

function handleLogSearch(value) {
    currentLogSearch = (value || '').trim().toLowerCase();
    updateLogControls();
    scheduleLogRerender();
}

function clearLogSearch() {
    const input = document.getElementById('logs-search-input');
    if (input) input.value = '';
    handleLogSearch('');
}

function setLogLevelFilter(value) {
    currentLogLevel = value || 'all';
    scheduleLogRerender();
}

async function copyVisibleLogs() {
    const visibleLogs = getFilteredEntries().slice(-MAX_LOG_LINES).map(entry => entry.message).join('\n');
    if (!visibleLogs) {
        showToast('当前没有可复制的日志', 'info');
        return;
    }

    try {
        await navigator.clipboard.writeText(visibleLogs);
        showToast(`已复制 ${visibleLogs.split('\n').length} 行日志`, 'success');
    } catch (e) {
        const textarea = document.createElement('textarea');
        textarea.value = visibleLogs;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        showToast('已复制当前日志', 'success');
    }
}

function connectLogsStream() {
    closeLogsStream();

    logsEventSource = new EventSource(ConfigMateApi.logsUrl(selectedLogService));
    updateLogStatus('实时监听中...', 'live');

    logsEventSource.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            data = { type: 'error', message: '[日志解析失败] ' + e.message };
        }
        handleLogData(data);
    };

    logsEventSource.onerror = () => {
        handleLogData({ type: 'error', message: '[连接错误] 实时日志连接中断，3 秒后尝试重连...' });
        updateLogStatus('连接中断，准备重连...', 'error');
        closeLogsStream();
        logReconnectTimer = setTimeout(() => {
            logReconnectTimer = null;
            if (document.getElementById('logs-modal')?.classList.contains('active')) {
                connectLogsStream();
            }
        }, 3000);
    };
}

function handleLogData(data) {
    const entry = normalizeLogEntry(data);
    storeLogEntry(entry);

    if (entry.type === 'close') {
        closeLogsStream();
        updateLogStatus(`连接已关闭，退出代码: ${data.code ?? 0}`, 'paused');
    }

    if (entry.level === 'success' && !startupDetected) {
        startupDetected = true;
        updateLogStatus('启动成功', 'success');
        setTimeout(() => {
            if (!isLogPaused && logsEventSource) updateLogStatus('实时监听中...', 'live');
        }, 5000);
    }

    if (!isLogPaused && entryMatchesFilters(entry)) {
        enqueueLogEntry(entry);
    } else {
        scheduleLogMetaUpdate();
    }
}

function normalizeLogEntry(data) {
    const fallbackMessage = data.type === 'close' ? `[连接已关闭，退出代码: ${data.code ?? 0}]` : '';
    const rawMessage = typeof data.message === 'string' ? data.message : String(data.message ?? fallbackMessage);
    let message = rawMessage;
    let truncated = false;

    if (message.length > MAX_MSG_LENGTH) {
        message = `${message.slice(0, MAX_MSG_LENGTH)} ... [已截断, 原文长度: ${rawMessage.length} chars]`;
        truncated = true;
    }

    const level = classifyLogLevel(data, message);

    return {
        id: ++logSeq,
        type: data.type || 'log',
        level,
        message,
        truncated,
        rawLength: rawMessage.length
    };
}

function classifyLogLevel(data, message) {
    if (data.type === 'error') return 'error';
    if (data.type === 'warn') return 'warn';
    if (isSuccessLogMessage(message)) return 'success';

    const explicitLevel = getExplicitLogLevel(message);
    if (explicitLevel) {
        if (explicitLevel === 'ERROR' || explicitLevel === 'FATAL') return 'error';
        if (explicitLevel === 'WARN' || explicitLevel === 'WARNING') return 'warn';
        return 'info';
    }

    if (isStrongErrorMessage(message)) return 'error';
    if (message.includes('[日志过多]') || /\bWARNING\b|\bWARN\b/i.test(message)) return 'warn';
    return 'info';
}

function isSuccessLogMessage(message) {
    return message.includes('Started ThingsBoard')
        || message.includes('启动成功')
        || message.includes('Installation finished successfully');
}

function getExplicitLogLevel(message) {
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

function storeLogEntry(entry) {
    logEntries.push(entry);
    if (logEntries.length > MAX_LOG_STORE) {
        const dropCount = logEntries.length - MAX_LOG_STORE;
        logEntries.splice(0, dropCount);
        droppedStoredLogs += dropCount;
    }
}

function enqueueLogEntry(entry) {
    if (logBuffer.length >= MAX_BUFFERED_LOGS) {
        const dropCount = logBuffer.length - MAX_BUFFERED_LOGS + 1;
        logBuffer.splice(0, dropCount);
        droppedBufferedLogs += dropCount;
    }
    logBuffer.push(entry);
    requestFlushLogs();
}

function requestFlushLogs() {
    if (isFlushing || isLogPaused) return;
    isFlushing = true;
    requestAnimationFrame(flushLogs);
}

function flushLogs() {
    const content = document.getElementById('logs-content');

    if (!content || logBuffer.length === 0) {
        isFlushing = false;
        updateLogMeta();
        return;
    }

    const fragment = document.createDocumentFragment();
    const batch = logBuffer.splice(0, LOG_FLUSH_BATCH_SIZE);

    if (droppedBufferedLogs > 0) {
        fragment.appendChild(renderLogLine({
            id: ++logSeq,
            type: 'system',
            level: 'warn',
            message: `[日志过多] 已跳过 ${droppedBufferedLogs} 条待渲染日志，继续显示最新内容。`
        }));
        droppedBufferedLogs = 0;
    }

    batch.forEach(entry => fragment.appendChild(renderLogLine(entry)));

    content.appendChild(fragment);

    const excess = content.children.length - MAX_LOG_LINES;
    if (excess > 0) {
        const range = document.createRange();
        range.setStartBefore(content.firstChild);
        range.setEndAfter(content.children[excess - 1]);
        range.deleteContents();
        range.detach();
    }

    if (autoScrollLogs) scrollLogsToBottom();

    isFlushing = false;
    updateLogMeta();

    if (logBuffer.length > 0) {
        requestFlushLogs();
    }
}

function renderFilteredLogs() {
    const content = document.getElementById('logs-content');
    if (!content) return;

    const fragment = document.createDocumentFragment();
    const entries = getFilteredEntries().slice(-MAX_LOG_LINES);
    content.innerHTML = '';
    entries.forEach(entry => fragment.appendChild(renderLogLine(entry)));
    content.appendChild(fragment);
    if (autoScrollLogs) scrollLogsToBottom();
    updateLogMeta();
}

function scheduleLogRerender() {
    if (pendingLogRerender) return;
    pendingLogRerender = true;
    requestAnimationFrame(() => {
        pendingLogRerender = false;
        renderFilteredLogs();
    });
}

function renderLogLine(entry) {
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

function isLogsNearBottom() {
    const content = document.getElementById('logs-content');
    if (!content) return true;
    return content.scrollHeight - content.scrollTop - content.clientHeight < 80;
}

function bindLogScrollWatcher(content) {
    if (!content || content.dataset.scrollWatcherBound === 'true') return;
    content.dataset.scrollWatcherBound = 'true';
    content.addEventListener('scroll', () => {
        if (isProgrammaticLogScroll) return;
        const shouldFollow = isLogsNearBottom();
        if (autoScrollLogs !== shouldFollow) {
            autoScrollLogs = shouldFollow;
            updateLogControls();
            scheduleLogMetaUpdate();
        }
    }, { passive: true });
}

function scrollLogsToBottom() {
    const content = document.getElementById('logs-content');
    if (!content) return;
    isProgrammaticLogScroll = true;
    content.scrollTop = content.scrollHeight;
    requestAnimationFrame(() => {
        isProgrammaticLogScroll = false;
    });
}

function updateLogStatus(text, state = 'live') {
    const statusEl = document.getElementById('logs-status');
    if (!statusEl) return;
    statusEl.classList.remove('success', 'paused', 'error');
    if (state && state !== 'live') statusEl.classList.add(state);
    const span = statusEl.querySelector('span');
    if (span) span.textContent = text;
}

function updateLogControls() {
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

function updateLogMeta() {
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

function scheduleLogMetaUpdate() {
    if (pendingLogMetaUpdate) return;
    pendingLogMetaUpdate = true;
    requestAnimationFrame(() => {
        pendingLogMetaUpdate = false;
        updateLogMeta();
    });
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
                const fileList = data.missingFiles.map(f => `<b style="color: #D63031;">${f}</b>`).join(' 和 ');
                if (msgEl) {
                    msgEl.innerHTML = `
                        <div style="text-align: left; background: #FFF5F5; padding: 12px; border-radius: 6px; border: 1px solid #FED7D7;">
                            当前目录缺失关键配置文件：<br>
                            ${fileList}
                        </div>
                        <div style="text-align: left; margin-top: 12px; color: #555; font-size: 13px; line-height: 1.6;">
                            • 核心功能（如启动、停止服务）将 <b>不可用</b>。<br>
                            • 但您仍可继续 <b>浏览或编辑</b> 历史配置与模板。
                        </div>
                    `;
                }

                modal.classList.add('active');
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
                btnRestart.style.background = "#FDCB6E";
                btnRestart.style.color = "#333";
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
                btnRestart.style.background = "#2ecc71";
                btnRestart.style.color = "white";
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

function openHistoryModal() {
    const modal = document.getElementById('history-modal');
    modal.style.display = 'flex'; // Reset display property overwritten by close
    // Force reflow
    void modal.offsetWidth;
    modal.classList.add('active');
    fetchHistory();
}

function closeHistoryModal() {
    const modal = document.getElementById('history-modal');
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 200);
}

async function fetchHistory() {
    const listEl = document.getElementById('history-list');
    if (!listEl) {
        console.error("history-list element not found!");
        return;
    }
    renderHistoryLoading();
    try {
        const res = await ConfigMateApi.history();
        const json = await res.json();

        if (json.status === 'success') {
            renderHistory(json.data);
        } else {
            renderHistoryState('读取失败', json.message || '历史记录接口返回异常', 'error');
        }
    } catch (e) {
        console.error(e);
        renderHistoryState('请求失败', e.message, 'error');
    }
}

function renderHistoryLoading() {
    updateHistorySummary([]);
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

function renderHistoryState(title, message, type = '') {
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

function updateHistorySummary(files) {
    const countEl = document.getElementById('history-count');
    const latestEl = document.getElementById('history-latest');
    const envPathEl = document.getElementById('history-env-path');
    const count = Array.isArray(files) ? files.length : 0;
    if (countEl) countEl.textContent = `${count} / 5`;
    if (latestEl) latestEl.textContent = count ? formatHistoryDate(files[0].timestamp, 'datetime') : '暂无记录';
    if (envPathEl) {
        const envPath = deploymentInfo?.envPath ? shortPath(deploymentInfo.envPath) : '.env';
        envPathEl.textContent = envPath;
        if (deploymentInfo?.envPath) envPathEl.title = deploymentInfo.envPath;
    }
}

function renderHistory(files) {
    const listEl = document.getElementById('history-list');
    updateHistorySummary(files || []);
    if (!files || files.length === 0) {
        renderHistoryState('暂无历史版本', '保存配置后会在这里显示备份记录');
        return;
    }

    listEl.innerHTML = files.map((file, index) => {
        const dateObj = new Date(file.timestamp);
        const timeStr = dateObj.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        const dateStr = dateObj.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const isLatest = index === 0;
        const filename = String(file.filename || '');
        const safeFilename = escapeHtml(filename);
        const relative = formatHistoryRelative(file.timestamp);
        const size = formatHistorySize(file.size);

        return `
        <li class="timeline-item ${isLatest ? 'latest' : ''}">
            <div class="timeline-marker"></div>
            <div class="timeline-content">
                <div class="timeline-header">
                    <div>
                        <div class="timeline-time">
                        <span>${timeStr}</span>
                        <span class="timeline-date-badge">${dateStr}</span>
                        ${isLatest ? '<span class="history-badge latest">最新</span>' : ''}
                        </div>
                        <div class="timeline-meta">
                            <span class="timeline-file-tag">ENV</span>
                            <span class="timeline-file-name" title="${safeFilename}">${safeFilename}</span>
                            <span>${escapeHtml(size)}</span>
                            <span>${escapeHtml(relative)}</span>
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
    `}).join('');
}

function handleHistoryAction(event) {
    const button = event.target.closest('[data-history-action]');
    if (!button) return;
    const filename = button.dataset.historyFile || '';
    if (!filename) return;
    const action = button.dataset.historyAction;
    if (action === 'view') viewContent(filename);
    else if (action === 'compare') compareHistory(filename);
    else if (action === 'restore') restoreHistory(filename);
}

function formatHistoryDate(isoStr, mode = 'short') {
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

function formatHistoryRelative(isoStr) {
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

function formatHistorySize(size) {
    const bytes = Number(size || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// --- Diff / View Logic ---

function openDiffModal(title) {
    document.getElementById('diff-title').innerText = title;
    const modal = document.getElementById('diff-modal');
    modal.style.display = 'flex'; // Reset display property overwritten by close
    void modal.offsetWidth;
    modal.classList.add('active');
}

function closeDiffModal() {
    const modal = document.getElementById('diff-modal');
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 200);
}

async function viewContent(filename) {
    try {
        const res = await ConfigMateApi.historyContent(filename);
        const json = await res.json();
        if (json.status === 'success') {
            const contentEl = document.getElementById('diff-content');
            contentEl.innerHTML = json.content.split('\n').map(line =>
                `<div class="diff-line">${escapeHtml(line)}</div>`
            ).join('');
            openDiffModal(`文件内容: ${filename}`);
        } else {
            alert('获取失败: ' + json.message);
        }
    } catch (e) {
        alert('请求失败: ' + e.message);
    }
}

async function compareHistory(filename) {
    try {
        // 1. Get History Content
        const resHist = await ConfigMateApi.historyContent(filename);
        const jsonHist = await resHist.json();

        // 2. Get Current Content
        const resCurr = await ConfigMateApi.rawEnv();
        const textCurr = await resCurr.text();

        if (jsonHist.status === 'success') {
            renderDiff(jsonHist.content, textCurr);
            openDiffModal(`配置对比 (${filename} vs 当前)`);
        } else {
            alert('获取历史文件失败: ' + jsonHist.message);
        }
    } catch (e) {
        alert('请求失败: ' + e.message);
    }
}

function renderDiff(oldText, newText) {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    // Simple key-value based diff (naive line diff for now for simplicity, since config order might change)
    // Or just visual line diff? Config order shouldn't change much.
    // Let's do a simple modified Check: Key-based is better for env files.

    const oldMap = parseEnvLines(oldLines);
    const newMap = parseEnvLines(newLines);

    const allKeys = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
    const sortedKeys = Array.from(allKeys).sort();

    let html = '';

    sortedKeys.forEach(key => {
        const oldVal = oldMap[key];
        const newVal = newMap[key];

        if (oldVal === undefined) {
            // Added
            html += `<div class="diff-line diff-added">+ ${key}=${newVal}</div>`;
        } else if (newVal === undefined) {
            // Removed
            html += `<div class="diff-line diff-removed">- ${key}=${oldVal}</div>`;
        } else if (oldVal !== newVal) {
            // Modified
            html += `<div class="diff-line diff-removed">- ${key}=${oldVal}</div>`;
            html += `<div class="diff-line diff-added">+ ${key}=${newVal}</div>`;
        } else {
            // Unchanged (optional: hide or show grey?)
            // Let's show context? or just changes?
            // User asked to "compare", usually implies seeing differences.
            // But seeing the whole file with highlights is also good.
            // Let's show everything but plain for unchanged.
            html += `<div class="diff-line">  ${key}=${newVal}</div>`;
        }
    });

    document.getElementById('diff-content').innerHTML = html;
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

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function restoreHistory(filename) {
    if (!await customConfirm(`确定要将配置回滚到 ${filename} 吗？\n\n当前未保存的修改将会丢失。`, '确认回滚', 'var(--danger)')) return;

    try {
        const res = await ConfigMateApi.restoreHistory(filename);
        const json = await res.json();

        if (json.status === 'success') {
            alert('回滚成功！页面将刷新以加载新配置。');
            location.reload();
        } else {
            alert('回滚失败: ' + json.message);
        }
    } catch (e) {
        alert('请求失败: ' + e.message);
    }
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

    if (btnEdit) btnEdit.style.display = enabled ? 'none' : 'block';
    if (btnCancel) btnCancel.style.display = enabled ? 'block' : 'none';
    if (btnSaveOnly) btnSaveOnly.style.display = enabled ? 'block' : 'none';
    if (btnSaveApply) btnSaveApply.style.display = enabled ? 'block' : 'none';

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
    const btn = document.querySelector('.btn-header[onclick="checkRuntimeSync()"]');
    const originalHtml = btn.innerHTML;

    try {
        // Loading State
        btn.innerHTML = `<svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>`;
        btn.disabled = true;

        const res = await ConfigMateApi.runtimeDiff();
        const json = await res.json();

        console.log("Runtime Check Response:", json);
        if (json.status === 'success') {
            renderRuntimeDiff(json);
        } else if (json.status === 'not_running') {
            showToast('⚠️ 服务未运行，无法获运行时配置', 'error');
        } else {
            showToast('❌ 检查失败: ' + json.message, 'error');
        }
    } catch (e) {
        console.error("Diff check failed", e);
        showToast('❌ 请求失败: ' + e.message, 'error');
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}

function renderRuntimeDiff(data) {
    const modal = document.getElementById('runtime-diff-modal');
    const tbody = document.getElementById('runtime-diff-tbody');
    const statusDiv = document.getElementById('diff-status-bar');
    const loadingDiv = document.getElementById('runtime-diff-loading');
    const resultDiv = document.getElementById('runtime-diff-result');
    const restartBtn = document.getElementById('btn-restart-from-diff');

    // Reset UI
    console.log("Opening Runtime Diff Modal...");
    modal.style.display = 'flex'; // Force flex
    void modal.offsetWidth;
    modal.classList.add('active');
    console.log("Modal active class added, display set to flex");

    loadingDiv.style.display = 'none';
    resultDiv.style.display = 'flex';
    tbody.innerHTML = '';

    const diffs = data.diffs || [];
    if (diffs.length === 0) {
        // Synced
        statusDiv.innerHTML = `
            <div class="diff-status-sync">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                运行配置与本地文件完全一致 (Synced)
            </div>
        `;
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 40px; color: #64748b;">✅ 所有配置项均已同步生效。</td></tr>`;
        restartBtn.style.display = 'none';
    } else {
        // Has Diffs
        statusDiv.innerHTML = `
            <div class="diff-status-diff">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                检测到 ${diffs.length} 个配置项不一致 (需重启生效)
            </div>
        `;
        restartBtn.style.display = 'block';

        tbody.innerHTML = diffs.map(diff => {
            let runtimeClass = '';
            let localClass = '';
            let stateTag = '';

            if (diff.state === 'MODIFIED') {
                runtimeClass = 'diff-val-del';
                localClass = 'diff-val-new';
                stateTag = '<span class="diff-tag diff-tag-mod">MODIFIED</span>';
            } else if (diff.state === 'NEW') {
                runtimeClass = ''; // Missing
                localClass = 'diff-val-new';
                stateTag = '<span class="diff-tag diff-tag-new">NEW</span>';
            } else if (diff.state === 'DELETED') {
                runtimeClass = 'diff-val-del';
                localClass = ''; // Missing
                stateTag = '<span class="diff-tag diff-tag-del">DELETED</span>';
            }

            return `
                <tr>
                    <td style="font-weight:600; color:#1e293b;">${diff.key}</td>
                    <td><span class="${runtimeClass}">${escapeHtml(diff.runtimeVal)}</span></td>
                    <td><span class="${localClass}">${escapeHtml(diff.localVal)}</span></td>
                    <td>${stateTag}</td>
                </tr>
            `;
        }).join('');
    }
}

function closeRuntimeDiffModal() {
    const modal = document.getElementById('runtime-diff-modal');
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        document.getElementById('runtime-diff-result').style.display = 'none';
        document.getElementById('runtime-diff-loading').style.display = 'flex';
    }, 200);
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

const INSTALL_STEPS = ['cleanup', 'compose', 'schema', 'data', 'assets', 'finish'];
let installRunning = false;
let installStartedAt = 0;
let installTimer = null;
let installFollowLogs = true;
let installLogRemainder = '';
let installHadError = false;

async function checkInstallAvailability() {
    try {
        const res = await ConfigMateApi.checkInstall();
        const data = await res.json();
        if (data.exists) {
            const btn = document.getElementById('btn-install-init');
            if (btn) btn.style.display = 'block';
        }
    } catch (e) {
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
    document.getElementById('install-modal').classList.remove('active');
}

async function startInstallService() {
    const modal = document.getElementById('install-modal');
    modal.classList.add('active');
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
    try {
        await navigator.clipboard.writeText(logs);
        showToast('安装日志已复制', 'success');
    } catch (e) {
        const textarea = document.createElement('textarea');
        textarea.value = logs;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        showToast('安装日志已复制', 'success');
    }
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

            titleEl.textContent = '⛔️ 关键配置缺失 (Critical Configuration Missing)';
            titleEl.style.color = '#ef4444';

            msgEl.innerHTML = `
                <div style="text-align: left; background: #FFF5F5; padding: 12px; border-radius: 6px; border: 1px solid #FED7D7; font-size: 13px;">
                    <div style="font-weight: 600; margin-bottom: 6px; color: #C0392B;">未找到 ThingsBoard 配置文件：</div>
                     <div style="margin-bottom: 4px;">• 请确保 <code>conf/thingsboard.yml</code></div>
                     <div style="margin-bottom: 4px;">• 或 <code>conf/tb-edge.yml</code> 存在。</div>
                </div>
                <div style="text-align: left; margin-top: 12px; color: #555; font-size: 13px; line-height: 1.6;">
                    • 本工具依赖配置文件来生成元数据。<br>
                    • 请检查 <code>conf/</code> 目录是否完整。<br>
                    • <b>工具将会暂停</b>，直到问题修复。
                </div>
            `;

            closeBtn.style.display = 'none';

            actionBtn.textContent = '已修复，刷新页面重试 (Reload)';
            actionBtn.classList.remove('btn-ghost');
            actionBtn.classList.add('btn-confirm');
            actionBtn.style.backgroundColor = '#ef4444';
            actionBtn.onclick = () => location.reload();

            modal.style.display = 'flex';
            modal.classList.add('active');
            return;
        } else if (data.status === 'error' && data.errors.length > 0) {
            // Hide the raw list and hint, we will use msgEl for everything
            listEl.style.display = 'none';
            hintEl.style.display = 'none';

            // Build styled error list
            const errorItems = data.errors.map(err =>
                `<div style="margin-bottom: 4px;">• <b style="color: #D63031;">${err.file}</b>: ${err.msg.replace('Missing env_file property', '未配置 env_file')}</div>`
            ).join('');

            // Blocking Mode
            titleEl.textContent = '⛔️ 严重配置错误 (Critical Configuration Error)';
            titleEl.style.color = '#ef4444';

            msgEl.innerHTML = `
                <div style="text-align: left; background: #FFF5F5; padding: 12px; border-radius: 6px; border: 1px solid #FED7D7; font-size: 13px;">
                    <div style="font-weight: 600; margin-bottom: 6px; color: #C0392B;">检测到以下文件配置不正确：</div>
                    ${errorItems}
                </div>
                <div style="text-align: left; margin-top: 12px; color: #555; font-size: 13px; line-height: 1.6;">
                    • 本工具依赖 <code>env_file</code> 配置来加载环境变量。<br>
                    • 请在上述文件中添加 <code>env_file: [.env]</code> 配置项。<br>
                    • 为了数据安全，<b>工具将暂停运行</b>，直到问题修复。
                </div>
            `;

            // Hide close button
            closeBtn.style.display = 'none';

            // Change action button to Reload
            actionBtn.textContent = '已修复，刷新页面重试 (Reload)';
            actionBtn.classList.remove('btn-ghost');
            actionBtn.classList.add('btn-confirm');
            actionBtn.style.backgroundColor = '#ef4444';
            actionBtn.onclick = () => location.reload();

            modal.style.display = 'flex'; // Force show
            modal.classList.add('active');
        }
    } catch (e) {
        console.error("Validation check failed", e);
    }
}

function closeValidateModal() {
    const modal = document.getElementById('validate-modal');
    modal.style.display = 'none'; // Force hide
    modal.classList.remove('active');
}
