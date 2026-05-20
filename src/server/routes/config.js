const { readRequestBody, writeJson } = require('../http');
const { checkDependsOn } = require('../config/env-store');

const DEFAULT_IGNORED_RUNTIME_PREFIXES = [
    'PATH',
    'JAVA_',
    'LANG',
    'LC_',
    'HOME',
    'LOG_DIR',
    'LIB_DIR',
    'CONFIG_PATH',
    'APP_NAME',
    'CONFIG_NAME',
    'LOGGING_CONFIG',
    'HOSTNAME',
    'PWD',
    'GPG_KEY'
];

function validateConfigValues(configMeta, values) {
    const errors = [];
    const metaSource = configMeta || {};
    const config = values || {};
    const currentAppType = (config.APPTYPE || config.APP_TYPE || 'CLOUD').toUpperCase();

    Object.keys(metaSource).forEach(key => {
        const meta = metaSource[key] || {};
        const scope = meta.scope || 'common';
        if (scope === 'cloud' && currentAppType !== 'CLOUD') return;
        if (scope === 'edge' && currentAppType !== 'EDGE') return;
        if (!checkDependsOn(meta.dependsOn, config)) return;

        const rawValue = config[key];
        const textValue = rawValue === undefined || rawValue === null ? '' : String(rawValue).trim();
        const label = meta.label || key;

        if (meta.required && textValue === '') {
            errors.push({ key, label, message: `${label}不能为空` });
            return;
        }
        if (textValue === '') return;

        if (meta.type === 'number') {
            const numberValue = Number(textValue);
            if (!Number.isFinite(numberValue)) {
                errors.push({ key, label, message: `${label}必须是数字` });
                return;
            }
            if (meta.min !== undefined && numberValue < Number(meta.min)) {
                errors.push({ key, label, message: `${label}不能小于 ${meta.min}` });
            }
            if (meta.max !== undefined && numberValue > Number(meta.max)) {
                errors.push({ key, label, message: `${label}不能大于 ${meta.max}` });
            }
        }

        if (meta.type === 'select' && Array.isArray(meta.options) && meta.options.length > 0) {
            const allowed = meta.options.map(String);
            if (!allowed.includes(String(rawValue))) {
                errors.push({ key, label, message: `${label}只能是：${allowed.join(' / ')}` });
            }
        }
    });

    return errors;
}

function buildRuntimeEnvDiff(localEnvMap, runtimeEnvMap, ignoredPrefixes = DEFAULT_IGNORED_RUNTIME_PREFIXES) {
    const diffs = [];
    Object.keys(localEnvMap || {}).forEach(key => {
        if (ignoredPrefixes.some(prefix => key.startsWith(prefix))) return;

        const runtimeVal = runtimeEnvMap ? runtimeEnvMap[key] : undefined;
        const localVal = localEnvMap[key];
        if (runtimeVal !== localVal) {
            diffs.push({
                key,
                runtimeVal: runtimeVal === undefined ? '(missing)' : runtimeVal,
                localVal: localVal === undefined ? '(missing)' : localVal,
                state: runtimeVal === undefined ? 'DELETED' : 'MODIFIED'
            });
        }
    });

    diffs.sort((a, b) => {
        const score = state => state === 'MODIFIED' ? 0 : (state === 'NEW' ? 1 : 2);
        return score(a.state) - score(b.state);
    });
    return diffs;
}

function parseRuntimeEnvFromInspect(stdout, logger = console) {
    try {
        const inspectData = JSON.parse(stdout || '[]');
        const envList = inspectData?.[0]?.Config?.Env || [];
        return envList.reduce((acc, envStr) => {
            const parts = String(envStr).split('=');
            const key = parts[0];
            const val = parts.slice(1).join('=');
            if (key) acc[key] = val;
            return acc;
        }, {});
    } catch (e) {
        logger.error?.('[Error] Failed to parse inspect output:', e);
        return {};
    }
}

