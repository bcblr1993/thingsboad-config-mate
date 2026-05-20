module.exports = {
    extends: ['stylelint-config-standard', 'stylelint-config-standard-scss'],
    ignoreFiles: [
        'node_modules/**',
        'dist/**',
        'build/**',
        'coverage/**',
        'tests/ui/report/**',
        'tests/backstop/test/**',
        'tests/backstop/report/**',
        'tests/backstop/ci-report/**'
    ],
    overrides: [
        {
            files: ['**/*.css'],
            customSyntax: 'postcss-safe-parser'
        },
        {
            files: ['**/*.scss'],
            customSyntax: 'postcss-scss'
        },
        {
            files: ['**/*.less'],
            customSyntax: 'postcss-less'
        },
        {
            files: ['**/*.{html,vue}'],
            customSyntax: 'postcss-html'
        },
        {
            files: ['**/*.{jsx,tsx}'],
            customSyntax: 'postcss-styled-syntax'
        }
    ],
    rules: {
        'color-no-invalid-hex': true,
        'declaration-block-no-duplicate-properties': [true, {
            ignore: ['consecutive-duplicates-with-different-values']
        }],
        'color-function-alias-notation': null,
        'comment-empty-line-before': null,
        'custom-property-empty-line-before': null,
        'declaration-block-no-redundant-longhand-properties': null,
        'declaration-block-single-line-max-declarations': null,
        'media-feature-range-notation': null,
        'no-descending-specificity': null,
        'property-no-deprecated': null,
        'property-no-vendor-prefix': null,
        'rule-empty-line-before': null,
        'selector-not-notation': null,
        'shorthand-property-no-redundant-values': null,
        'value-keyword-case': null,
        'declaration-property-value-keyword-no-deprecated': null,
        'keyframes-name-pattern': null,
        'no-duplicate-selectors': [true, { severity: 'warning' }],
        'selector-class-pattern': [
            '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$|^is-[a-z0-9-]+$|^has-[a-z0-9-]+$',
            {
                message: 'Class selectors should use lowercase kebab-case, or state prefixes like is-/has-.',
                severity: 'warning'
            }
        ],
        'color-hex-length': ['long', { severity: 'warning' }],
        'color-function-notation': ['modern', { severity: 'warning' }],
        'alpha-value-notation': ['percentage', { severity: 'warning' }],
        'function-url-quotes': 'always',
        'font-family-name-quotes': 'always-where-recommended',
        'selector-max-id': [2, { severity: 'warning' }],
        'selector-max-compound-selectors': [5, { severity: 'warning' }],
        'declaration-no-important': [true, { severity: 'warning' }],
        'declaration-property-value-disallowed-list': [{
            '/color$/': ['/#[0-9a-fA-F]{3,8}\\b/', '/rgba?\\(/', '/hsla?\\(/'],
            'background': ['/#[0-9a-fA-F]{3,8}\\b/', '/rgba?\\(/', '/hsla?\\(/'],
            'background-color': ['/#[0-9a-fA-F]{3,8}\\b/', '/rgba?\\(/', '/hsla?\\(/'],
            'border': ['/#[0-9a-fA-F]{3,8}\\b/', '/rgba?\\(/', '/hsla?\\(/'],
            'border-color': ['/#[0-9a-fA-F]{3,8}\\b/', '/rgba?\\(/', '/hsla?\\(/'],
            'box-shadow': ['/#[0-9a-fA-F]{3,8}\\b/', '/rgba?\\(/', '/hsla?\\(/'],
            'text-shadow': ['/#[0-9a-fA-F]{3,8}\\b/', '/rgba?\\(/', '/hsla?\\(/']
        }, {
            severity: 'warning'
        }]
    }
};
