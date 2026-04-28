const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, spawn, execFile } = require('child_process');
const os = require('os');
const { resolveAppContext, resolveAppRoot } = require('./src/server/app-context');
const { createEnvStore } = require('./src/server/config/env-store');
const { createDockerComposeRuntime } = require('./src/server/docker/compose');
const { readRequestBody, writeJson } = require('./src/server/http');
const { createCleanupService } = require('./src/server/services/cleanup');
const { createServiceComposeConfigBuilder } = require('./src/server/services/compose-config');
const { createDeploymentPlanner } = require('./src/server/services/deployment-plan');
const { createLogStreamService } = require('./src/server/services/log-stream');
const { createServiceRegistry } = require('./src/server/services/registry');
const { createServiceRuntime } = require('./src/server/services/runtime');
const CONFIG_META = require('./config-meta');

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
const dockerRuntime = createDockerComposeRuntime({ appRoot: APP_ROOT });
const serviceRuntime = createServiceRuntime({ docker: dockerRuntime, getServiceDefinition });
const { getServiceStatus, runComposeAction } = serviceRuntime;
const envStore = createEnvStore({
    envFilePath: ENV_FILE_PATH,
    historyDir: HISTORY_DIR,
    configMeta: CONFIG_META,
    logger: console
});
const { parseEnvFile, saveEnvFile } = envStore;
const deploymentPlanner = createDeploymentPlanner({
    appType: APP_TYPE,
    getPackageServiceId,
    getServiceDefinition,
    getServiceStatus,
    runComposeAction,
    configProvider: parseEnvFile
});
const {
    applyAppConfigChange,
    buildDeploymentPlan,
    buildDeploymentPlanWithStatus,
    checkRequiredDependencies,
    dependencyBlockResult,
    guardAppServiceDependencies
} = deploymentPlanner;
const cleanupService = createCleanupService({
    appRoot: APP_ROOT,
    runtimeDir: RUNTIME_DIR,
    backupRoot: CLEANUP_BACKUP_ROOT,
    auditLogFile: AUDIT_LOG_FILE,
    cleanupServiceDataDirs: serviceRegistry.cleanupServiceDataDirs,
    getServiceDefinition,
    getPackageServiceId,
    getServiceStatus,
    docker: dockerRuntime
});
const { buildCleanupPlan, runCleanupService } = cleanupService;
const logStreamService = createLogStreamService({
    appRoot: APP_ROOT,
    docker: dockerRuntime,
    getServiceDefinition,
    defaultServiceId: getPackageServiceId
});
let serviceComposeConfigBuilder = null;

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



// const { getHtml } = require('./ui-template'); // Removed

// Try to lazy load js-yaml to avoid hard crash if missing (though we installed it)
let yaml;
try {
    yaml = require('js-yaml');
} catch (e) {
    console.warn('[Warn] js-yaml not found. Auto-init from YAML disabled.');
}
serviceComposeConfigBuilder = createServiceComposeConfigBuilder({
    yaml,
    getServiceDefinition,
    getPackageServiceId,
    envProvider: parseEnvFile
});
const { buildServiceComposeConfig } = serviceComposeConfigBuilder;

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

// --- Auth & Deployment Helpers ---
const CONFIG_MATE_PASSWORD = process.env.CONFIG_MATE_PASSWORD || '';
const AUTH_REQUIRED = CONFIG_MATE_PASSWORD.trim().length > 0;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();
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

// --- HTTP Server ---

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
                    available: !dockerRuntime.readyMessage(),
                    message: dockerRuntime.readyMessage()
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
            writeJson(res, 200, { status: 'success', data: envStore.listHistory() }, headers);
            return;
        }

        // API: Restore History
        if (pathname === '/api/history/restore' && method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const { filename } = JSON.parse(body);
                    const result = envStore.restoreHistory(filename);
                    if (!result.ok) {
                        writeJson(res, result.statusCode || 500, { status: 'error', message: result.message }, headers);
                        return;
                    }
                    writeJson(res, 200, { status: 'success', message: result.message }, headers);
                } catch (e) {
                    writeJson(res, 500, { status: 'error', message: e.message }, headers);
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
                    const result = envStore.readHistoryContent(filename);
                    if (!result.ok) {
                        writeJson(res, result.statusCode || 500, { status: 'error', message: result.message }, headers);
                        return;
                    }
                    writeJson(res, 200, { status: 'success', content: result.content }, headers);
                } catch (e) {
                    writeJson(res, 500, { status: 'error', message: e.message }, headers);
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
                    cli: dockerRuntime.dockerPath,
                    compose: dockerRuntime.dockerComposeCmd,
                    socketMounted: fs.existsSync('/var/run/docker.sock') || os.platform() === 'win32',
                    available: !dockerRuntime.readyMessage(),
                    message: dockerRuntime.readyMessage()
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
            if (!dockerRuntime.dockerComposeCmd) {
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

                    const argsDown = [...dockerRuntime.dockerComposeCmdArgs, '-f', appDef.installComposeAbsPath, 'down'];
                    const argsUp = [...dockerRuntime.dockerComposeCmdArgs, '-f', appDef.installComposeAbsPath, 'up'];

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
                    activeChild = spawn(dockerRuntime.dockerComposeCmd, argsDown, { cwd: APP_ROOT });

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

                        activeChild = spawn(dockerRuntime.dockerComposeCmd, argsUp, { cwd: APP_ROOT });

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
                const content = envStore.readRaw();
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
                    envStore.saveRaw(body);
                    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok' }));
                } catch (e) {
                    res.writeHead(500, headers);
                    res.end(JSON.stringify({ status: 'error', message: e.message }));
                }
            });
            return;
        }

        const serviceLogsMatch = pathname.match(/^\/api\/services\/([^/]+)\/logs$/);
        if ((pathname === '/api/logs' || serviceLogsMatch) && method === 'GET') {
            const serviceId = serviceLogsMatch
                ? serviceLogsMatch[1]
                : (requestUrl.searchParams.get('service') || getPackageServiceId());
            logStreamService.streamLogs({ req, res, serviceId, headers });
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
            if (!dockerRuntime.dockerComposeCmd) {
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
                const argsPs = dockerRuntime.composeArgsFor(def, ['ps', '-q', def.composeService]);

                execFile(dockerRuntime.dockerComposeCmd, argsPs, { cwd: APP_ROOT }, (errPs, stdoutPs) => {
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
                    execFile(dockerRuntime.dockerPath, ['inspect', containerId], (errInspect, stdoutInspect) => {
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
dockerRuntime.detect();
startServer();