function createConfigRoutes({
    configMeta,
    envStore,
    parseEnvFile,
    saveEnvFile,
    dockerRuntime,
    getServiceDefinition,
    getPackageServiceId,
    logger = console
}) {
    function handle(req, res, { method, pathname, headers }) {
        if (pathname === '/api/config' && method === 'GET') {
            writeJson(res, 200, {
                meta: configMeta,
                values: parseEnvFile()
            }, headers);
            return true;
        }

        if (pathname === '/api/save' && method === 'POST') {
            readRequestBody(req).then(body => {
                const newConfig = JSON.parse(body || '{}');
                const validationErrors = validateConfigValues(configMeta, { ...parseEnvFile(), ...newConfig });
                if (validationErrors.length > 0) {
                    writeJson(res, 400, {
                        status: 'error',
                        code: 'CONFIG_VALIDATION_FAILED',
                        message: '配置校验未通过',
                        errors: validationErrors
                    }, headers);
                    return;
                }
                saveEnvFile(newConfig);
                writeJson(res, 200, { status: 'ok' }, headers);
            }).catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return true;
        }

        if (pathname === '/api/history' && method === 'GET') {
            writeJson(res, 200, { status: 'success', data: envStore.listHistory() }, headers);
            return true;
        }

        if (pathname === '/api/history/restore' && method === 'POST') {
            readRequestBody(req).then(body => {
                const { filename } = JSON.parse(body || '{}');
                const result = envStore.restoreHistory(filename);
                if (!result.ok) {
                    writeJson(res, result.statusCode || 500, { status: 'error', message: result.message }, headers);
                    return;
                }
                writeJson(res, 200, { status: 'success', message: result.message }, headers);
            }).catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return true;
        }

        if (pathname === '/api/history/content' && method === 'POST') {
            readRequestBody(req).then(body => {
                const { filename } = JSON.parse(body || '{}');
                const result = envStore.readHistoryContent(filename);
                if (!result.ok) {
                    writeJson(res, result.statusCode || 500, { status: 'error', message: result.message }, headers);
                    return;
                }
                writeJson(res, 200, { status: 'success', content: result.content }, headers);
            }).catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return true;
        }

        if (pathname === '/api/env-raw' && method === 'GET') {
            try {
                res.writeHead(200, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(envStore.readRaw());
            } catch (e) {
                writeJson(res, 500, { status: 'error', message: e.message }, headers);
            }
            return true;
        }

        if (pathname === '/api/save-raw' && method === 'POST') {
            readRequestBody(req).then(body => {
                envStore.saveRaw(body);
                writeJson(res, 200, { status: 'ok' }, headers);
            }).catch(e => writeJson(res, 500, { status: 'error', message: e.message }, headers));
            return true;
        }

        if (pathname === '/api/diff-runtime' && method === 'GET') {
            handleDiffRuntime(res, headers).catch(e => {
                writeJson(res, 500, { status: 'error', message: 'Internal Server Error', details: e.message }, headers);
            });
            return true;
        }

        return false;
    }

    async function handleDiffRuntime(res, headers) {
        if (!dockerRuntime.dockerComposeCmd) {
            writeJson(res, 500, { status: 'error', message: 'Docker not available' }, headers);
            return;
        }

        const def = getServiceDefinition(getPackageServiceId());
        if (!def || !def.exists) {
            writeJson(res, 200, { status: 'not_running', service: getPackageServiceId() }, headers);
            return;
        }

        const ps = await dockerRuntime.exec(
            dockerRuntime.dockerComposeCmd,
            dockerRuntime.composeArgsFor(def, ['ps', '-q', def.composeService])
        );
        if (ps.error) {
            writeJson(res, 500, { status: 'error', message: 'Failed to resolve container ID', details: ps.error.message }, headers);
            return;
        }

        const containerId = ps.stdout.trim();
        if (!containerId) {
            writeJson(res, 200, { status: 'not_running', service: def.id }, headers);
            return;
        }

        const inspect = await dockerRuntime.exec(dockerRuntime.dockerPath, ['inspect', containerId]);
        if (inspect.error) {
            writeJson(res, 500, { status: 'error', message: 'Failed to inspect container', details: inspect.error.message }, headers);
            return;
        }

        const runtimeEnvMap = parseRuntimeEnvFromInspect(inspect.stdout, logger);
        const localEnvMap = parseEnvFile();
        writeJson(res, 200, {
            status: 'success',
            service: def.id,
            containerId,
            diffs: buildRuntimeEnvDiff(localEnvMap, runtimeEnvMap)
        }, headers);
    }

    return {
        handle
    };
}

module.exports = {
    buildRuntimeEnvDiff,
    createConfigRoutes,
    parseRuntimeEnvFromInspect,
    validateConfigValues
};
