const fs = require('fs');
const path = require('path');

// Helper to read .env synchronously
function getAppType() {
    // 1. Try to read from .env
    try {
        const envPath = path.join(process.cwd(), '.env');
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const match = envContent.match(/^APPTYPE=(.*)$/m);
            if (match && match[1]) {
                return match[1].trim().toUpperCase();
            }
        }
    } catch (e) {
        console.warn('Failed to read .env for APPTYPE:', e.message);
    }

    // 2. Fallback: Check config files existence
    const edgeConfigPath = path.join(process.cwd(), 'conf', 'tb-edge.yml');
    if (fs.existsSync(edgeConfigPath)) {
        return 'EDGE';
    }

    const cloudConfigPath = path.join(process.cwd(), 'conf', 'thingsboard.yml');
    if (fs.existsSync(cloudConfigPath)) {
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
