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
            if (keyCount > 5) {
                console.log(`[Info] .env file exists and appears complete (${keyCount} keys). Skipping auto-init.`);
                return;
            }
            console.log(`[Info] .env file exists but has minimal config (${keyCount} keys). Merging with YAML...`);
        } catch (e) {
            console.warn('[Warn] Failed to parse existing .env, overwriting:', e);
        }
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
            if (meta.dependsOn && !checkDependsOn(meta.dependsOn, newConfig)) return;

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
            const skippedByDeps = [];

            Object.keys(CONFIG_META).forEach(k => {
                const meta = CONFIG_META[k];
                const scope = meta.scope || 'common';
                if (scope === 'cloud' && targetAppType !== 'CLOUD') return;
                if (scope === 'edge' && targetAppType !== 'EDGE') return;

                // Check dependencies
                if (meta.dependsOn && !checkDependsOn(meta.dependsOn, newConfig)) {
                    skippedByDeps.push(k);
                    return;
                }
                expectedKeys.push(k);
            });

            const missedExtraction = expectedKeys.filter(k => !newConfig[k] && !existingEnv[k]);

            if (skippedByDeps.length > 0) {
                console.log(`[Info] ℹ️  Skipped ${skippedByDeps.length} keys because their dependencies (e.g. Queue Type) are not met:`);
                // Optional: print them if verbose, or just summary. 
                // User wants to know "why 36 instead of 47", so let's print them compactly.
                console.log(`   - ${skippedByDeps.join(', ')}`);
            }

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

// 保存 .env (重组文件结构以美化)
function saveEnvFile(newConfig) {
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

        if (url === '/api/restart' && method === 'POST') {
            if (!dockerComposeCmd) {
                res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'error',
                    message: 'Docker Compose not available. Please install Docker or Docker Compose.'
                }));
                return;
            }

            const config = parseEnvFile();
            const serviceName = (config['APPTYPE'] === 'EDGE' || (config['APP_IMAGE'] && config['APP_IMAGE'].includes('edge'))) ? 'iotedge' : 'iotcloud';
            const args = [...dockerComposeCmdArgs, 'up', '-d', '--force-recreate', serviceName];
            console.log(`[Info] Executing: ${dockerComposeCmd} ${args.join(' ')}`);

            execFile(dockerComposeCmd, args, { cwd: process.cwd() }, (error, stdout, stderr) => {
                const result = {
                    status: error ? 'error' : 'success',
                    output: stdout + stderr
                };
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            });
            return;
        }

        if (url === '/api/stop' && method === 'POST') {
            if (!dockerComposeCmd) {
                res.writeHead(500, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Docker not available' }));
                return;
            }
            const config = parseEnvFile();
            const serviceName = (config['APPTYPE'] === 'EDGE' || (config['APP_IMAGE'] && config['APP_IMAGE'].includes('edge'))) ? 'iotedge' : 'iotcloud';
            const args = [...dockerComposeCmdArgs, 'stop', serviceName];

            console.log(`[Info] Stopping service: ${dockerComposeCmd} ${args.join(' ')}`);
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
            const config = parseEnvFile();
            const serviceName = (config['APPTYPE'] === 'EDGE' || (config['APP_IMAGE'] && config['APP_IMAGE'].includes('edge'))) ? 'iotedge' : 'iotcloud';
            const args = [...dockerComposeCmdArgs, 'restart', serviceName];

            console.log(`[Info] Restarting service: ${dockerComposeCmd} ${args.join(' ')}`);
            execFile(dockerComposeCmd, args, { cwd: process.cwd() }, (error, stdout, stderr) => {
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: error ? 'error' : 'success', output: stdout + stderr }));
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

            const args = [...dockerComposeCmdArgs, 'ps', '-q', '--status', 'running', serviceName];

            // If no docker-compose.yml, we still return 'stopped' + dockerComposeMissing
            if (!hasDockerComposeYml) {
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'stopped',
                    service: serviceName,
                    dockerComposeMissing: true
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
