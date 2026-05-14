/**
 * Trailing-edge debounce. Returns a wrapped function that delays invocation
 * until `wait` ms have elapsed since the last call.
 *
 *   const onSearch = debounce(fn, 300);
 *   onSearch.cancel();  // discard any pending invocation
 */

export function debounce(fn, wait) {
    let timer = null;
    function wrapped(...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
        }, wait);
    }
    wrapped.cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
    };
    return wrapped;
}

/**
 * Leading-edge throttle. Invokes `fn` at most once per `wait` ms.
 */
export function throttle(fn, wait) {
    let lastCall = 0;
    let timer = null;
    let lastArgs = null;
    function wrapped(...args) {
        const now = Date.now();
        const remaining = wait - (now - lastCall);
        if (remaining <= 0) {
            lastCall = now;
            fn.apply(this, args);
        } else {
            lastArgs = args;
            if (!timer) {
                timer = setTimeout(() => {
                    lastCall = Date.now();
                    timer = null;
                    fn.apply(this, lastArgs);
                }, remaining);
            }
        }
    }
    wrapped.cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        lastCall = 0;
        lastArgs = null;
    };
    return wrapped;
}
