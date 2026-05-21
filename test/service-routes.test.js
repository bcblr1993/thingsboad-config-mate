const test = require('node:test');
const assert = require('node:assert/strict');
const {
    cleanupStatusCode,
    serviceActionStatusCode
} = require('../src/server/routes/services');

test('service action status codes preserve API behavior', () => {
    assert.equal(serviceActionStatusCode({ status: 'success' }), 200);
    assert.equal(serviceActionStatusCode({ status: 'error', code: 'DEPENDENCIES_NOT_RUNNING' }), 409);
    assert.equal(serviceActionStatusCode({ status: 'error', code: 'APP_SERVICE_NOT_RUNNING' }), 409);
    assert.equal(serviceActionStatusCode({ status: 'error', code: 'UNKNOWN' }), 500);
});

test('cleanup status codes preserve API behavior', () => {
    assert.equal(cleanupStatusCode({ status: 'success' }), 200);
    assert.equal(cleanupStatusCode({ status: 'error', code: 'APP_SERVICE_RUNNING' }), 409);
    assert.equal(cleanupStatusCode({ status: 'error', code: 'TARGET_SERVICE_RUNNING' }), 409);
    assert.equal(cleanupStatusCode({ status: 'error', code: 'CLEANUP_RUNNING' }), 409);
    assert.equal(cleanupStatusCode({ status: 'error', code: 'CONFIRMATION_MISMATCH' }), 400);
});
