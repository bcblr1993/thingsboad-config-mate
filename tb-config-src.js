const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, spawn, execFile, execFileSync } = require('child_process');
const os = require('os');
const { resolveAppContext, resolveAppRoot } = require('./src/server/app-context');
const { readRequestBody, writeJson } = require('./src/server/http');
const { createServiceRegistry } = require('./src/server/services/registry');

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : null;

// --- Config ---
const portArg = args.find(arg => arg.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.split('=')[1]) : (process.env.PORT || 3300);
const REQUESTED_APP_ROOT = resolveAppRoot();
const APP_CONTEXT = resolveAppContext(REQUESTED_APP_ROOT);
const APP_ROOT = APP_CONTEXT.appRoot;
const APP_TYPE = APP_CONTEXT.appType;
const APP_DIR = APP_CONTEXT.appDir;
const YAML_CONFIG_PATH = APP_CONTEXT.yamlPath;
const ENV_FILE_PATH = path.join(APP_DIR, '.env');
const HISTORY_DIR = path.join(APP_DIR, '.env_history');

process.env.APP_ROOT = APP_ROOT;
process.env.APP_TYPE = APP_TYPE;

const RUNTIME_DIR = path.join(APP_ROOT, '.config-mate');
if (!fs.existsSync(RUNTIME_DIR)) {
    try { fs.mkdirSync(RUNTIME_DIR, { recursive: true }); } catch (e) { }
}
const PID_FILE = path.join(RUNTIME_DIR, `tb-config-mate-${PORT}.pid`);
const LOG_FILE = path.join(RUNTIME_DIR, `tb-config-mate-${PORT}.log`);
const CLEANUP_BACKUP_ROOT = path.join(RUNTIME_DIR, 'backups');
const AUDIT_LOG_FILE = path.join(RUNTIME_DIR, 'audit.log');
const serviceRegistry = createServiceRegistry({ appRoot: APP_ROOT, appType: APP_TYPE });
const { getPackageServiceId, getServiceDefinition, listServiceDefinitions } = serviceRegistry;
const CLEANUP_SERVICE_DATA_DIRS = serviceRegistry.cleanupServiceDataDirs;

// --- Helper: Check Status ---
function getRunningPid(pidPath = PID_FILE) {
    if (!fs.existsSync(pidPath)) return null;
    try {
        const pid = parseInt(fs.readFileSync(pidPath, 'utf8'));
        process.kill(pid, 0); // Check if process exists
        return pid;
    } catch (e) {
        return null; // Stale PID file or process not running
    }
}

// --- Log Rotation (Daemon Mode) ---
function setupLogger() {
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    const MAX_FILES = 5;

    // Helper: Rotate files .log -> .log.1 -> .log.2 ...
    function rotate() {
        try {
            if (fs.existsSync(LOG_FILE)) {
                try {
                    const stats = fs.statSync(LOG_FILE);
                    if (stats.size < MAX_SIZE) return;
                } catch (e) { return; } // File might be gone
            } else {
                return;
            }

            // Rotate existing backups
            for (let i = MAX_FILES - 1; i >= 1; i--) {
                const oldF = `${LOG_FILE}.${i}`;
                const newF = `${LOG_FILE}.${i + 1}`;
                if (fs.existsSync(oldF)) {
                    try { fs.renameSync(oldF, newF); } catch (e) { }
                }
            }
            // Rotate current
            try { fs.renameSync(LOG_FILE, `${LOG_FILE}.1`); } catch (e) { }

        } catch (e) {
            // Last resort fallback
        }
    }

    let logStream = null;

    function openStream() {
        // Check rotation before opening
        rotate();
        logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

        // Handle stream errors
        logStream.on('error', (err) => {
            // If stream fails, we can't do much in background, maybe try reopen?
        });
    }

    openStream();

    function writeLog(args, level = 'INFO') {
        const msg = args.map(a => (typeof a === 'string' ? a : (a instanceof Error ? a.stack : JSON.stringify(a)))).join(' ');
        const ts = new Date().toISOString();
        const line = `[${ts}] [${level}] ${msg}\n`;

        if (logStream) {
            // Check size periodically or on write?
            // fs.statSync is expensive per log?
            // Use bytesWritten relative?
            // Simplest robust way: check bytesWritten + periodic stat?
            // Let's rely on internal counter and occasional stat?
            // Or just check fs.statSync? For a config tool, logs aren't high frequency.
            // But let's be safe. Check bytesWritten.
            if (logStream.bytesWritten > MAX_SIZE) {
                logStream.end();
                openStream();
            }
            logStream.write(line);
        }
    }

    // Override console
    console.log = (...args) => writeLog(args, 'INFO');
    console.error = (...args) => writeLog(args, 'ERROR');
    console.warn = (...args) => writeLog(args, 'WARN');
    console.debug = (...args) => writeLog(args, 'DEBUG');

    // Also catch unhandled exceptions to log file
    process.on('uncaughtException', (err) => {
        writeLog([err], 'FATAL');
        process.exit(1);
    });
}

// Enable rotation if running as daemon
if (args.includes('--daemon')) {
    setupLogger();
}

// --- CLI Commands ---
// 处理版本号查询
if (args.includes('-v') || args.includes('--version')) {
    const packageJson = require('./package.json');
    console.log(`ThingsBoard Config Mate v${packageJson.version}`);
    process.exit(0);
}

if (args.includes('-h') || args.includes('--help')) {
    const packageJson = require('./package.json');
    console.log(`
ThingsBoard Config Mate (TB-CM) v${packageJson.version} - 命令行使用指南

用法:
  tb-config-mate [命令] [选项]

命令:
  start     在后台启动配置服务 (默认端口 3300)
  stop      停止正在运行的后台服务 (需指定端口，默认停止 3300)
  restart   停止并重新启动后台服务
  status    查看后台服务的运行状态 (未指定端口时显示所有实例)

选项:
  --port=N     指定服务运行的端口 (默认: 3300)
  -v, --version 显示版本号
  -h, --help    显示此帮助信息

示例:
  使用指定端口启动:
    ./tb-config-mate start --port=4005
  
  查看状态:
    ./tb-config-mate status
    ./tb-config-mate status --port=4005
    `);
    process.exit(0);
}

if (command === 'status') {
    if (portArg) {
        // Check specific port
        const pid = getRunningPid();
        if (pid) {
            console.log(`[Status] Service (Port ${PORT}) is RUNNING (PID: ${pid})`);
        } else {
            console.log(`[Status] Service (Port ${PORT}) is STOPPED`);
        }
    } else {
        // Scan all pid files
        const files = fs.readdirSync(RUNTIME_DIR).filter(f => f.startsWith('tb-config-mate-') && f.endsWith('.pid'));
        if (files.length === 0) {
            console.log('[Status] No running instances found.');
        } else {
            console.log('[Status] Found instances:');
            files.forEach(f => {
                const portMatch = f.match(/tb-config-mate-(\d+)\.pid/);
                const p = portMatch ? portMatch[1] : 'Unknown';
                const pid = getRunningPid(path.join(RUNTIME_DIR, f));
                if (pid) {
                    console.log(`  - Port ${p}: RUNNING (PID: ${pid})`);
                } else {
                    console.log(`  - Port ${p}: STOPPED (Stale PID file)`);
                }
            });
        }
    }
    process.exit(0);
}

if (command === 'stop') {
    const pid = getRunningPid();
    if (pid) {
        try {
            process.kill(pid);
            console.log(`[Success] Stopped service on Port ${PORT} (PID: ${pid})`);
            if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
        } catch (e) {
            console.error(`[Error] Failed to stop: ${e.message}`);
        }
    } else {
        console.log(`[Info] Service on Port ${PORT} is not running.`);
    }
    process.exit(0);
}

if (command === 'restart') {
    const pid = getRunningPid();
    if (pid) {
        try {
            process.kill(pid);
            console.log(`[Success] Stopped service on Port ${PORT} (PID: ${pid})`);
            if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
        } catch (e) {
            console.warn(`[Warn] Failed to stop previous instance: ${e.message}`);
        }
    }
}

if (command === 'start' || command === 'restart') {
    if (command === 'start' && getRunningPid()) {
        console.log(`[Info] Service is already running (PID: ${getRunningPid()}).`);
        process.exit(0);
    }

    console.log(`[Info] Starting background service...`);
    const logFd = fs.openSync(LOG_FILE, 'a');

    const childArgs = args.filter(a => !['start', 'stop', 'restart', 'status'].includes(a));

    // Always pass the entry script path (__filename) to the child process, unless running in pkg.
    // In 'pkg', __filename resolves to the internal snapshot path (e.g. /snapshot/.../tb-config-src.js).
    // Using process.pkg to detect if we're in a packaged binary.
    const spawnCmd = process.pkg ? process.execPath : process.execPath;
    let spawnArgs = process.pkg ? [...childArgs, '--daemon'] : [__filename, ...childArgs, '--daemon'];

    const child = spawn(spawnCmd, spawnArgs, {
        detached: true,
        stdio: 'ignore', // Let the child manage its own logging via --daemon
        cwd: process.cwd(),
        env: process.env
    });

    child.unref();
    console.log(`[Success] Started (PID: ${child.pid})`);
    console.log(`[Log] > ${LOG_FILE}`);
    process.exit(0);
}


// --- Overwrite Mode (--over) ---
if (args.includes('--over')) {
    console.log('[Info] Mode: Configuration Overwrite');
    if (!fs.existsSync(ENV_FILE_PATH)) {
        console.error('[Error] .env file not found.');
        process.exit(1);
    }

    // 1. Parse .env
    const envVars = {};
    const envContent = fs.readFileSync(ENV_FILE_PATH, 'utf-8');
    envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const parts = trimmed.split('=');
            const key = parts[0].trim();
            // Value: join remaining parts in case value contains '='
            const val = parts.slice(1).join('=').trim();
            envVars[key] = val;
        }
    });

    const totalEnvKeys = Object.keys(envVars).length;
    console.log(`[Info] Loaded ${totalEnvKeys} variables from .env`);

    // 2. Identify Target File
    const appType = envVars['APPTYPE'] || 'CLOUD';
    let targetFile = null;

    if (appType === 'EDGE') {
        const candidates = [
            path.join(APP_DIR, 'conf', 'tb-edge.yml'),
            path.join(APP_DIR, 'tb-edge.yml'),
            YAML_CONFIG_PATH
        ];
        targetFile = candidates.find(f => fs.existsSync(f));
    } else {
        const candidates = [
            path.join(APP_DIR, 'conf', 'thingsboard.yml'),
            path.join(APP_DIR, 'thingsboard.yml'),
            YAML_CONFIG_PATH
        ];
        targetFile = candidates.find(f => fs.existsSync(f));
    }

    if (!targetFile) {
        console.error(`[Error] Target configuration file for ${appType} not found.`);
        process.exit(1);
    }
    console.log(`[Info] Target Config: ${targetFile}`);

    // 3. Backup
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHmmss
    const backupFile = `${targetFile}.${timestamp}.bak`;
    try {
        fs.copyFileSync(targetFile, backupFile);
        console.log(`[Backup] Created: ${path.basename(backupFile)}`);
    } catch (e) {
        console.error('[Error] Backup failed:', e);
        process.exit(1);
    }

    // 4. Regex Scanning & Replacement
    let fileContent = fs.readFileSync(targetFile, 'utf8');
    let updateCount = 0;
    let unchangedCount = 0;

    console.log('[Process] Starting placeholder replacement...');
    console.log('----------------------------------------------------------------');

    Object.keys(envVars).forEach(key => {
        const newValue = envVars[key];

        // Match ${KEY} or ${KEY:default}
        // Regex Explanation:
        // \$\{      Literal ${
        // KEY       Variable Name
        // (:[^}]*)? Optional group: colon followed by anything non-} (the default value)
        // \}        Literal }
        const regex = new RegExp(`\\$\\{${key}(:[^}]*)?\\}`, 'g');

        let hasMatch = false;

        // We use a callback to perform replacement to allow for logic (escaping, logging) values
        fileContent = fileContent.replace(regex, (match, defaultGroup, offset, string) => {
            hasMatch = true;

            // Safety Check: Is this placeholder inside double quotes?
            // Simple heuristic: look at chars immediately before/after match
            const prevChar = string[offset - 1];
            const nextChar = string[offset + match.length];
            const isQuoted = (prevChar === '"' && nextChar === '"');

            let finalValue = newValue;

            // If inside quotes, escape quotes in the value
            if (isQuoted) {
                finalValue = finalValue.replace(/"/g, '\\"');
            }

            // Construct replacement: ${KEY:NEW_VALUE}
            const replacement = `\${${key}:${finalValue}}`;

            if (match !== replacement) {
                console.log(`[Updated] ${key}`);
                console.log(`          Before: "${match}"`);
                console.log(`          After:  "${replacement}"`);
                console.log('----------------------------------------------------------------');
                updateCount++;
                return replacement;
            } else {
                return match; // No change
            }
        });

        if (!hasMatch) {
            // Log skip only if verbose? Or maybe specific ones? 
            // User asked for "Detailed log", but logging every skip for 100 vars might be too much.
            // Let's print matched ones prominently.
            unchangedCount++;
        }
    });

    try {
        fs.writeFileSync(targetFile, fileContent, 'utf8');
        console.log(`[Success] Overwrite complete.`);
        console.log(`          - Total Env Vars: ${totalEnvKeys}`);
        console.log(`          - Replacements:   ${updateCount}`);
        console.log(`          - Unchanged/Skip: ${unchangedCount}`);
    } catch (e) {
        console.error('[Error] Failed to write changes:', e);
        // Restore backup? maybe manual
    }

    process.exit(0);
} else {
    // Regular Server Startup continue...
}



