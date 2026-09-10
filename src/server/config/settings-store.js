/**
 * Config Mate 运行时设置。
 *
 * 与业务 .env 无关，存放 Config Mate 自身的行为开关，持久化在
 * APP_ROOT/.config-mate/settings.json，容器重建后仍然保留。
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
    /* 严格依赖校验。
       开启（默认）：依赖服务未处于 running 时，阻止启动/重启业务服务。
       关闭：仅在操作确认弹窗中提示风险，不阻断。

       现场会出现 Redis Cluster、Kafka 集群、Cassandra 集群等多种部署形态，
       Config Mate 的服务白名单无法穷举，硬校验会挡住本来正常的操作，
       因此提供此开关由现场运维决定。 */
    strictDependencyCheck: true
};

function normalizeBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null || value === '') return fallback;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

function createSettingsStore({ settingsFile, env = process.env, logger = console }) {
    if (!settingsFile) throw new Error('settingsFile is required');

    /* 环境变量作为初始默认值，便于交付包统一预置；
       界面上的修改会写入文件并覆盖它。 */
    const envDefaults = {
        strictDependencyCheck: normalizeBoolean(
            env.CONFIG_MATE_STRICT_DEPENDENCY,
            DEFAULT_SETTINGS.strictDependencyCheck
        )
    };

    let cache = null;

    function readFromDisk() {
        if (!fs.existsSync(settingsFile)) return {};
        try {
            return JSON.parse(fs.readFileSync(settingsFile, 'utf8')) || {};
        } catch (e) {
            logger.warn?.(`[Settings] 配置文件解析失败，使用默认值: ${e.message}`);
            return {};
        }
    }

    function get() {
        if (!cache) {
            const stored = readFromDisk();
            cache = {
                strictDependencyCheck: normalizeBoolean(
                    stored.strictDependencyCheck,
                    envDefaults.strictDependencyCheck
                )
            };
        }
        return { ...cache };
    }

    function update(patch = {}) {
        const current = get();
        const next = { ...current };

        if (Object.prototype.hasOwnProperty.call(patch, 'strictDependencyCheck')) {
            next.strictDependencyCheck = normalizeBoolean(
                patch.strictDependencyCheck,
                current.strictDependencyCheck
            );
        }

        fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
        fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2), 'utf8');
        cache = next;
        return { ...next };
    }

    function isStrictDependencyCheck() {
        return get().strictDependencyCheck;
    }

    return {
        get,
        update,
        isStrictDependencyCheck
    };
}

module.exports = {
    DEFAULT_SETTINGS,
    createSettingsStore,
    normalizeBoolean
};
