/**
 * Schema-based form validator. Replaces the per-field validation
 * scattered through legacy app.js (validateField, validateConfig).
 *
 *   import { validate, required, pattern, range, maxLength, custom } from
 *     '@/src/components/form/validator.js';
 *
 *   const schema = {
 *     name: [required(), pattern(/^[a-z0-9-]+$/, '名称只能包含小写字母、数字和短横线'),
 *            maxLength(32)],
 *     port: [required(), range(1, 65535, '端口必须是 1-65535 的数字')]
 *   };
 *   const { ok, errors } = validate(values, schema);
 *   // ok: boolean
 *   // errors: { [field]: string[] }
 */

/**
 * @typedef {(value: any, fieldName: string, allValues: Record<string, any>) => string | null} Rule
 */

/** @returns {Rule} */
export function required(message = '必填项') {
    return value => {
        if (value === undefined || value === null) return message;
        if (typeof value === 'string' && value.trim() === '') return message;
        if (Array.isArray(value) && value.length === 0) return message;
        return null;
    };
}

/** @returns {Rule} */
export function pattern(re, message = '格式不正确') {
    return value => {
        if (value === undefined || value === null || value === '') return null;
        return re.test(String(value)) ? null : message;
    };
}

/** @returns {Rule} */
export function maxLength(max, message) {
    return value => {
        if (value === undefined || value === null) return null;
        const len = String(value).length;
        return len > max ? (message || `长度不能超过 ${max}`) : null;
    };
}

/** @returns {Rule} */
export function minLength(min, message) {
    return value => {
        if (value === undefined || value === null) return null;
        const len = String(value).length;
        return len < min ? (message || `长度不能少于 ${min}`) : null;
    };
}

/** @returns {Rule} */
export function range(min, max, message) {
    return value => {
        if (value === undefined || value === null || value === '') return null;
        const n = Number(value);
        if (Number.isNaN(n)) return message || `必须是 ${min}-${max} 之间的数字`;
        if (n < min || n > max) return message || `必须在 ${min} 到 ${max} 之间`;
        return null;
    };
}

/** @returns {Rule} */
export function oneOf(allowed, message) {
    return value => {
        if (value === undefined || value === null || value === '') return null;
        return allowed.includes(value) ? null : (message || `必须是 ${allowed.join(' / ')} 之一`);
    };
}

/** @returns {Rule} */
export function custom(fn, message = '校验失败') {
    return (value, name, all) => {
        try {
            const result = fn(value, name, all);
            if (result === true || result === null || result === undefined) return null;
            if (result === false) return message;
            return String(result); // result is a custom error string
        } catch (err) {
            return err?.message || message;
        }
    };
}

/**
 * @param {Record<string, any>} values
 * @param {Record<string, Rule[]>} schema
 * @returns {{ok: boolean, errors: Record<string, string[]>}}
 */
export function validate(values, schema) {
    /** @type {Record<string, string[]>} */
    const errors = {};
    let ok = true;

    for (const [field, rules] of Object.entries(schema || {})) {
        const value = values?.[field];
        for (const rule of rules || []) {
            const message = rule(value, field, values || {});
            if (message) {
                if (!errors[field]) errors[field] = [];
                errors[field].push(message);
                ok = false;
            }
        }
    }

    return { ok, errors };
}