// Import modularized components
const CONFIG_META = require('./config-meta');
// const { getHtml } = require('./ui-template'); // Removed

// Try to lazy load js-yaml to avoid hard crash if missing (though we installed it)
let yaml;
try {
    yaml = require('js-yaml');
} catch (e) {
    console.warn('[Warn] js-yaml not found. Auto-init from YAML disabled.');
}

// --- Auto-Init Logic ---
function tryInitFromYaml() {
    let existingEnv = {};

    if (fs.existsSync(ENV_FILE_PATH)) {
        try {
            existingEnv = parseEnvFile();
            const keyCount = Object.keys(existingEnv).length;
            console.log(`[Info] .env file exists with ${keyCount} keys. Checking for missing configurations...`);
        } catch (e) {
            console.warn('[Warn] Failed to parse existing .env, will create new:', e);
        }
    } else {
        console.log('[Info] .env file not found. Will create from YAML...');
    }

    if (!yaml) return;

    console.log('[Info] Looking for YAML config...');

    const candidates = [
        YAML_CONFIG_PATH,
        path.join(APP_DIR, 'conf', 'thingsboard.yml'),
        path.join(APP_DIR, 'conf', 'tb-edge.yml'),
        path.join(APP_DIR, 'thingsboard.yml'),
        path.join(APP_DIR, 'tb-edge.yml'),
        path.join(APP_ROOT, 'conf', 'thingsboard.yml'),
        path.join(APP_ROOT, 'conf', 'tb-edge.yml'),
        path.join(__dirname, 'conf', 'thingsboard.yml'),
        path.join(__dirname, 'conf', 'tb-edge.yml')
    ].filter(Boolean);

    let yamlPath = null;
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            yamlPath = p;
            break;
        }
    }

    if (!yamlPath) {
        console.log('[Info] No YAML config found in conf/ directory. Skipping.');
        return;
    }

    console.log(`[Info] Found YAML config at: ${yamlPath}`);

    try {
        const fileContents = fs.readFileSync(yamlPath, 'utf8');
        const data = yaml.load(fileContents);
        const flattened = flattenYaml(data);

        // Auto-extract Env Vars from values
        Object.keys(flattened).forEach(flatKey => {
            const val = flattened[flatKey];
            if (typeof val === 'string') {
                const match = val.match(/^\$\{([^:]+)(:.*)?\}$/);
                if (match) {
                    const varName = match[1];
                    if (!flattened[varName]) {
                        flattened[varName] = val;
                    }
                }
            }
        });

        const YAML_KEY_MAPPING = {
            "REDIS_CONNECTION_TYPE": ["REDIS_CONNECTION_TYPE"],
            "REDIS_HOST": ["REDIS_STANDALONE_HOST"],
            "REDIS_PORT": ["REDIS_STANDALONE_PORT"],
            "REDIS_USE_DEFAULT_CLIENT_CONFIG": ["REDIS_STANDALONE_USEDEFAULTCLIENTCONFIG"],
            "REDIS_CLIENT_NAME": ["REDIS_STANDALONE_CLIENTNAME"],
            "REDIS_CLIENT_CONNECT_TIMEOUT": ["REDIS_STANDALONE_CONNECTTIMEOUT"],
            "REDIS_CLIENT_READ_TIMEOUT": ["REDIS_STANDALONE_READTIMEOUT"],
            "REDIS_CLIENT_USE_POOL_CONFIG": ["REDIS_STANDALONE_USEPOOLCONFIG"],
            "REDIS_NODES": ["REDIS_CLUSTER_NODES"],
            "REDIS_MAX_REDIRECTS": ["REDIS_CLUSTER_MAX_REDIRECTS"],
            "REDIS_USE_DEFAULT_POOL_CONFIG": ["REDIS_CLUSTER_USEDEFAULTPOOLCONFIG", "REDIS_USE_DEFAULT_POOL_CONFIG"],
            "REDIS_MASTER": ["REDIS_SENTINEL_MASTER"],
            "REDIS_SENTINELS": ["REDIS_SENTINEL_SENTINELS"],
            "REDIS_SENTINEL_PASSWORD": ["REDIS_SENTINEL_PASSWORD"],
            "REDIS_SENTINEL_USE_DEFAULT_POOL_CONFIG": ["REDIS_SENTINEL_USEDEFAULTPOOLCONFIG"],
            "SPRING_DRIVER_CLASS_NAME": ["SPRING_DATASOURCE_DRIVERCLASSNAME"],
            "NETTY_MAX_PAYLOAD_SIZE": ["TRANSPORT_MQTT_NETTY_MAX_PAYLOAD_SIZE"],
            "MQTT_BIND_PORT": ["TRANSPORT_MQTT_BIND_PORT"]
        };

        const newConfig = {};

        // Infer APPTYPE based on filename
        let targetAppType = 'CLOUD';
        const filename = path.basename(yamlPath);
        if (filename === 'thingsboard.yml') {
            newConfig['APPTYPE'] = 'CLOUD';
            targetAppType = 'CLOUD';
        } else if (filename === 'tb-edge.yml') {
            newConfig['APPTYPE'] = 'EDGE';
            targetAppType = 'EDGE';
        }


        // Build Reverse Mapping from YAML values
        // Scan all flattened values. If a value contains "${KEY:DEFAULT}" or "${KEY}", 
        // we map KEY -> value (the placeholder string itself).
        // This allows automatic discovery of keys without manual mapping.
        const reverseMapping = {};
        Object.keys(flattened).forEach(flatKey => {
            const val = flattened[flatKey];
            if (typeof val === 'string') {
                // Regex to match ${KEY} or ${KEY:DEFAULT}
                // We capture the KEY name.
                // Note: YAML might have nested structure like "${HOST}:${PORT}", so we iterate all matches.
                // But for simple config extraction, usually one key per value.
                const regex = /\$\{([A-Z0-9_]+)(?::[^}]*)?\}/g;
                let match;
                while ((match = regex.exec(val)) !== null) {
                    const envKey = match[1];
                    // If we have multiple occurrences (rare), last one wins or we ignore collisions.
                    // We store the full original value string which resolveSpringPlaceholder can handle.
                    // But resolveSpringPlaceholder expects the *entire* string to be the value to parse.
                    reverseMapping[envKey] = val;
                }
            }
        });

        Object.keys(CONFIG_META).forEach(metaKey => {
            const meta = CONFIG_META[metaKey];
            const scope = meta.scope || 'common';
            if (scope === 'cloud' && targetAppType !== 'CLOUD') return;
            if (scope === 'edge' && targetAppType !== 'EDGE') return;
            // 注意: 不再检查 dependsOn，所有配置项都会被提取到 .env
            // UI 显示/隐藏由前端的 dependsOn 逻辑控制

            // Priority 1: Direct key match (doubtful for YAML but possible)
            if (flattened[metaKey] !== undefined) {
                newConfig[metaKey] = resolveSpringPlaceholder(flattened[metaKey]);
                return;
            }

            // Priority 2: Auto-discovered Reverse Mapping (The Magic Fix)
            if (reverseMapping[metaKey] !== undefined) {
                newConfig[metaKey] = resolveSpringPlaceholder(reverseMapping[metaKey]);
                return;
            }


            // Priority 3: Explicit Manual Mapping (Legacy/Fallback)
            if (YAML_KEY_MAPPING[metaKey]) {
                const mappedKeys = YAML_KEY_MAPPING[metaKey];
                for (const mappedKey of mappedKeys) {
                    if (flattened[mappedKey] !== undefined) {
                        newConfig[metaKey] = resolveSpringPlaceholder(flattened[mappedKey]);
                        return;
                    }
                }
            }

            // Priority 4: Special Handling for Legacy Edge Keys (No Env Var in YAML)
            if (targetAppType === 'EDGE') {
                if (metaKey === 'CLOUD_CHECK_STATUS_BASE_URL' && data?.cloud?.check_status?.baseURL) {
                    newConfig[metaKey] = data.cloud.check_status.baseURL;
                    return;
                }
                if (metaKey === 'EDGES_STORAGE_HISTORY_STATUS' && data?.cloud?.rpc?.storage?.history_status !== undefined) {
                    newConfig[metaKey] = String(data.cloud.rpc.storage.history_status);
                    return;
                }
                if (metaKey === 'TELEMETRY_SEPARATION_ENABLED' && data?.cloud?.telemetry?.separation?.enabled !== undefined) {
                    newConfig[metaKey] = String(data.cloud.telemetry.separation.enabled);
                    return;
                }
            }
        });

        if (Object.keys(newConfig).length > 0) {
            console.log(`[Info] Extracted ${Object.keys(newConfig).length} configurations from YAML.`);

            // Calculate missing keys (present in newConfig but NOT in existingEnv)
            const missingKeys = {};
            let missingCount = 0;
            Object.keys(newConfig).forEach(key => {
                // Use Object.prototype.hasOwnProperty for safety
                if (!Object.prototype.hasOwnProperty.call(existingEnv, key)) {
                    missingKeys[key] = newConfig[key];
                    missingCount++;
                }
            });


            // Log missing keys details
            const expectedKeys = [];

            Object.keys(CONFIG_META).forEach(k => {
                const meta = CONFIG_META[k];
                const scope = meta.scope || 'common';
                if (scope === 'cloud' && targetAppType !== 'CLOUD') return;
                if (scope === 'edge' && targetAppType !== 'EDGE') return;
                // 不再根据 dependsOn 跳过，所有配置项都应该被提取
                expectedKeys.push(k);
            });

            const missedExtraction = expectedKeys.filter(k => !newConfig[k] && !existingEnv[k]);

            if (missedExtraction.length > 0) {
                console.log(`[Info] ⚠️  The following ${missedExtraction.length} keys were expected but NOT found in YAML or .env. Using defaults:`);
                missedExtraction.forEach(k => {
                    console.log(`   - ${k}`);
                    const meta = CONFIG_META[k];
                    // Priority 5: Default value from Metadata (Fallback)
                    if (meta.default !== undefined) {
                        missingKeys[k] = meta.default;
                        missingCount++;
                    } else {
                        // If no default, maybe set empty? Or skip?
                        // User request implies "extract all defined here to env".
                        // Let's set it to empty string if no default, to ensure it exists.
                        missingKeys[k] = '';
                        missingCount++;
                    }
                });
            }

            if (missingCount > 0) {
                console.log(`[Info] Found ${missingCount} missing keys. Updating .env...`);

                if (Object.keys(existingEnv).length === 0 && !fs.existsSync(ENV_FILE_PATH)) {
                    // New file: Create clean
                    saveEnvFile(missingKeys);
                } else {
                    // Existing file: Append only
                    let appendContent = '\n# --- Auto-Generated Defaults ---\n';
                    Object.keys(missingKeys).sort().forEach(key => {
                        const meta = CONFIG_META[key];
                        if (meta) {
                            if (meta.comment) {
                                appendContent += `# ${meta.label} (${meta.comment})\n`;
                            } else {
                                appendContent += `# ${meta.label}\n`;
                            }
                        }
                        appendContent += `${key}=${missingKeys[key]}\n`;
                    });
                    try {
                        fs.appendFileSync(ENV_FILE_PATH, appendContent);
                        console.log('[Success] Appended missing configurations to .env');
                    } catch (err) {
                        console.error('[Error] Failed to append to .env:', err);
                    }
                }
            } else {
                console.log('[Info] .env is already complete. No new keys to add.');
            }
        } else {
            console.log('[Warn] Parsed YAML but found no matching configurations defined in metadata.');
        }

    } catch (e) {
        console.error('[Error] Failed to parse YAML:', e);
    }
}

