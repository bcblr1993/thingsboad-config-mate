const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esmSyntaxPattern = /^\s*(?:import|export)\s/m;

function collectJsFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return collectJsFiles(fullPath);
        return entry.isFile() && entry.name.endsWith('.js') ? [path.relative(root, fullPath)] : [];
    });
}

function run(command, args, label = '') {
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
        if (label) console.error(`Check failed: ${label}`);
        process.exit(result.status || 1);
    }
}

function checkSyntax(file) {
    const absolutePath = path.join(root, file);
    const source = fs.readFileSync(absolutePath, 'utf8');
    if (!esmSyntaxPattern.test(source)) {
        run(process.execPath, ['--check', file], file);
        return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-mate-check-'));
    const tempFile = path.join(tempDir, `${path.basename(file, '.js')}.mjs`);
    try {
        fs.writeFileSync(tempFile, source);
        run(process.execPath, ['--check', tempFile], file);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

const syntaxFiles = [
    'tb-config-src.js',
    'config-meta.js',
    ...collectJsFiles(path.join(root, 'assets')),
    ...collectJsFiles(path.join(root, 'src', 'server'))
];

syntaxFiles.forEach(checkSyntax);

const testFiles = fs.readdirSync(path.join(root, 'test'))
    .filter(file => file.endsWith('.test.js'))
    .map(file => path.join('test', file));
run(process.execPath, ['--test', ...testFiles]);
