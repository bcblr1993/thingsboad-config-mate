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

    /* Tier-specific Lucide icons (mirrors overview-ui.js). */
    const TIER_ICON_SVG = {
        business: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
        storage:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path></svg>',
        cache:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>',
        queue:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
        monitor:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
    };

    function getTierIcon(tier) {
        return TIER_ICON_SVG[tier] || SVC_ICON_SVG;
    }

    function formatUptime(startedAt) {
        if (!startedAt) return '—';
        const start = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
        if (!Number.isFinite(start)) return '—';
        let diff = Math.max(0, Math.floor((Date.now() - start) / 1000));
        const day = Math.floor(diff / 86400); diff -= day * 86400;
        const hr = Math.floor(diff / 3600); diff -= hr * 3600;
        const min = Math.floor(diff / 60);
        if (day > 0) return `${day}d ${hr}h`;
        if (hr > 0) return `${hr}h ${min}m`;
        if (min > 0) return `${min}m`;
        return '刚刚';
    }

    /* Extract a short port summary string from sections (e.g. "8080, 1883"). */
    function summarizePorts(sections) {
        const portSection = (sections || []).find(s => (s.title || '') === '端口');
        if (!portSection || !Array.isArray(portSection.items)) return '—';
        const ports = portSection.items
            .map(it => {
                const raw = String(it?.value || it?.key || '').trim();
                if (!raw || raw === '无' || raw === '无环境变量') return null;
                const match = raw.match(/(\d{2,5})/);
                return match ? match[1] : null;
            })
            .filter(Boolean);
        if (ports.length === 0) return '—';
        return ports.slice(0, 3).join(', ') + (ports.length > 3 ? ` +${ports.length - 3}` : '');
    }

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

    function renderServiceCards({ services = [], requiredIds = new Set(), selectedServiceId = '', portsByService = {} } = {}) {
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
            const uptime = running ? formatUptime(service.startedAt) : '—';
            const ports = portsByService[service.id] || '—';
            const tierIcon = getTierIcon(tier);
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
            // C 方案三按钮: 日志 / 重启 or 启动 / 更多 (danger 动作下放到详情面板).
            const primaryBtn = running
                ? `<button type="button" onclick="event.stopPropagation(); serviceAction(${idArg}, 'restart')" ${canOperateRunning ? '' : 'disabled'}>重启</button>`
                : `<button type="button" onclick="event.stopPropagation(); serviceAction(${idArg}, 'up')" ${canStart ? '' : 'disabled'}>启动</button>`;

            return `
                <div class="${classes}" data-service-id="${escapeHtml(service.id)}" data-tier="${escapeHtml(tier)}" onclick="selectService(${idArg})">
                    <div class="cm-svc-head">
                        <div class="cm-svc-head-left">
                            <span class="cm-svc-icon">${tierIcon}</span>
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
                        <div class="cm-svc-metric"><span class="cm-svc-metric-key">Uptime</span><span class="cm-svc-metric-val">${escapeHtml(uptime)}</span></div>
                        <div class="cm-svc-metric"><span class="cm-svc-metric-key">CPU</span><span class="cm-svc-metric-val">—</span></div>
                        <div class="cm-svc-metric"><span class="cm-svc-metric-key">Mem</span><span class="cm-svc-metric-val">—</span></div>
                        <div class="cm-svc-metric"><span class="cm-svc-metric-key">Ports</span><span class="cm-svc-metric-val" title="${escapeHtml(ports)}">${escapeHtml(ports)}</span></div>
                    </div>
                    <div class="cm-svc-actions">
                        <button type="button" onclick="event.stopPropagation(); showLogs(true, ${idArg})" ${disabled ? 'disabled' : ''}>日志</button>
                        ${primaryBtn}
                        <button type="button" class="cm-svc-action-more" onclick="event.stopPropagation(); selectService(${idArg})" title="查看更多">…</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderServiceConfig(data, options = {}) {
        const summary = data.summary || {};
        const serviceId = data.service?.id || options.selectedServiceId || '';
        const serviceStatus = options.serviceStatus || {};
        const tier = inferTier({ id: serviceId, tier: serviceStatus.tier });
        const running = !!serviceStatus.running;
        const status = serviceStatus.status || (running ? 'running' : 'stopped');
        const statusLabel = STATUS_LABEL[status] || status;
        const idArg = jsArg(serviceId);
        const cleanupInFlightService = options.cleanupInFlightService || '';
        const cleanupDisabled = !isCleanupSupportedService(serviceId)
            || isDisabledStatus(status)
            || !!cleanupInFlightService;

        const sections = data.sections || [];
        const portSection = sections.find(s => (s.title || '') === '端口');
        const volumeSection = sections.find(s => (s.title || '') === '挂载');
        const otherSections = sections.filter(s => !['端口', '挂载'].includes(s.title || ''));

        const portsHtml = renderPortsList(portSection);
        const volumesHtml = renderVolumesList(volumeSection);
        const dependenciesHtml = renderDetailDependencies(options.dependencyServices, options.appServiceId, serviceId);

        const containerKvs = [
            { k: 'Service ID', v: serviceId || '—' },
            { k: '镜像', v: summary.image || '—' },
            { k: '容器名', v: summary.containerName || '—' },
            { k: '重启策略', v: summary.restart || '—' },
            { k: '容器 ID', v: serviceStatus.containerId ? serviceStatus.containerId.slice(0, 12) : '—' },
            { k: '运行时长', v: running ? formatUptime(serviceStatus.startedAt) : '—' },
            { k: 'CPU', v: '—' },
            { k: '内存', v: '—' },
        ];

        const sectionsHtml = (otherSections || []).map((section, sectionIndex) =>
            renderServiceConfigSection(section, sectionIndex, serviceId)
        ).join('');

        return `
            <div class="cm-detail-header">
                <div class="cm-detail-header-titles">
                    <div class="cm-detail-title">
                        <span class="cm-detail-title-name">${escapeHtml(serviceId || data.service?.label || '')}</span>
                        <span class="cm-detail-title-status cm-svc-status ${escapeHtml(status)}">
                            <span class="cm-svc-status-dot"></span>${escapeHtml(statusLabel)}
                        </span>
                        <code class="cm-detail-title-path">${escapeHtml(data.composePath || '')}</code>
                    </div>
                    <div class="cm-detail-subtitle">${escapeHtml(data.service?.label || serviceId)} · tier=${escapeHtml(tier)}</div>
                </div>
                <div class="cm-detail-actions">
                    <button class="btn btn-ghost" type="button" onclick="showLogs(true, ${idArg})" ${isDisabledStatus(status) ? 'disabled' : ''}>查看日志</button>
                    <button class="btn btn-ghost" type="button" onclick="serviceAction(${idArg}, 'down')" ${running ? '' : 'disabled'}>停止</button>
                    <button class="btn btn-primary" type="button" onclick="serviceAction(${idArg}, ${running ? '\'restart\'' : '\'up\''})" ${isDisabledStatus(status) ? 'disabled' : ''}>${running ? '重启' : '启动'}</button>
                    ${isCleanupSupportedService(serviceId)
                        ? `<button class="btn btn-danger service-detail-cleanup-btn" type="button" onclick="cleanupService(${jsArg(serviceId)})" ${cleanupDisabled ? 'disabled' : ''}>${cleanupInFlightService === serviceId ? '清理中' : '清理数据'}</button>`
                        : ''}
                </div>
            </div>

            <div class="cm-detail-grid">
                <section class="cm-detail-col">
                    <div class="cm-detail-col-title">容器 (Container)</div>
                    <div class="cm-detail-kv-grid">
                        ${containerKvs.map(({ k, v }) => `
                            <div class="cm-detail-kv">
                                <div class="cm-detail-kv-key">${escapeHtml(k)}</div>
                                <div class="cm-detail-kv-val" title="${escapeHtml(v)}">${escapeHtml(v)}</div>
                            </div>`).join('')}
                    </div>
                </section>
                <section class="cm-detail-col">
                    <div class="cm-detail-col-title">端口与卷 (Ports &amp; Volumes)</div>
                    <div class="cm-detail-sub-title">端口</div>
                    ${portsHtml}
                    <div class="cm-detail-sub-title">挂载</div>
                    ${volumesHtml}
                </section>
                <section class="cm-detail-col">
                    <div class="cm-detail-col-title">依赖健康 (Dependencies)</div>
                    ${dependenciesHtml}
                </section>
            </div>

            <section class="cm-detail-recent-logs" id="cm-detail-recent-logs" data-service-id="${escapeHtml(serviceId)}">
                <div class="cm-detail-recent-logs-head">
                    <span>最近日志 · ${escapeHtml(serviceId)} · stdout</span>
                    <button class="btn btn-ghost" type="button" onclick="showLogs(true, ${idArg})">打开完整日志</button>
                </div>
                <div class="cm-detail-recent-logs-body" data-state="idle">等待加载日志...</div>
            </section>

            ${sectionsHtml ? `
                <section class="cm-detail-sections">
                    <div class="cm-detail-col-title">完整环境变量</div>
                    <div class="service-config-sections ${getServiceConfigSectionsClass(otherSections)}">
                        ${sectionsHtml}
                    </div>
                </section>` : ''}
        `;
    }

    function renderPortsList(section) {
        const items = section?.items || [];
        const usable = items.filter(it => {
            const raw = String(it?.value || '').trim();
            return raw && raw !== '无';
        });
        if (usable.length === 0) {
            return '<div class="cm-detail-empty">无端口暴露</div>';
        }
        return `<ul class="cm-detail-list">${usable.map(it => {
            const raw = String(it.value || '');
            const portMatch = raw.match(/(\d{2,5})/);
            const port = portMatch ? portMatch[1] : raw;
            return `<li class="cm-detail-list-row">
                <code class="cm-detail-list-key">${escapeHtml(port)}</code>
                <span class="cm-detail-list-val" title="${escapeHtml(raw)}">${escapeHtml(raw)}</span>
            </li>`;
        }).join('')}</ul>`;
    }

    function renderVolumesList(section) {
        const items = section?.items || [];
        const usable = items.filter(it => {
            const raw = String(it?.value || '').trim();
            return raw && raw !== '无';
        });
        if (usable.length === 0) {
            return '<div class="cm-detail-empty">无挂载</div>';
        }
        return `<ul class="cm-detail-list">${usable.map(it => {
            const raw = String(it.value || '');
            const [src, dst] = raw.split(':').map(s => s.trim());
            return `<li class="cm-detail-list-row cm-detail-list-row-mount">
                <code class="cm-detail-list-key" title="${escapeHtml(src || raw)}">${escapeHtml(src || raw)}</code>
                <span class="cm-detail-list-arrow">→</span>
                <code class="cm-detail-list-val" title="${escapeHtml(dst || '')}">${escapeHtml(dst || '')}</code>
            </li>`;
        }).join('')}</ul>`;
    }

    function renderDetailDependencies(services, appServiceId, currentServiceId) {
        if (!Array.isArray(services) || services.length === 0) {
            return '<div class="cm-detail-empty">未声明依赖</div>';
        }
        const deps = services.filter(s => s.id !== currentServiceId && s.id !== appServiceId);
        if (deps.length === 0) {
            return '<div class="cm-detail-empty">未声明依赖</div>';
        }
        return `<ul class="cm-detail-deps">${deps.map(s => {
            const running = !!s.running;
            const status = s.status || (running ? 'running' : 'stopped');
            const statusLabel = running ? '健康' : (STATUS_LABEL[status] || status);
            return `<li class="cm-detail-deps-row">
                <span class="cm-detail-deps-name">${escapeHtml(s.id || s.label || '')}</span>
                <span class="cm-svc-status ${escapeHtml(status)}">
                    <span class="cm-svc-status-dot"></span>${escapeHtml(statusLabel)}
                </span>
            </li>`;
        }).join('')}</ul>`;
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
        inferTier,
        getTierIcon,
        formatUptime,
        summarizePorts
    };
})();
