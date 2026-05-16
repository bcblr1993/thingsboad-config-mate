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

function createServiceRegistry({ appRoot, appType }) {
    function getPackageServiceId() {
        return appType === 'EDGE' ? 'iotedge' : 'iotcloud';
    }

    function getServiceDefinition(id) {
        const def = SERVICE_DEFINITIONS[id];
        if (!def) return null;
        if (def.appType && def.appType !== appType) return null;

        const composeAbsPath = path.join(appRoot, def.composePath);
        return {
            ...def,
            composeAbsPath,
            installComposeAbsPath: def.installComposePath ? path.join(appRoot, def.installComposePath) : null,
            exists: fs.existsSync(composeAbsPath)
        };
    }

    function listServiceDefinitions() {
        return Object.keys(SERVICE_DEFINITIONS)
            .map(getServiceDefinition)
            .filter(Boolean)
            .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    }

    return {
        cleanupServiceDataDirs: { ...CLEANUP_SERVICE_DATA_DIRS },
        cleanupServiceDataDirModes: { ...CLEANUP_SERVICE_DATA_DIR_MODES },
        getPackageServiceId,
        getServiceDefinition,
        listServiceDefinitions
    };
}

module.exports = {
    CLEANUP_SERVICE_DATA_DIRS,
    CLEANUP_SERVICE_DATA_DIR_MODES,
    SERVICE_DEFINITIONS,
    createServiceRegistry
};
