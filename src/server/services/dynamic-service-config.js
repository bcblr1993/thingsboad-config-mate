/**
 * 动态服务（HA 集群 / Redis Cluster）的只读详情。
 *
 * 静态服务的详情来自解析 compose 文件（compose-config.js），但动态服务
 * 没有可知的 compose 路径，因此详情全部由运行时探测结果构建：
 * 配置取自 `docker inspect` 的 Config.Env（即容器实际生效的值）。
 */

const { isSensitiveComposeKey } = require('./compose-config');

/* HA 容器环境变量里与运维无关的噪声，不在详情里展示。 */
const HIDDEN_HA_ENV_PREFIXES = ['PATH', 'LANG', 'LC_', 'HOME', 'HOSTNAME', 'PWD', 'GOSU_', 'PG_MAJOR', 'PG_VERSION', 'TERM'];

function configItem(key, value, sensitive = false) {
    return {
        key,
        value: value === null || value === undefined ? '' : String(value),
        sensitive: !!sensitive
    };
}

function isNoiseEnvKey(key) {
    return HIDDEN_HA_ENV_PREFIXES.some(prefix => key === prefix || key.startsWith(prefix));
}

function roleLabel(role) {
    if (role === 'primary') return '主节点 (PRIMARY)';
    if (role === 'standby') return '备节点 (STANDBY)';
    return '未知';
}

