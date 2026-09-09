/**
 * Config Mate 管理员凭据存储。
 *
 * 改造前密码只来自环境变量 CONFIG_MATE_PASSWORD，且以明文全等比较。
 * 交付包默认值是 123456，配合挂载的 docker.sock，等于一个 root 等价的
 * HTTP 服务——单机时风险尚可控，一旦进入多节点（Agent/Console）形态，
 * 攻击面按节点数翻倍，因此必须先解决。
 *
 * 本模块提供：
 *   - scrypt 哈希存储（Node 内置，无新增依赖）
 *   - 恒定时间比较，避免通过响应时间推测密码
 *   - 改密持久化到 APP_ROOT/.config-mate/auth.json（0600）
 *   - 「仍在使用默认密码」标记，供界面强制引导改密
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_PASSWORD = '123456';
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

function hashPassword(password, salt = crypto.randomBytes(SALT_BYTES).toString('hex')) {
    const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
    return { salt, hash: derived };
}

/** 恒定时间比较，长度不同也不提前返回。 */
function safeEqual(a, b) {
    const bufA = Buffer.from(String(a), 'utf8');
    const bufB = Buffer.from(String(b), 'utf8');
    if (bufA.length !== bufB.length) {
        // 仍执行一次比较，避免长度差异造成可观测的时间差。
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

function verifyPassword(password, stored) {
    if (!stored || !stored.salt || !stored.hash) return false;
    const { hash } = hashPassword(password, stored.salt);
    return safeEqual(hash, stored.hash);
}

function createCredentialStore({
    credentialFile,
    envPassword = '',
    logger = console
}) {
    if (!credentialFile) throw new Error('credentialFile is required');

    let cache = null;

    function readFromDisk() {
        if (!fs.existsSync(credentialFile)) return null;
        try {
            const parsed = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
            return parsed && parsed.salt && parsed.hash ? parsed : null;
        } catch (e) {
            logger.warn?.(`[Auth] 凭据文件解析失败，回落到环境变量密码: ${e.message}`);
            return null;
        }
    }

    function load() {
        if (cache === null) cache = readFromDisk() || false;
        return cache || null;
    }

    /** 是否已通过界面改过密（存在持久化凭据）。 */
    function hasStoredCredential() {
        return !!load();
    }

    /**
     * 校验密码。
     * 已改密 → 比对哈希；未改密 → 与环境变量密码恒定时间比较。
     */
    function verify(password) {
        const stored = load();
        if (stored) return verifyPassword(password, stored);
        if (!envPassword) return false;
        return safeEqual(String(password), envPassword);
    }

    /** 当前是否仍在使用交付包默认密码（未改密且环境变量就是默认值）。 */
    function isUsingDefaultPassword() {
        return !load() && safeEqual(envPassword, DEFAULT_PASSWORD);
    }

    function setPassword(newPassword) {
        const text = String(newPassword || '');
        if (text.length < 8) {
            return { ok: false, message: '新密码至少 8 位。' };
        }
        if (safeEqual(text, DEFAULT_PASSWORD)) {
            return { ok: false, message: '不能使用交付包默认密码。' };
        }
        if (!/[A-Za-z]/.test(text) || !/[0-9]/.test(text)) {
            return { ok: false, message: '新密码需同时包含字母和数字。' };
        }

        const next = { ...hashPassword(text), updatedAt: new Date().toISOString() };
        fs.mkdirSync(path.dirname(credentialFile), { recursive: true });
        fs.writeFileSync(credentialFile, JSON.stringify(next, null, 2), { mode: 0o600 });
        try {
            fs.chmodSync(credentialFile, 0o600);
        } catch (e) {
            logger.warn?.(`[Auth] 无法设置凭据文件权限: ${e.message}`);
        }
        cache = next;
        return { ok: true };
    }

    return {
        hasStoredCredential,
        isUsingDefaultPassword,
        setPassword,
        verify
    };
}

module.exports = {
    DEFAULT_PASSWORD,
    createCredentialStore,
    hashPassword,
    safeEqual,
    verifyPassword
};
