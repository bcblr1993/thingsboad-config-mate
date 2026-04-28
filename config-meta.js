const { resolveAppContext, resolveAppRoot } = require('./src/server/app-context');

function getAppType() {
    return resolveAppContext(resolveAppRoot()).appType || 'CLOUD';
}

const appType = getAppType();
console.log(`[ConfigMate] Loading metadata for APPTYPE: ${appType}`);

if (appType === 'EDGE') {
    module.exports = require('./meta/edge');
} else {
    module.exports = require('./meta/cloud');
}