function formatLagBytes(bytes) {
    if (!Number.isFinite(bytes)) return '未知';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function buildHaOverviewSection(status) {
    const items = [
        configItem('本机角色', roleLabel(status.role)),
        configItem('VIP', status.vip || '未配置'),
        configItem('VIP 是否在本机', status.vipHeld ? `是（网卡 ${status.vipIface || '未知'}）` : '否'),
        configItem('数据库可写', status.writable ? '是' : '否'),
        configItem('业务数据库', status.database || ''),
        configItem('数据库端口', status.port || ''),
        configItem('本机节点名', status.nodeName || ''),
        configItem('本机 IP', status.nodeIp || ''),
        configItem('对端 IP', status.partnerIp || '')
    ];
    return { title: '集群概览', items };
}

function buildHaTopologySection(status) {
    const nodes = status.topology?.nodes || [];
    if (nodes.length === 0) {
        return {
            title: '集群拓扑',
            items: [configItem('状态', status.topology?.message || '未能读取 repmgr 拓扑，请检查对端连通性。')]
        };
    }

    /* 判断「本机」必须用容器自己的 NODE_NAME，不能用 repmgr 的 * 标记：
       * 标记的是本次查询所连接的节点，在备节点上执行 cluster show 时，
       repmgr 连接的仍然是主库，* 会落在主节点上。 */
    const localName = status.nodeName || '';
    const items = nodes.map(node => configItem(
        `${node.name}${localName && node.name === localName ? '（本机）' : ''}`,
        [
            node.role === 'primary' ? 'primary' : node.role,
            node.status,
            node.reachable === false ? '不可达' : '',
            node.upstream ? `upstream=${node.upstream}` : ''
        ].filter(Boolean).join(' · ')
    ));

    if (status.topology?.degraded) {
        items.push(configItem('提示', 'repmgr 报告部分节点不可达，请确认两台机器网络互通。'));
    }
    return { title: '集群拓扑', items };
}

function buildHaReplicationSection(status) {
    const rows = status.replication || [];
    if (rows.length === 0) {
        const hint = status.role === 'standby'
            ? '本机为备节点，复制状态请在主节点查看。'
            : '当前没有备节点连接到本机。';
        return { title: '流复制', items: [configItem('状态', hint)] };
    }

    return {
        title: '流复制',
        items: rows.map(row => configItem(
            row.applicationName,
            `${row.state} · ${row.syncState} · 延迟 ${formatLagBytes(row.lagBytes)}`
        ))
    };
}

function buildLicenseSection(status) {
    const license = status.license;
    if (!license) return null;

    if (license.status === 'unavailable') {
        return { title: 'License', items: [configItem('状态', license.message)] };
    }

    const items = [
        configItem('状态', license.status || '未知'),
        configItem('类型', license.mode || '未知'),
        configItem('数据库到期日', license.expiry || '未标注')
    ];

    if (license.daysRemaining !== null) {
        const remaining = license.daysRemaining;
        items.push(configItem(
            '剩余天数',
            remaining < 0 ? `已过期 ${Math.abs(remaining)} 天` : `${remaining} 天`
        ));
    }

    (license.products || []).forEach(product => {
        items.push(configItem(`授权 · ${product.product}`, `${product.version}${product.expiry ? ` · 到期 ${product.expiry}` : ' · 无期限'}`));
    });

    return { title: 'License', items };
}

function buildHaEnvSection(status) {
    const env = status.env || {};
    const items = Object.keys(env)
        .filter(key => !isNoiseEnvKey(key))
        .sort()
        .map(key => configItem(key, env[key], isSensitiveComposeKey(key)));

    return {
        title: '容器生效配置',
        items: items.length ? items : [configItem('环境变量', '无')]
    };
}

function buildHaRuntimeSection(status) {
    return {
        title: '运行信息',
        items: [
            configItem('容器名', status.containerName || ''),
            configItem('容器 ID', (status.containerId || '').slice(0, 12)),
            configItem('启动时间', status.startedAt || ''),
            configItem('交付包目录', status.workingDir || '未能从 compose 标签读取')
        ]
    };
}

function buildHaConfig(def, status) {
    const sections = [];

    sections.push({
        title: '说明',
        items: [
            configItem('纳管方式', '只读纳管：Config Mate 不修改 HA 配置，也不提供启停'),
            configItem('启停与切换', '请使用该 HA 交付包中的 ./start.sh 与 ./ops.sh'),
            configItem('配置修改', '编辑 HA 交付包的 .env 后重启对应节点生效')
        ]
    });

    if (!status.running) {
        sections.push({
            title: '当前状态',
            items: [configItem('容器状态', status.status === 'missing' ? '未部署' : '已停止')]
        });
        return { sections };
    }

    sections.push(buildHaOverviewSection(status));
    sections.push(buildHaTopologySection(status));
    sections.push(buildHaReplicationSection(status));

    const licenseSection = buildLicenseSection(status);
    if (licenseSection) sections.push(licenseSection);

    sections.push(buildHaEnvSection(status));
    sections.push(buildHaRuntimeSection(status));
    return { sections };
}

function buildRedisClusterConfig(def, status) {
    const sections = [{
        title: '说明',
        items: [
            configItem('纳管方式', '只读纳管：compose 由 redis-cluster.sh 动态生成'),
            configItem('启停与扩缩', '请使用 services/redis-cluster/redis-cluster.sh')
        ]
    }];

    if (!status.exists) {
        sections.push({ title: '当前状态', items: [configItem('集群', '未部署')] });
        return { sections };
    }

    sections.push({
        title: '集群概览',
        items: [
            configItem('节点总数', status.nodeCount || 0),
            configItem('运行中节点', status.runningCount || 0),
            configItem('集群状态', status.clusterState || '未知'),
            configItem('已分配槽位', status.slotsAssigned || '未知'),
            configItem('已知节点数', status.knownNodes || '未知'),
            configItem('分片数', status.clusterSize || '未知')
        ]
    });

    sections.push({
        title: '容器节点',
        items: (status.nodes || []).map(node => configItem(
            node.container,
            `${node.running ? '运行中' : '已停止'}${node.port ? ` · 端口 ${node.port}` : ''}`
        ))
    });

    if ((status.clusterNodes || []).length > 0) {
        sections.push({
            title: '集群成员',
            items: status.clusterNodes.map(node => configItem(
                `${node.address}${node.myself ? '（本机）' : ''}`,
                [node.role, node.linkState, node.slots].filter(Boolean).join(' · ')
            ))
        });
    }

    return { sections };
}

function createDynamicServiceConfigBuilder({ getServiceDefinition, getServiceStatus }) {
    async function buildDynamicServiceConfig(serviceId) {
        const def = getServiceDefinition(serviceId);
        if (!def) return { status: 'error', message: 'Unknown service' };
        if (!def.kind || def.kind === 'compose') return null;

        const status = await getServiceStatus(def);
        const built = def.kind === 'ha-cluster'
            ? buildHaConfig(def, status)
            : buildRedisClusterConfig(def, status);

        return {
            status: 'success',
            service: { id: def.id, label: def.label },
            composePath: '',
            readOnly: true,
            summary: {
                image: '',
                containerName: status.containerName || '',
                restart: ''
            },
            sections: built.sections
        };
    }

    return { buildDynamicServiceConfig };
}

module.exports = {
    buildHaConfig,
    buildRedisClusterConfig,
    createDynamicServiceConfigBuilder,
    formatLagBytes,
    roleLabel
};
