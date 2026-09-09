/**
 * 双机热备（HA）集群只读探测。
 *
 * 设计约束：交付的 HA 镜像与部署包保持零改动，本模块只调用容器内
 * 已有的命令（与现场运维手册第八节完全一致），不依赖 compose 文件
 * 路径，也不依赖 HA 包解压在 APP_ROOT 之内。
 *
 * PostgreSQL 与瀚高两条线的差异全部是参数级的（容器名、端口、数据库
 * 用户、PGDATA 路径、是否有 License），因此共用同一套探测实现。
 */

const HA_PROBE_TIMEOUT_MS = 5000;

/* 各 HA 变体的参数表。容器名由交付包的 compose 写死，可作为发现依据。 */
const HA_VARIANTS = {
    'postgres-ha': {
        id: 'postgres-ha',
        label: 'PostgreSQL 双机热备',
        containerName: 'postgres-ha',
        dbUser: 'postgres',
        defaultPort: 5432,
        pgdataRoot: '/var/lib/postgresql/data',
        license: null,
        tier: 'storage'
    },
    'highgo-ha': {
        id: 'highgo-ha',
        label: '瀚高双机热备',
        containerName: 'highgo-ha',
        dbUser: 'highgo',
        defaultPort: 5866,
        pgdataRoot: '/opt/highgo/hgdb-4.5/data',
        license: { command: 'hg_lic', file: 'hgdb.lic' },
        tier: 'storage'
    }
};

function listHaVariants() {
    return Object.keys(HA_VARIANTS).map(id => ({ ...HA_VARIANTS[id] }));
}

function getHaVariant(id) {
    const variant = HA_VARIANTS[id];
    return variant ? { ...variant } : null;
}

function isHaServiceId(id) {
    return Object.prototype.hasOwnProperty.call(HA_VARIANTS, id);
}

/**
 * 解析 `repmgr cluster show` 的表格输出。
 *
 *  ID | Name     | Role    | Status    | Upstream | Location | Priority | ...
 * ----+----------+---------+-----------+----------+----------+----------+
 *   1 | pg-node1 | primary | * running |          | default  | 100      | ...
 *   2 | pg-node2 | standby |   running | pg-node1 | default  | 100      | ...
 */
function parseRepmgrClusterShow(stdout) {
    const lines = String(stdout || '').split(/\r?\n/);
    const nodes = [];

    lines.forEach(line => {
        if (!line.includes('|')) return;
        const cells = line.split('|').map(cell => cell.trim());
        const id = Number(cells[0]);
        // 表头（ID）与分隔行（----）都不是有效数据行。
        if (!Number.isInteger(id)) return;

        const rawStatus = cells[3] || '';
        nodes.push({
            id,
            name: cells[1] || '',
            role: (cells[2] || '').toLowerCase(),
            status: rawStatus.replace(/^\*\s*/, '').trim(),
            // repmgr 用前导 * 标记「本次查询所连接的节点」。
            current: rawStatus.startsWith('*'),
            upstream: cells[4] || ''
        });
    });

    return nodes;
}

/**
 * 从 `ip -o addr show` 输出里判断 VIP 是否在本机。
 *
 * 不能写死 eth0：现场网卡名不固定（运维手册也提示「注意更换网卡名称」），
 * 所以遍历全部网卡做精确匹配。
 */
function parseVipPresence(stdout, vip) {
    if (!vip) return { held: false, iface: '' };

    const lines = String(stdout || '').split(/\r?\n/);
    for (const line of lines) {
        // 形如: 2: eth0    inet 192.168.1.100/24 brd ... scope global eth0
        const match = line.match(/^\s*\d+:\s*(\S+)\s+inet6?\s+([^/\s]+)/);
        if (match && match[2] === vip) {
            return { held: true, iface: match[1] };
        }
    }
    return { held: false, iface: '' };
}

/** 解析 pg_stat_replication 的关键字段（-A -F| 无对齐输出）。 */
function parseReplicationRows(stdout) {
    return String(stdout || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const [applicationName, state, syncState, lagBytes] = line.split('|');
            const lag = Number(lagBytes);
            return {
                applicationName: applicationName || '',
                state: state || '',
                syncState: syncState || '',
                lagBytes: Number.isFinite(lag) ? lag : null
            };
        })
        .filter(row => row.applicationName);
}

