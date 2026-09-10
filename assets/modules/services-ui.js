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
        degraded: '部分运行',
    };

    /* 双机热备角色徽章。只读纳管，角色由 HA 集群自身决定。 */
    const HA_ROLE_BADGE = {
        primary: { text: 'PRIMARY', title: '本机是当前主节点，数据库可写' },
        standby: { text: 'STANDBY', title: '本机是备节点，数据库只读' },
    };

    /* 集群模式下标注服务所属节点；远端服务额外提示不可在此操作。 */
    function renderNodeBadge(service) {
        if (!service || !service.nodeId) return '';
        const label = service.nodeLabel || service.nodeId;
        if (service.remote) {
            return `<span class="cm-svc-node-badge is-remote" title="该服务运行在 ${escapeHtml(label)}，请登录该节点进行操作">${escapeHtml(label)}</span>`;
        }
        return `<span class="cm-svc-node-badge" title="本机节点 ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
    }

    function renderHaBadges(service) {
        if (!service || service.kind !== 'ha-cluster' || !service.running) return '';

        const badges = [];
        const role = HA_ROLE_BADGE[service.role];
        if (role) {
            badges.push(`<span class="cm-svc-ha-badge is-${escapeHtml(service.role)}" title="${escapeHtml(role.title)}">${role.text}</span>`);
        }
        if (service.vipHeld) {
            const iface = service.vipIface ? `（网卡 ${service.vipIface}）` : '';
            badges.push(`<span class="cm-svc-ha-badge is-vip" title="虚拟 IP ${escapeHtml(service.vip || '')} 当前在本机${escapeHtml(iface)}">VIP</span>`);
        }

        // License 到期是静默故障，必须在卡片上直接可见。
        const license = service.license;
        if (license && ['expired', 'critical', 'warning'].includes(license.level)) {
            const days = license.daysRemaining;
            const text = license.level === 'expired' ? 'License 已过期' : `License ${days}天`;
            const title = license.level === 'expired'
                ? `瀚高 License 已于 ${license.expiry} 过期，请尽快续期`
                : `瀚高 License 将于 ${license.expiry} 到期，剩余 ${days} 天`;
            badges.push(`<span class="cm-svc-ha-badge is-license-${escapeHtml(license.level)}" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`);
        }

        return badges.join('');
    }

/* 后端的容器归属诊断是给排查用的英文短语，直接透传到卡片上运维看不懂。
   这里翻译为可操作的说明；未收录的消息原样展示，避免吞掉有用信息。 */
    const SERVICE_MESSAGE_TEXT = {
        'matched container belongs to another compose project':
            '发现同名容器，但它由其他部署目录启动，不属于本安装包',
        'compose file missing': '未找到该服务的 compose 文件',
        'service definition missing': '缺少服务定义'
    };

    function translateServiceMessage(message) {
        const text = String(message || '').trim();
        if (!text) return '';
        return SERVICE_MESSAGE_TEXT[text] || text;
    }

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

    function serviceMetric(label, value, extraClass = '') {
        const safeValue = value === undefined || value === null || value === '' ? '—' : String(value);
        return `
            <span class="cm-svc-stat ${extraClass}">
                <span class="cm-svc-stat-label">${escapeHtml(label)}</span>
                <strong>${escapeHtml(safeValue)}</strong>
            </span>
        `;
    }

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes)) return '';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = bytes;
        let unit = 0;
        while (value >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit += 1;
        }
        const digits = value >= 100 ? 0 : value >= 10 ? 1 : 1;
        return `${value.toFixed(digits)} ${units[unit]}`;
    }

    function formatCpu(service) {
        if (typeof service?.cpu === 'string' && service.cpu) return service.cpu;
        if (Number.isFinite(service?.cpuPercent)) {
            const value = service.cpuPercent;
            return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
        }
        return '';
    }

    function formatMemory(service) {
        if (typeof service?.memory === 'string' && service.memory) return service.memory;
        if (typeof service?.memoryUsage === 'string' && service.memoryUsage) return service.memoryUsage;
        if (Number.isFinite(service?.memoryBytes)) return formatBytes(service.memoryBytes);
        return '';
    }

    function renderServiceStats(service, portsByService = {}) {
        const uptime = service.running ? formatUptime(service.startedAt) : '—';
        const ports = portsByService[service.id] || service.portsSummary || '';
        const cpu = service.running ? formatCpu(service) : '';
        const memory = service.running ? formatMemory(service) : '';
        const stats = [
            serviceMetric('UP', uptime, service.running ? '' : 'is-muted'),
            serviceMetric('PORTS', ports || '查看详情', ports ? '' : 'is-muted'),
        ];
        if (cpu) {
            stats.push(serviceMetric('CPU', cpu));
        }
        if (memory) {
            stats.push(serviceMetric('MEM', memory));
        }
        return `<div class="cm-svc-stats">${stats.join('')}</div>`;
    }

    function renderServiceActionButtons({
        idArg,
        status,
        canStart,
        canOperateRunning,
        cleanupSupported,
        cleanupDisabled,
        cleanupBusy,
        readOnly
    }) {
        /* 只读纳管服务（HA 集群 / Redis Cluster）不提供启停：
           HA 的启停有严格的先主后备顺序，Redis Cluster 的启停需要节点数参数，
           两者都必须走各自交付包的脚本。 */
        if (readOnly) {
            return `
                <span class="cm-svc-readonly-hint" title="只读纳管：请使用该组件交付包中的脚本执行启停与切换">只读纳管</span>
                <button type="button" class="cm-svc-action-detail btn-action-view" onclick="event.stopPropagation(); selectService(${idArg})">详情</button>
            `;
        }

        const logDisabled = isDisabledStatus(status) ? 'disabled' : '';
        if (isDisabledStatus(status)) {
            return `
                <button type="button" class="cm-svc-action-log btn-action-view" onclick="event.stopPropagation(); showLogs(true, ${idArg})" ${logDisabled}>日志</button>
                <button type="button" class="cm-svc-action-start btn-action-start" disabled>启动</button>
                <button type="button" class="cm-svc-action-more btn-action-tool" onclick="openServiceCardMenu(event, ${idArg}, ${cleanupSupported ? 'true' : 'false'}, ${cleanupDisabled ? 'true' : 'false'}, ${cleanupBusy ? 'true' : 'false'})" aria-haspopup="menu" aria-label="更多操作">...</button>
            `;
        }
        const primaryAction = canStart
            ? `<button type="button" class="cm-svc-action-start btn-action-start" onclick="event.stopPropagation(); serviceAction(${idArg}, 'up')">启动</button>`
            : `<button type="button" class="cm-svc-action-stop btn-action-stop" onclick="event.stopPropagation(); serviceAction(${idArg}, 'down')" ${canOperateRunning ? '' : 'disabled'}>停止</button>`;
        const restartAction = canOperateRunning
            ? `<button type="button" class="cm-svc-action-restart btn-action-restart" onclick="event.stopPropagation(); serviceAction(${idArg}, 'restart')">重启</button>`
            : '';
        return `
            <button type="button" class="cm-svc-action-log btn-action-view" onclick="event.stopPropagation(); showLogs(true, ${idArg})" ${logDisabled}>日志</button>
            ${primaryAction}
            ${restartAction}
            <button type="button" class="cm-svc-action-more btn-action-tool" onclick="openServiceCardMenu(event, ${idArg}, ${cleanupSupported ? 'true' : 'false'}, ${cleanupDisabled ? 'true' : 'false'}, ${cleanupBusy ? 'true' : 'false'})" aria-haspopup="menu" aria-label="更多操作">...</button>
        `;
    }

    const CAPABILITY_LABEL = {
        database: '数据库',
        cache: '缓存',
        queue: '消息队列',
        timeseries: '时序存储'
    };

    function dependencyChip(label, state, title) {
        const statusText = state === 'running' ? '运行中' : (state === 'unknown' ? '异常' : '待启动');
        return `
            <span class="dependency-status-chip ${state}" title="${escapeHtml(title || `${label}：${statusText}`)}">
                <span class="dependency-status-dot"></span>
                <span class="dependency-status-name">${escapeHtml(label)}</span>
            </span>
        `;
    }

    /**
     * 依赖状态按「能力」聚合展示，而不是逐个服务列出。
     *
     * 数据库能力可能由 postgres / postgres-ha / highgo-ha 提供，三者互斥，
     * 逐个列出会让顶部同时出现「PostgreSQL 双机热备」和「瀚高双机热备」，
     * 看起来像两个都要跑。这里一组只出一个标签：
     *   - 组内已有服务在跑 → 显示该服务名（运维关心的是「谁在提供」）
     *   - 组内只有一个候选 → 直接显示它
     *   - 多个候选且都没跑 → 显示能力名，候选放进 tooltip
     */
    function renderDependencyStatusChips(plan = {}) {
        const statusById = {};
        (plan.statuses || []).forEach(item => { statusById[item.id] = item; });

        const groups = Array.isArray(plan.dependencyGroups) ? plan.dependencyGroups : [];
        if (groups.length === 0) {
            // 旧结构（无 dependencyGroups）时保持原有的逐服务展示。
            const statuses = Array.isArray(plan.statuses) && plan.statuses.length
                ? plan.statuses
                : (plan.services || []).map(service => ({
                    ...service,
                    running: !(plan.missingServices || []).includes(service.id)
                }));
            if (!statuses.length) return '<span class="dependency-status-chip empty">无依赖</span>';
            return statuses.map(item => dependencyChip(
                item.label || item.id || 'service',
                item.running ? 'running' : (isDisabledStatus(item.status) ? 'unknown' : 'pending')
            )).join('');
        }

        const chips = groups.map(group => {
            const candidates = (group.candidates || []).map(id => statusById[id]).filter(Boolean);
            if (candidates.length === 0) return '';

            const active = candidates.find(item => item.running);
            if (active) {
                return dependencyChip(active.label || active.id, 'running', `${active.label || active.id}：运行中`);
            }
            if (candidates.length === 1) {
                const only = candidates[0];
                const state = isDisabledStatus(only.status) ? 'unknown' : 'pending';
                return dependencyChip(only.label || only.id, state);
            }
            // 多个互斥候选都未运行：显示能力名，避免误以为要全部启动。
            const names = candidates.map(item => item.label || item.id).join(' / ');
            const capabilityLabel = CAPABILITY_LABEL[group.capability] || group.capability || '依赖';
            return dependencyChip(capabilityLabel, 'pending', `${capabilityLabel}未就绪，可由以下任一提供：${names}`);
        }).filter(Boolean);

        // 业务服务本身不属于任何能力组，单独列在最后。
        const appService = (plan.services || []).find(service => !service.capability);
        if (appService) {
            const status = statusById[appService.id];
            const state = status?.running ? 'running' : (isDisabledStatus(status?.status) ? 'unknown' : 'pending');
            chips.push(dependencyChip(appService.label || appService.id, state));
        }

        return chips.length ? chips.join('') : '<span class="dependency-status-chip empty">无依赖</span>';
    }

    function renderServiceStatus(status) {
        return `
            <span class="service-status ${escapeHtml(status || 'unknown')}">
                <span class="service-status-dot"></span>${escapeHtml(status || 'unknown')}
            </span>
        `;
    }

    /** 去掉大小写、空格和连字符后比较，用于判断两个名字是否其实是同一个。 */
    function normalizeName(value) {
        return String(value || '').toLowerCase().replace(/[\s._-]/g, '');
    }

    /**
     * 卡片标题的 tooltip：名称 + 容器名 + 镜像。
     *
     * 卡片正面只留服务名。原先名称下面还有一行服务 id，但多数服务的 id 就是
     * 名字的小写形式（Cassandra / cassandra、IoTDB / iotdb、IoT Cloud /
     * iotcloud……），每张卡都把同一个词重复一遍；少数不同的又让各卡高矮不一。
     * 统一去掉那一行，卡片正面只回答「这是什么服务、在不在跑」。
     *
     * 容器名和镜像并没有丢：悬停标题即可看到，服务详情里也有「镜像」「容器名」
     * 两项。需要去命令行 `docker logs <容器名>` 或核对镜像版本时都能查到。
     */
    function buildServiceIdentityHint(service, image) {
        const label = service.label || service.id || '';
        const parts = [label];
        [service.id, image].forEach(value => {
            if (!value) return;
            // 与已列出的名字等价时不重复叠加（如 postgres · postgres）。
            if (parts.some(part => normalizeName(part) === normalizeName(value))) return;
            parts.push(value);
        });
        return parts.filter(Boolean).join(' · ');
    }

    function renderServiceCards({
        services = [],
        requiredIds = new Set(),
        appServiceId = '',
        selectedServiceId = '',
        portsByService = {},
        cleanupInFlightService = ''
    } = {}) {
        return services.map(service => {
            const required = requiredIds.has(service.id);
            const startupDependency = required && service.id !== appServiceId;
            const disabled = isDisabledStatus(service.status);
            const canStart = !disabled && !service.running;
            const canOperateRunning = !disabled && service.running;
            const selected = selectedServiceId === service.id;
            const idArg = jsArg(service.id);
            const cleanupSupported = isCleanupSupportedService(service.id);
            const cleanupBusy = cleanupInFlightService === service.id;
            const cleanupDisabled = disabled || !!cleanupInFlightService;
            const tier = inferTier(service);
            const running = !!service.running;
            const status = service.status || 'unknown';
            const statusLabel = STATUS_LABEL[status] || status;
            const image = service.image || service.composeService || '';
            const tierIcon = getTierIcon(tier);
            const readOnly = !!service.readOnly;
            const nameTitle = buildServiceIdentityHint(service, image);
            /* 筛选用的文本放进 data 属性，而不是从卡片 DOM 里读——卡片正面
               不再显示 id 与镜像了。顺便把显示名也纳入匹配：输入框写的是
               「筛选服务名 / 镜像」，但原来只匹配 id 和镜像，输入「瀚高」或
               「PostgreSQL」筛不出任何东西。 */
            const searchText = [service.label, service.id, image].filter(Boolean).join(' ').toLowerCase();
            const actionsHtml = renderServiceActionButtons({
                idArg,
                status,
                canStart,
                canOperateRunning,
                cleanupSupported,
                cleanupDisabled,
                cleanupBusy,
                readOnly
            });
            const haBadgesHtml = renderHaBadges(service);
            const nodeBadgeHtml = renderNodeBadge(service);
            const messageText = translateServiceMessage(service.message);
            const messageHtml = messageText
                ? `<div class="cm-svc-message" title="${escapeHtml(service.message || '')}">${escapeHtml(messageText)}</div>`
                : '';
            const dependencyBadgeHtml = startupDependency
                ? '<span class="cm-svc-dependency-badge" title="根据平台配置，启动业务服务前必须先运行该服务">启动依赖</span>'
                : '';
            const classes = [
                'service-card',
                'cm-svc-card',
                `cm-tier-${tier}`,
                required ? 'required' : '',
                startupDependency ? 'is-startup-dependency' : '',
                selected ? 'selected' : '',
                running ? 'is-running' : 'is-stopped',
                readOnly ? 'is-readonly' : '',
            ].filter(Boolean).join(' ');
            return `
                <div class="${classes}" data-service-id="${escapeHtml(service.id)}" data-tier="${escapeHtml(tier)}" data-search="${escapeHtml(searchText)}">
                    <div class="cm-svc-head">
                        <div class="cm-svc-head-left">
                            <span class="cm-svc-icon">${tierIcon}</span>
                            <div class="cm-svc-meta">
                                <div class="cm-svc-name-row">
                                    <span class="cm-svc-name" title="${escapeHtml(nameTitle)}">${escapeHtml(service.label || service.id)}</span>
                                    ${dependencyBadgeHtml}
                                    ${nodeBadgeHtml}
                                    ${haBadgesHtml}
                                </div>
                            </div>
                        </div>
                        <span class="cm-svc-status ${escapeHtml(status)}">
                            <span class="cm-svc-status-dot"></span>${escapeHtml(statusLabel)}
                        </span>
                    </div>
                    ${messageHtml}
                    <div class="cm-svc-actions">
                        ${actionsHtml}
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

        const sections = data.sections || [];
        const portSection = sections.find(s => (s.title || '') === '端口');
        const volumeSection = sections.find(s => (s.title || '') === '挂载');
        const otherSections = sections
            .map((section, sectionIndex) => ({ section, sectionIndex }))
            .filter(({ section }) => !['端口', '挂载'].includes(section.title || ''));

        const portsHtml = renderPortsList(portSection);
        const volumesHtml = renderVolumesList(volumeSection);

        const containerKvs = [
            { k: 'Service ID', v: serviceId || '—' },
            { k: '镜像', v: summary.image || '—' },
            { k: '容器名', v: summary.containerName || '—' },
            { k: '重启策略', v: summary.restart || '—' },
            { k: '容器 ID', v: serviceStatus.containerId ? serviceStatus.containerId.slice(0, 12) : '—' },
        ];

        const sectionsHtml = (otherSections || []).map(({ section, sectionIndex }) =>
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
                    <button class="cm-icon-close cm-detail-close-btn btn-action-close" type="button" onclick="closeServiceDetail()" aria-label="关闭详细信息">×</button>
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
                    <div class="cm-detail-port-volume-grid">
                        <div class="cm-detail-port-volume-block">
                            <div class="cm-detail-sub-title">端口</div>
                            ${portsHtml}
                        </div>
                        <div class="cm-detail-port-volume-block">
                            <div class="cm-detail-sub-title">挂载</div>
                            ${volumesHtml}
                        </div>
                    </div>
                </section>
            </div>

            ${sectionsHtml ? `
                <section class="cm-detail-sections">
                    <div class="cm-detail-col-title">完整环境变量</div>
                    <div class="service-config-sections ${getServiceConfigSectionsClass(otherSections.map(({ section }) => section))}">
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
            ? `<button class="secret-toggle btn-action-tool" type="button" title="显示" aria-label="显示 ${escapeHtml(key || '敏感配置')}" onclick="toggleServiceSecret(${sectionIndex}, ${itemIndex}, this)">${renderServiceSecretIcon(false)}</button>`
            : '';
        const copyButton = shouldShowServiceConfigCopy(item, serviceId, sectionTitle)
            ? `<button class="copy-config-value btn-action-copy" type="button" title="复制 ${escapeHtml(key || '配置值')}" aria-label="复制 ${escapeHtml(key || '配置值')}" onclick="copyServiceConfigValue(${sectionIndex}, ${itemIndex})">
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
        buildServiceIdentityHint,
        isCleanupSupportedService,
        isDisabledStatus,
        renderHaBadges,
        renderNodeBadge,
        translateServiceMessage,
        CAPABILITY_LABEL,
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
