/**
 * Form field renderer. Builds the standard label + input + helper +
 * error layout used in the UI preview page (`.cm-field` system).
 *
 *   import { renderField } from '@/src/components/form/field.js';
 *   const node = renderField({
 *     name: 'port',
 *     label: '数据库端口',
 *     value: 5432,
 *     helper: '默认 PostgreSQL 端口',
 *     errors: ['必须在 1-65535 之间'],
 *     required: true,
 *     type: 'number',
 *     onInput: (val) => store.update('port', val)
 *   });
 *   container.appendChild(node);
 */

import { el, escapeHtml } from '../../utils/dom.js';

/**
 * @param {Object} props
 * @param {string} props.name
 * @param {string} props.label
 * @param {any} [props.value]
 * @param {string} [props.helper]
 * @param {string[]} [props.errors]
 * @param {boolean} [props.required]
 * @param {boolean} [props.disabled]
 * @param {string} [props.type]            'text' (default) | 'number' | 'password' | 'textarea' | 'select'
 * @param {Array<{value: string, label: string}>} [props.options]   for type=select
 * @param {string} [props.placeholder]
 * @param {(value: string) => void} [props.onInput]
 * @param {(value: string) => void} [props.onChange]
 * @returns {HTMLElement}
 */
export function renderField(props) {
    const {
        name, label, value = '', helper, errors = [], required: isRequired = false,
        disabled = false, type = 'text', options = [], placeholder = '',
        onInput, onChange
    } = props;

    const hasError = errors.length > 0;
    const inputId = `cm-field-${name}`;

    const labelNode = el('label', { className: 'cm-field-label', for: inputId }, [
        label,
        isRequired ? el('span', { className: 'cm-field-required' }, '*') : null
    ]);

    let input;
    if (type === 'textarea') {
        input = /** @type {HTMLTextAreaElement} */ (el('textarea', {
            id: inputId,
            name,
            className: 'cm-field-input' + (hasError ? ' is-error' : ''),
            placeholder,
            disabled,
            rows: 3
        }));
        input.value = String(value ?? '');
    } else if (type === 'select') {
        const children = options.map(opt =>
            el('option', { value: opt.value, selected: opt.value === value }, opt.label)
        );
        input = /** @type {HTMLSelectElement} */ (el('select', {
            id: inputId,
            name,
            className: 'cm-field-input' + (hasError ? ' is-error' : ''),
            disabled
        }, children));
        input.value = String(value ?? '');
    } else {
        input = el('input', {
            id: inputId,
            name,
            type,
            className: 'cm-field-input' + (hasError ? ' is-error' : ''),
            placeholder,
            disabled,
            value: String(value ?? '')
        });
    }

    if (typeof onInput === 'function') {
        input.addEventListener('input', () => onInput(/** @type any */(input).value));
    }
    if (typeof onChange === 'function') {
        input.addEventListener('change', () => onChange(/** @type any */(input).value));
    }

    const children = [labelNode, input];

    if (hasError) {
        for (const msg of errors) {
            children.push(el('span', { className: 'cm-field-error' }, msg));
        }
    } else if (helper) {
        children.push(el('span', { className: 'cm-field-helper' }, helper));
    }

    return el('div', { className: 'cm-field', dataset: { name } }, children);
}

/**
 * Lightweight inline error renderer for already-existing inputs.
 * Useful when you need to add validation feedback to legacy DOM
 * without rebuilding the field.
 *
 * @param {HTMLElement} inputEl
 * @param {string[]} errors
 */
export function setFieldErrors(inputEl, errors) {
    if (!inputEl) return;
    const container = inputEl.closest('.cm-field') || inputEl.parentElement;
    if (!container) return;

    inputEl.classList.toggle('is-error', errors.length > 0);

    container.querySelectorAll('.cm-field-error').forEach(node => node.remove());
    for (const msg of errors) {
        const span = document.createElement('span');
        span.className = 'cm-field-error';
        span.textContent = msg;
        container.appendChild(span);
    }
}

// Avoid lint warning when escapeHtml is unused at this stage.
void escapeHtml;