/**
 * 解析 `hg_lic -c -F ./hgdb.lic` 输出中的到期日。
 *
 * -----------------------------------------------------------------
 * PRODUCT          VERSION                    EXPIRY DATE
 * -----------------------------------------------------------------
 * DATABASE         HGDB-SEE-V4.5              2026-09-02
 * HA_CLUSTER       ALL                        NULL
 */
function parseHighgoLicense(stdout) {
    const text = String(stdout || '');
    if (!text.trim()) return null;

    const statusMatch = text.match(/License status:\s*(\S+)/i);
    const modeMatch = text.match(/License mode:\s*(\S+)/i);
    const products = [];

    text.split(/\r?\n/).forEach(line => {
        const match = line.match(/^\s*([A-Z_]+)\s+(\S+)\s+(\S+)\s*$/);
        if (!match) return;
        if (match[1] === 'PRODUCT') return;
        products.push({
            product: match[1],
            version: match[2],
            expiry: match[3] === 'NULL' ? '' : match[3]
        });
    });

    const database = products.find(item => item.product === 'DATABASE');
    const expiry = database?.expiry || '';
    let daysRemaining = null;
    if (expiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
        const expiryTime = Date.parse(`${expiry}T23:59:59`);
        if (Number.isFinite(expiryTime)) {
            daysRemaining = Math.floor((expiryTime - Date.now()) / 86400000);
        }
    }

    return {
        status: statusMatch ? statusMatch[1] : '',
        mode: modeMatch ? modeMatch[1] : '',
        products,
        expiry,
        daysRemaining,
        // 到期是静默故障，提前两级预警：30 天提醒，7 天内告警。
        level: daysRemaining === null ? 'unknown'
            : daysRemaining < 0 ? 'expired'
                : daysRemaining <= 7 ? 'critical'
                    : daysRemaining <= 30 ? 'warning' : 'ok'
    };
}

