const fs = require('fs');
const path = require('path');

/* tier 分类用于 Cloud-Console UI (C 方案 阶段 4): 服务卡片着色 + Segmented 过滤
   分类标准:
   - business: 业务主服务 (iotcloud / iotedge / wechat 等业务相关网关)
   - storage:  持久化存储 (postgres / cassandra)
   - cache:    缓存 (redis)
   - queue:    消息/协调 (kafka / zookeeper)
   - monitor:  监控 (netdata) */
const SERVICE_DEFINITIONS = {
    postgres: {
        id: 'postgres',
        label: 'PostgreSQL',
        composePath: 'services/postgres/docker-compose.yml',
        composeService: 'postgres',
        order: 10,
        optional: false,
        tier: 'storage'
    },
    redis: {
        id: 'redis',
        label: 'Redis',
        composePath: 'services/redis/docker-compose.yml',
        composeService: 'redis',
        order: 20,
        optional: true,
        tier: 'cache'
    },
    cassandra: {
        id: 'cassandra',
        label: 'Cassandra',
        composePath: 'services/cassandra/docker-compose.yml',
        composeService: 'cassandra',
        order: 30,
        optional: true,
        tier: 'storage'
    },
    kafka: {
        id: 'kafka',
        label: 'Kafka',
        composePath: 'services/kafka/docker-compose.yml',
        composeService: 'kafka',
        order: 40,
        optional: true,
        tier: 'queue'
    },
    netdata: {
        id: 'netdata',
        label: 'Netdata',
        composePath: 'services/netdata/docker-compose.yml',
        composeService: 'netdata',
        order: 50,
        optional: true,
        tier: 'monitor'
    },
    wechat: {
        id: 'wechat',
        label: '企业微信告警',
        composePath: 'services/wechat-messenger-v2.1.0/docker-compose.yml',
        composeService: 'wechat-messenger',
        image: 'wechat-messenger:v2.1.0',
        missingImageMessage: 'ARM64 包未包含 wechat-messenger:v2.1.0，请提供 ARM64 镜像或源码后再启动。',
        order: 60,
        optional: true,
        tier: 'business'
    },
    iotcloud: {
        id: 'iotcloud',
        label: 'IoT Cloud',
        composePath: 'services/iotcloud/docker-compose.yml',
        installComposePath: 'services/iotcloud/docker-compose-install.yml',
        composeService: 'iotcloud',
        appType: 'CLOUD',
        order: 100,
        optional: false,
        tier: 'business'
    },
    iotedge: {
        id: 'iotedge',
        label: 'IoT Edge',
        composePath: 'services/iotedge/docker-compose.yml',
        installComposePath: 'services/iotedge/docker-compose-install.yml',
        composeService: 'iotedge',
        appType: 'EDGE',
        order: 100,
        optional: false,
        tier: 'business'
    }
};

const CLEANUP_SERVICE_DATA_DIRS = {
    postgres: 'services/postgres/data',
    redis: 'services/redis/data',
    kafka: 'services/kafka/kafka_0_data',
    cassandra: 'services/cassandra/cassandra_node1_data'
};

const CLEANUP_SERVICE_DATA_DIR_MODES = {
    kafka: 0o777
};

/* 动态服务：不在交付包里以「一个 compose 文件 + 一个服务名」的形式存在，
   只能按容器名在运行时发现。
   - postgres-ha / highgo-ha：HA 包可解压在任意目录，compose 路径不可知。
   - redis-cluster：compose 由 redis-cluster.sh 按节点数动态生成。
   这些服务只做只读纳管，不提供启停（启停仍走各自交付包的脚本）。 */
