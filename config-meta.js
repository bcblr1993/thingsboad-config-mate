const fs = require('fs');
const path = require('path');

// Helper to read .env synchronously
function getAppType() {
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
    return 'CLOUD'; // Default
}

const appType = getAppType();
console.log(`[ConfigMate] Loading metadata for APPTYPE: ${appType}`);

if (appType === 'EDGE') {
    module.exports = require('./meta/edge');
} else {
    module.exports = require('./meta/cloud');
}
