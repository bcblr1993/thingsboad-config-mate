const os = require('os');
const { execFile } = require('child_process');

function execFilePromise(file, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout: 3000, ...options }, (err, stdout, stderr) => {
            if (err) {
                err.stdout = stdout;
                err.stderr = stderr;
                reject(err);
            } else {
                resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
            }
        });
    });
}

function unavailable(reason) {
    return { available: false, reason };
}

async function getDiskUsageForPath(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') {
        return unavailable('invalid path');
    }
    const platform = os.platform();
    if (platform === 'win32') {
        return unavailable('windows-not-supported');
    }
    try {
        const { stdout } = await execFilePromise('df', ['-kP', targetPath]);
        const lines = stdout.trim().split(/\r?\n/);
        if (lines.length < 2) return unavailable('df output too short');
        const cols = lines[1].split(/\s+/).filter(Boolean);
        if (cols.length < 5) return unavailable('df columns unexpected');
        const totalKB = Number(cols[1]);
        const usedKB = Number(cols[2]);
        const availKB = Number(cols[3]);
        if (!Number.isFinite(totalKB) || totalKB <= 0) return unavailable('df parse failed');
        const percent = Math.round((usedKB / totalKB) * 100);
        return {
            available: true,
            path: targetPath,
            totalBytes: totalKB * 1024,
            usedBytes: usedKB * 1024,
            freeBytes: availKB * 1024,
            percent
        };
    } catch (err) {
        return unavailable(err.code === 'ETIMEDOUT' ? 'df timeout' : (err.message || 'df failed'));
    }
}

module.exports = {
    getDiskUsageForPath
};
