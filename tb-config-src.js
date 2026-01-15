const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn, execFile } = require('child_process');
const os = require('os');

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : null;

// --- Config ---
const portArg = args.find(arg => arg.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.split('=')[1]) : (process.env.PORT || 3300);
const PID_FILE = path.join(process.cwd(), 'tb-config-mate.pid');
const LOG_FILE = path.join(process.cwd(), 'tb-config-mate.log');
const HISTORY_DIR = path.join(process.cwd(), '.env_history');

// --- Helper: Check Status ---
function getRunningPid() {
    if (!fs.existsSync(PID_FILE)) return null;
    try {
        const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
        process.kill(pid, 0); // Check if process exists
        return pid;
    } catch (e) {
        return null;
    }
}

// --- CLI Commands ---
if (args.includes('-h') || args.includes('--help')) {
    console.log(`
ThingsBoard Config Mate (TB-CM) - 命令行使用指南

用法:
  tb-config-mate [命令] [选项]

命令:
  start     在后台启动配置服务 (默认端口 3300)
  stop      停止正在运行的后台服务
  restart   停止并重新启动后台服务
  status    查看后台服务的运行状态

选项:
  --port=N  指定服务运行的端口 (默认: 3300)
  -h, --help 显示此帮助信息

示例:
  使用指定端口启动:
    ./tb-config-mate start --port=4000
  
  查看当前状态:
    ./tb-config-mate status
    `);
    process.exit(0);
}

if (command === 'status') {
    const pid = getRunningPid();
    if (pid) {
        console.log(`[Status] Service is RUNNING (PID: ${pid})`);
    } else {
        console.log('[Status] Service is STOPPED');
    }
    process.exit(0);
}

if (command === 'stop') {
    const pid = getRunningPid();
    if (pid) {
        try {
            process.kill(pid);
            console.log(`[Success] Stopped service (PID: ${pid})`);
            if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
        } catch (e) {
            console.error(`[Error] Failed to stop: ${e.message}`);
        }
    } else {
        console.log('[Info] Service is not running.');
    }
    process.exit(0);
}

