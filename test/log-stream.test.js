const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const test = require('node:test');

const {
    createLogStreamService,
    enqueueBoundedEvent,
    truncateLogLine
} = require('../src/server/services/log-stream');

class FakeResponse extends EventEmitter {
    constructor() {
        super();
        this.statusCode = null;
        this.headers = null;
        this.chunks = [];
        this.destroyed = false;
        this.writableEnded = false;
    }

    writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
    }

    write(chunk) {
        this.chunks.push(String(chunk));
        return true;
    }

    end(chunk = '') {
        if (chunk) this.write(chunk);
        this.writableEnded = true;
        this.emit('finish');
    }
}

function createFakeChild() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.pause = () => {};
    child.stdout.resume = () => {};
    child.stderr.pause = () => {};
    child.stderr.resume = () => {};
    child.killed = false;
    child.exitCode = null;
    child.pid = 999999;
    child.kill = () => {
        child.killed = true;
    };
    return child;
}

function createService(overrides = {}) {
    const docker = {
        dockerComposeCmd: '/usr/bin/docker',
        composeArgsFor(def, args) {
            return ['compose', '-f', def.composeAbsPath, ...args];
        },
        ...overrides.docker
    };

    return createLogStreamService({
        appRoot: '/tmp/config-mate',
        docker,
        defaultServiceId: () => 'postgres',
        getServiceDefinition: id => {
            if (id !== 'postgres') return null;
            return {
                id: 'postgres',
                composeAbsPath: '/tmp/config-mate/services/postgres/docker-compose.yml',
                composeService: 'postgres',
                exists: true
            };
        },
        logger: { log() {}, error() {} },
        platform: 'win32',
        limits: {
            flushIntervalMs: 10,
            heartbeatIntervalMs: 10000
        },
        ...overrides
    });
}

test('truncateLogLine caps long messages', () => {
    const message = truncateLogLine('abcdef', 3);
    assert.equal(message, 'abc ... [server truncated, original length: 6]');
});

test('enqueueBoundedEvent drops oldest entries when full', () => {
    const queue = [{ id: 1 }, { id: 2 }];
    const dropped = enqueueBoundedEvent(queue, { id: 3 }, 2);

    assert.equal(dropped, 1);
    assert.deepEqual(queue, [{ id: 2 }, { id: 3 }]);
});

test('streamLogs returns JSON error when Docker Compose is unavailable', () => {
    const service = createService({ docker: { dockerComposeCmd: '' } });
    const req = new EventEmitter();
    const res = new FakeResponse();

    service.streamLogs({ req, res, serviceId: 'postgres' });

    assert.equal(res.statusCode, 500);
    assert.match(res.chunks.join(''), /Docker Compose not available/);
});

test('streamLogs sends SSE error when service is missing', () => {
    const service = createService();
    const req = new EventEmitter();
    const res = new FakeResponse();

    service.streamLogs({ req, res, serviceId: 'unknown' });

    assert.equal(res.statusCode, 200);
    assert.match(res.chunks.join(''), /服务不存在或 compose 文件缺失/);
    assert.match(res.chunks.join(''), /"type":"close"/);
    assert.equal(res.writableEnded, true);
});

test('streamLogs streams stdout lines and close event', () => {
    const child = createFakeChild();
    const service = createService({
        spawn: () => child
    });
    const req = new EventEmitter();
    const res = new FakeResponse();

    service.streamLogs({ req, res, serviceId: 'postgres' });
    child.stdout.emit('data', Buffer.from('hello\n'));
    child.emit('close', 0);

    const output = res.chunks.join('');
    assert.match(output, /hello/);
    assert.match(output, /"type":"close","code":0/);
    assert.equal(res.writableEnded, true);
});