const DYNAMIC_SERVICE_DEFINITIONS = {
    'postgres-ha': {
        id: 'postgres-ha',
        label: 'PostgreSQL 双机热备',
        kind: 'ha-cluster',
        readOnly: true,
        order: 11,
        optional: true,
        tier: 'storage',
        conflicts: ['postgres', 'highgo-ha']
    },
    'highgo-ha': {
        id: 'highgo-ha',
        label: '瀚高双机热备',
        kind: 'ha-cluster',
        readOnly: true,
        order: 12,
        optional: true,
        tier: 'storage',
        conflicts: ['postgres', 'postgres-ha']
    },
    'redis-cluster': {
        id: 'redis-cluster',
        label: 'Redis Cluster',
        kind: 'redis-cluster',
        readOnly: true,
        order: 21,
        optional: true,
        tier: 'cache',
        conflicts: ['redis']
    }
};

function isDynamicServiceId(id) {
    return Object.prototype.hasOwnProperty.call(DYNAMIC_SERVICE_DEFINITIONS, id);
}

function createServiceRegistry({ appRoot, appType }) {
    /* 现场实际发现的动态服务 id。为空时行为与改造前完全一致，
       非 HA 现场不会看到任何多余卡片。 */
    let discoveredDynamicIds = [];

    function getPackageServiceId() {
        return appType === 'EDGE' ? 'iotedge' : 'iotcloud';
    }

    function getStaticServiceDefinition(id) {
        const def = SERVICE_DEFINITIONS[id];
        if (!def) return null;
        if (def.appType && def.appType !== appType) return null;

        const composeAbsPath = path.join(appRoot, def.composePath);
        return {
            ...def,
            kind: 'compose',
            composeAbsPath,
            installComposeAbsPath: def.installComposePath ? path.join(appRoot, def.installComposePath) : null,
            exists: fs.existsSync(composeAbsPath)
        };
    }

    function getDynamicServiceDefinition(id) {
        const def = DYNAMIC_SERVICE_DEFINITIONS[id];
        if (!def) return null;
        return {
            ...def,
            composePath: '',
            composeAbsPath: '',
            composeService: '',
            installComposeAbsPath: null,
            // 由发现结果决定，而不是文件系统。
            exists: discoveredDynamicIds.includes(id)
        };
    }

    function getServiceDefinition(id) {
        return getStaticServiceDefinition(id) || getDynamicServiceDefinition(id);
    }

    function listServiceDefinitions() {
        const staticDefs = Object.keys(SERVICE_DEFINITIONS)
            .map(getStaticServiceDefinition)
            .filter(Boolean);
        // 只列出真正发现到的动态服务。
        const dynamicDefs = discoveredDynamicIds
            .map(getDynamicServiceDefinition)
            .filter(Boolean);

        return [...staticDefs, ...dynamicDefs]
            .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    }

    function setDiscoveredDynamicServices(ids) {
        discoveredDynamicIds = (ids || []).filter(isDynamicServiceId);
        return discoveredDynamicIds;
    }

    function listDiscoveredDynamicServices() {
        return [...discoveredDynamicIds];
    }

    /* 与已发现服务冲突的静态服务 id（如现场跑着 postgres-ha 时的 postgres）。
       用于在界面上提示互斥，避免误启动导致端口冲突或双写。 */
    function listConflictingServiceIds() {
        const conflicts = new Set();
        discoveredDynamicIds.forEach(id => {
            (DYNAMIC_SERVICE_DEFINITIONS[id]?.conflicts || []).forEach(target => conflicts.add(target));
        });
        return [...conflicts];
    }

    return {
        cleanupServiceDataDirs: { ...CLEANUP_SERVICE_DATA_DIRS },
        cleanupServiceDataDirModes: { ...CLEANUP_SERVICE_DATA_DIR_MODES },
        getPackageServiceId,
        getServiceDefinition,
        listServiceDefinitions,
        listConflictingServiceIds,
        listDiscoveredDynamicServices,
        setDiscoveredDynamicServices
    };
}

module.exports = {
    CLEANUP_SERVICE_DATA_DIRS,
    CLEANUP_SERVICE_DATA_DIR_MODES,
    DYNAMIC_SERVICE_DEFINITIONS,
    SERVICE_DEFINITIONS,
    createServiceRegistry,
    isDynamicServiceId
};
