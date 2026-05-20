const test = require('node:test');
const assert = require('node:assert/strict');
const { appActionStatusCode } = require('../src/server/routes/app');

test('app action status codes preserve API behavior', () => {
    assert.equal(appActionStatusCode({ status: 'success' }), 200);
    assert.equal(appActionStatusCode({ status: 'error', code: 'CONFIG_VALIDATION_FAILED' }), 400);
    assert.equal(appActionStatusCode({ status: 'error', code: 'DEPENDENCIES_NOT_RUNNING' }), 409);
    assert.equal(appActionStatusCode({ status: 'error', code: 'APP_SERVICE_NOT_RUNNING' }), 409);
    assert.equal(appActionStatusCode({ status: 'error', code: 'OTHER' }), 500);
});
