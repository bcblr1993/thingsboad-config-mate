// Flat ESLint config (v9+).
// Scope: assets/src/** only. Legacy /assets/{api,app}.js and /assets/modules/*
// remain unchecked until they are migrated to ESM in stage 3.

import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        files: ['assets/src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                EventSource: 'readonly'
            }
        },
        rules: {
            // Catch real bugs.
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-undef': 'error',
            'no-implicit-globals': 'error',
            'no-var': 'error',
            'prefer-const': 'warn',
            'eqeqeq': ['error', 'always', { null: 'ignore' }],
            'no-prototype-builtins': 'off',

            // Style is delegated to Prettier — keep the rule list short.
            // Multi-space alignment is allowed: this codebase uses it
            // intentionally for readable parallel exports / object literals.
            'no-multi-spaces': 'off'
        }
    }
];
