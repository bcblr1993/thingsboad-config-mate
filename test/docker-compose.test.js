const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createDockerComposeRuntime } = require('../src/server/docker/compose');

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
