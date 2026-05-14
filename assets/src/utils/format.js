/**
 * Display formatters. Pure functions, locale-aware where it matters.
 */

const ZH_LOCALE = 'zh-CN';

/** Format bytes as B / KB / MB / GB / TB with 1 decimal. */
export function formatBytes(bytes, decimals = 1) {
    if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return '--';
    const num = Number(bytes);
    if (num === 0) return '0 B';
    const k = 1024;
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(Math.floor(Math.log(Math.abs(num)) / Math.log(k)), units.length - 1);
    return `${(num / Math.pow(k, i)).toFixed(decimals)} ${units[i]}`;
}

/** Format a number 0..1 (or 0..100) as percentage. */
export function formatPercent(value, { fromHundred = false, decimals = 0 } = {}) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
    const n = fromHundred ? Number(value) : Number(value) * 100;
    return `${n.toFixed(decimals)}%`;
}

/** Format a duration in milliseconds as a short human string. */
export function formatDuration(ms) {
    if (!Number.isFinite(ms)) return '--';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = s / 60;
    if (m < 60) return `${m.toFixed(1)}min`;
    const h = m / 60;
    if (h < 24) return `${h.toFixed(1)}h`;
    return `${(h / 24).toFixed(1)}d`;
}

/** Format a timestamp as YYYY-MM-DD HH:mm:ss in local time. */
export function formatDateTime(value) {
    if (!value) return '--';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '--';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
         + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format a timestamp as a relative-time string (e.g. "5 分钟前"). */
export function formatRelativeTime(value, now = Date.now()) {
    if (!value) return '--';
    const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (Number.isNaN(t)) return '--';
    const diff = Math.round((t - now) / 1000);
    const abs = Math.abs(diff);
    if (abs < 60)    return diff <= 0 ? '刚刚' : '即将';
    if (abs < 3600)  return `${Math.round(abs / 60)} 分钟${diff < 0 ? '前' : '后'}`;
    if (abs < 86400) return `${Math.round(abs / 3600)} 小时${diff < 0 ? '前' : '后'}`;
    return `${Math.round(abs / 86400)} 天${diff < 0 ? '前' : '后'}`;
}

/** Truncate a string with ellipsis. */
export function truncate(text, max = 80) {
    if (text === null || text === undefined) return '';
    const s = String(text);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
