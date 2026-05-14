const fs = require('fs');
const path = require('path');

const YAML_KEY_MAPPING = {
    REDIS_CONNECTION_TYPE: ['REDIS_CONNECTION_TYPE'],
    REDIS_HOST: ['REDIS_STANDALONE_HOST'],
    REDIS_PORT: ['REDIS_STANDALONE_PORT'],
    REDIS_USE_DEFAULT_CLIENT_CONFIG: ['REDIS_STANDALONE_USEDEFAULTCLIENTCONFIG'],
    REDIS_CLIENT_NAME: ['REDIS_STANDALONE_CLIENTNAME'],
    REDIS_CLIENT_CONNECT_TIMEOUT: ['REDIS_STANDALONE_CONNECTTIMEOUT'],
    REDIS_CLIENT_READ_TIMEOUT: ['REDIS_STANDALONE_READTIMEOUT'],
    REDIS_CLIENT_USE_POOL_CONFIG: ['REDIS_STANDALONE_USEPOOLCONFIG'],
    REDIS_NODES: ['REDIS_CLUSTER_NODES'],
    REDIS_MAX_REDIRECTS: ['REDIS_CLUSTER_MAX_REDIRECTS'],
    REDIS_USE_DEFAULT_POOL_CONFIG: ['REDIS_CLUSTER_USEDEFAULTPOOLCONFIG', 'REDIS_USE_DEFAULT_POOL_CONFIG'],
    REDIS_MASTER: ['REDIS_SENTINEL_MASTER'],
    REDIS_SENTINELS: ['REDIS_SENTINEL_SENTINELS'],
    REDIS_SENTINEL_PASSWORD: ['REDIS_SENTINEL_PASSWORD'],
    REDIS_SENTINEL_USE_DEFAULT_POOL_CONFIG: ['REDIS_SENTINEL_USEDEFAULTPOOLCONFIG'],
    SPRING_DRIVER_CLASS_NAME: ['SPRING_DATASOURCE_DRIVERCLASSNAME'],
    NETTY_MAX_PAYLOAD_SIZE: ['TRANSPORT_MQTT_NETTY_MAX_PAYLOAD_SIZE'],
    MQTT_BIND_PORT: ['TRANSPORT_MQTT_BIND_PORT']
};