function flattenYaml(obj, prefix = '', res = {}) {
    for (const key in obj) {
        if (!obj.hasOwnProperty(key)) continue;
        const val = obj[key];
        // Convert camelCase or snake_case key to UPPER_UNDERSCORE for standard ENV
        // But wait, thingsboard.yml keys are usually snake_case or camelCase?
        // Actually usually standard YAML keys are lowercase/mixed.
        // e.g. spring: datasource: url
        // We want SPRING_DATASOURCE_URL.

        // Normalize key to uppercase
        const upperKey = key.toUpperCase();
        const newKey = prefix ? `${prefix}_${upperKey}` : upperKey;

        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            flattenYaml(val, newKey, res);
        } else {
            res[newKey] = String(val);
        }
    }
    return res;
}

function resolveSpringPlaceholder(val) {
    if (typeof val !== 'string') return val;
    val = val.trim();
    // Match ${VAR:default} or ${VAR:} (empty default)
    // Note: This regex assumes simple nesting or no nesting.
    // Captures: 1=VAR, 2=default (can be empty)
    const match = val.match(/^\$\{([^:]+):(.*)\}$/);
    if (match) {
        return match[2]; // Return default value (can be empty string)
    }
    // Match ${VAR} (no default) -> return empty string or keep it?
    // If it's a variable without default, likely meant to be set by env.
    // Returning empty string for .env initialization seems safer than leaving raw ${VAR}.
    const matchNoDefault = val.match(/^\$\{([^:]+)\}$/);
    if (matchNoDefault) {
        return "";
    }
    return val;
}

// --- 核心逻辑 ---

// 读取并解析 .env
function parseEnvFile() {
    if (!fs.existsSync(ENV_FILE_PATH)) return {};
    const content = fs.readFileSync(ENV_FILE_PATH, 'utf-8');
    const result = {};
    content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const parts = trimmed.split('=');
            const key = parts[0].trim();
            const val = parts.slice(1).join('=').trim();
            result[key] = val;
        }
    });
    return result;
}

// Check if dependsOn condition is satisfied
function checkDependsOn(dependsOn, config) {
    if (!dependsOn) return true; // No dependency

    // Handle single condition: { key: "X", value: "Y" }
    if (dependsOn.key && dependsOn.value !== undefined) {
        const keys = Array.isArray(dependsOn.key) ? dependsOn.key : [dependsOn.key];
        return keys.some(k => config[k] === dependsOn.value);
    }

    // Handle OR condition: { or: [...] }
    if (dependsOn.or) {
        return dependsOn.or.some(cond => checkDependsOn(cond, config));
    }

    // Handle AND condition: { and: [...] }
    if (dependsOn.and) {
        return dependsOn.and.every(cond => checkDependsOn(cond, config));
    }

    return true;
}

