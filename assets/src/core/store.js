/**
 * Minimal reactive store. No dependencies.
 *
 *   const store = createStore({ count: 0 });
 *   store.subscribe(s => render(s));
 *   store.set({ count: 1 });                       // shallow merge
 *   store.set(prev => ({ count: prev.count + 1 })); // updater fn
 *
 * Design choices:
 *   - Shallow merge by default (matches typical UI state usage)
 *   - Listeners fire synchronously after set()
 *   - No middleware, no devtools, no time travel — keep it 30 lines
 */

export function createStore(initial = {}) {
    let state = initial;
    /** @type {Set<(state: any) => void>} */
    const listeners = new Set();

    function get() {
        return state;
    }

    function set(next) {
        const computed = typeof next === 'function' ? next(state) : next;
        if (computed === state) return;
        state = { ...state, ...computed };
        for (const fn of [...listeners]) fn(state);
    }

    function replace(next) {
        if (next === state) return;
        state = next;
        for (const fn of [...listeners]) fn(state);
    }

    function subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    return { get, set, replace, subscribe };
}
