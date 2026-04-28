const fs = require('fs');
const path = require('path');

// Helper to read .env synchronously
function getAppType() {
    if (process.env.APP_TYPE) {
        return process.env.APP_TYPE.trim().toUpperCase();
    }

    const appRoot = path.resolve(process.env.APP_ROOT || process.cwd());

    // 1. Try to read from .env
    try {
        const envCandidates = [
            path.join(appRoot, 'services', 'iotedge', '.env'),
            path.join(appRoot, 'services', 'iotcloud', '.env'),
            path.join(appRoot, '.env')
        ];
        const envPath = envCandidates.find(p => fs.existsSync(p));
        if (envPath && fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const match = envContent.match(/^(APP_TYPE|APPTYPE)=(.*)$/m);
            if (match && match[1]) {
                return match[2].trim().toUpperCase();
            }
        }
    } catch (e) {
        console.warn('Failed to read .env for APPTYPE:', e.message);
    }

    // 2. Fallback: Check config files existence
    const edgeConfigPath = path.join(appRoot, 'services', 'iotedge', 'conf', 'tb-edge.yml');
    if (fs.existsSync(edgeConfigPath)) {
        return 'EDGE';
    }

    const cloudConfigPath = path.join(appRoot, 'services', 'iotcloud', 'conf', 'thingsboard.yml');
    if (fs.existsSync(cloudConfigPath)) {
        return 'CLOUD';
    }

    const legacyEdgeConfigPath = path.join(process.cwd(), 'conf', 'tb-edge.yml');
    if (fs.existsSync(legacyEdgeConfigPath)) {
        return 'EDGE';
    }

    const legacyCloudConfigPath = path.join(process.cwd(), 'conf', 'thingsboard.yml');
    if (fs.existsSync(legacyCloudConfigPath)) {
        return 'CLOUD';
    }

    return 'CLOUD'; // Default
}

const appType = getAppType();
console.log(`[ConfigMate] Loading metadata for APPTYPE: ${appType}`);

if (appType === 'EDGE') {
    module.exports = require('./meta/edge');
} else {
    module.exports = require('./meta/cloud');
}
