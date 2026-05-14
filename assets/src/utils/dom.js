/**
 * Minimal DOM helpers. Intentionally small — components should prefer
 * direct DOM APIs. These are for the most common patterns only.
 */

/** Escape HTML special characters for safe interpolation. */
export function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** querySelector with optional scope; returns null when not found. */
export function $(selector, scope = document) {
    return scope.querySelector(selector);
}

/** querySelectorAll, returning a true Array. */
export function $$(selector, scope = document) {
    return Array.from(scope.querySelectorAll(selector));
}

/**
 * Create an element with attributes and children.
 *
 *   el('div', { className: 'card', dataset: { id: 7 } }, [
 *     el('h3', {}, 'Title'),
 *     'plain text'
 *   ])
 */
export function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'className') node.className = String(value);
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else node.setAttribute(key, value);
    }
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

/** Toggle class based on condition. */
export function toggleClass(node, className, condition) {
    if (!node) return;
    if (condition) node.classList.add(className);
    else node.classList.remove(className);
}