function flattenYaml(obj, prefix = '', res = {}) {
    if (!obj || typeof obj !== 'object') return res;
    for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        const val = obj[key];
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

function findPlaceholderEnd(value, startIndex) {
    let depth = 0;
    for (let i = startIndex; i < value.length; i++) {
        if (value[i] === '$' && value[i + 1] === '{') {
            depth++;
            i++;
            continue;
        }
        if (value[i] === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function splitPlaceholderContent(content) {
    let depth = 0;
    for (let i = 0; i < content.length; i++) {
        if (content[i] === '$' && content[i + 1] === '{') {
            depth++;
            i++;
            continue;
        }
        if (content[i] === '}') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (content[i] === ':' && depth === 0) {
            return {
                key: content.slice(0, i),
                hasDefault: true,
                defaultValue: content.slice(i + 1)
            };
        }
    }
    return {
        key: content,
        hasDefault: false,
        defaultValue: ''
    };
}

function extractEnvPlaceholders(value) {
    if (typeof value !== 'string') return [];

    const result = [];
    let index = 0;
    while (index < value.length) {
        const start = value.indexOf('${', index);
        if (start === -1) break;

        const end = findPlaceholderEnd(value, start);
        if (end === -1) break;

        const raw = value.slice(start, end + 1);
        const content = value.slice(start + 2, end);
        const parsed = splitPlaceholderContent(content);
        const key = parsed.key.trim();

        if (/^[A-Z][A-Z0-9_]*$/.test(key)) {
            result.push({
                key,
                raw,
                hasDefault: parsed.hasDefault,
                defaultValue: parsed.defaultValue
            });
        }

        index = end + 1;
    }

    return result;
}

function resolveSpringPlaceholder(value) {
    if (typeof value !== 'string') return value;
    const val = value.trim();
    const placeholders = extractEnvPlaceholders(val);
    if (placeholders.length === 1 && placeholders[0].raw === val) {
        return placeholders[0].hasDefault ? placeholders[0].defaultValue : '';
    }
    return val;
}

function findYamlPath({ yamlConfigPath, appDir, appRoot, projectRoot }) {
    return [
        yamlConfigPath,
        path.join(appDir, 'conf', 'thingsboard.yml'),
        path.join(appDir, 'conf', 'tb-edge.yml'),
        path.join(appDir, 'thingsboard.yml'),
        path.join(appDir, 'tb-edge.yml'),
        path.join(appRoot, 'conf', 'thingsboard.yml'),
        path.join(appRoot, 'conf', 'tb-edge.yml'),
        path.join(projectRoot, 'conf', 'thingsboard.yml'),
        path.join(projectRoot, 'conf', 'tb-edge.yml')
    ].filter(Boolean).find(candidate => fs.existsSync(candidate)) || null;
}

function inferAppTypeFromYamlPath(yamlPath) {
    const filename = path.basename(yamlPath || '');
    if (filename === 'tb-edge.yml') return 'EDGE';
    return 'CLOUD';
}

function buildReverseMapping(flattened) {
    const reverseMapping = {};
    Object.keys(flattened).forEach(flatKey => {
        const val = flattened[flatKey];
        extractEnvPlaceholders(val).forEach(placeholder => {
            reverseMapping[placeholder.key] = placeholder.raw;
        });
    });
    return reverseMapping;
}

function extractAllPlaceholderConfig(flattened) {
    const config = {};
    Object.keys(flattened).forEach(flatKey => {
        extractEnvPlaceholders(flattened[flatKey]).forEach(placeholder => {
            if (Object.prototype.hasOwnProperty.call(config, placeholder.key)) return;
            config[placeholder.key] = placeholder.hasDefault ? placeholder.defaultValue : '';
        });
    });
    return config;
}

function extractConfigFromYaml({ data, flattened, configMeta, targetAppType }) {
    const reverseMapping = buildReverseMapping(flattened);
    const newConfig = {
        APPTYPE: targetAppType,
        ...extractAllPlaceholderConfig(flattened)
    };

    Object.keys(configMeta).forEach(metaKey => {
        const meta = configMeta[metaKey];
        const scope = meta.scope || 'common';
        if (scope === 'cloud' && targetAppType !== 'CLOUD') return;
        if (scope === 'edge' && targetAppType !== 'EDGE') return;

        if (flattened[metaKey] !== undefined) {
            newConfig[metaKey] = resolveSpringPlaceholder(flattened[metaKey]);
            return;
        }

        if (reverseMapping[metaKey] !== undefined) {
            newConfig[metaKey] = resolveSpringPlaceholder(reverseMapping[metaKey]);
            return;
        }

        if (YAML_KEY_MAPPING[metaKey]) {
            const mappedKeys = YAML_KEY_MAPPING[metaKey];
            for (const mappedKey of mappedKeys) {
                if (flattened[mappedKey] !== undefined) {
                    newConfig[metaKey] = resolveSpringPlaceholder(flattened[mappedKey]);
                    return;
                }
            }
        }

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
            }
        }
    });

    return newConfig;
}

function createYamlInitializer({
    yaml,
    envFilePath,
    yamlConfigPath,
    appRoot,
    appDir,
    projectRoot,
    configMeta,
    parseEnvFile,
    saveEnvFile,
    logger = console
}) {
    function run() {
        let existingEnv = {};
        if (fs.existsSync(envFilePath)) {
            try {
                existingEnv = parseEnvFile();
                logger.log?.(`[Info] .env file exists with ${Object.keys(existingEnv).length} keys. Checking for missing configurations...`);
            } catch (e) {
                logger.warn?.('[Warn] Failed to parse existing .env, will create new:', e);
            }
        } else {
            logger.log?.('[Info] .env file not found. Will create from YAML...');
        }

        if (!yaml) return;
        logger.log?.('[Info] Looking for YAML config...');

        const yamlPath = findYamlPath({ yamlConfigPath, appDir, appRoot, projectRoot });
        if (!yamlPath) {
            logger.log?.('[Info] No YAML config found in conf/ directory. Skipping.');
            return;
        }

        logger.log?.(`[Info] Found YAML config at: ${yamlPath}`);
        try {
            const data = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
            const flattened = flattenYaml(data);
            Object.keys(flattened).forEach(flatKey => {
                const val = flattened[flatKey];
                if (typeof val === 'string') {
                    const match = val.match(/^\$\{([^:]+)(:.*)?\}$/);
                    if (match && !flattened[match[1]]) flattened[match[1]] = val;
                }
            });

            const targetAppType = inferAppTypeFromYamlPath(yamlPath);
            const newConfig = extractConfigFromYaml({ data, flattened, configMeta, targetAppType });
            appendMissingConfig({ newConfig, existingEnv, targetAppType });
        } catch (e) {
            logger.error?.('[Error] Failed to parse YAML:', e);
        }
    }

    function appendMissingConfig({ newConfig, existingEnv, targetAppType }) {
        if (Object.keys(newConfig).length === 0) {
            logger.log?.('[Warn] Parsed YAML but found no matching configurations defined in metadata.');
            return;
        }

        logger.log?.(`[Info] Extracted ${Object.keys(newConfig).length} configurations from YAML.`);
        const missingKeys = {};
        let missingCount = 0;

        Object.keys(newConfig).forEach(key => {
            if (!Object.prototype.hasOwnProperty.call(existingEnv, key)) {
                missingKeys[key] = newConfig[key];
                missingCount++;
            }
        });

        const expectedKeys = Object.keys(configMeta).filter(key => {
            const meta = configMeta[key];
            const scope = meta.scope || 'common';
            if (scope === 'cloud' && targetAppType !== 'CLOUD') return false;
            if (scope === 'edge' && targetAppType !== 'EDGE') return false;
            return true;
        });

        const missedExtraction = expectedKeys.filter(key => (
            !Object.prototype.hasOwnProperty.call(newConfig, key)
            && !Object.prototype.hasOwnProperty.call(existingEnv, key)
        ));
        if (missedExtraction.length > 0) {
            logger.log?.(`[Info] ⚠️  The following ${missedExtraction.length} keys were expected but NOT found in YAML or .env. Using defaults:`);
            missedExtraction.forEach(key => {
                logger.log?.(`   - ${key}`);
                const meta = configMeta[key];
                missingKeys[key] = meta.default !== undefined ? meta.default : '';
                missingCount++;
            });
        }

        if (missingCount <= 0) {
            logger.log?.('[Info] .env is already complete. No new keys to add.');
            return;
        }

        logger.log?.(`[Info] Found ${missingCount} missing keys. Updating .env...`);
        if (Object.keys(existingEnv).length === 0 && !fs.existsSync(envFilePath)) {
            saveEnvFile(missingKeys);
            return;
        }

        let appendContent = '\n# --- Auto-Generated Defaults ---\n';
        Object.keys(missingKeys).sort().forEach(key => {
            const meta = configMeta[key];
            if (meta) appendContent += meta.comment ? `# ${meta.label} (${meta.comment})\n` : `# ${meta.label}\n`;
            appendContent += `${key}=${missingKeys[key]}\n`;
        });
        try {
            fs.appendFileSync(envFilePath, appendContent);
            logger.log?.('[Success] Appended missing configurations to .env');
        } catch (err) {
            logger.error?.('[Error] Failed to append to .env:', err);
        }
    }

    return {
        run
    };
}

module.exports = {
    buildReverseMapping,
    createYamlInitializer,
    extractAllPlaceholderConfig,
    extractConfigFromYaml,
    extractEnvPlaceholders,
    findYamlPath,
    flattenYaml,
    resolveSpringPlaceholder,
    YAML_KEY_MAPPING
};
