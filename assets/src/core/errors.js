/**
 * Typed errors for cross-layer propagation.
 *
 * Layering rule:
 *   - HTTP layer throws HttpError
 *   - Service layer converts to BizError or rethrows
 *   - Page layer catches and presents (toast / banner / redirect)
 */

export class HttpError extends Error {
    /**
     * @param {number} status HTTP status code
     * @param {string} message Human-readable message
     * @param {object} [options]
     * @param {string} [options.url]
     * @param {string} [options.method]
     * @param {unknown} [options.body] Response body (parsed when JSON)
     */
    constructor(status, message, options = {}) {
        super(message || `HTTP ${status}`);
        this.name = 'HttpError';
        this.status = status;
        this.url = options.url;
        this.method = options.method;
        this.body = options.body;
    }

    get isUnauthorized() { return this.status === 401; }
    get isForbidden()    { return this.status === 403; }
    get isNotFound()     { return this.status === 404; }
    get isServerError()  { return this.status >= 500; }
}

export class BizError extends Error {
    /**
     * @param {string} code Application-level error code
     * @param {string} message User-facing message
     * @param {object} [meta] Extra metadata (logged, not shown)
     */
    constructor(code, message, meta) {
        super(message);
        this.name = 'BizError';
        this.code = code;
        this.meta = meta;
    }
}

export class TimeoutError extends Error {
    constructor(ms, url) {
        super(`Request timed out after ${ms}ms: ${url}`);
        this.name = 'TimeoutError';
        this.timeoutMs = ms;
        this.url = url;
    }
}
