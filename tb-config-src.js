const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');
const { resolveAppContext, resolveAppRoot } = require('./src/server/app-context');
const { createAuthService } = require('./src/server/auth/session');
const { createEnvStore } = require('./src/server/config/env-store');
const { createYamlInitializer } = require('./src/server/config/yaml-init');
const { createDockerComposeRuntime } = require('./src/server/docker/compose');
const { writeJson } = require('./src/server/http');
const { createCleanupService } = require('./src/server/services/cleanup');
const { createServiceComposeConfigBuilder } = require('./src/server/services/compose-config');
const { createDeploymentPlanner } = require('./src/server/services/deployment-plan');
const { createLogStreamService } = require('./src/server/services/log-stream');
const { createServiceRegistry } = require('./src/server/services/registry');
const { createServiceRuntime } = require('./src/server/services/runtime');
const { createAppRoutes } = require('./src/server/routes/app');
const { createConfigRoutes, validateConfigValues } = require('./src/server/routes/config');
const { createInstallRoutes } = require('./src/server/routes/install');
const { createServiceRoutes } = require('./src/server/routes/services');
const { createSystemRoutes } = require('./src/server/routes/system');
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
const CONFIG_MATE_SERVICE_DIR = path.join(APP_ROOT, 'services', 'config-mate');
const CLEANUP_BACKUP_ROOT = path.join(CONFIG_MATE_SERVICE_DIR, 'backups');
const AUDIT_LOG_FILE = path.join(CLEANUP_BACKUP_ROOT, 'audit.log');
const DEFAULT_CONFIG_MATE_PASSWORD = '123456';
const CONFIG_MATE_PASSWORD = process.env.CONFIG_MATE_PASSWORD || DEFAULT_CONFIG_MATE_PASSWORD;
const authService = createAuthService({ password: CONFIG_MATE_PASSWORD });
const AUTH_REQUIRED = authService.authRequired;
const {
    getRequestActor,
    isAuthenticated
} = authService;
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
    guardAppServiceDependencies,
    guardAppServiceRunning
} = deploymentPlanner;
const cleanupService = createCleanupService({
    appRoot: APP_ROOT,
    runtimeDir: RUNTIME_DIR,
    backupRoot: CLEANUP_BACKUP_ROOT,
    auditLogFile: AUDIT_LOG_FILE,
    cleanupServiceDataDirs: serviceRegistry.cleanupServiceDataDirs,
    cleanupServiceDataDirModes: serviceRegistry.cleanupServiceDataDirModes,
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
const systemRoutes = createSystemRoutes({
    appRoot: APP_ROOT,
    appDir: APP_DIR,
    appType: APP_TYPE,
    envFilePath: ENV_FILE_PATH,
    yamlConfigPath: YAML_CONFIG_PATH,
    authService,
    configMatePassword: CONFIG_MATE_PASSWORD,
    dockerRuntime,
    buildDeploymentDiagnostics,
    getPackageServiceId
});
let serviceRoutes = null;
let serviceComposeConfigBuilder = null;

function shortDiagnosticPath(value) {
    if (!value) return '';
    const normalized = String(value).replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length <= 3) return normalized;
    return `.../${parts.slice(-3).join('/')}`;
}

function buildDiagnosticItem(id, label, target, ok, detail, severity = 'error') {
    return {
        id,
        label,
        target,
        state: ok ? 'ok' : severity,
        detail
    };
}

function buildDeploymentDiagnostics() {
    const dockerMessage = dockerRuntime.readyMessage();
    const socketMounted = fs.existsSync('/var/run/docker.sock') || os.platform() === 'win32';
    const serviceDefs = listServiceDefinitions();
    const existingServices = serviceDefs.filter(service => service.exists);
    const appDef = getServiceDefinition(getPackageServiceId());
    const checks = [
        buildDiagnosticItem(
            'app-root',
            '安装包目录',
            shortDiagnosticPath(APP_ROOT),
            fs.existsSync(APP_ROOT),
            fs.existsSync(APP_ROOT) ? APP_ROOT : `目录不存在：${APP_ROOT}`
        ),
        buildDiagnosticItem(
            'app-env',
            '平台配置 .env',
            shortDiagnosticPath(ENV_FILE_PATH),
            fs.existsSync(ENV_FILE_PATH),
            fs.existsSync(ENV_FILE_PATH) ? ENV_FILE_PATH : `未找到 .env：${ENV_FILE_PATH}`
        ),
        // YAML 模板是可选的：新版部署包不再下发 conf/*.yml，配置直接预置在 .env 里。
        // 只有 .env 也缺失时，没有 YAML 才真的会导致首次补全不完整。
        buildDiagnosticItem(
            'yaml-config',
            'YAML 模板',
            YAML_CONFIG_PATH ? shortDiagnosticPath(YAML_CONFIG_PATH) : 'conf/*.yml',
            (!!YAML_CONFIG_PATH && fs.existsSync(YAML_CONFIG_PATH)) || fs.existsSync(ENV_FILE_PATH),
            YAML_CONFIG_PATH && fs.existsSync(YAML_CONFIG_PATH)
                ? YAML_CONFIG_PATH
                : (fs.existsSync(ENV_FILE_PATH)
                    ? '未下发 YAML 模板，配置来自 .env（新版部署包的正常形态）。'
                    : '未找到 YAML 模板，且 .env 缺失，首次补全配置可能不完整。'),
            'warning'
        ),
        buildDiagnosticItem(
            'docker-socket',
            'Docker Socket',
            '/var/run/docker.sock',
            socketMounted,
            socketMounted ? '/var/run/docker.sock 已挂载' : '未挂载 /var/run/docker.sock，无法控制宿主机 Docker。'
        ),
        buildDiagnosticItem(
            'docker-compose',
            'Docker Compose',
            dockerRuntime.dockerComposeCmd || 'docker compose',
            !dockerMessage,
            dockerMessage || `${dockerRuntime.dockerComposeCmd || 'docker compose'} 可用`
        ),
        buildDiagnosticItem(
            'app-compose',
            '业务 Compose',
            appDef?.composePath ? shortDiagnosticPath(appDef.composePath) : '业务 docker-compose.yml',
            !!appDef?.exists,
            appDef?.exists ? appDef.composePath : `未找到 ${appDef?.composePath || '业务 compose'}`
        ),
        buildDiagnosticItem(
            'service-compose',
            '服务 Compose',
            `${existingServices.length}/${serviceDefs.length} 个 compose`,
            existingServices.length > 0,
            `${existingServices.length}/${serviceDefs.length} 个服务 compose 可用`,
            'warning'
        ),
        buildDiagnosticItem(
            'auth',
            '管理员登录',
            'admin',
            AUTH_REQUIRED,
            '已启用 admin 单账号登录，默认密码可通过 CONFIG_MATE_PASSWORD 覆盖。',
            'warning'
        )
    ];
    const counts = checks.reduce((acc, check) => {
        acc[check.state] = (acc[check.state] || 0) + 1;
        return acc;
    }, { ok: 0, warning: 0, error: 0 });
    return {
        status: counts.error > 0 ? 'error' : (counts.warning > 0 ? 'warning' : 'ok'),
        counts,
        checks
    };
}

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
const configRoutes = createConfigRoutes({
    configMeta: CONFIG_META,
    envStore,
    parseEnvFile,
    saveEnvFile,
    dockerRuntime,
    getServiceDefinition,
    getPackageServiceId
});
const installRoutes = createInstallRoutes({
    appRoot: APP_ROOT,
    appDir: APP_DIR,
    dockerRuntime,
    getServiceDefinition,
    getPackageServiceId,
    guardAppServiceDependencies
});
serviceRoutes = createServiceRoutes({
    listServiceDefinitions,
    getServiceDefinition,
    getPackageServiceId,
    getServiceStatus,
    runComposeAction,
    buildServiceComposeConfig,
    buildCleanupPlan,
    runCleanupService,
    getRequestActor,
    guardAppServiceDependencies,
    guardAppServiceRunning
});
const yamlInitializer = createYamlInitializer({
    yaml,
    envFilePath: ENV_FILE_PATH,
    yamlConfigPath: YAML_CONFIG_PATH,
    appRoot: APP_ROOT,
    appDir: APP_DIR,
    configMeta: CONFIG_META,
    parseEnvFile,
    saveEnvFile
});
const appRoutes = createAppRoutes({
    parseEnvFile,
    saveEnvFile,
    buildDeploymentPlanWithStatus,
    guardAppServiceRunning,
    applyAppConfigChange,
    runComposeAction,
    getPackageServiceId,
    getServiceDefinition,
    getServiceStatus,
    logStreamService,
    validateConfig: config => validateConfigValues(CONFIG_META, config)
});

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
        '.html': 'text/html; charset=utf-8',
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

        if (systemRoutes.handlePublic(req, res, { method, pathname, requestUrl, headers })) {
            return;
        }

        if (!isAuthenticated(req)) {
            writeJson(res, 401, { status: 'unauthorized', message: '请先登录 Config Mate' }, headers);
            return;
        }

        if (systemRoutes.handleAuthenticated(req, res, { method, pathname, requestUrl, headers })) {
            return;
        }

        if (configRoutes.handle(req, res, { method, pathname, requestUrl, headers })) {
            return;
        }

        if (serviceRoutes.handle(req, res, { method, pathname, requestUrl, headers })) {
            return;
        }

        if (installRoutes.handle(req, res, { method, pathname, requestUrl, headers })) {
            return;
        }

        if (appRoutes.handle(req, res, { method, pathname, requestUrl, headers })) {
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
yamlInitializer.run();
dockerRuntime.detect();
startServer();
