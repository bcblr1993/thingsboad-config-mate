const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const { readRequestBody, respondError } = require('../src/server/http');

function fakeReq() {
    const req = new EventEmitter();
    req.pause = () => { req.paused = true; };
    return req;
}

function fakeRes() {
    return {
        statusCode: null,
        headers: null,
        body: null,
        writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
        end(payload) { this.body = payload; }
    };
}

test('a body within the limit is read normally', async () => {
    const req = fakeReq();
    const promise = readRequestBody(req, { limitBytes: 1000 });
    req.emit('data', Buffer.from('{"a":1}'));
    req.emit('end');
    assert.equal(await promise, '{"a":1}');
});

test('an oversized body is rejected with 413 and does not destroy the socket', async () => {
    const req = fakeReq();
    // destroy 会让错误响应无法写回客户端，调用方只看到连接中断。
    req.destroy = () => { throw new Error('should not destroy the request'); };

    const promise = readRequestBody(req, { limitBytes: 10 });
    req.emit('data', Buffer.from('x'.repeat(50)));

    const error = await promise.catch(e => e);
    assert.equal(error.statusCode, 413);
    assert.equal(error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(req.paused, true, '应暂停接收而不是销毁连接');
});

test('data arriving after the limit does not resolve or double-reject', async () => {
    const req = fakeReq();
    const promise = readRequestBody(req, { limitBytes: 10 });
    req.emit('data', Buffer.from('x'.repeat(50)));
    await promise.catch(() => {});

    // 超限后继续到达的数据与 end 事件不应再影响已决的 Promise。
    req.emit('data', Buffer.from('more'));
    req.emit('end');
    req.emit('error', new Error('late error'));
    // 走到这里没有抛未捕获异常即为通过。
    assert.ok(true);
});

test('respondError honours the statusCode carried by the error', () => {
    const res = fakeRes();
    const error = new Error('太大了');
    error.statusCode = 413;
    error.code = 'PAYLOAD_TOO_LARGE';

    respondError(res, error, {});
    assert.equal(res.statusCode, 413);
    const payload = JSON.parse(res.body);
    assert.equal(payload.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(payload.message, '太大了');
});

test('respondError falls back to 500 for plain errors', () => {
    const res = fakeRes();
    respondError(res, new Error('boom'), {});
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.parse(res.body).message, 'boom');
});
