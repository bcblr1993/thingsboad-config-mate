/**
 * Unified HTTP client with interceptors.
 *
 * Stage 1: thin wrapper around the existing fetch behavior (legacy api.js
 * already swapped window.fetch to route through its 401 handler — we
 * delegate to that to preserve current auth flow).
 *
 * Public API:
 *   http.request(url, options)        -> Promise<any>  (parsed JSON when possible)
 *   http.requestRaw(url, options)     -> Promise<Response>
 *   http.get / post / postText        -> shortcuts
 *   http.use('request'|'response'|'error', fn)  // register interceptor
 *
 * Interceptors:
 *   request:  ({url, options}) => ({url, options}) | void
 *   response: (parsed, ctx)   => parsed | void
 *   error:    (err, ctx)      => void  (cannot suppress; logging/notify only)
 */

import { HttpError, TimeoutError } from './errors.js';
import { logger } from './logger.js';

/** @type {{request: Function[], response: Function[], error: Function[]}} */
const interceptors = { request: [], response: [], error: [] };

const DEFAULT_TIMEOUT_MS = 30_000;

function getFetch() {
    // Use whatever the page currently has installed. Legacy api.js may have
    // replaced window.fetch with its 401-aware wrapper. We respect that.
    return (typeof window !== 'undefined' && window.fetch) || fetch;
}

async function runRequestInterceptors(ctx) {
    for (const fn of interceptors.request) {
        const out = await fn(ctx);
        if (out && typeof out === 'object') ctx = { ...ctx, ...out };
    }
    return ctx;
}

async function runResponseInterceptors(parsed, ctx) {
    let current = parsed;
    for (const fn of interceptors.response) {
        const out = await fn(current, ctx);
        if (out !== undefined) current = out;
    }
    return current;
}

async function runErrorInterceptors(err, ctx) {
    for (const fn of interceptors.error) {
        try { await fn(err, ctx); }
        catch (innerErr) { logger.warn('error-interceptor itself threw:', innerErr); }
    }
}

async function withTimeout(promise, ms, url) {
    if (!ms || ms <= 0) return promise;
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(ms, url)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

async function parseBody(res) {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        try { return await res.json(); } catch { return null; }
    }
    return await res.text();
}

async function request(url, options = {}) {
    let ctx = await runRequestInterceptors({
        url,
        options: { ...options },
        method: (options.method || 'GET').toUpperCase(),
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    });

    const fetchImpl = getFetch();
    let res;
    try {
        res = await withTimeout(fetchImpl(ctx.url, ctx.options), ctx.timeoutMs, ctx.url);
    } catch (err) {
        await runErrorInterceptors(err, ctx);
        throw err;
    }

    if (!res.ok) {
        const body = await parseBody(res).catch(() => null);
        const httpErr = new HttpError(res.status, `HTTP ${res.status} ${res.statusText}`, {
            url: ctx.url, method: ctx.method, body
        });
        await runErrorInterceptors(httpErr, ctx);
        throw httpErr;
    }

    const parsed = await parseBody(res);
    return await runResponseInterceptors(parsed, ctx);
}

async function requestRaw(url, options = {}) {
    const ctx = await runRequestInterceptors({
        url, options: { ...options },
        method: (options.method || 'GET').toUpperCase(),
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    });
    const fetchImpl = getFetch();
    return await withTimeout(fetchImpl(ctx.url, ctx.options), ctx.timeoutMs, ctx.url);
}

function get(url, options) {
    return request(url, { ...options, method: 'GET' });
}

function postJson(url, body, options) {
    return request(url, {
        ...options,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(options?.headers) },
        body: JSON.stringify(body ?? {})
    });
}

function postText(url, body, options) {
    return request(url, {
        ...options,
        method: 'POST',
        body: body ?? ''
    });
}

function use(type, fn) {
    if (!interceptors[type]) throw new Error(`Unknown interceptor type: ${type}`);
    if (typeof fn !== 'function') throw new TypeError('Interceptor must be a function');
    interceptors[type].push(fn);
    return () => {
        const idx = interceptors[type].indexOf(fn);
        if (idx >= 0) interceptors[type].splice(idx, 1);
    };
}

export const http = { request, requestRaw, get, postJson, postText, use };