function createHaProbe({ docker, logger = console, timeoutMs = HA_PROBE_TIMEOUT_MS }) {
    function dockerExec(args) {
        return docker.exec(docker.dockerPath, args, { timeout: timeoutMs });
    }

    /** 在容器内以数据库用户身份执行一条 psql 语句。 */
    function psql(variant, sql, extraPsqlArgs = '') {
        // 显式带 -p：瀚高端口 5866 非默认，不能依赖容器内 PGPORT 是否设置正确。
        const inner = `psql -p ${variant.port} ${extraPsqlArgs} -tAc "${sql}"`.replace(/\s+/g, ' ');
        return dockerExec(['exec', variant.containerName, 'su', '-', variant.dbUser, '-c', inner]);
    }

    async function inspectContainer(containerName) {
        const result = await dockerExec(['inspect', containerName]);
        if (result.error) return null;
        try {
            return JSON.parse(result.stdout || '[]')?.[0] || null;
        } catch (error) {
            logger.error?.(`[HA] Failed to parse inspect output for ${containerName}: ${error.message}`);
            return null;
        }
    }

    /** 从 inspect 结果读取 HA 容器的生效环境变量。 */
    function readContainerEnv(inspectData) {
        const list = inspectData?.Config?.Env || [];
        return list.reduce((acc, item) => {
            const text = String(item);
            const idx = text.indexOf('=');
            if (idx > 0) acc[text.slice(0, idx)] = text.slice(idx + 1);
            return acc;
        }, {});
    }

    async function probeRole(variant) {
        const result = await psql(variant, 'SELECT pg_is_in_recovery()');
        if (result.error) return { role: 'unknown', writable: false };
        const value = result.stdout.trim().toLowerCase();
        if (value === 'f') return { role: 'primary', writable: true };
        if (value === 't') return { role: 'standby', writable: false };
        return { role: 'unknown', writable: false };
    }

    async function probeVip(variant) {
        if (!variant.vip) return { held: false, iface: '' };
        const result = await dockerExec(['exec', variant.containerName, 'ip', '-o', 'addr', 'show']);
        if (result.error) return { held: false, iface: '' };
        return parseVipPresence(result.stdout, variant.vip);
    }

    async function probeTopology(variant) {
        const result = await dockerExec([
            'exec', variant.containerName,
            'su', '-', variant.dbUser, '-c',
            'repmgr -f /etc/repmgr.conf cluster show'
        ]);
        // cluster show 在对端不可达时返回非零退出码，但 stdout 仍有可用内容。
        const nodes = parseRepmgrClusterShow(result.stdout);
        return {
            nodes,
            degraded: !!result.error && nodes.length > 0,
            message: nodes.length === 0 ? (result.stderr || '').trim().slice(0, 200) : ''
        };
    }

    async function probeReplication(variant) {
        const result = await psql(
            variant,
            "SELECT application_name, state, sync_state, pg_wal_lsn_diff(sent_lsn, replay_lsn) FROM pg_stat_replication",
            '-F"|"'
        );
        if (result.error) return [];
        return parseReplicationRows(result.stdout);
    }

    async function probeLicense(variant) {
        if (!variant.license) return null;
        const { command, file } = variant.license;
        const result = await dockerExec([
            'exec', variant.containerName,
            'bash', '-c',
            `cd ${variant.pgdataRoot} && ${command} -c -F ./${file}`
        ]);
        if (result.error) {
            return {
                status: 'unavailable',
                mode: '',
                products: [],
                expiry: '',
                daysRemaining: null,
                level: 'unknown',
                message: '未能读取 License 信息，请确认已按部署文档激活。'
            };
        }
        return parseHighgoLicense(result.stdout);
    }

    /**
     * 完整探测一个 HA 服务。调用方需先确认容器存在。
     * 各子探测互相独立，单项失败不影响其余结果。
     */
    async function probe(serviceId) {
        const base = getHaVariant(serviceId);
        if (!base) return null;

        const inspectData = await inspectContainer(base.containerName);
        if (!inspectData) {
            return {
                ...base,
                exists: false,
                status: 'missing',
                running: false,
                containerId: ''
            };
        }

        const env = readContainerEnv(inspectData);
        const variant = {
            ...base,
            vip: env.NODE_VIP || '',
            port: Number(env.PG_PORT) || base.defaultPort,
            nodeName: env.NODE_NAME || '',
            nodeIp: env.NODE_IP || '',
            partnerIp: env.PARTNER_IP || '',
            database: env.POSTGRES_DB || ''
        };

        const running = !!inspectData?.State?.Running;
        const containerId = inspectData?.Id || '';
        const startedAt = inspectData?.State?.StartedAt || '';
        const workingDir = inspectData?.Config?.Labels?.['com.docker.compose.project.working_dir'] || '';

        if (!running) {
            return {
                ...variant,
                exists: true,
                status: 'stopped',
                running: false,
                containerId,
                startedAt,
                workingDir,
                env,
                role: 'unknown',
                vipHeld: false,
                topology: { nodes: [], degraded: false, message: '' },
                replication: [],
                license: null
            };
        }

        const [roleInfo, vipInfo, topology, replication, license] = await Promise.all([
            probeRole(variant),
            probeVip(variant),
            probeTopology(variant),
            probeReplication(variant),
            probeLicense(variant)
        ]);

        return {
            ...variant,
            exists: true,
            status: 'running',
            running: true,
            containerId,
            startedAt,
            workingDir,
            env,
            role: roleInfo.role,
            writable: roleInfo.writable,
            vipHeld: vipInfo.held,
            vipIface: vipInfo.iface,
            topology,
            replication,
            license
        };
    }

    /** 扫描现场实际存在哪些 HA 容器，用于动态注册。 */
    async function discover() {
        const found = [];
        for (const variant of listHaVariants()) {
            const inspectData = await inspectContainer(variant.containerName);
            if (inspectData) found.push(variant.id);
        }
        return found;
    }

    return {
        discover,
        probe,
        inspectContainer,
        readContainerEnv
    };
}

module.exports = {
    HA_VARIANTS,
    createHaProbe,
    getHaVariant,
    isHaServiceId,
    listHaVariants,
    parseHighgoLicense,
    parseRepmgrClusterShow,
    parseReplicationRows,
    parseVipPresence
};
