const commonMeta = require('./meta/common');
const cloudMeta = require('./meta/cloud');
const edgeMeta = require('./meta/edge');

module.exports = {
    ...commonMeta,
    ...cloudMeta,
    ...edgeMeta
};
