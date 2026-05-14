import { env } from './env.js';

const noop = () => {};

function prefix(level) {
    return `[CM ${level}]`;
}

export const logger = {
    debug: env.isDev ? console.debug.bind(console, prefix('debug')) : noop,
    info:  env.isDev ? console.info.bind(console, prefix('info'))  : noop,
    warn:  console.warn.bind(console, prefix('warn')),
    error: console.error.bind(console, prefix('error'))
};
