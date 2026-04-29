const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    checkComposeFileContent,
    validateComposeFiles
} = require('../src/server/routes/install');

function tempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'config-mate-install-routes-'));
}

test('checkComposeFileContent ignores commented compose keys', () => {
    const root = tempRoot();
    const compose = path.join(root, 'docker-compose.yml');
    fs.writeFileSync(compose, [
        'services:',
        '  app:',
        '    image: app',
        '    # env_file:',
        '    environment:',
        '      A: B'
    ].join('\n'));

    assert.equal(checkComposeFileContent(compose, 'env_file'), false);
    fs.writeFileSync(compose, 'services:\n  app:\n    env_file:\n      - ./.env\n');
    assert.equal(checkComposeFileContent(compose, 'env_file'), true);
});

test('validateComposeFiles reports missing ThingsBoard yaml before compose checks', () => {
    const root = tempRoot();
    const result = validateComposeFiles({
        appDir: root,
        appDef: {
            composePath: 'docker-compose.yml',
            composeAbsPath: path.join(root, 'docker-compose.yml')
        }
    });

    assert.deepEqual(result, {
        status: 'config_missing',
        msg: 'Missing ThingsBoard configuration files',
        files: ['conf/thingsboard.yml', 'conf/tb-edge.yml']
    });
});

test('validateComposeFiles validates compose files and env_file declarations', () => {
    const root = tempRoot();
    const conf = path.join(root, 'conf');
    fs.mkdirSync(conf, { recursive: true });
    fs.writeFileSync(path.join(conf, 'thingsboard.yml'), 'spring: {}\n');

    const compose = path.join(root, 'docker-compose.yml');
    const installCompose = path.join(root, 'docker-compose-install.yml');
    const appDef = {
        composePath: 'docker-compose.yml',
        composeAbsPath: compose,
        installComposePath: 'docker-compose-install.yml',
        installComposeAbsPath: installCompose
    };

    assert.deepEqual(validateComposeFiles({ appDir: root, appDef }), {
        status: 'missing',
        files: ['docker-compose.yml', 'docker-compose-install.yml']
    });

    fs.writeFileSync(compose, 'services:\n  app:\n    env_file:\n      - ./.env\n');
    fs.writeFileSync(installCompose, 'services:\n  install:\n    image: app\n');
    assert.deepEqual(validateComposeFiles({ appDir: root, appDef }), {
        status: 'error',
        errors: [{ file: 'docker-compose-install.yml', msg: '未配置 env_file (Missing env_file property)' }]
    });

    fs.writeFileSync(installCompose, 'services:\n  install:\n    env_file:\n      - ./.env\n');
    assert.deepEqual(validateComposeFiles({ appDir: root, appDef }), { status: 'success' });
});
