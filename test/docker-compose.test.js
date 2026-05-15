const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    createDockerComposeRuntime,
    sanitizeEnvFileForCompose
} = require('../src/server/docker/compose');

function createTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'config-mate-docker-'));
}

function writeExecutable(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    fs.chmodSync(filePath, 0o755);
}

test('detects modern docker compose CLI', () => {
    const root = createTempRoot();
    const dockerBin = path.join(root, 'docker');
    writeExecutable(dockerBin, '#!/bin/sh\n[ "$1" = "compose" ] && [ "$2" = "version" ] && exit 0\nexit 1\n');

    const runtime = createDockerComposeRuntime({
        appRoot: root,
        env: { DOCKER_BIN: dockerBin },
        platform: 'win32',
        logger: { log() {}, error() {} }
    });
    runtime.detect();

    assert.equal(runtime.dockerPath, dockerBin);
    assert.equal(runtime.dockerComposeCmd, dockerBin);
    assert.deepEqual(runtime.dockerComposeCmdArgs, ['compose']);
    assert.equal(runtime.readyMessage(), null);
});

test('falls back to docker-compose binary', () => {
    const root = createTempRoot();
    const dockerBin = path.join(root, 'docker');
    const composeBin = path.join(root, 'docker-compose');
    writeExecutable(dockerBin, '#!/bin/sh\nexit 1\n');
    writeExecutable(composeBin, '#!/bin/sh\nexit 0\n');

    const runtime = createDockerComposeRuntime({
        appRoot: root,
        env: { DOCKER_BIN: dockerBin, DOCKER_COMPOSE_BIN: composeBin },
        platform: 'win32',
        logger: { log() {}, error() {} }
    });
    runtime.detect();

    assert.equal(runtime.dockerPath, dockerBin);
    assert.equal(runtime.dockerComposeCmd, composeBin);
    assert.deepEqual(runtime.dockerComposeCmdArgs, []);
    assert.equal(runtime.readyMessage(), null);
});

test('returns clear ready message before docker detection', () => {
    const runtime = createDockerComposeRuntime({
        appRoot: createTempRoot(),
        env: {},
        platform: 'win32',
        logger: { log() {}, error() {} }
    });

    assert.equal(runtime.readyMessage(), 'Docker CLI not found in Config Mate container.');
});

test('sanitizes dollar placeholders for docker compose env parsing', () => {
    const content = [
        'APP_IMAGE=iotcloud:4.1.0',
        'SECURITY_JAVA_CACERTS_PATH=${java.home}/lib/security/cacerts',
        'PLAIN=value',
        '# COMMENT=${ignored}'
    ].join('\n');

    assert.equal(sanitizeEnvFileForCompose(content), [
        'APP_IMAGE=iotcloud:4.1.0',
        "SECURITY_JAVA_CACERTS_PATH='${java.home}/lib/security/cacerts'",
        'PLAIN=value',
        '# COMMENT=${ignored}'
    ].join('\n'));
});

test('composeArgsFor uses sanitized env file and project directory for app compose', () => {
    const root = createTempRoot();
    const runtimeDir = path.join(root, '.config-mate');
    const appDir = path.join(root, 'services', 'iotcloud');
    fs.mkdirSync(appDir, { recursive: true });
    const compose = path.join(appDir, 'docker-compose.yml');
    fs.writeFileSync(path.join(appDir, '.env'), [
        'APP_IMAGE=iotcloud:4.1.0',
        'SECURITY_JAVA_CACERTS_PATH=${java.home}/lib/security/cacerts'
    ].join('\n'));
    fs.writeFileSync(compose, [
        'services:',
        '  iotcloud:',
        '    image: ${APP_IMAGE}',
        '    env_file:',
        '      - ./.env'
    ].join('\n'));

    const runtime = createDockerComposeRuntime({
        appRoot: root,
        runtimeDir,
        env: {},
        platform: 'win32',
        logger: { log() {}, error() {} }
    });

    const args = runtime.composeArgsFor({
        id: 'iotcloud',
        composeService: 'iotcloud',
        composeAbsPath: compose
    }, ['up', '-d']);

    assert.equal(args[0], '--env-file');
    assert.match(args[1], /iotcloud\.env\.compose$/);
    assert.equal(args[2], '--project-directory');
    assert.equal(args[3], appDir);
    assert.equal(args[4], '-f');
    assert.match(args[5], /iotcloud-docker-compose\.yml$/);
    assert.deepEqual(args.slice(6), ['up', '-d']);
    assert.match(fs.readFileSync(args[1], 'utf8'), /SECURITY_JAVA_CACERTS_PATH='\$\{java\.home\}\/lib\/security\/cacerts'/);
    assert.match(fs.readFileSync(args[5], 'utf8'), new RegExp(args[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
