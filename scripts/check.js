const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function collectJsFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return collectJsFiles(fullPath);
        return entry.isFile() && entry.name.endsWith('.js') ? [path.relative(root, fullPath)] : [];
    });
}

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: root,
        stdio: 'inherit',
        shell: false
    });

    if (result.error) {
        console.error(result.error.message);
        process.exit(1);
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

const syntaxFiles = [
    'tb-config-src.js',
    'config-meta.js',
    'assets/app.js',
    ...collectJsFiles(path.join(root, 'src', 'server'))
];

syntaxFiles.forEach(file => run(process.execPath, ['--check', file]));

const testFiles = fs.readdirSync(path.join(root, 'test'))
    .filter(file => file.endsWith('.test.js'))
    .map(file => path.join('test', file));
run(process.execPath, ['--test', ...testFiles]);