if (command === 'restart') {
    const pid = getRunningPid();
    if (pid) {
        try {
            process.kill(pid);
            console.log(`[Success] Stopped service (PID: ${pid})`);
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

    let spawnCmd = process.execPath;
    // Always pass the entry script path (__filename) to the child process.
    // In 'pkg', __filename resolves to the internal snapshot path (e.g. /snapshot/.../tb-config-src.js).
    // This allows the child process (which is the same binary) to know what script to execute,
    // avoiding both "missing argv[1]" errors and "invalid module" errors.
    let spawnArgs = [__filename, ...childArgs];

    const child = spawn(spawnCmd, spawnArgs, {
        detached: true,
        stdio: ['ignore', logFd, logFd],
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
    const ENV_FILE_PATH = path.join(process.cwd(), '.env');

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
            path.join(process.cwd(), 'conf', 'tb-edge.yml'),
            path.join(process.cwd(), 'tb-edge.yml')
        ];
        targetFile = candidates.find(f => fs.existsSync(f));
    } else {
        const candidates = [
            path.join(process.cwd(), 'conf', 'thingsboard.yml'),
            path.join(process.cwd(), 'thingsboard.yml')
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

try {
    fs.writeFileSync(PID_FILE, process.pid.toString());

    const cleanup = () => { if (fs.existsSync(PID_FILE)) try { fs.unlinkSync(PID_FILE); } catch (e) { } };
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(); });
    process.on('SIGTERM', () => { cleanup(); process.exit(); });
} catch (e) {
    console.warn('[Warn] Failed to write PID:', e);
}

const ENV_FILE_PATH = path.join(process.cwd(), '.env');

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
        path.join(process.cwd(), 'conf', 'thingsboard.yml'),
        path.join(process.cwd(), 'conf', 'tb-edge.yml'),
        path.join(process.cwd(), 'thingsboard.yml'),
        path.join(process.cwd(), 'tb-edge.yml'),
        path.join(__dirname, 'conf', 'thingsboard.yml'),
        path.join(__dirname, 'conf', 'tb-edge.yml')
    ];

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
                console.log(`[Info] ⚠️  The following ${missedExtraction.length} keys were expected but NOT found in YAML or .env:`);
                missedExtraction.forEach(k => console.log(`   - ${k}`));
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

// --- HTTP Server ---

// Detect Docker binary path (without shell)
let dockerPath = null;
let dockerComposeCmd = null;
let dockerComposeCmdArgs = [];

const commonDockerPaths = [
    '/usr/bin/docker',
    '/usr/local/bin/docker',
    '/snap/bin/docker',
    '/opt/docker/bin/docker',
    'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' // Windows
];

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
    execFile(dockerPath, ['compose', 'version'], (error) => {
        if (!error) {
            console.log('[Info] Using: docker compose (new format)');
            dockerComposeCmd = dockerPath;
            dockerComposeCmdArgs = ['compose'];
        } else {
            // Fallback: try to find docker-compose
            const dockerComposePaths = [
                '/usr/bin/docker-compose',
                '/usr/local/bin/docker-compose'
            ];

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
    });
}

function startServer() {
    const server = http.createServer((req, res) => {
        const { method, url } = req;
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        };

        if (method === 'OPTIONS') {
            res.writeHead(204, headers);
            res.end();
            return;
        }

        if (url === '/' || url === '/index.html') {
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

        if (url === '/api/config' && method === 'GET') {
            const current = parseEnvFile();
            const responseData = {
                meta: CONFIG_META,
                values: current
            };
            res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
            res.end(JSON.stringify(responseData));
            return;
        }

        if (url === '/api/save' && method === 'POST') {
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
        if (url === '/api/history' && method === 'GET') {
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
        if (url === '/api/history/restore' && method === 'POST') {
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
        if (url === '/api/history/content' && method === 'POST') {
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

        if (url === '/api/restart' && method === 'POST') {
            if (!dockerComposeCmd) {
                res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'error',
                    message: 'Docker Compose not available. Please install Docker or Docker Compose.'
                }));
                return;
            }

            // User requested: docker compose down && docker compose up -d
            // We ignore serviceName here and restart the whole stack for a clean state.

            // 1. Down
            const argsDown = [...dockerComposeCmdArgs, 'down'];
            console.log(`[Info] Clean Restart - Step 1/2: ${dockerComposeCmd} ${argsDown.join(' ')}`);

            execFile(dockerComposeCmd, argsDown, { cwd: process.cwd() }, (errDown, stdoutDown, stderrDown) => {
                if (errDown) {
                    console.error('[Error] Failed to down:', stderrDown);
                    res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: 'Failed to stop services (down)', output: stderrDown }));
                    return;
                }

                // 2. Up -d
                const argsUp = [...dockerComposeCmdArgs, 'up', '-d'];
                console.log(`[Info] Clean Restart - Step 2/2: ${dockerComposeCmd} ${argsUp.join(' ')}`);

                execFile(dockerComposeCmd, argsUp, { cwd: process.cwd() }, (errUp, stdoutUp, stderrUp) => {
                    const result = {
                        status: errUp ? 'error' : 'success',
                        output: (stdoutDown + stderrDown) + "\n" + (stdoutUp + stderrUp)
                    };
                    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                });
            });
            return;
        }

        if (url === '/api/stop' && method === 'POST') {
            if (!dockerComposeCmd) {
                res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Docker not available' }));
                return;
            }

            // User requested: docker compose down (Full stack removal)
            const args = [...dockerComposeCmdArgs, 'down'];

            console.log(`[Info] Stopping service (Down): ${dockerComposeCmd} ${args.join(' ')}`);
            execFile(dockerComposeCmd, args, { cwd: process.cwd() }, (error, stdout, stderr) => {
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: error ? 'error' : 'success', output: stdout + stderr }));
            });
            return;
        }

        if (url === '/api/service-restart' && method === 'POST') {
            if (!dockerComposeCmd) {
                res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Docker not available' }));
                return;
            }

            // User requested: docker compose down && docker compose up -d
            // Clean Restart (Only Restart, No Save)

            // 1. Down
            const argsDown = [...dockerComposeCmdArgs, 'down'];
            console.log(`[Info] Service Restart - Step 1/2: ${dockerComposeCmd} ${argsDown.join(' ')}`);

            execFile(dockerComposeCmd, argsDown, { cwd: process.cwd() }, (errDown, stdoutDown, stderrDown) => {
                if (errDown) {
                    console.error('[Error] Failed to down:', stderrDown);
                    res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: 'Failed to stop services (down)', output: stderrDown }));
                    return;
                }

                // 2. Up -d
                const argsUp = [...dockerComposeCmdArgs, 'up', '-d'];
                console.log(`[Info] Service Restart - Step 2/2: ${dockerComposeCmd} ${argsUp.join(' ')}`);

                execFile(dockerComposeCmd, argsUp, { cwd: process.cwd() }, (errUp, stdoutUp, stderrUp) => {
                    const result = {
                        status: errUp ? 'error' : 'success',
                        output: (stdoutDown + stderrDown) + "\n" + (stdoutUp + stderrUp)
                    };
                    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                });
            });
            return;
        }



        // API: Check Installation Config
        if (url === '/api/check-install' && method === 'GET') {
            const installFile = path.resolve(process.cwd(), 'docker-compose-install.yml');
            const exists = fs.existsSync(installFile);
            res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'success', exists }));
            return;
        }

        // API: Validate Compose Files (Check for env_file)
        if (url.startsWith('/api/validate-compose') && method === 'GET') {
            const requiredFiles = ['docker-compose.yml', 'docker-compose-install.yml'];

            const missingFiles = [];
            const invalidFiles = [];

            // 0. Pre-check: ThingsBoard Config Files (conf/thingsboard.yml or conf/tb-edge.yml)
            const confDir = path.join(process.cwd(), 'conf');
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
                const filePath = path.resolve(process.cwd(), file);
                if (!fs.existsSync(filePath)) {
                    missingFiles.push(file);
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
                const filePath = path.resolve(process.cwd(), file);
                // We know it exists from step 1
                if (!checkFileContent(filePath, 'env_file')) {
                    invalidFiles.push({ file: file, msg: '未配置 env_file (Missing env_file property)' });
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
        if (url === '/api/install' && method === 'POST') {
            if (!dockerComposeCmd) {
                res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Docker not available' }));
                return;
            }

            const installFile = 'docker-compose-install.yml';
            const argsDown = [...dockerComposeCmdArgs, '-f', installFile, 'down'];
            const argsUp = [...dockerComposeCmdArgs, '-f', installFile, 'up'];

            console.log(`[Info] Starting Installation (Mode: Down then Up): ${installFile}`);

            res.writeHead(200, {
                ...headers,
                'Content-Type': 'text/plain',
                'Transfer-Encoding': 'chunked'
            });

            // Keep track of active child for cleanup
            let activeChild = null;

            // Phase 1: Down
            res.write('[INFO] 正在执行清理 (Clean up)...\n');
            activeChild = spawn(dockerComposeCmd, argsDown, { cwd: process.cwd() });

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
                activeChild = spawn(dockerComposeCmd, argsUp, { cwd: process.cwd() });

                activeChild.stdout.on('data', d => res.write(d));
                activeChild.stderr.on('data', d => res.write(d));

                activeChild.on('close', (codeUp) => {
                    console.log(`[Info] Installation finished with code ${codeUp}`);
                    if (codeUp === 0) {
                        res.write('\n[SUCCESS] 安装初始化流程执行成功。\n');
                    } else {
                        res.write(`\n[ERROR] 安装初始化流程失败，退出代码：${codeUp}。\n`);
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
            return;
        }

        if (url === '/api/env-raw' && method === 'GET') {
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

        if (url === '/api/save-raw' && method === 'POST') {
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
        if (url === '/api/logs' && method === 'GET') {
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
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });

            // Use spawn for real-time logs (streaming)
            const config = parseEnvFile();
            const serviceName = (config['APPTYPE'] === 'EDGE' || (config['APP_IMAGE'] && config['APP_IMAGE'].includes('edge'))) ? 'iotedge' : 'iotcloud';
            console.log(`[Debug] Logs Service Detection: APPTYPE=${config['APPTYPE']}, APP_IMAGE=${config['APP_IMAGE']} -> Service=${serviceName}`);

            const args = [...dockerComposeCmdArgs, 'logs', '-f', '--tail=50', serviceName];
            console.log(`[Info] Starting real-time logs: ${dockerComposeCmd} ${args.join(' ')}`);

            const child = spawn(dockerComposeCmd, args, {
                cwd: process.cwd(),
                stdio: ['ignore', 'pipe', 'pipe'] // Ignore stdin, pipe stdout/stderr
            });

            // Stream stdout
            child.stdout.on('data', (chunk) => {
                const lines = chunk.toString().trim().split('\n');
                lines.forEach(line => {
                    if (line) res.write(`data: ${JSON.stringify({ type: 'log', message: line })}\n\n`);
                });
            });

            // Stream stderr
            child.stderr.on('data', (chunk) => {
                const lines = chunk.toString().trim().split('\n');
                lines.forEach(line => {
                    if (line) res.write(`data: ${JSON.stringify({ type: 'log', message: line })}\n\n`);
                });
            });

            // Handle process exit
            child.on('close', (code) => {
                console.log(`[Info] Logs process exited with code ${code}`);
                res.write(`data: ${JSON.stringify({ type: 'close', code })}\n\n`);
                res.end();
            });

            child.on('error', (err) => {
                console.error('[Error] Failed to spawn logs process:', err.message);
                res.write(`data: ${JSON.stringify({ type: 'error', message: `[错误] ${err.message}` })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'close', code: -1 })}\n\n`);
                res.end();
            });

            // Heartbeat to keep connection alive
            const heartbeat = setInterval(() => {
                res.write(': heartbeat\n\n');
            }, 15000);

            // Clean up on client disconnect
            req.on('close', () => {
                console.log('[Info] Client disconnected, killing logs process...');
                clearInterval(heartbeat);
                child.kill();
            });

            return;
        }

        if (url === '/api/status' && method === 'GET') {
            if (!dockerComposeCmd) {
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'unknown', message: 'No Docker' }));
                return;
            }

            const config = parseEnvFile();
            // Default to iotcloud unless explicitly EDGE
            const serviceName = (config['APPTYPE'] === 'EDGE' || (config['APP_IMAGE'] && config['APP_IMAGE'].includes('edge'))) ? 'iotedge' : 'iotcloud';

            const hasDockerComposeYml = fs.existsSync(path.join(process.cwd(), 'docker-compose.yml'));
            const hasDockerComposeInstallYml = fs.existsSync(path.join(process.cwd(), 'docker-compose-install.yml'));

            const missingFiles = [];
            if (!hasDockerComposeYml) missingFiles.push('docker-compose.yml');
            if (!hasDockerComposeInstallYml) missingFiles.push('docker-compose-install.yml');

            const args = [...dockerComposeCmdArgs, 'ps', '-q', '--status', 'running', serviceName];

            // If any required file is missing, we still return 'stopped' + missingFiles
            if (missingFiles.length > 0) {
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'stopped',
                    service: serviceName,
                    missingFiles: missingFiles
                }));
                return;
            }

            execFile(dockerComposeCmd, args, { cwd: process.cwd() }, (error, stdout, stderr) => {
                if (error) {
                    // Start or other error
                    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'stopped', service: serviceName, dockerComposeMissing: false }));
                } else {
                    const isRunning = stdout && stdout.trim().length > 0;
                    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        status: isRunning ? 'running' : 'stopped',
                        service: serviceName,
                        dockerComposeMissing: false
                    }));
                }
            });
            return;
        }

        // API: Diff Runtime vs Local Config
        if (url === '/api/diff-runtime' && method === 'GET') {
            if (!dockerComposeCmd) {
                res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Docker not available' }));
                return;
            }

            try {
                // 1. Identify Service Name (Reuse existing logic)
                const config = parseEnvFile();
                // Default logic: EDGE app type -> iotedge, otherwise iotcloud
                const serviceName = (config['APPTYPE'] === 'EDGE' || (config['APP_IMAGE'] && config['APP_IMAGE'].includes('edge'))) ? 'iotedge' : 'iotcloud';

                // 2. Resolve Container ID via Service Name
                // Command: docker compose ps -q <serviceName>
                const argsPs = [...dockerComposeCmdArgs, 'ps', '-q', serviceName];

                execFile(dockerComposeCmd, argsPs, { cwd: process.cwd() }, (errPs, stdoutPs) => {
                    if (errPs) {
                        res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'error', message: 'Failed to resolve container ID', details: errPs.message }));
                        return;
                    }

                    const containerId = stdoutPs.trim();

                    if (!containerId) {
                        res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'not_running', service: serviceName }));
                        return;
                    }

                    // 3. Fetch Runtime Env via docker inspect
                    // Note: We use 'docker' command directly.
                    execFile('docker', ['inspect', containerId], (errInspect, stdoutInspect) => {
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
                            service: serviceName,
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

    server.listen(PORT, () => {
        console.log(`[Info] Service running at http://localhost:${PORT}`);
        if (process.argv.includes('--dev')) {
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
