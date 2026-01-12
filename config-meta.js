module.exports = {
    // === 全局配置 ===
    "APPTYPE": {
        label: "应用类型 (运行模式)",
        comment: "当前模式由 .env 文件决定，不可更改",
        type: "readonly",
        group: "核心设置",
        default: "CLOUD",
        hidden: true
    },

    // === 核心存储 ===
    "DATABASE_TS_TYPE": {
        label: "历史数据存储类型",
        comment: "选择时序数据的存储引擎 (sql 或 cassandra)",
        type: "select",
        options: ["sql", "cassandra"],
        group: "核心存储",
        required: true
    },
    "DATABASE_TS_LATEST_TYPE": {
        label: "最新数据存储类型",
        comment: "最新数据的存储引擎",
        type: "select",
        options: ["sql", "cassandra", "redis"],
        group: "核心存储",
        required: true
    },

    // === PostgreSQL 配置 ===
    "SPRING_DATASOURCE_URL": {
        label: "PostgreSQL 连接 URL",
        comment: "jdbc:postgresql://host:port/db_name",
        type: "text",
        group: "SQL 数据库",
        required: true
    },
    "SPRING_DATASOURCE_USERNAME": {
        label: "PostgreSQL 用户名",
        type: "text",
        group: "SQL 数据库",
        required: true
    },
    "SPRING_DATASOURCE_PASSWORD": {
        label: "PostgreSQL 密码",
        type: "password",
        group: "SQL 数据库",
        required: true
    },
    "SPRING_DRIVER_CLASS_NAME": {
        label: "数据库驱动",
        type: "text",
        group: "SQL 数据库",
        required: true
    },

    // === Cassandra 配置 ===
    "CASSANDRA_URL": {
        label: "Cassandra 节点地址",
        comment: "host:port",
        type: "text",
        group: "Cassandra",
        required: true,
        dependsOn: { key: ["DATABASE_TS_TYPE", "DATABASE_TS_LATEST_TYPE"], value: "cassandra" }
    },
    "CASSANDRA_KEYSPACE_NAME": {
        label: "Keyspace 名称",
        type: "text",
        group: "Cassandra",
        required: true,
        dependsOn: { key: ["DATABASE_TS_TYPE", "DATABASE_TS_LATEST_TYPE"], value: "cassandra" }
    },
    "CASSANDRA_CLUSTER_NAME": {
        label: "集群名称",
        type: "text",
        group: "Cassandra",
        required: true,
        dependsOn: { key: ["DATABASE_TS_TYPE", "DATABASE_TS_LATEST_TYPE"], value: "cassandra" }
    },
    "CASSANDRA_LOCAL_DATACENTER": {
        label: "数据中心名称",
        type: "text",
        group: "Cassandra",
        required: true,
        dependsOn: { key: ["DATABASE_TS_TYPE", "DATABASE_TS_LATEST_TYPE"], value: "cassandra" }
    },

    // === 缓存 (Redis) ===
    "CACHE_TYPE": {
        label: "缓存类型",
        type: "select",
        options: ["caffeine", "redis"],
        group: "Redis 缓存",
        required: true
    },
    "REDIS_CONNECTION_TYPE": {
        label: "Redis 连接模式",
        type: "select",
        options: ["standalone", "cluster", "sentinel"],
        group: "Redis 缓存",
        default: "standalone",
        required: true,
        dependsOn: { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] }
    },

    // === Redis Standalone 单机模式 ===
    "REDIS_HOST": {
        label: "主机地址",
        type: "text",
        group: "Redis 缓存",
        default: "127.0.0.1",
        required: true,
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] },
                { key: "REDIS_CONNECTION_TYPE", value: "standalone" }
            ]
        }
    },
    "REDIS_PORT": {
        label: "端口",
        type: "number",
        group: "Redis 缓存",
        default: 6379,
        required: true,
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] },
                { key: "REDIS_CONNECTION_TYPE", value: "standalone" }
            ]
        }
    },

    // === Redis Cluster 集群模式 ===
    "REDIS_NODES": {
        label: "集群节点列表",
        comment: "格式: host1:port1,host2:port2",
        type: "text",
        group: "Redis 缓存",
        required: true,
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] },
                { key: "REDIS_CONNECTION_TYPE", value: "cluster" }
            ]
        }
    },
    "REDIS_MAX_REDIRECTS": {
        label: "最大重定向次数",
        type: "number",
        default: 12,
        group: "Redis 缓存",
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] },
                { key: "REDIS_CONNECTION_TYPE", value: "cluster" }
            ]
        }
    },

    // === Redis Sentinel 哨兵模式 ===
    "REDIS_MASTER": {
        label: "哨兵主节点名称",
        type: "text",
        group: "Redis 缓存",
        required: true,
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] },
                { key: "REDIS_CONNECTION_TYPE", value: "sentinel" }
            ]
        }
    },
    "REDIS_SENTINELS": {
        label: "哨兵节点列表",
        comment: "格式: host1:port1,host2:port2",
        type: "text",
        group: "Redis 缓存",
        required: true,
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] },
                { key: "REDIS_CONNECTION_TYPE", value: "sentinel" }
            ]
        }
    },
    "REDIS_SENTINEL_PASSWORD": {
        label: "哨兵密码",
        type: "password",
        group: "Redis 缓存",
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] },
                { key: "REDIS_CONNECTION_TYPE", value: "sentinel" }
            ]
        }
    },

    // === Redis 通用配置 ===
    "REDIS_PASSWORD": {
        label: "Redis 密码",
        type: "password",
        group: "Redis 缓存",
        dependsOn: { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] }
    },
    "REDIS_DB": {
        label: "Redis 库索引",
        type: "number",
        default: 0,
        group: "Redis 缓存",
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] },
                { key: "REDIS_CONNECTION_TYPE", value: "standalone" }
            ]
        }
    },

    // === 消息队列 ===
    "TB_QUEUE_TYPE": {
        label: "消息队列类型",
        type: "select",
        options: ["in-memory", "kafka"],
        group: "消息队列",
        required: true
    },
    "TB_KAFKA_SERVERS": {
        label: "Kafka 服务地址",
        comment: "host:port,host2:port2",
        type: "text",
        group: "消息队列",
        required: true,
        dependsOn: { key: "TB_QUEUE_TYPE", value: "kafka" }
    },

    // === 高级设置 ===
    // === 高级设置 (Cloud 模式) ===
    "TELEMETRY_GRPC_ENABLED": {
        label: "启用遥测 gRPC (Server)",
        type: "select",
        options: ["true", "false"],
        group: "高级设置",
        scope: "cloud",
        dependsOn: { key: "APPTYPE", value: "CLOUD" }
    },
    "TELEMETRY_GRPC_PORT": {
        label: "遥测 gRPC 端口",
        type: "number",
        group: "高级设置",
        scope: "cloud",
        dependsOn: { and: [{ key: "APPTYPE", value: "CLOUD" }, { key: "TELEMETRY_GRPC_ENABLED", value: "true" }] }
    },
    "TELEMETRY_GRPC_MAX_CONNECTIONS": {
        label: "最大连接数",
        type: "number",
        default: 100,
        group: "高级设置",
        scope: "cloud",
        dependsOn: { and: [{ key: "APPTYPE", value: "CLOUD" }, { key: "TELEMETRY_GRPC_ENABLED", value: "true" }] }
    },

    // === Edge gRPC 客户端 (Edge 模式) ===
    "TELEMETRY_GRPC_CLIENT_HOST": {
        label: "遥测 gRPC 服务器地址",
        comment: "Cloud 端 gRPC 服务地址",
        type: "text",
        default: "localhost",
        group: "Edge 连接配置",
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" }
    },
    "TELEMETRY_GRPC_CLIENT_PORT": {
        label: "遥测 gRPC 服务器端口",
        type: "number",
        default: 7071,
        group: "Edge 连接配置",
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" }
    },
    "TELEMETRY_GRPC_CLIENT_SSL_ENABLED": {
        label: "启用遥测 gRPC SSL",
        type: "select",
        options: ["true", "false"],
        group: "Edge 连接配置",
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "false"
    },

    // === 规则引擎脚本 ===
    "TBEL_MAX_TOTAL_ARGS_SIZE": {
        label: "TBEL: 最大参数大小",
        comment: "默认为 100000",
        type: "number",
        group: "规则引擎脚本",
        default: 100000,
        required: true
    },
    "TBEL_MAX_RESULT_SIZE": {
        label: "TBEL: 最大结果大小",
        comment: "默认为 300000",
        type: "number",
        group: "规则引擎脚本",
        default: 300000,
        required: true
    },
    "TBEL_MAX_SCRIPT_BODY_SIZE": {
        label: "TBEL: 最大脚本体大小",
        comment: "默认为 50000",
        type: "number",
        group: "规则引擎脚本",
        default: 50000,
        required: true
    },
    "JS_MAX_TOTAL_ARGS_SIZE": {
        label: "JS: 最大参数大小",
        comment: "默认为 100000",
        type: "number",
        group: "规则引擎脚本",
        default: 100000,
        required: true
    },
    "JS_MAX_RESULT_SIZE": {
        label: "JS: 最大结果大小",
        comment: "默认为 300000",
        type: "number",
        group: "规则引擎脚本",
        default: 300000,
        required: true
    },
    "JS_MAX_SCRIPT_BODY_SIZE": {
        label: "JS: 最大脚本体大小",
        comment: "默认为 50000",
        type: "number",
        group: "规则引擎脚本",
        default: 50000,
        required: true
    },

    // === MQTT 传输 ===
    "NETTY_MAX_PAYLOAD_SIZE": {
        label: "MQTT: 最大载荷 (Bytes)",
        comment: "默认为 65536 (64KB)",
        type: "number",
        group: "MQTT 传输",
        default: 65536,
        required: true
    },
    "MQTT_BIND_PORT": {
        label: "MQTT: 监听端口",
        comment: "默认为 1883",
        type: "number",
        group: "MQTT 传输",
        default: 1883,
        required: true
    },

    // === Edge 连接配置 (仅 Edge 模式) ===
    "CLOUD_ROUTING_KEY": {
        label: "Edge 路由标识 (Routing Key)",
        comment: "Edge 上云的唯一标识 (UUID)",
        type: "text",
        group: "Edge 连接配置",
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        required: true
    },
    "CLOUD_ROUTING_SECRET": {
        label: "Edge 密钥 (Secret)",
        comment: "Edge 上云的验证密钥",
        type: "password",
        group: "Edge 连接配置",
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        required: true
    },
    "CLOUD_RPC_HOST": {
        label: "云端 RPC 主机地址",
        comment: "默认: newcloud.sprixin.com",
        type: "text",
        group: "Edge 连接配置",
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "newcloud.sprixin.com"
    },
    "CLOUD_RPC_PORT": {
        label: "云端 RPC 端口",
        comment: "默认: 7070",
        type: "number",
        group: "Edge 连接配置",
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: 7070
    },
    "CLOUD_RPC_SSL_ENABLED": {
        label: "启用 Cloud RPC SSL",
        type: "select",
        options: ["true", "false"],
        group: "Edge 连接配置",
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "false"
    }
};
