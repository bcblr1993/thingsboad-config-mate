const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
    checkComposeFileContent,
    createInstallRoutes,
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

test('install route checks dependencies instead of requiring app service running', async () => {
    const root = tempRoot();
    const installCompose = path.join(root, 'docker-compose-install.yml');
    fs.writeFileSync(installCompose, 'services:\n  install:\n    env_file:\n      - ./.env\n');

    let dependencyGuardCalled = false;
    const routes = createInstallRoutes({
        appRoot: root,
        appDir: root,
        dockerRuntime: {
            dockerComposeCmd: 'docker',
            dockerComposeCmdArgs: ['compose']
        },
        getServiceDefinition: () => ({
            id: 'iotcloud',
            installComposePath: 'services/iotcloud/docker-compose-install.yml',
            installComposeAbsPath: installCompose
        }),
        getPackageServiceId: () => 'iotcloud',
        guardAppServiceDependencies: async actionText => {
            dependencyGuardCalled = true;
            assert.equal(actionText, '执行初始化安装');
            return {
                status: 'error',
                code: 'DEPENDENCIES_NOT_RUNNING',
                message: '请先启动依赖服务：PostgreSQL'
            };
        }
    });

    const req = new EventEmitter();
    const body = await new Promise(resolve => {
        const res = {
            writeHead(statusCode, headers) {
                this.statusCode = statusCode;
                this.headers = headers;
            },
            end(payload) {
                resolve({ statusCode: this.statusCode, headers: this.headers, payload });
            }
        };

        const handled = routes.handle(req, res, {
            method: 'POST',
            pathname: '/api/install',
            headers: {}
        });
        assert.equal(handled, true);
    });

    assert.equal(dependencyGuardCalled, true);
    assert.equal(body.statusCode, 409);
    assert.equal(JSON.parse(body.payload).code, 'DEPENDENCIES_NOT_RUNNING');
});

test('install route uses docker runtime compose args for install compose file', async () => {
    const root = tempRoot();
    const installCompose = path.join(root, 'docker-compose-install.yml');
    fs.writeFileSync(installCompose, 'services:\n  install:\n    env_file:\n      - ./.env\n');

    const spawnCalls = [];
    const spawnedChildren = [];
    function spawn(cmd, args, options) {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.killed = false;
        child.kill = () => {
            child.killed = true;
        };
        spawnCalls.push({ cmd, args, options });
        spawnedChildren.push(child);
        setImmediate(() => child.emit('close', 0));
        return child;
    }

    const routes = createInstallRoutes({
        appRoot: root,
        appDir: root,
        dockerRuntime: {
            dockerComposeCmd: 'docker',
            composeArgsFor(def, args) {
                return ['compose', '--prepared', def.composeAbsPath, ...args];
            }
        },
        getServiceDefinition: () => ({
            id: 'iotcloud',
            composeService: 'iotcloud',
            installComposePath: 'services/iotcloud/docker-compose-install.yml',
            installComposeAbsPath: installCompose
        }),
        getPackageServiceId: () => 'iotcloud',
        guardAppServiceDependencies: async () => null,
        spawn
    });

    const req = new EventEmitter();
    const body = await new Promise(resolve => {
        const chunks = [];
        const res = {
            writeHead(statusCode, headers) {
                this.statusCode = statusCode;
                this.headers = headers;
            },
            write(chunk) {
                chunks.push(String(chunk));
            },
            end(payload = '') {
                chunks.push(String(payload));
                resolve({ statusCode: this.statusCode, headers: this.headers, payload: chunks.join('') });
            }
        };

        const handled = routes.handle(req, res, {
            method: 'POST',
            pathname: '/api/install',
            headers: {}
        });
        assert.equal(handled, true);
    });

    assert.equal(body.statusCode, 200);
    assert.match(body.payload, /\[SUCCESS\] 安装完成/);
    assert.deepEqual(spawnCalls.map(call => call.args), [
        ['compose', '--prepared', installCompose, 'down'],
        ['compose', '--prepared', installCompose, 'up']
    ]);
    assert.deepEqual(spawnCalls.map(call => call.options), [
        { cwd: root },
        { cwd: root }
    ]);
    assert.equal(spawnedChildren.length, 2);
});
