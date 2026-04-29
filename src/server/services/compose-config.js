const fs = require('fs');

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
            } catch (error) {
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
        } catch (error) {
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

function resolveComposeVariableString(value, env = {}, processEnv = process.env) {
    if (typeof value !== 'string') return value || '';
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])([^}]*))?\}/g, (match, key, operator, fallback) => {
        const hasEnvValue = Object.prototype.hasOwnProperty.call(env, key) && env[key] !== '';
        if (hasEnvValue) return env[key];
        if (processEnv[key]) return processEnv[key];
        if (operator && operator.includes('-')) return fallback || '';
        return match;
    });
}

function createServiceComposeConfigBuilder({
    yaml,
    getServiceDefinition,
    getPackageServiceId,
    envProvider = () => ({})
}) {
    function buildServiceComposeConfig(serviceId) {
        const def = getServiceDefinition(serviceId);
        if (!def) return { status: 'error', message: 'Unknown service' };
        if (!def.exists) return { status: 'error', message: `Compose file not found: ${def.composePath}` };
        if (!yaml) return { status: 'error', message: 'YAML parser is not available' };

        let doc;
        try {
            doc = yaml.load(fs.readFileSync(def.composeAbsPath, 'utf8')) || {};
        } catch (error) {
            return { status: 'error', message: `Failed to parse compose file: ${error.message}` };
        }

        const service = doc.services?.[def.composeService];
        if (!service) {
            return { status: 'error', message: `Service ${def.composeService} not found in ${def.composePath}` };
        }

        const envEntries = normalizeComposeEnvironment(service.environment);
        const envMap = composeEntriesToMap(envEntries);
        const summary = {
            image: resolveComposeVariableString(service.image || '', envProvider()),
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

    return { buildServiceComposeConfig };
}

module.exports = {
    createServiceComposeConfigBuilder,
    normalizeComposeEnvironment,
    normalizeComposeList,
    normalizeComposeCommand,
    extractRedisPassword,
    isSensitiveComposeKey,
    filterServiceEnvironmentEntries,
    resolveComposeVariableString
};