// Backup .env before saving
function backupEnv() {
    if (!fs.existsSync(ENV_FILE_PATH)) return;

    if (!fs.existsSync(HISTORY_DIR)) {
        fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').split('.')[0];
    const backupFile = path.join(HISTORY_DIR, `.env.bak.${timestamp}`);

    try {
        fs.copyFileSync(ENV_FILE_PATH, backupFile);
        console.log(`[Backup] Created: ${backupFile}`);
        rotateBackups();
    } catch (e) {
        console.warn('[Warn] Failed to backup .env:', e.message);
    }
}

// Keep only the latest 5 backups
function rotateBackups() {
    if (!fs.existsSync(HISTORY_DIR)) return;

    const files = fs.readdirSync(HISTORY_DIR)
        .filter(f => f.startsWith('.env.bak.'))
        .map(f => ({
            name: f,
            path: path.join(HISTORY_DIR, f),
            time: fs.statSync(path.join(HISTORY_DIR, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time); // Newest first

    if (files.length > 5) {
        const toDelete = files.slice(5);
        toDelete.forEach(file => {
            try {
                fs.unlinkSync(file.path);
                console.log(`[Backup] Rotated/Deleted: ${file.name}`);
            } catch (e) {
                console.warn('[Warn] Failed to delete old backup:', e.message);
            }
        });
    }
}

// 保存 .env (重组文件结构以美化)
function saveEnvFile(newConfig) {
    // Perform backup before overwriting
    backupEnv();

    let outputLines = [];
    outputLines.push("# ==========================================");
    outputLines.push("# ThingsBoard 配置文件 (自动生成)");
    outputLines.push(`# 更新时间: ${new Date().toLocaleString()}`);
    outputLines.push("# ==========================================");
    outputLines.push("");

    const processedKeys = new Set();
    const config = { ...parseEnvFile(), ...newConfig };

    // 1. 按元数据分组写入标准配置
    const groups = {};
    const currentAppType = config['APPTYPE'] || 'CLOUD'; // Default to CLOUD if unknown

    Object.keys(CONFIG_META).forEach(key => {
        const meta = CONFIG_META[key];

        // Scope Filtering
        const scope = meta.scope || 'common';
        if (scope === 'cloud' && currentAppType !== 'CLOUD') return;
        if (scope === 'edge' && currentAppType !== 'EDGE') return;

        // DependsOn Filtering
        if (!checkDependsOn(meta.dependsOn, config)) return;

        if (!groups[meta.group]) groups[meta.group] = [];
        groups[meta.group].push(key);
    });

    Object.keys(groups).forEach(groupName => {
        outputLines.push(`# === ${groupName} ===`);
        groups[groupName].forEach(key => {
            const meta = CONFIG_META[key];
            const value = config[key] !== undefined ? config[key] : "";
            // 写入中文注释
            if (meta.comment) {
                outputLines.push(`# ${meta.label} (${meta.comment})`);
            } else {
                outputLines.push(`# ${meta.label}`);
            }
            outputLines.push(`${key}=${value}`);
            processedKeys.add(key);
        });
        outputLines.push(""); // 分组空行
    });

    // 2. 写入未在元数据中定义的自定义配置
    const customKeys = Object.keys(config).filter(k => !processedKeys.has(k));
    if (customKeys.length > 0) {
        outputLines.push("# === 自定义配置 (其他) ===");
        customKeys.forEach(key => {
            outputLines.push(`${key}=${config[key]}`);
        });
    }

    fs.writeFileSync(ENV_FILE_PATH, outputLines.join('\n'));
}

// --- Auth & Deployment Helpers ---
const CONFIG_MATE_PASSWORD = process.env.CONFIG_MATE_PASSWORD || '';
const AUTH_REQUIRED = CONFIG_MATE_PASSWORD.trim().length > 0;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();
let activeCleanupService = null;

function parseCookies(req) {
    const header = req.headers.cookie || '';
    const cookies = {};
    header.split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx === -1) return;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        cookies[key] = decodeURIComponent(val);
    });
    return cookies;
}

function getAuthToken(req) {
    const auth = req.headers.authorization || '';
    let token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) token = parseCookies(req).config_mate_session;
    return token;
}

function getSession(req) {
    const token = getAuthToken(req);
    if (!token || !sessions.has(token)) return null;

    const session = sessions.get(token);
    if (session.expiresAt < Date.now()) {
        sessions.delete(token);
        return null;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return { ...session, token };
}

function isAuthenticated(req) {
    if (!AUTH_REQUIRED) return true;
    return !!getSession(req);
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || '';
}

function normalizeOperatorName(value) {
    const text = String(value || '').trim();
    return text.slice(0, 64);
}

function sanitizePathSegment(value) {
    const text = normalizeOperatorName(value) || 'operator';
    return text.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'operator';
}

function createSession(req, operator) {
    const token = crypto.randomBytes(32).toString('hex');
    const sessionId = token.slice(0, 10);
    sessions.set(token, {
        operator: normalizeOperatorName(operator) || 'operator',
        sessionId,
        loginAt: new Date().toISOString(),
        ip: getClientIp(req),
        expiresAt: Date.now() + SESSION_TTL_MS
    });
    return token;
}

function getRequestActor(req) {
    const session = getSession(req);
    return {
        operator: session?.operator || 'anonymous',
        sessionId: session?.sessionId || 'anonymous',
        ip: session?.ip || getClientIp(req)
    };
}

function dockerReadyMessage() {
    if (!dockerPath) return 'Docker CLI not found in Config Mate container.';
    if (!dockerComposeCmd) return 'Docker Compose is not available.';
    if (!fs.existsSync('/var/run/docker.sock') && os.platform() !== 'win32') {
        return 'Docker socket /var/run/docker.sock is not mounted.';
    }
    return null;
}

function composeArgsFor(def, args) {
    return [...dockerComposeCmdArgs, '-f', def.composeAbsPath, ...args];
}

function execDocker(cmd, args, options = {}) {
    return new Promise(resolve => {
        execFile(cmd, args, { cwd: APP_ROOT, ...options }, (error, stdout, stderr) => {
            resolve({ error, stdout: stdout || '', stderr: stderr || '' });
        });
    });
}

async function getServiceStatus(def) {
    if (!def) {
        return { id: 'unknown', label: 'Unknown', status: 'missing', running: false, containerId: '', message: 'service definition missing' };
    }
    if (!def.exists) {
        return { ...def, status: 'missing', running: false, containerId: '', message: 'compose file missing' };
    }
    const dockerIssue = dockerReadyMessage();
    if (dockerIssue) {
        return { ...def, status: 'unknown', running: false, containerId: '', message: dockerIssue };
    }

    const ps = await execDocker(dockerComposeCmd, composeArgsFor(def, ['ps', '-q', def.composeService]));
    const containerId = ps.stdout.trim().split('\n').filter(Boolean)[0] || '';
    if (!containerId && def.image) {
        const image = await execDocker(dockerPath, ['image', 'inspect', def.image, '--format', '{{.Os}}/{{.Architecture}}']);
        if (image.error) {
            return { ...def, status: 'missing-image', running: false, containerId: '', message: def.missingImageMessage || `Image not found: ${def.image}` };
        }
        const platform = image.stdout.trim();
        if (platform && platform !== 'linux/arm64') {
            return { ...def, status: 'unsupported', running: false, containerId: '', message: `${def.image} is ${platform}, expected linux/arm64.` };
        }
    }
    if (!containerId) {
        return { ...def, status: 'stopped', running: false, containerId: '' };
    }

    const inspect = await execDocker(dockerPath, ['inspect', '-f', '{{.State.Running}}', containerId]);
    const running = inspect.stdout.trim() === 'true';
    return { ...def, status: running ? 'running' : 'stopped', running, containerId };
}

async function runComposeAction(id, action) {
    const def = getServiceDefinition(id);
    if (!def) return { status: 'error', message: 'Unknown service' };
    if (!def.exists) return { status: 'error', message: `Compose file not found: ${def.composePath}` };

    const dockerIssue = dockerReadyMessage();
    if (dockerIssue) return { status: 'error', message: dockerIssue };

    if (action !== 'down' && def.image) {
        const image = await execDocker(dockerPath, ['image', 'inspect', def.image, '--format', '{{.Os}}/{{.Architecture}}']);
        if (image.error) {
            return { status: 'error', message: def.missingImageMessage || `Image not found: ${def.image}` };
        }
        const platform = image.stdout.trim();
        if (platform && platform !== 'linux/arm64') {
            return { status: 'error', message: `${def.image} is ${platform}, expected linux/arm64.` };
        }
    }

    const commands = [];
    if (action === 'up') commands.push(['up', '-d']);
    else if (action === 'down') commands.push(['down']);
    else if (action === 'restart') commands.push(['down'], ['up', '-d']);
    else return { status: 'error', message: 'Unsupported action' };

    let output = '';
    for (const cmdArgs of commands) {
        const result = await execDocker(dockerComposeCmd, composeArgsFor(def, cmdArgs));
        output += result.stdout + result.stderr;
        if (result.error) {
            return { status: 'error', message: result.error.message, output };
        }
    }

    return { status: 'success', output };
}

function toAppRootPath(relativePath) {
    const abs = path.resolve(APP_ROOT, relativePath);
    const root = path.resolve(APP_ROOT);
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Unsafe path outside APP_ROOT: ${relativePath}`);
    }
    return abs;
}

function formatTimestampForPath(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('') + '-' + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join('');
}

function getCleanupDefinition(serviceId) {
    const def = getServiceDefinition(serviceId);
    const dataDir = CLEANUP_SERVICE_DATA_DIRS[serviceId];
    if (!def || !dataDir) return null;
    const dataAbsPath = toAppRootPath(dataDir);
    const backupRoot = path.resolve(CLEANUP_BACKUP_ROOT);
    const root = path.resolve(APP_ROOT);
    const rel = path.relative(root, backupRoot);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error('Cleanup backup root must be inside APP_ROOT');
    }
    return {
        ...def,
        dataDir,
        dataAbsPath,
        backupRoot
    };
}

function buildCleanupBackupDir(serviceId, actor, date = new Date()) {
    const segment = `${formatTimestampForPath(date)}-${serviceId}-${sanitizePathSegment(actor.operator)}`;
    return path.join(CLEANUP_BACKUP_ROOT, segment);
}

function getUniqueBackupDir(preferredDir) {
    if (!fs.existsSync(preferredDir)) return preferredDir;
    for (let i = 2; i < 1000; i += 1) {
        const candidate = `${preferredDir}-${i}`;
        if (!fs.existsSync(candidate)) return candidate;
    }
    throw new Error('无法创建唯一备份目录，请检查备份目录是否异常。');
}

function buildCleanupPlan(serviceId, actor = { operator: 'operator' }) {
    const def = getCleanupDefinition(serviceId);
    if (!def) {
        return { status: 'error', message: '该服务不支持一键清理。仅支持 postgres、redis、kafka、cassandra。' };
    }
    if (!def.exists) return { status: 'error', message: `Compose file not found: ${def.composePath}` };

    const backupDir = buildCleanupBackupDir(serviceId, actor);
    return {
        status: 'success',
        service: { id: def.id, label: def.label },
        appService: getPackageServiceId(),
        dataDir: def.dataDir,
        dataPath: def.dataAbsPath,
        backupRoot: CLEANUP_BACKUP_ROOT,
        backupDir,
        composePath: def.composePath,
        requiresAppStopped: true,
        appServiceRunning: false,
        warnings: [
            '该操作会停止目标服务并归档当前数据目录。',
            '业务服务正在运行时禁止清理，请先停止 IoT Cloud/IoT Edge。',
            '清理后不会自动执行 ThingsBoard 初始化安装。'
        ]
    };
}

function appendAuditLog(entry) {
    try {
        fs.mkdirSync(RUNTIME_DIR, { recursive: true });
        fs.appendFileSync(AUDIT_LOG_FILE, JSON.stringify(entry) + '\n');
    } catch (e) {
        console.error(`[Audit] Failed to write audit log: ${e.message}`);
    }
}

function buildAuditEntry(status, serviceId, actor, fields = {}) {
    return {
        timestamp: new Date().toISOString(),
        event: 'service_cleanup',
        status,
        serviceId,
        operator: actor.operator,
        sessionId: actor.sessionId,
        ip: actor.ip,
        ...fields
    };
}

function summarizeServiceStatus(status) {
    if (!status) return null;
    return {
        status: status.status || 'unknown',
        running: !!status.running,
        containerId: status.containerId || ''
    };
}

function safeMovePath(source, destination) {
    if (!fs.existsSync(source)) return false;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(source, destination);
    return true;
}

function writeCleanupManifest(manifestPath, manifest) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

async function runCleanupService(serviceId, confirmServiceId, actor) {
    const def = getCleanupDefinition(serviceId);
    if (!def) {
        appendAuditLog(buildAuditEntry('failure', serviceId, actor, {
            reason: 'UNSUPPORTED_SERVICE',
            error: 'Unsupported cleanup service'
        }));
        console.log(`[Audit] Cleanup failure operator=${actor.operator} service=${serviceId} source=n/a backup=n/a status=failure error=UNSUPPORTED_SERVICE`);
        return { status: 'error', message: '该服务不支持一键清理。仅支持 postgres、redis、kafka、cassandra。' };
    }
    if (confirmServiceId !== serviceId) {
        appendAuditLog(buildAuditEntry('failure', serviceId, actor, {
            reason: 'CONFIRMATION_MISMATCH',
            sourcePath: def.dataAbsPath,
            backupDir: '',
            composePath: def.composePath,
            error: `confirmServiceId mismatch: ${confirmServiceId || ''}`
        }));
        console.log(`[Audit] Cleanup failure operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=n/a status=failure error=CONFIRMATION_MISMATCH`);
        return { status: 'error', code: 'CONFIRMATION_MISMATCH', message: `请输入 ${serviceId} 才能执行清理。` };
    }
    if (!def.exists) {
        appendAuditLog(buildAuditEntry('failure', serviceId, actor, {
            reason: 'COMPOSE_MISSING',
            sourcePath: def.dataAbsPath,
            backupDir: '',
            composePath: def.composePath,
            error: `Compose file not found: ${def.composePath}`
        }));
        console.log(`[Audit] Cleanup failure operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=n/a status=failure error=COMPOSE_MISSING`);
        return { status: 'error', message: `Compose file not found: ${def.composePath}` };
    }

    const dockerIssue = dockerReadyMessage();
    if (dockerIssue) {
        appendAuditLog(buildAuditEntry('failure', serviceId, actor, {
            reason: 'DOCKER_UNAVAILABLE',
            sourcePath: def.dataAbsPath,
            backupDir: '',
            composePath: def.composePath,
            error: dockerIssue
        }));
        console.log(`[Audit] Cleanup failure operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=n/a status=failure error=DOCKER_UNAVAILABLE`);
        return { status: 'error', message: dockerIssue };
    }
    if (activeCleanupService) {
        appendAuditLog(buildAuditEntry('failure', serviceId, actor, {
            reason: 'CLEANUP_RUNNING',
            sourcePath: def.dataAbsPath,
            backupDir: '',
            composePath: def.composePath,
            activeCleanupService
        }));
        console.log(`[Audit] Cleanup failure operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=n/a status=failure error=CLEANUP_RUNNING`);
        return { status: 'error', code: 'CLEANUP_RUNNING', message: `已有清理任务正在执行：${activeCleanupService}` };
    }

    const appStatus = await getServiceStatus(getServiceDefinition(getPackageServiceId()));
    if (appStatus.running) {
        const blocked = buildAuditEntry('blocked', serviceId, actor, {
            reason: 'APP_SERVICE_RUNNING',
            appService: getPackageServiceId(),
            sourcePath: def.dataAbsPath,
            backupDir: '',
            composePath: def.composePath
        });
        appendAuditLog(blocked);
        console.log(`[Audit] Cleanup blocked operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=n/a status=blocked reason=APP_SERVICE_RUNNING`);
        return {
            status: 'error',
            code: 'APP_SERVICE_RUNNING',
            message: `请先停止 ${getPackageServiceId()}，再清理 ${def.label} 数据。`
        };
    }

    activeCleanupService = serviceId;
    const startedAt = new Date();
    const targetStatusBefore = await getServiceStatus(def);
    const backupDir = getUniqueBackupDir(buildCleanupBackupDir(serviceId, actor, startedAt));
    const archivedDataPath = path.join(backupDir, path.basename(def.dataAbsPath));
    const manifestPath = path.join(backupDir, 'manifest.json');
    const sourceExisted = fs.existsSync(def.dataAbsPath);
    const manifest = {
        serviceId,
        serviceLabel: def.label,
        operator: actor.operator,
        sessionId: actor.sessionId,
        ip: actor.ip,
        startedAt: startedAt.toISOString(),
        appRoot: APP_ROOT,
        appService: getPackageServiceId(),
        composePath: def.composePath,
        sourcePath: def.dataAbsPath,
        backupDir,
        archivedDataPath,
        sourceExisted,
        targetStatusBefore: summarizeServiceStatus(targetStatusBefore),
        result: 'pending'
    };

    appendAuditLog(buildAuditEntry('pending', serviceId, actor, {
        sourcePath: def.dataAbsPath,
        backupDir,
        composePath: def.composePath,
        sourceExisted,
        targetStatusBefore: summarizeServiceStatus(targetStatusBefore)
    }));
    console.log(`[Audit] Cleanup pending operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=${backupDir} status=pending`);

    let output = '';
    try {
        fs.mkdirSync(backupDir, { recursive: true });
        writeCleanupManifest(manifestPath, manifest);

        const down = await execDocker(dockerComposeCmd, composeArgsFor(def, ['down']));
        output += down.stdout + down.stderr;
        if (down.error) throw new Error(down.error.message);

        const archived = safeMovePath(def.dataAbsPath, archivedDataPath);
        fs.mkdirSync(def.dataAbsPath, { recursive: true });

        const up = await execDocker(dockerComposeCmd, composeArgsFor(def, ['up', '-d']));
        output += up.stdout + up.stderr;
        if (up.error) throw new Error(up.error.message);

        const targetStatusAfter = await getServiceStatus(def);
        manifest.finishedAt = new Date().toISOString();
        manifest.result = 'success';
        manifest.archived = archived;
        manifest.targetStatusAfter = summarizeServiceStatus(targetStatusAfter);
        manifest.output = output.slice(-8000);
        writeCleanupManifest(manifestPath, manifest);

        appendAuditLog(buildAuditEntry('success', serviceId, actor, {
            sourcePath: def.dataAbsPath,
            backupDir,
            archived,
            composePath: def.composePath,
            targetStatusAfter: summarizeServiceStatus(targetStatusAfter)
        }));
        console.log(`[Audit] Cleanup success operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=${backupDir} status=success`);

        return {
            status: 'success',
            service: { id: def.id, label: def.label },
            sourcePath: def.dataAbsPath,
            backupDir,
            archived,
            manifestPath,
            output
        };
    } catch (e) {
        let targetStatusAfterFailure = null;
        try {
            targetStatusAfterFailure = await getServiceStatus(def);
        } catch (statusError) {
            targetStatusAfterFailure = { status: 'unknown', running: false, containerId: '', message: statusError.message };
        }
        manifest.finishedAt = new Date().toISOString();
        manifest.result = 'failure';
        manifest.error = e.message;
        manifest.targetStatusAfter = summarizeServiceStatus(targetStatusAfterFailure);
        manifest.output = output.slice(-8000);
        try { writeCleanupManifest(manifestPath, manifest); } catch (manifestError) { console.error(`[Audit] Failed to update cleanup manifest: ${manifestError.message}`); }

        appendAuditLog(buildAuditEntry('failure', serviceId, actor, {
            sourcePath: def.dataAbsPath,
            backupDir,
            composePath: def.composePath,
            error: e.message,
            targetStatusAfter: summarizeServiceStatus(targetStatusAfterFailure)
        }));
        console.log(`[Audit] Cleanup failure operator=${actor.operator} service=${serviceId} source=${def.dataAbsPath} backup=${backupDir} status=failure error=${e.message}`);

        return {
            status: 'error',
            message: e.message,
            sourcePath: def.dataAbsPath,
            backupDir,
            manifestPath,
            output
        };
    } finally {
        activeCleanupService = null;
    }
}

function normalizeComposeEnvironment(environment) {
    const entries = [];
    if (Array.isArray(environment)) {
        environment.forEach(item => {
            if (typeof item !== 'string') return;
            const idx = item.indexOf('=');
            if (idx === -1) entries.push({ key: item.trim(), value: '' });
            else entries.push({ key: item.slice(0, idx).trim(), value: item.slice(idx + 1).trim() });
        });
    } else if (environment && typeof environment === 'object') {
        Object.keys(environment).forEach(key => {
            const raw = environment[key];
            entries.push({ key, value: raw === null || raw === undefined ? '' : String(raw) });
        });
    }
    return entries.filter(item => item.key);
}

function composeEntriesToMap(entries) {
    return entries.reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
    }, {});
}

function normalizeComposeList(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value.map(item => {
            if (typeof item === 'string') return item;
            try {
                return JSON.stringify(item);
            } catch (e) {
                return String(item);
            }
        });
    }
    return [String(value)];
}

function normalizeComposeCommand(command) {
    if (!command) return '';
    if (Array.isArray(command)) return command.join(' ');
    if (typeof command === 'object') {
        try {
            return JSON.stringify(command);
        } catch (e) {
            return String(command);
        }
    }
    return String(command);
}

function extractRedisPassword(command) {
    const value = normalizeComposeCommand(command);
    if (!value) return '';
    const match = value.match(/--requirepass(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
    return match ? (match[1] || match[2] || match[3] || '') : '';
}

function isSensitiveComposeKey(key) {
    if (/NUM_TOKENS/i.test(key)) return false;
    return /(PASSWORD|PASS|SECRET|TOKEN|WEBHOOK|PRIVATE|ACCESS_KEY|AUTH)/i.test(key);
}

function configItem(key, value, sensitive = false) {
    return {
        key,
        value: value === null || value === undefined ? '' : String(value),
        sensitive: !!sensitive
    };
}

function listItems(values) {
    return normalizeComposeList(values).map(value => configItem('', value, false));
}

function appendPortAndVolumeSections(response, service) {
    response.sections.push({ title: '端口', items: listItems(service.ports) });
    response.sections.push({ title: '挂载', items: listItems(service.volumes) });
}

function buildLoggingItems(service) {
    const logging = service?.logging;
    if (!logging || typeof logging !== 'object') return [];
    const items = [];
    if (logging.driver) items.push(configItem('driver', logging.driver));
    if (logging.options && typeof logging.options === 'object') {
        Object.keys(logging.options).forEach(key => items.push(configItem(key, logging.options[key])));
    }
    return items;
}

function buildOtherItems(service) {
    const items = [];
    const command = normalizeComposeCommand(service.command);
    if (command) items.push(configItem('command', command, isSensitiveComposeKey(command)));
    if (service.restart) items.push(configItem('restart', service.restart));
    normalizeComposeList(service.cap_add).forEach(value => items.push(configItem('cap_add', value)));
    normalizeComposeList(service.security_opt).forEach(value => items.push(configItem('security_opt', value)));
    buildLoggingItems(service).forEach(item => items.push(configItem(`logging.${item.key}`, item.value, item.sensitive)));
    return items;
}

const HIDDEN_SERVICE_ENV_KEYS = {
    kafka: new Set([
        'KAFKA_ENABLE_KRAFT',
        'KAFKA_CFG_NODE_ID',
        'KAFKA_KRAFT_CLUSTER_ID',
        'KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP',
        'KAFKA_CFG_INTER_BROKER_LISTENER_NAME'
    ])
};

function filterServiceEnvironmentEntries(serviceId, entries) {
    const hidden = HIDDEN_SERVICE_ENV_KEYS[serviceId];
    if (!hidden) return entries;
    return entries.filter(item => !hidden.has(item.key));
}

function resolveComposeVariableString(value, env = parseEnvFile()) {
    if (typeof value !== 'string') return value || '';
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])([^}]*))?\}/g, (match, key, operator, fallback) => {
        const hasEnvValue = Object.prototype.hasOwnProperty.call(env, key) && env[key] !== '';
        if (hasEnvValue) return env[key];
        if (process.env[key]) return process.env[key];
        if (operator && operator.includes('-')) return fallback || '';
        return match;
    });
}

function buildServiceComposeConfig(serviceId) {
    const def = getServiceDefinition(serviceId);
    if (!def) return { status: 'error', message: 'Unknown service' };
    if (!def.exists) return { status: 'error', message: `Compose file not found: ${def.composePath}` };
    if (!yaml) return { status: 'error', message: 'YAML parser is not available' };

    let doc;
    try {
        doc = yaml.load(fs.readFileSync(def.composeAbsPath, 'utf8')) || {};
    } catch (e) {
        return { status: 'error', message: `Failed to parse compose file: ${e.message}` };
    }

    const service = doc.services?.[def.composeService];
    if (!service) {
        return { status: 'error', message: `Service ${def.composeService} not found in ${def.composePath}` };
    }

    const envEntries = normalizeComposeEnvironment(service.environment);
    const envMap = composeEntriesToMap(envEntries);
    const summary = {
        image: resolveComposeVariableString(service.image || ''),
        containerName: service.container_name || '',
        restart: service.restart || ''
    };

    const response = {
        status: 'success',
        service: { id: def.id, label: def.label },
        composePath: def.composePath,
        summary,
        sections: []
    };

    if (def.id === getPackageServiceId()) {
        response.sections.push({
            title: '说明',
            items: [
                configItem('业务配置', '业务配置仍在当前主配置表单中维护'),
                configItem('env_file', normalizeComposeList(service.env_file).join(', ') || '无'),
                configItem('compose 摘要', '这里只读展示运行摘要，不提供 compose 编辑')
            ]
        });
        response.sections.push({ title: '端口', items: listItems(service.ports) });
        response.sections.push({ title: '挂载', items: listItems(service.volumes) });
        response.sections.push({ title: '其他', items: buildOtherItems(service) });
        return response;
    }

    if (def.id === 'postgres') {
        response.sections.push({
            title: '关键配置',
            items: [
                configItem('POSTGRES_USER', envMap.POSTGRES_USER || 'postgres'),
                configItem('POSTGRES_PASSWORD', envMap.POSTGRES_PASSWORD || '', true),
                configItem('POSTGRES_DB', envMap.POSTGRES_DB || '')
            ]
        });
        appendPortAndVolumeSections(response, service);
        return response;
    }

    if (def.id === 'redis') {
        const password = extractRedisPassword(service.command) || envMap.REDIS_PASSWORD || '';
        response.sections.push({
            title: '关键配置',
            items: [
                configItem('REDIS_PASSWORD', password, true)
            ]
        });
        appendPortAndVolumeSections(response, service);
        return response;
    }

    const visibleEnvEntries = filterServiceEnvironmentEntries(def.id, envEntries);
    const envItems = visibleEnvEntries.map(item => configItem(item.key, item.value, isSensitiveComposeKey(item.key)));
    response.sections.push({
        title: '环境变量',
        items: envItems.length ? envItems : [configItem('环境变量', '无环境变量')]
    });
    response.sections.push({ title: '端口', items: listItems(service.ports) });
    response.sections.push({ title: '挂载', items: listItems(service.volumes) });
    response.sections.push({ title: '其他', items: buildOtherItems(service) });
    return response;
}

function buildDeploymentPlan(config = parseEnvFile()) {
    const required = new Set(['postgres']);
    const warnings = [];

    if (config.DATABASE_TS_TYPE === 'cassandra' || config.DATABASE_TS_LATEST_TYPE === 'cassandra') {
        required.add('cassandra');
    }

    if (config.DATABASE_TS_LATEST_TYPE === 'redis-cluster' || config.REDIS_CONNECTION_TYPE === 'cluster') {
        warnings.push('Redis Cluster 暂不自动初始化，请确认 ANNOUNCE_IP 和 REDIS_NODES 后手动执行高级流程。');
    } else if (config.DATABASE_TS_LATEST_TYPE === 'redis' || config.CACHE_TYPE === 'redis') {
        required.add('redis');
    }

    if (config.TB_QUEUE_TYPE === 'kafka') {
        required.add('kafka');
    }

    required.add(getPackageServiceId());

    const services = Array.from(required)
        .map(getServiceDefinition)
        .filter(Boolean)
        .sort((a, b) => a.order - b.order);

    return {
        appType: APP_TYPE,
        appService: getPackageServiceId(),
        services: services.map(s => ({ id: s.id, label: s.label, order: s.order, exists: s.exists })),
        warnings
    };
}

async function buildDeploymentPlanWithStatus(config = parseEnvFile()) {
    const plan = buildDeploymentPlan(config);
    const statuses = await Promise.all(plan.services.map(s => getServiceStatus(getServiceDefinition(s.id))));
    const appServiceId = getPackageServiceId();
    const missing = statuses.filter(s => !s.running).map(s => s.id);
    const missingDependencyIds = statuses
        .filter(s => s.id !== appServiceId && !s.running)
        .map(s => s.id);
    return { ...plan, statuses, missingServices: missing, missingDependencyIds };
}

async function checkRequiredDependencies(config = parseEnvFile()) {
    const plan = await buildDeploymentPlanWithStatus(config);
    const appServiceId = getPackageServiceId();
    const missingDependencies = (plan.statuses || [])
        .filter(s => s.id !== appServiceId && !s.running)
        .map(s => ({
            id: s.id,
            label: s.label || s.id,
            status: s.status || 'unknown',
            message: s.message || ''
        }));

    return {
        ok: missingDependencies.length === 0,
        plan,
        missingDependencies,
        missingDependencyIds: missingDependencies.map(s => s.id)
    };
}

function dependencyBlockResult(actionText, dependencyCheck) {
    const names = dependencyCheck.missingDependencies.map(s => s.label || s.id).join('、');
    return {
        status: 'error',
        code: 'DEPENDENCIES_NOT_RUNNING',
        message: `请先启动依赖服务：${names}，状态变为 running 后再${actionText}。`,
        plan: dependencyCheck.plan,
        missingDependencyIds: dependencyCheck.missingDependencyIds,
        missingDependencies: dependencyCheck.missingDependencies
    };
}

async function guardAppServiceDependencies(actionText, config = parseEnvFile()) {
    const dependencyCheck = await checkRequiredDependencies(config);
    if (!dependencyCheck.ok) {
        return dependencyBlockResult(actionText, dependencyCheck);
    }
    return null;
}

async function applyAppConfigChange(config) {
    const dependencyBlock = await guardAppServiceDependencies('重启当前业务服务', config);
    if (dependencyBlock) return dependencyBlock;

    const plan = buildDeploymentPlan(config);
    const outputs = [];
    const appServiceId = getPackageServiceId();
    const appDef = getServiceDefinition(appServiceId);

    if (!appDef || !appDef.exists) {
        return { status: 'error', plan, output: `[ERROR] ${appServiceId}: compose file missing` };
    }

    const statuses = await Promise.all(plan.services.map(s => getServiceStatus(getServiceDefinition(s.id))));
    const missingServices = statuses
        .filter(s => s.exists && !s.running)
        .map(s => s.id);
    const missingDependencyIds = statuses
        .filter(s => s.id !== appServiceId && s.exists && !s.running)
        .map(s => s.id);

    const result = await runComposeAction(appServiceId, 'restart');
    outputs.push(`[${result.status.toUpperCase()}] ${appServiceId}: restart\n${result.output || result.message || ''}`);
    if (result.status !== 'success') {
        return {
            status: 'error',
            plan: { ...plan, statuses, missingServices, missingDependencyIds },
            output: outputs.join('\n'),
            restartedService: appServiceId,
            skippedDependencies: missingDependencyIds
        };
    }

    return {
        status: 'success',
        plan: { ...plan, statuses, missingServices, missingDependencyIds },
        output: outputs.join('\n'),
        restartedService: appServiceId,
        skippedDependencies: missingDependencyIds
    };
}

// --- HTTP Server ---

// Detect Docker binary path (without shell)
let dockerPath = null;
let dockerComposeCmd = null;
let dockerComposeCmdArgs = [];

const commonDockerPaths = [
    process.env.DOCKER_BIN,
    '/usr/bin/docker',
    '/usr/local/bin/docker',
    '/snap/bin/docker',
    '/opt/docker/bin/docker',
    'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' // Windows
].filter(Boolean);

function detectDockerPath() {
    // Try to find docker binary
    for (const path of commonDockerPaths) {
        try {
            fs.accessSync(path, fs.constants.X_OK);
            dockerPath = path;
            console.log(`[Info] Found docker at: ${path}`);
            break;
        } catch (e) {
            // Continue
        }
    }

    if (!dockerPath) {
        console.error('[Error] Docker not found in common paths');
        console.error('[Info] Searched paths:', commonDockerPaths);
        return;
    }

    // Test if it's new format (docker compose) or old format (docker-compose)
    try {
        execFileSync(dockerPath, ['compose', 'version'], { stdio: 'ignore' });
        console.log('[Info] Using: docker compose (new format)');
        dockerComposeCmd = dockerPath;
        dockerComposeCmdArgs = ['compose'];
        return;
    } catch (error) {
        // Fallback: try to find docker-compose
        const dockerComposePaths = [
            process.env.DOCKER_COMPOSE_BIN,
            '/usr/bin/docker-compose',
            '/usr/local/bin/docker-compose'
        ].filter(Boolean);

        for (const path of dockerComposePaths) {
            try {
                fs.accessSync(path, fs.constants.X_OK);
                console.log('[Info] Using: docker-compose (legacy format)');
                dockerComposeCmd = path;
                dockerComposeCmdArgs = [];
                return;
            } catch (e) {
                // Continue
            }
        }

        console.error('[Error] Neither "docker compose" nor "docker-compose" is available!');
    }
}

function serveStaticAsset(pathname, res, headers) {
    const assetRoot = path.resolve(__dirname, 'assets');
    const relativePath = decodeURIComponent(pathname.replace(/^\/assets\//, ''));
    const assetPath = path.resolve(assetRoot, relativePath);

    if (!assetPath.startsWith(assetRoot + path.sep)) {
        writeJson(res, 403, { status: 'error', message: 'Forbidden' }, headers);
        return;
    }

    if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
        writeJson(res, 404, { status: 'error', message: 'Asset not found' }, headers);
        return;
    }

    const ext = path.extname(assetPath).toLowerCase();
    const contentTypes = {
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp'
    };

    res.writeHead(200, {
        ...headers,
        'Content-Type': contentTypes[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    res.end(fs.readFileSync(assetPath));
}

function startServer() {
    const server = http.createServer((req, res) => {
        const { method } = req;
        const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const url = req.url;
        const pathname = requestUrl.pathname;
        const headers = {
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        };

        if (method === 'OPTIONS') {
            res.writeHead(204, headers);
            res.end();
            return;
        }

        if (pathname === '/' || pathname === '/index.html') {
            const htmlPath = path.join(__dirname, 'index.html');
            console.log(`[Debug] Loading HTML from: ${htmlPath}`);
            const html = fs.readFileSync(htmlPath, 'utf-8');
            res.writeHead(200, {
                ...headers,
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(html);
            return;
        }

        if (pathname.startsWith('/assets/') && method === 'GET') {
            serveStaticAsset(pathname, res, headers);
            return;
        }

        if (pathname === '/api/health' && method === 'GET') {
            writeJson(res, 200, {
                status: 'ok',
                appRoot: APP_ROOT,
                appDir: APP_DIR,
                appType: APP_TYPE,
                docker: {
                    available: !dockerReadyMessage(),
                    message: dockerReadyMessage()
                }
            }, headers);
            return;
        }

        if (pathname === '/api/auth/status' && method === 'GET') {
            const session = getSession(req);
            writeJson(res, 200, {
                required: AUTH_REQUIRED,
                authenticated: isAuthenticated(req),
                operator: session?.operator || ''
            }, headers);
            return;
        }

        if (pathname === '/api/login' && method === 'POST') {
            readRequestBody(req).then(body => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const operator = normalizeOperatorName(payload.operator);
                    if (!operator) {
                        writeJson(res, 400, { status: 'error', message: '请输入操作员名称' }, headers);
                        return;
                    }
                    if (!AUTH_REQUIRED || payload.password === CONFIG_MATE_PASSWORD) {
                        const token = createSession(req, operator);
                        const session = sessions.get(token);
                        writeJson(res, 200, { status: 'success', operator: session.operator }, {
                            ...headers,
                            'Set-Cookie': `config_mate_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
                        });
                    } else {
                        writeJson(res, 401, { status: 'error', message: '密码错误' }, headers);
                    }
                } catch (e) {
                    writeJson(res, 400, { status: 'error', message: e.message }, headers);
                }
            });
            return;
        }

        if (pathname === '/api/logout' && method === 'POST') {
            const token = getAuthToken(req);
            if (token) sessions.delete(token);
            writeJson(res, 200, { status: 'success' }, {
                ...headers,
                'Set-Cookie': 'config_mate_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
            });
            return;
        }

        // 版本号 API
        if (pathname === '/api/version' && method === 'GET') {
            const packageJson = require('./package.json');
            res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ version: packageJson.version }));
            return;
        }

        if (!isAuthenticated(req)) {
            writeJson(res, 401, { status: 'unauthorized', message: '请先登录 Config Mate' }, headers);
            return;
        }

        if (pathname === '/api/config' && method === 'GET') {
            const current = parseEnvFile();
            const responseData = {
                meta: CONFIG_META,
                values: current
            };
            res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
            res.end(JSON.stringify(responseData));
            return;
        }

        if (pathname === '/api/save' && method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const newConfig = JSON.parse(body);
                    saveEnvFile(newConfig);
                    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok' }));
                } catch (e) {
                    res.writeHead(500, headers);
                    res.end(JSON.stringify({ status: 'error', message: e.message }));
                }
            });
            return;
        }

        // API: Get History List
        if (pathname === '/api/history' && method === 'GET') {
            if (!fs.existsSync(HISTORY_DIR)) {
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', data: [] }));
                return;
            }

            const files = fs.readdirSync(HISTORY_DIR)
                .filter(f => f.startsWith('.env.bak.'))
                .map(f => {
                    const stats = fs.statSync(path.join(HISTORY_DIR, f));
                    return {
                        filename: f,
                        timestamp: stats.mtime.toISOString(),
                        size: stats.size
                    };
                })
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'success', data: files }));
            return;
        }

        // API: Restore History
        if (pathname === '/api/history/restore' && method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const { filename } = JSON.parse(body);
                    const backupPath = path.join(HISTORY_DIR, filename);

                    if (!fs.existsSync(backupPath)) {
                        res.writeHead(404, { ...headers, 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'error', message: 'Backup file not found' }));
                        return;
                    }

                    fs.copyFileSync(backupPath, ENV_FILE_PATH);
                    console.log(`[History] Restored .env from ${filename}`);

                    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'success', message: 'Restored successfully' }));
                } catch (e) {
                    res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: e.message }));
                }
            });
            return;
        }

        // API: Get History Content
        if (pathname === '/api/history/content' && method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const { filename } = JSON.parse(body);
                    // Security check: simple path traversal prevention
                    const safeName = path.basename(filename);
                    const backupPath = path.join(HISTORY_DIR, safeName);

                    if (!fs.existsSync(backupPath)) {
                        res.writeHead(404, { ...headers, 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'error', message: 'File not found' }));
                        return;
                    }

                    const content = fs.readFileSync(backupPath, 'utf-8');
                    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'success', content }));
                } catch (e) {
                    res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: e.message }));
                }
            });
            return;
        }

        if (pathname === '/api/deployment' && method === 'GET') {
            writeJson(res, 200, {
                status: 'success',
                appRoot: APP_ROOT,
                appDir: APP_DIR,
                appType: APP_TYPE,
                appService: getPackageServiceId(),
                envPath: ENV_FILE_PATH,
                yamlPath: YAML_CONFIG_PATH,
                authRequired: AUTH_REQUIRED,
                docker: {
                    cli: dockerPath,
                    compose: dockerComposeCmd,
                    socketMounted: fs.existsSync('/var/run/docker.sock') || os.platform() === 'win32',
                    available: !dockerReadyMessage(),
                    message: dockerReadyMessage()
                }
            }, headers);
            return;
        }

        if (pathname === '/api/services' && method === 'GET') {
            Promise.all(listServiceDefinitions().map(getServiceStatus))
                .then(services => writeJson(res, 200, { status: 'success', services }, headers))
                .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return;
        }

        const serviceConfigMatch = pathname.match(/^\/api\/services\/([^/]+)\/config$/);
        if (serviceConfigMatch && method === 'GET') {
            const result = buildServiceComposeConfig(serviceConfigMatch[1]);
            writeJson(res, result.status === 'success' ? 200 : 404, result, headers);
            return;
        }

        const serviceCleanupPlanMatch = pathname.match(/^\/api\/services\/([^/]+)\/cleanup-plan$/);
        if (serviceCleanupPlanMatch && method === 'GET') {
            const actor = getRequestActor(req);
            const result = buildCleanupPlan(serviceCleanupPlanMatch[1], actor);
            if (result.status === 'success') {
                getServiceStatus(getServiceDefinition(getPackageServiceId()))
                    .then(appStatus => {
                        result.appServiceRunning = !!appStatus.running;
                        result.appServiceStatus = appStatus.status || 'unknown';
                        writeJson(res, 200, result, headers);
                    })
                    .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            } else {
                writeJson(res, 404, result, headers);
            }
            return;
        }

        const serviceCleanupMatch = pathname.match(/^\/api\/services\/([^/]+)\/cleanup$/);
        if (serviceCleanupMatch && method === 'POST') {
            readRequestBody(req).then(body => {
                const payload = body ? JSON.parse(body) : {};
                return runCleanupService(serviceCleanupMatch[1], payload.confirmServiceId, getRequestActor(req));
            }).then(result => {
                const code = result.status === 'success' ? 200
                    : (result.code === 'APP_SERVICE_RUNNING' || result.code === 'CLEANUP_RUNNING' ? 409 : 400);
                writeJson(res, code, result, headers);
            }).catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return;
        }

        const serviceActionMatch = pathname.match(/^\/api\/services\/([^/]+)\/(up|down|restart)$/);
        if (serviceActionMatch && method === 'POST') {
            const [, serviceId, action] = serviceActionMatch;
            const actionText = action === 'up' ? '启动当前业务服务' : '重启当前业务服务';
            const guardedAction = async () => {
                if (serviceId === getPackageServiceId() && (action === 'up' || action === 'restart')) {
                    const dependencyBlock = await guardAppServiceDependencies(actionText);
                    if (dependencyBlock) return dependencyBlock;
                }
                return runComposeAction(serviceId, action);
            };
            guardedAction()
                .then(result => writeJson(res, result.status === 'success' ? 200 : (result.code === 'DEPENDENCIES_NOT_RUNNING' ? 409 : 500), result, headers))
                .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return;
        }

        if (pathname === '/api/plan' && method === 'POST') {
            readRequestBody(req).then(body => {
                const payload = body ? JSON.parse(body) : {};
                return buildDeploymentPlanWithStatus(payload.config || parseEnvFile());
            }).then(plan => {
                writeJson(res, 200, { status: 'success', plan }, headers);
            }).catch(e => {
                writeJson(res, 500, { status: 'error', message: e.message }, headers);
            });
            return;
        }

        if (pathname === '/api/apply-plan' && method === 'POST') {
            readRequestBody(req).then(async body => {
                const payload = body ? JSON.parse(body) : {};
                const config = payload.config || parseEnvFile();
                const dependencyBlock = await guardAppServiceDependencies('保存并重启当前业务服务', config);
                if (dependencyBlock) return dependencyBlock;
                if (payload.save !== false && payload.config) {
                    saveEnvFile(config);
                }
                return applyAppConfigChange(config);
            }).then(result => {
                writeJson(res, result.status === 'success' ? 200 : (result.code === 'DEPENDENCIES_NOT_RUNNING' ? 409 : 500), result, headers);
            }).catch(e => {
                writeJson(res, 500, { status: 'error', message: e.message }, headers);
            });
            return;
        }

        if (pathname === '/api/restart' && method === 'POST') {
            guardAppServiceDependencies('重启当前业务服务')
                .then(block => block || runComposeAction(getPackageServiceId(), 'restart'))
                .then(result => writeJson(res, result.status === 'success' ? 200 : (result.code === 'DEPENDENCIES_NOT_RUNNING' ? 409 : 500), result, headers))
                .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return;
        }

        if (pathname === '/api/stop' && method === 'POST') {
            runComposeAction(getPackageServiceId(), 'down')
                .then(result => writeJson(res, result.status === 'success' ? 200 : 500, result, headers))
                .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return;
        }

        if (pathname === '/api/service-restart' && method === 'POST') {
            guardAppServiceDependencies('重启当前业务服务')
                .then(block => block || runComposeAction(getPackageServiceId(), 'restart'))
                .then(result => writeJson(res, result.status === 'success' ? 200 : (result.code === 'DEPENDENCIES_NOT_RUNNING' ? 409 : 500), result, headers))
                .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return;
        }



        // API: Check Installation Config
        if (pathname === '/api/check-install' && method === 'GET') {
            const appDef = getServiceDefinition(getPackageServiceId());
            const installFile = appDef?.installComposeAbsPath;
            const exists = !!installFile && fs.existsSync(installFile);
            res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'success', exists }));
            return;
        }

        // API: Validate Compose Files (Check for env_file)
        if (pathname === '/api/validate-compose' && method === 'GET') {
            const appDef = getServiceDefinition(getPackageServiceId());
            const requiredFiles = [
                { label: appDef?.composePath || 'docker-compose.yml', path: appDef?.composeAbsPath },
                { label: appDef?.installComposePath || 'docker-compose-install.yml', path: appDef?.installComposeAbsPath }
            ];

            const missingFiles = [];
            const invalidFiles = [];

            // 0. Pre-check: ThingsBoard Config Files (conf/thingsboard.yml or conf/tb-edge.yml)
            const confDir = path.join(APP_DIR, 'conf');
            const tbConfigPath = path.join(confDir, 'thingsboard.yml');
            const edgeConfigPath = path.join(confDir, 'tb-edge.yml');

            const hasTbConfig = fs.existsSync(tbConfigPath);
            const hasEdgeConfig = fs.existsSync(edgeConfigPath);

            if (!hasTbConfig && !hasEdgeConfig) {
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'config_missing',
                    msg: 'Missing ThingsBoard configuration files',
                    files: ['conf/thingsboard.yml', 'conf/tb-edge.yml']
                }));
                return;
            }

            // 1. Check Existence
            requiredFiles.forEach(file => {
                if (!file.path || !fs.existsSync(file.path)) {
                    missingFiles.push(file.label);
                }
            });

            // 2. Logic Branching
            if (missingFiles.length > 0) {
                // Scenario A: Missing Files -> Warning (Non-blocking)
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'missing',
                    files: missingFiles
                }));
                return;
            }

            // Scenario B: All Files Exist -> Strict Content Check
            requiredFiles.forEach(file => {
                const filePath = file.path;
                // We know it exists from step 1
                if (!checkFileContent(filePath, 'env_file')) {
                    invalidFiles.push({ file: file.label, msg: '未配置 env_file (Missing env_file property)' });
                }
            });

            if (invalidFiles.length > 0) {
                // Blocking Error
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'error',
                    errors: invalidFiles
                }));
            } else {
                // Success
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success' }));
            }
            return;
        }

        function checkFileContent(filePath, keyword) {
            try {
                if (!filePath) return false;
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                // Regex: Start of line, optional whitespace, keyword, optional whitespace, colon, anything else
                const regex = new RegExp(`^\\s*${keyword}\\s*:`);
                return lines.some(line => {
                    const trimmed = line.trim();
                    return regex.test(line) && !trimmed.startsWith('#');
                });
            } catch (e) {
                console.error(`[Error] checkFileContent failed for ${filePath}:`, e);
                return false;
            }
        }

        // API: Execute Installation
        if (pathname === '/api/install' && method === 'POST') {
            if (!dockerComposeCmd) {
                res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Docker not available' }));
                return;
            }

            const appDef = getServiceDefinition(getPackageServiceId());
            if (!appDef?.installComposeAbsPath || !fs.existsSync(appDef.installComposeAbsPath)) {
                res.writeHead(404, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Install compose file not found' }));
                return;
            }

            checkRequiredDependencies()
                .then(dependencyCheck => {
                    if (!dependencyCheck.ok) {
                        writeJson(res, 409, dependencyBlockResult('执行初始化安装', dependencyCheck), headers);
                        return;
                    }

                    const argsDown = [...dockerComposeCmdArgs, '-f', appDef.installComposeAbsPath, 'down'];
                    const argsUp = [...dockerComposeCmdArgs, '-f', appDef.installComposeAbsPath, 'up'];

                    console.log(`[Info] Starting Installation (Mode: Down then Up): ${appDef.installComposePath}`);

                    res.writeHead(200, {
                        ...headers,
                        'Content-Type': 'text/plain',
                        'Transfer-Encoding': 'chunked'
                    });

                    // Keep track of active child for cleanup
                    let activeChild = null;

                    // Phase 1: Down
                    res.write('[INFO] 正在执行清理 (Clean up)...\n');
                    activeChild = spawn(dockerComposeCmd, argsDown, { cwd: APP_ROOT });

                    activeChild.stdout.on('data', d => res.write(d));
                    activeChild.stderr.on('data', d => res.write(d));

                    activeChild.on('close', (codeDown) => {
                        if (codeDown !== 0) {
                            res.write(`[WARN] 清理命令退出代码: ${codeDown} (通常表示无运行容器，可忽略)\n`);
                        } else {
                            res.write('[INFO] 清理完成。\n');
                        }

                        res.write('[INFO] 正在启动安装 (Start Install)...\n');

                        // Phase 2: Up
                        let hasInstallError = false;

                        activeChild = spawn(dockerComposeCmd, argsUp, { cwd: APP_ROOT });

                        activeChild.stdout.on('data', d => {
                            const str = d.toString();
                            if (str.includes(' ERROR') || str.includes('ERROR ')) {
                                hasInstallError = true;
                            }
                            res.write(d);
                        });
                        activeChild.stderr.on('data', d => {
                            const str = d.toString();
                            if (str.includes(' ERROR') || str.includes('ERROR ')) {
                                hasInstallError = true;
                            }
                            res.write(d);
                        });

                        activeChild.on('close', (codeUp) => {
                            console.log(`[Info] Installation finished with code ${codeUp}`);
                            if (codeUp === 0 && !hasInstallError) {
                                res.write('\n[SUCCESS] 安装完成。\n');
                            } else {
                                const reason = hasInstallError ? '检测到错误日志' : `退出代码：${codeUp}`;
                                res.write(`\n[ERROR] 安装初始化流程失败 (${reason})。\n`);
                            }
                            res.end();
                            activeChild = null;
                        });
                    });

                    req.on('close', () => {
                        if (activeChild && !activeChild.killed) {
                            console.log('[Info] Request cancelled, killing active process...');
                            activeChild.kill('SIGTERM');
                            setTimeout(() => { if (activeChild && !activeChild.killed) activeChild.kill('SIGKILL'); }, 5000);
                        }
                    });
                })
                .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return;
        }

        if (pathname === '/api/env-raw' && method === 'GET') {
            try {
                const content = fs.existsSync(ENV_FILE_PATH) ? fs.readFileSync(ENV_FILE_PATH, 'utf-8') : '';
                res.writeHead(200, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(content);
            } catch (e) {
                res.writeHead(500, headers);
                res.end(JSON.stringify({ status: 'error', message: e.message }));
            }
            return;
        }

        if (pathname === '/api/save-raw' && method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    fs.writeFileSync(ENV_FILE_PATH, body, 'utf-8');
                    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok' }));
                } catch (e) {
                    res.writeHead(500, headers);
                    res.end(JSON.stringify({ status: 'error', message: e.message }));
                }
            });
            return;
        }

        // SSE for Container Logs - Using callback mode like restart API
        const serviceLogsMatch = pathname.match(/^\/api\/services\/([^/]+)\/logs$/);
        if ((pathname === '/api/logs' || serviceLogsMatch) && method === 'GET') {
            if (!dockerComposeCmd) {
                res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'error',
                    message: 'Docker Compose not available'
                }));
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });

            // Use spawn for real-time logs (streaming)
            const serviceId = serviceLogsMatch
                ? serviceLogsMatch[1]
                : (requestUrl.searchParams.get('service') || getPackageServiceId());
            const def = getServiceDefinition(serviceId);
            if (!def || !def.exists) {
                res.write(`data: ${JSON.stringify({ type: 'error', message: `[错误] 服务不存在或 compose 文件缺失: ${serviceId}` })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'close', code: -1 })}\n\n`);
                res.end();
                return;
            }

            const args = composeArgsFor(def, ['logs', '-f', '--tail=50', def.composeService]);
            console.log(`[Info] Starting real-time logs: ${dockerComposeCmd} ${args.join(' ')}`);

            const child = spawn(dockerComposeCmd, args, {
                cwd: APP_ROOT,
                detached: process.platform !== 'win32',
                stdio: ['ignore', 'pipe', 'pipe'] // Ignore stdin, pipe stdout/stderr
            });

            const MAX_PENDING_LOG_EVENTS = 1000;
            const MAX_EVENTS_PER_FLUSH = 120;
            const MAX_SSE_LINE_LENGTH = 4000;
            const FLUSH_INTERVAL_MS = 200;

            let closed = false;
            let cleanupStarted = false;
            let waitingForDrain = false;
            let droppedLogEvents = 0;
            let stdoutRemainder = '';
            let stderrRemainder = '';
            const pendingEvents = [];

            function isResponseOpen() {
                return !closed && !res.destroyed && !res.writableEnded;
            }

            function pauseUntilDrain() {
                if (waitingForDrain || !isResponseOpen()) return;
                waitingForDrain = true;
                child.stdout.pause();
                child.stderr.pause();
                res.once('drain', () => {
                    waitingForDrain = false;
                    if (!isResponseOpen()) return;
                    child.stdout.resume();
                    child.stderr.resume();
                    flushPendingEvents();
                });
            }

            function writeSse(payload) {
                if (!isResponseOpen()) return false;
                const ok = res.write(`data: ${JSON.stringify(payload)}\n\n`);
                if (!ok) pauseUntilDrain();
                return ok;
            }

            function enqueueLogLine(line) {
                if (!line) return;
                let message = line;
                if (message.length > MAX_SSE_LINE_LENGTH) {
                    message = `${message.slice(0, MAX_SSE_LINE_LENGTH)} ... [server truncated, original length: ${line.length}]`;
                }
                if (pendingEvents.length >= MAX_PENDING_LOG_EVENTS) {
                    const dropCount = pendingEvents.length - MAX_PENDING_LOG_EVENTS + 1;
                    pendingEvents.splice(0, dropCount);
                    droppedLogEvents += dropCount;
                }
                pendingEvents.push({ type: 'log', message });
            }

            function processLogChunk(chunk, streamName) {
                const existing = streamName === 'stdout' ? stdoutRemainder : stderrRemainder;
                const text = existing + chunk.toString('utf8');
                const lines = text.split(/\r?\n/);
                const remainder = lines.pop() || '';
                if (streamName === 'stdout') stdoutRemainder = remainder;
                else stderrRemainder = remainder;
                lines.forEach(enqueueLogLine);
            }

            function flushRemainders() {
                if (stdoutRemainder) {
                    enqueueLogLine(stdoutRemainder);
                    stdoutRemainder = '';
                }
                if (stderrRemainder) {
                    enqueueLogLine(stderrRemainder);
                    stderrRemainder = '';
                }
            }

            function flushPendingEvents() {
                if (!isResponseOpen()) return;
                if (droppedLogEvents > 0) {
                    const dropped = droppedLogEvents;
                    droppedLogEvents = 0;
                    if (!writeSse({ type: 'warn', message: `[日志过多] 已丢弃 ${dropped} 条旧日志，继续显示最新内容。` })) return;
                }

                let sent = 0;
                while (pendingEvents.length > 0 && sent < MAX_EVENTS_PER_FLUSH) {
                    const event = pendingEvents.shift();
                    if (!writeSse(event)) {
                        pendingEvents.unshift(event);
                        return;
                    }
                    sent += 1;
                }
            }

            const flushTimer = setInterval(flushPendingEvents, FLUSH_INTERVAL_MS);

            function killLogsProcess() {
                if (child.killed || child.exitCode !== null) return;
                try {
                    if (process.platform !== 'win32') {
                        process.kill(-child.pid, 'SIGTERM');
                    } else {
                        child.kill('SIGTERM');
                    }
                } catch (e) {
                    try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
                }
                setTimeout(() => {
                    if (child.killed || child.exitCode !== null) return;
                    try {
                        if (process.platform !== 'win32') {
                            process.kill(-child.pid, 'SIGKILL');
                        } else {
                            child.kill('SIGKILL');
                        }
                    } catch (_) {
                        // The process may already be gone.
                    }
                }, 5000).unref?.();
            }

            function cleanupLogStream(reason, shouldKillChild = false) {
                if (cleanupStarted) return;
                cleanupStarted = true;
                closed = true;
                clearInterval(heartbeat);
                clearInterval(flushTimer);
                child.stdout.removeAllListeners('data');
                child.stderr.removeAllListeners('data');
                pendingEvents.length = 0;
                if (shouldKillChild) {
                    console.log(`[Info] Closing logs stream (${reason}), killing logs process...`);
                    killLogsProcess();
                }
            }

            // Stream stdout/stderr into a bounded queue. The interval above handles SSE writes.
            child.stdout.on('data', (chunk) => processLogChunk(chunk, 'stdout'));
            child.stderr.on('data', (chunk) => processLogChunk(chunk, 'stderr'));

            // Handle process exit
            child.on('close', (code) => {
                console.log(`[Info] Logs process exited with code ${code}`);
                cleanupStarted = true;
                clearInterval(heartbeat);
                clearInterval(flushTimer);
                flushRemainders();
                flushPendingEvents();
                if (isResponseOpen()) {
                    writeSse({ type: 'close', code });
                    closed = true;
                    res.end();
                }
            });

            child.on('error', (err) => {
                console.error('[Error] Failed to spawn logs process:', err.message);
                cleanupStarted = true;
                clearInterval(heartbeat);
                clearInterval(flushTimer);
                if (isResponseOpen()) {
                    writeSse({ type: 'error', message: `[错误] ${err.message}` });
                    writeSse({ type: 'close', code: -1 });
                    closed = true;
                    res.end();
                }
            });

            // Heartbeat to keep connection alive
            const heartbeat = setInterval(() => {
                if (isResponseOpen()) {
                    const ok = res.write(': heartbeat\n\n');
                    if (!ok) pauseUntilDrain();
                } else {
                    clearInterval(heartbeat);
                }
            }, 15000);

            // Clean up on client disconnect
            req.on('close', () => {
                cleanupLogStream('request closed', true);
            });

            res.on('close', () => {
                cleanupLogStream('response closed', true);
            });

            return;
        }

        if (pathname === '/api/status' && method === 'GET') {
            const def = getServiceDefinition(getPackageServiceId());
            getServiceStatus(def)
                .then(status => {
                    const payload = {
                        status: status.status,
                        service: status.id,
                        dockerComposeMissing: !status.exists,
                        missingFiles: status.exists ? [] : [status.composePath],
                        message: status.message
                    };
                    writeJson(res, 200, payload, headers);
                })
                .catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return;
        }

        // API: Diff Runtime vs Local Config
        if (pathname === '/api/diff-runtime' && method === 'GET') {
            if (!dockerComposeCmd) {
                res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Docker not available' }));
                return;
            }

            try {
                const def = getServiceDefinition(getPackageServiceId());
                if (!def || !def.exists) {
                    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'not_running', service: getPackageServiceId() }));
                    return;
                }

                // 2. Resolve Container ID via Service Name
                // Command: docker compose ps -q <serviceName>
                const argsPs = composeArgsFor(def, ['ps', '-q', def.composeService]);

                execFile(dockerComposeCmd, argsPs, { cwd: APP_ROOT }, (errPs, stdoutPs) => {
                    if (errPs) {
                        res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'error', message: 'Failed to resolve container ID', details: errPs.message }));
                        return;
                    }

                    const containerId = stdoutPs.trim();

                    if (!containerId) {
                        res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'not_running', service: def.id }));
                        return;
                    }

                    // 3. Fetch Runtime Env via docker inspect
                    // Note: We use 'docker' command directly.
                    execFile(dockerPath, ['inspect', containerId], (errInspect, stdoutInspect) => {
                        if (errInspect) {
                            res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ status: 'error', message: 'Failed to inspect container', details: errInspect.message }));
                            return;
                        }

                        let runtimeEnvMap = {};
                        try {
                            const inspectData = JSON.parse(stdoutInspect);
                            if (inspectData && inspectData[0] && inspectData[0].Config && inspectData[0].Config.Env) {
                                inspectData[0].Config.Env.forEach(envStr => {
                                    const parts = envStr.split('=');
                                    const key = parts[0];
                                    const val = parts.slice(1).join('=');
                                    runtimeEnvMap[key] = val;
                                });
                            }
                        } catch (e) {
                            console.error('[Error] Failed to parse inspect output:', e);
                        }

                        // 4. Fetch Local Config
                        const localEnvMap = {};

                        // 4.1 Load .env for values
                        const dotEnvConfig = parseEnvFile();

                        // 4.2 Merge into localEnvMap
                        // In this tool, the .env file IS the source of truth for variables we care about.
                        // Variables in docker-compose.yml are either hardcoded or mapped to .env.
                        // For the purpose of "Did I change my config?", comparing against .env is the most direct way.
                        Object.assign(localEnvMap, dotEnvConfig);

                        // 5. Compare
                        // Compare - Only Key in Local config matters
                        const diffs = [];
                        // We only care about keys defined in Local Config (.env / compose)
                        // If Runtime has extra keys (e.g. system default envs), we ignore them.
                        const interestingKeys = Object.keys(localEnvMap);
                        const ignoredPrefixes = ['PATH', 'JAVA_', 'LANG', 'LC_', 'HOME', 'LOG_DIR', 'LIB_DIR', 'CONFIG_PATH', 'APP_NAME', 'CONFIG_NAME', 'LOGGING_CONFIG', 'HOSTNAME', 'PWD', 'GPG_KEY'];

                        interestingKeys.forEach(key => {
                            if (ignoredPrefixes.some(prefix => key.startsWith(prefix))) return;

                            let runtimeVal = runtimeEnvMap[key];
                            let localVal = localEnvMap[key];

                            // Logic:
                            // 1. Local has it, Runtime doesn't -> DELETED (Action: Restart needed to apply)
                            // 2. Local has it, Runtime has different -> MODIFIED (Action: Restart needed)
                            // 3. Local has it, Runtime has same -> Synced (Ignored)

                            if (runtimeVal !== localVal) {
                                let state = 'MODIFIED';
                                if (runtimeVal === undefined) state = 'DELETED';
                                // Note: 'NEW' case (Runtime has it, Local doesn't) is effectively ignored by iterating interestingKeys only.

                                // Special handling for empty strings if needed, but strict equality is usually fine for envs
                                diffs.push({
                                    key,
                                    runtimeVal: runtimeVal === undefined ? '(missing)' : runtimeVal,
                                    localVal: localVal === undefined ? '(missing)' : localVal,
                                    state
                                });
                            }
                        });

                        // Sort: MODIFIED first
                        diffs.sort((a, b) => {
                            const score = (s) => s === 'MODIFIED' ? 0 : (s === 'NEW' ? 1 : 2);
                            return score(a.state) - score(b.state);
                        });

                        res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            status: 'success',
                            service: def.id,
                            containerId: containerId,
                            diffs: diffs
                        }));
                    });
                });

            } catch (e) {
                res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Internal Server Error', details: e.message }));
            }
            return;
        }

        res.writeHead(404, headers);
        res.end('Not Found');
    });

    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.error(`[Error] Port ${PORT} is already in use.`);
            console.error(`Please stop the existing service running on port ${PORT} or use a different port.`);
            process.exit(1);
        } else {
            console.error(`[Error] Server error:`, e);
            process.exit(1);
        }
    });

    server.listen(PORT, () => {
        // Write PID only after successful start
        try {
            fs.writeFileSync(PID_FILE, process.pid.toString());
            const cleanup = () => { if (fs.existsSync(PID_FILE)) try { fs.unlinkSync(PID_FILE); } catch (e) { } };
            process.on('exit', cleanup);
            process.on('SIGINT', () => { cleanup(); process.exit(); });
            process.on('SIGTERM', () => { cleanup(); process.exit(); });
        } catch (e) {
            console.warn('[Warn] Failed to write PID:', e);
        }

        console.log(`[Info] Service running at http://localhost:${PORT}`);
        console.log(`[Info] APP_ROOT=${APP_ROOT}`);
        console.log(`[Info] APP_TYPE=${APP_TYPE}, APP_DIR=${APP_DIR}`);
        if (process.argv.includes('--dev') || process.env.NO_BROWSER === '1') {
            console.log('[Dev] Hot-reload mode: Browser auto-open skipped.');
        } else {
            openBrowser();
        }
    });
}

function openBrowser() {
    const url = `http://localhost:${PORT}`;
    const platform = os.platform();
    let cmd = '';

    if (platform === 'darwin') {
        cmd = `open -n -a "Google Chrome" --args --app=${url}`;
    } else if (platform === 'win32') {
        cmd = `start chrome --app=${url}`;
    } else {
        cmd = `google-chrome --app=${url}`;
    }

    exec(cmd, (err) => {
        if (err) {
            console.log('[Warn] Failed to open app mode, trying default browser...');
            const openCmd = platform === 'darwin' ? 'open' : (platform === 'win32' ? 'start' : 'xdg-open');
            exec(`${openCmd} ${url}`);
        }
    });
}

// Entry Point
tryInitFromYaml();
detectDockerPath();
startServer();
