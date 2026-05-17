/* Config Mate · Cloud-Console overview page renderer.
   Pure render helpers driven by app.js (which owns state + API calls). */

(function () {
    'use strict';

    const escapeHtml = (window.ConfigMateUi && ConfigMateUi.escapeHtml)
        || (s => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

    /* Heuristic service-tier mapping. Real tier metadata lands in stage 4
       (service-registry exposes a `tier` field). Until then we infer from
       the service id / image. */
    const TIER_HEURISTICS = [
        { tier: 'storage',  match: /^postgres|^cassandra|^mysql|^mongo/i },
        { tier: 'cache',    match: /^redis|^memcache/i },
        { tier: 'queue',    match: /^kafka|^zookeeper|^rabbit|^nats/i },
        { tier: 'monitor',  match: /^netdata|^grafana|^prometheus|^loki/i },
    ];

    function classifyTier(service) {
        if (!service) return 'business';
        if (service.tier) return service.tier;
        const id = service.id || '';
        for (const rule of TIER_HEURISTICS) {
            if (rule.match.test(id)) return rule.tier;
        }
        return 'business';
    }

    const TIER_LABEL = {
        business: '业务',
        storage:  '存储',
        cache:    '缓存',
        queue:    '队列',
        monitor:  '监控',
    };

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes)) return '—';
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

    function formatRelativeTime(ts) {
        if (!ts) return '';
        const date = typeof ts === 'string' || typeof ts === 'number' ? new Date(ts) : ts;
        if (Number.isNaN(date.getTime())) return '';
        const diff = Date.now() - date.getTime();
        const min = Math.floor(diff / 60000);
        if (min < 1) return '刚刚';
        if (min < 60) return `${min} 分钟前`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr} 小时前`;
        const day = Math.floor(hr / 24);
        if (day < 30) return `${day} 天前`;
        return date.toLocaleDateString('zh-CN');
    }

    function kpiHtml({ key, value, sub, tone, icon }) {
        const toneClass = tone ? ` cm-kpi-${tone}` : '';
        const iconHtml = icon ? `<span class="cm-kpi-icon" aria-hidden="true">${icon}</span>` : '';
        return `
            <div class="cm-kpi${toneClass}">
                <div class="cm-kpi-head">
                    <span class="cm-kpi-label">${escapeHtml(key)}</span>
                    ${iconHtml}
                </div>
                <div class="cm-kpi-body">
                    <span class="cm-kpi-value">${escapeHtml(value)}</span>
                    ${sub ? `<span class="cm-kpi-sub">${escapeHtml(sub)}</span>` : ''}
                </div>
            </div>`;
    }

    const ICONS = {
        cube: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
        play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>',
        alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>',
        diff: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
        clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
        disk: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path></svg>',
    };

    function renderKPIs({ services, plan, drift, history, disk }) {
        const total = services?.length || 0;
        const running = (services || []).filter(s => s.running).length;
        const stopped = total - running;
        const stoppedNames = (services || [])
            .filter(s => !s.running)
            .slice(0, 2)
            .map(s => s.id)
            .join(', ');

        const driftCount = Number.isFinite(drift?.modifiedCount)
            ? drift.modifiedCount
            : Number.isFinite(drift?.count) ? drift.count : null;
        const driftValue = driftCount == null ? '—' : String(driftCount);
        const driftTone = driftCount > 0 ? 'warn' : (driftCount === 0 ? 'ok' : '');
        const driftSub = driftCount > 0 ? '项 · 待重启' : (driftCount === 0 ? '无漂移' : '检查中');

        const historyCount = Array.isArray(history) ? history.length : (Number.isFinite(history?.count) ? history.count : null);
        const historyValue = historyCount == null ? '—' : String(historyCount);
        const historySub = historyCount == null ? '加载中' : '/ 5 上限';

        let diskValue = '—';
        let diskSub = '加载中';
        let diskTone = '';
        if (disk?.available && Number.isFinite(disk.percent)) {
            diskValue = `${disk.percent}%`;
            diskSub = `${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`;
            diskTone = disk.percent >= 85 ? 'danger' : (disk.percent >= 70 ? 'warn' : '');
        } else if (disk && !disk.available) {
            diskValue = '—';
            diskSub = '不可用';
        }

        return [
            kpiHtml({ key: '服务总数', value: String(total), sub: total ? `${(plan?.services || []).length || total} 项依赖` : null, icon: ICONS.cube }),
            kpiHtml({ key: '运行中', value: String(running), sub: total ? `共 ${total} 个` : null, tone: running > 0 ? 'ok' : '', icon: ICONS.play }),
            kpiHtml({ key: '已停止', value: String(stopped), sub: stoppedNames || (stopped ? null : '全部健康'), tone: stopped > 0 ? 'warn' : 'ok', icon: ICONS.alert }),
            kpiHtml({ key: '配置漂移', value: driftValue, sub: driftSub, tone: driftTone, icon: ICONS.diff }),
            kpiHtml({ key: '历史版本', value: historyValue, sub: historySub, icon: ICONS.clock }),
            kpiHtml({ key: '磁盘使用', value: diskValue, sub: diskSub, tone: diskTone, icon: ICONS.disk }),
        ].join('');
    }

    /* Tier-aware service mark (filled square with the tier-specific
       Lucide-style icon). Returns inline SVG. */
    const TIER_ICONS = {
        business: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
        storage:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path></svg>',
        cache:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>',
        queue:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
        monitor:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
    };

    function formatUptime(startedAt) {
        if (!startedAt) return '—';
        const start = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
        if (!Number.isFinite(start)) return '—';
        let diffSec = Math.max(0, Math.floor((Date.now() - start) / 1000));
        const day = Math.floor(diffSec / 86400);
        diffSec -= day * 86400;
        const hr = Math.floor(diffSec / 3600);
        diffSec -= hr * 3600;
        const min = Math.floor(diffSec / 60);
        if (day > 0) return `${day}d ${hr}h`;
        if (hr > 0) return `${hr}h ${min}m`;
        if (min > 0) return `${min}m`;
        return '刚刚';
    }

    function renderServiceTiles(services) {
        if (!services || services.length === 0) {
            return '<div class="cm-overview-empty">暂无服务记录</div>';
        }
        return services.map(s => {
            const tier = classifyTier(s);
            const running = !!s.running;
            const statusLabel = running ? 'Running' : (s.status === 'missing' || s.status === 'unsupported' ? '不可用' : 'Stopped');
            const statusClass = running ? 'cm-tile-status-ok' : (s.status === 'missing' || s.status === 'unsupported' ? 'cm-tile-status-warn' : 'cm-tile-status-stopped');
            const image = s.image || s.composeService || s.label || '';
            const tierIcon = TIER_ICONS[tier] || TIER_ICONS.business;
            const uptime = running ? formatUptime(s.startedAt) : '—';
            return `
                <button type="button" class="cm-service-tile cm-tier-${tier} ${running ? 'is-running' : 'is-stopped'}" data-service-id="${escapeHtml(s.id)}" onclick="navigateRoute('deployment')">
                    <div class="cm-tile-head">
                        <span class="cm-tile-icon" aria-hidden="true">${tierIcon}</span>
                        <span class="cm-tile-meta">
                            <span class="cm-tile-name">${escapeHtml(s.id || s.label)}</span>
                            <span class="cm-tile-desc">${escapeHtml(image)}</span>
                        </span>
                        <span class="cm-tile-status ${statusClass}">
                            <span class="cm-tile-dot"></span>${escapeHtml(statusLabel)}
                        </span>
                    </div>
                    <div class="cm-tile-metrics">
                        <div class="cm-tile-metric">
                            <span class="cm-tile-metric-key">UP</span>
                            <span class="cm-tile-metric-val">${escapeHtml(uptime)}</span>
                        </div>
                        <div class="cm-tile-metric">
                            <span class="cm-tile-metric-key">CPU</span>
                            <span class="cm-tile-metric-val">—</span>
                        </div>
                        <div class="cm-tile-metric">
                            <span class="cm-tile-metric-key">MEM</span>
                            <span class="cm-tile-metric-val">—</span>
                        </div>
                    </div>
                </button>`;
        }).join('');
    }

    function renderTierLegend(services) {
        const tiers = ['business', 'storage', 'cache', 'queue', 'monitor'];
        const counts = Object.fromEntries(tiers.map(t => [t, { total: 0, stopped: 0 }]));
        (services || []).forEach(s => {
            const t = classifyTier(s);
            if (!counts[t]) return;
            counts[t].total += 1;
            if (!s.running) counts[t].stopped += 1;
        });
        return tiers.map(t => {
            const c = counts[t];
            const icon = TIER_ICONS[t] || '';
            const sub = c.total === 0
                ? '<span class="cm-tier-legend-sub muted">无服务</span>'
                : c.stopped > 0
                    ? `<span class="cm-tier-legend-sub warn">${c.stopped} 停止</span>`
                    : '<span class="cm-tier-legend-sub ok">全部健康</span>';
            return `
                <div class="cm-tier-legend-card cm-tier-${t}">
                    <div class="cm-tier-legend-head">
                        <span class="cm-tier-legend-icon" aria-hidden="true">${icon}</span>
                        <span class="cm-tier-legend-label">${escapeHtml(TIER_LABEL[t] || t)}</span>
                    </div>
                    <div class="cm-tier-legend-count">${c.total}</div>
                    ${sub}
                </div>`;
        }).join('');
    }

    function renderAlerts({ services, drift }) {
        const alerts = [];
        const stopped = (services || []).filter(s => !s.running && s.status !== 'missing-image');
        if (stopped.length > 0) {
            alerts.push({
                tone: 'warn',
                title: `${stopped.length} 个服务已停止`,
                desc: stopped.map(s => s.id).slice(0, 3).join(' / '),
                action: { label: '查看', target: 'deployment' }
            });
        }
        const driftCount = Number.isFinite(drift?.modifiedCount) ? drift.modifiedCount : 0;
        if (driftCount > 0) {
            alerts.push({
                tone: 'info',
                title: `${driftCount} 项配置已修改未生效`,
                desc: '运行中的容器环境与本地 .env 存在差异',
                action: { label: '去业务配置', target: 'config' }
            });
        }
        if (alerts.length === 0) {
            return '<div class="cm-overview-no-alert"><span class="cm-overview-no-alert-dot"></span>当前没有需要处理的告警</div>';
        }
        return alerts.map(a => `
            <div class="cm-alert cm-alert-${a.tone}">
                <span class="cm-alert-icon">${ICONS.alert}</span>
                <div class="cm-alert-body">
                    <div class="cm-alert-title">${escapeHtml(a.title)}</div>
                    <div class="cm-alert-desc">${escapeHtml(a.desc)}</div>
                </div>
                <button class="cm-alert-action" type="button" onclick="navigateRoute('${escapeHtml(a.action.target)}')">${escapeHtml(a.action.label)} →</button>
            </div>`).join('');
    }

    function renderActivity(items) {
        if (!Array.isArray(items) || items.length === 0) {
            return '<li class="cm-overview-empty">暂无历史记录</li>';
        }
        return items.slice(0, 5).map(item => {
            const filename = item.filename || item.name || '配置快照';
            const time = item.timestamp || item.savedAt || item.mtime;
            const operator = item.operator || item.metadata?.operator || '';
            const titleHtml = operator
                ? `<strong>${escapeHtml(operator)}</strong> 保存了配置`
                : `配置历史快照`;
            return `
                <li class="cm-activity-item">
                    <span class="cm-activity-dot"></span>
                    <div class="cm-activity-body">
                        <div class="cm-activity-title">${titleHtml}</div>
                        <div class="cm-activity-desc">${escapeHtml(filename)}</div>
                    </div>
                    <span class="cm-activity-time">${escapeHtml(formatRelativeTime(time))}</span>
                </li>`;
        }).join('');
    }

    function mount(overview) {
        const kpiRow = document.getElementById('overview-kpi-row');
        const grid = document.getElementById('overview-services');
        const tierLegend = document.getElementById('overview-tier-legend');
        const meta = document.getElementById('overview-services-meta');
        const alerts = document.getElementById('overview-alerts');
        const activity = document.getElementById('overview-activity');
        const subtitle = document.getElementById('overview-subtitle');

        if (kpiRow) kpiRow.innerHTML = renderKPIs(overview);
        if (grid) grid.innerHTML = renderServiceTiles(overview.services);
        if (tierLegend) tierLegend.innerHTML = renderTierLegend(overview.services);
        if (alerts) alerts.innerHTML = renderAlerts(overview);
        if (activity) activity.innerHTML = renderActivity(overview.history);
        if (meta) {
            const total = overview.services?.length || 0;
            const running = (overview.services || []).filter(s => s.running).length;
            meta.textContent = total > 0 ? `${running} / ${total} 运行中` : '尚未获取服务状态';
        }
        if (subtitle && overview.deployment) {
            const d = overview.deployment;
            const appType = d.appType || '—';
            const appService = d.appService || '—';
            subtitle.textContent = `${d.appDir || ''} · APP_TYPE = ${appType} · 主服务 ${appService}`;
        }
    }

    window.ConfigMateOverviewUi = {
        mount,
        renderKPIs,
        renderServiceTiles,
        renderTierLegend,
        renderAlerts,
        renderActivity,
        classifyTier,
        formatUptime,
        TIER_LABEL,
        TIER_ICONS
    };
})();
