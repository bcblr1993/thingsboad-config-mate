(function () {
    const COPY_ENABLED_SERVICES = new Set(['postgres', 'redis', 'kafka', 'cassandra', 'wechat']);
    const CLEANUP_SUPPORTED_SERVICES = new Set(['postgres', 'redis', 'kafka', 'cassandra']);
    const DISABLED_STATUSES = new Set(['missing', 'unknown', 'missing-image', 'unsupported']);
    const escapeHtml = window.ConfigMateUi.escapeHtml;

    /* Heuristic tier mapping fallback. Server already adds .tier in stage 4
       (services/registry.js), but legacy compose snapshots / mocked tests
       may still come through without it. */
    const TIER_HEURISTICS = [
        { tier: 'storage', match: /^postgres|^cassandra|^mysql|^mongo/i },
        { tier: 'cache',   match: /^redis|^memcache/i },
        { tier: 'queue',   match: /^kafka|^zookeeper|^rabbit|^nats/i },
        { tier: 'monitor', match: /^netdata|^grafana|^prometheus|^loki/i },
    ];

    function inferTier(service) {
        if (!service) return 'business';
        if (service.tier) return service.tier;
        const id = service.id || '';
        for (const rule of TIER_HEURISTICS) {
            if (rule.match.test(id)) return rule.tier;
        }
        return 'business';
    }

    const STATUS_LABEL = {
        running: 'Running',
        stopped: 'Stopped',
        missing: '缺失',
        unknown: '未知',
        'missing-image': '镜像缺失',
        unsupported: '不支持',
    };

    function jsArg(value) {
        return escapeHtml(JSON.stringify(String(value || '')));
    }

    const SVC_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>';

    function isCleanupSupportedService(serviceId) {
        return CLEANUP_SUPPORTED_SERVICES.has(serviceId);
    }

    function isDisabledStatus(status) {
        return DISABLED_STATUSES.has(status);
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
                : (isDisabledStatus(item.status) ? 'unknown' : 'pending');
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

    function renderServiceStatus(status) {
        return `
            <span class="service-status ${escapeHtml(status || 'unknown')}">
                <span class="service-status-dot"></span>${escapeHtml(status || 'unknown')}
            </span>
        `;
    }

    function renderServiceCards({ services = [], requiredIds = new Set(), selectedServiceId = '' } = {}) {
        return services.map(service => {
            const required = requiredIds.has(service.id);
            const disabled = isDisabledStatus(service.status);
            const canStart = !disabled && !service.running;
            const canOperateRunning = !disabled && service.running;
            const selected = selectedServiceId === service.id;
            const idArg = jsArg(service.id);
            const tier = inferTier(service);
            const running = !!service.running;
            const status = service.status || 'unknown';
            const statusLabel = STATUS_LABEL[status] || status;
            const image = service.image || service.composeService || '';
            const messageHtml = service.message
                ? `<div class="cm-svc-message">${escapeHtml(service.message)}</div>`
                : '';
            const classes = [
                'service-card',
                'cm-svc-card',
                `cm-tier-${tier}`,
                required ? 'required' : '',
                selected ? 'selected' : '',
                running ? 'is-running' : 'is-stopped',
            ].filter(Boolean).join(' ');

            return `
                <div class="${classes}" data-service-id="${escapeHtml(service.id)}" data-tier="${escapeHtml(tier)}" onclick="selectService(${idArg})">
                    <div class="cm-svc-head">
                        <div class="cm-svc-head-left">
                            <span class="cm-svc-icon">${SVC_ICON_SVG}</span>
                            <div class="cm-svc-meta">
                                <span class="cm-svc-name" title="${escapeHtml(service.label || service.id)}">${escapeHtml(service.id || service.label)}</span>
                                <span class="cm-svc-image" title="${escapeHtml(image || service.label || '')}">${escapeHtml(image || service.label || '')}</span>
                            </div>
                        </div>
                        <span class="cm-svc-status ${escapeHtml(status)}">
                            <span class="cm-svc-status-dot"></span>${escapeHtml(statusLabel)}
                        </span>
                    </div>
                    ${messageHtml}
                    <div class="cm-svc-metrics">
                        <div class="cm-svc-metric"><span class="cm-svc-metric-key">Tier</span><span class="cm-svc-metric-val">${escapeHtml(tier)}</span></div>
                        <div class="cm-svc-metric"><span class="cm-svc-metric-key">Container</span><span class="cm-svc-metric-val">${escapeHtml(service.containerId ? service.containerId.slice(0, 10) : '—')}</span></div>
                    </div>
                    <div class="cm-svc-actions">
                        <button type="button" onclick="event.stopPropagation(); serviceAction(${idArg}, 'up')" ${canStart ? '' : 'disabled'}>启动</button>
                        <button type="button" onclick="event.stopPropagation(); serviceAction(${idArg}, 'restart')" ${canOperateRunning ? '' : 'disabled'}>重启</button>
                        <button type="button" class="cm-svc-action-danger" onclick="event.stopPropagation(); serviceAction(${idArg}, 'down')" ${canOperateRunning ? '' : 'disabled'}>停止</button>
                        <button type="button" onclick="event.stopPropagation(); showLogs(true, ${idArg})" ${disabled ? 'disabled' : ''}>日志</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderServiceConfig(data, options = {}) {
        const summary = data.summary || {};
        const serviceId = data.service?.id || options.selectedServiceId || '';
        const chips = [
            summary.image ? `镜像: ${summary.image}` : '',
            summary.containerName ? `容器: ${summary.containerName}` : '',
            summary.restart ? `重启: ${summary.restart}` : ''
        ].filter(Boolean);
        const cleanupInFlightService = options.cleanupInFlightService || '';
        const cleanupDisabled = !isCleanupSupportedService(serviceId)
            || isDisabledStatus(options.serviceStatus?.status)
            || !!cleanupInFlightService;
        const cleanupButton = isCleanupSupportedService(serviceId)
            ? `<button class="service-detail-cleanup-btn" type="button" onclick="cleanupService(${jsArg(serviceId)})" ${cleanupDisabled ? 'disabled' : ''}>${cleanupInFlightService === serviceId ? '清理中' : '数据清理'}</button>`
            : '';

        return `
            <div class="service-config-header">
                <div>
                    <div class="service-config-title">服务配置：${escapeHtml(data.service?.label || data.service?.id || options.selectedServiceId || '')}</div>
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
        const value = item?.value === undefined || item?.value === null ? '' : String(item.value);
        return COPY_ENABLED_SERVICES.has(serviceId) && !!item?.key && value.length > 0 && value !== '无环境变量';
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

    function toggleServiceSecretItem(config, sectionIndex, itemIndex, btn) {
        const item = config?.sections?.[sectionIndex]?.items?.[itemIndex];
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

    window.ConfigMateServicesUi = {
        isCleanupSupportedService,
        isDisabledStatus,
        renderDependencyStatusChips,
        renderServiceStatus,
        renderServiceCards,
        renderServiceConfig,
        renderServiceSecretIcon,
        toggleServiceSecretItem,
        inferTier
    };
})();
