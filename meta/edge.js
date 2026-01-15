module.exports = {
    // === 全局配置 ===
    "APPTYPE": {
        label: "应用类型 (运行模式)",
        comment: "当前模式由 .env 文件决定",
        type: "readonly",
        group: "核心设置",
        default: "EDGE",
        hidden: true
    },

    // === Edge 连接配置 (基础) ===
    "CLOUD_ROUTING_KEY": {
        label: "Edge 路由标识 (Routing Key)",
        comment: "Edge 上云的唯一标识 (UUID)",
        type: "text",
        group: "Edge 连接配置",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        required: true
    },
    "CLOUD_ROUTING_SECRET": {
        label: "Edge 密钥 (Secret)",
        comment: "Edge 上云的验证密钥",
        type: "password",
        group: "Edge 连接配置",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        required: true
    },
    "CLOUD_RPC_HOST": {
        label: "云端 RPC 主机地址",
        comment: "默认: newcloud.sprixin.com",
        type: "text",
        group: "Edge 连接配置",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "newcloud.sprixin.com"
    },

    // === Edge 状态检查 ===
    "CLOUD_CHECK_STATUS_BASE_URL": {
        label: "状态检查 Base URL",
        comment: "默认: https://newcloud.sprixin.com/",
        type: "text",
        group: "Edge 状态检查",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "https://newcloud.sprixin.com/"
    },
    "CLOUD_CHECK_STATUS_TENANT_USERNAME": {
        label: "状态检查租户账号",
        type: "text",
        group: "Edge 状态检查",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "cloud@sprixin.com"
    },
    "CLOUD_CHECK_STATUS_TENANT_PASSWORD": {
        label: "状态检查租户密码",
        type: "password",
        group: "Edge 状态检查",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "eBrfmK0W5tFciz"
    },
    "CLOUD_CHECK_STATUS_PERIOD_MIN": {
        label: "状态检查周期 (分)",
        type: "number",
        group: "Edge 状态检查",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: 10
    },

    // === Edge 存储与队列调优 ===
    "EDGES_STORAGE_HISTORY_STATUS": {
        label: "启用实时优先 (History Status)",
        comment: "开启时网络恢复后优先上送实时数据",
        type: "select",
        options: ["true", "false"],
        group: "Edge 存储与队列",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "true"
    },
    "EDGES_STORAGE_MAX_READ_HISTORY_COUNT": {
        label: "历史数据每次上送条数",
        type: "number",
        group: "Edge 存储与队列",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: 50
    },
    "EDGES_STORAGE_REALTIME_LAG_THRESHOLD_MS": {
        label: "实时数据延迟阈值 (ms)",
        comment: "仅在 TB_QUEUE_TYPE 为 caffeine 时生效",
        type: "number",
        group: "Edge 存储与队列",
        dependsOn: {
            and: [
                { key: "APPTYPE", value: "EDGE" },
                { key: "TB_QUEUE_TYPE", value: "caffeine" }
            ]
        },
        default: 180000
    },
    "EDGES_STORAGE_KAFKA_BACKFILL_THRESHOLD_MS": {
        label: "Kafka 回填历史间隔 (ms)",
        comment: "仅在 TB_QUEUE_TYPE 为 kafka 时生效",
        type: "number",
        group: "Edge 存储与队列",
        dependsOn: {
            and: [
                { key: "APPTYPE", value: "EDGE" },
                { key: "TB_QUEUE_TYPE", value: "kafka" }
            ]
        },
        default: 1000
    },

    // === 遥测分离配置 (Edge) ===
    "TELEMETRY_SEPARATION_ENABLED": {
        label: "启用遥测读写分离",
        comment: "开启后将使用独立 gRPC 通道传输遥测数据",
        type: "select",
        options: ["true", "false"],
        group: "Edge 遥测分离",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "false"
    },
    "TELEMETRY_GRPC_CLIENT_HOST": {
        label: "遥测 gRPC 主机地址",
        type: "text",
        group: "Edge 遥测分离",
        dependsOn: {
            and: [
                { key: "APPTYPE", value: "EDGE" },
                { key: "TELEMETRY_SEPARATION_ENABLED", value: "true" }
            ]
        },
        default: "localhost"
    },
    "TB_QUEUE_KAFKA_TELEMETRY_TS_KV_CLOUD_EVENT_MAX_POLL_RECORDS": {
        label: "遥测分离拉取条数",
        type: "number",
        group: "Edge 遥测分离",
        dependsOn: {
            and: [
                { key: "APPTYPE", value: "EDGE" },
                { key: "TELEMETRY_SEPARATION_ENABLED", value: "true" },
                { key: "TB_QUEUE_TYPE", value: "kafka" }
            ]
        }
    },
    "TB_QUEUE_TELEMETRY_TS_KV_CLOUD_EVENT_PARTITIONS": {
        label: "遥测分离队列分区数",
        type: "number",
        group: "Edge 遥测分离",
        dependsOn: {
            and: [
                { key: "APPTYPE", value: "EDGE" },
                { key: "TELEMETRY_SEPARATION_ENABLED", value: "true" },
                { key: "TB_QUEUE_TYPE", value: "kafka" }
            ]
        }
    },

    // === 核心设置 ===


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
    "TS_KV_TTL": {
        label: "系统数据过期时间 (TTL)",
        comment: "单位: 秒。0 表示永不过期 (仅 Cassandra)",
        type: "number",
        default: 0,
        group: "核心存储",
        dependsOn: { key: ["DATABASE_TS_TYPE", "DATABASE_TS_LATEST_TYPE"], value: "cassandra" }
    },
    "SQL_TTL_TS_EXECUTION_INTERVAL": {
        label: "时序数据清理间隔 (ms)",
        comment: "默认 7200000 (2小时)",
        type: "number",
        default: 7200000,
        group: "核心存储"
    },
    "SQL_TTL_TS_TS_KEY_VALUE_TTL": {
        label: "时序数据保留时间 (秒)",
        comment: "默认 0 (永久)，建议 2592000 (30天)",
        type: "number",
        default: 0,
        group: "核心存储"
    },
    "SQL_TTL_CLOUD_EVENTS_EXECUTION_INTERVAL": {
        label: "云事件清理间隔 (ms)",
        type: "number",
        default: 7200000,
        group: "核心存储"
    },
    "SQL_TTL_CLOUD_EVENTS_TTL": {
        label: "云事件保留时间 (秒)",
        type: "number",
        default: 259200,
        group: "核心存储"
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
    "CASSANDRA_USERNAME": {
        label: "Cassandra 用户名",
        type: "text",
        group: "Cassandra",
        dependsOn: { key: ["DATABASE_TS_TYPE", "DATABASE_TS_LATEST_TYPE"], value: "cassandra" }
    },
    "CASSANDRA_PASSWORD": {
        label: "Cassandra 密码",
        type: "password",
        group: "Cassandra",
        dependsOn: { key: ["DATABASE_TS_TYPE", "DATABASE_TS_LATEST_TYPE"], value: "cassandra" }
    },

    // === 缓存 (Redis) ===
    "CACHE_TYPE": {
        label: "缓存类型",
        type: "select",
        options: ["caffeine", "redis"],
        group: "缓存配置",
        required: true
    },
    "REDIS_CONNECTION_TYPE": {
        label: "Redis 连接模式",
        type: "select",
        options: ["standalone", "cluster"],
        group: "缓存配置",
        default: "standalone",
        required: true,
        dependsOn: { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] }
    },

    // === Redis Standalone 单机模式 ===
    "REDIS_HOST": {
        label: "主机地址",
        type: "text",
        group: "缓存配置",
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
        group: "缓存配置",
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
        group: "缓存配置",
        required: true,
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] },
                { key: "REDIS_CONNECTION_TYPE", value: "cluster" }
            ]
        }
    },

    // === Redis 通用配置 ===
    "REDIS_PASSWORD": {
        label: "Redis 密码",
        type: "password",
        group: "缓存配置",
        dependsOn: { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] }
    },
    "REDIS_DB": {
        label: "Redis 库索引",
        type: "number",
        default: 0,
        group: "缓存配置",
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }] },
                { key: "REDIS_CONNECTION_TYPE", value: "standalone" }
            ]
        }
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

    // === 消息队列 ===
    "TB_QUEUE_TYPE": {
        label: "队列类型 (Queue Type)",
        type: "select",
        options: ["kafka", "in-memory"],
        group: "消息队列",
        default: "in-memory",
        required: true
    },
    "TB_KAFKA_SERVERS": {
        label: "Kafka 服务器地址",
        comment: "host1:port1,host2:port2",
        type: "text",
        group: "消息队列",
        required: true,
        dependsOn: { key: "TB_QUEUE_TYPE", value: "kafka" }
    },
    "TB_QUEUE_KAFKA_CLOUD_EVENT_MAX_POLL_RECORDS": {
        label: "Cloud Event 队列拉取条数",
        type: "number",
        group: "消息队列",
        default: 100,
        dependsOn: { key: "TB_QUEUE_TYPE", value: "kafka" }
    },

    // === MQTT 传输 ===
    "MQTT_BIND_PORT": {
        label: "MQTT: 监听端口",
        comment: "默认为 1883",
        type: "number",
        group: "MQTT 传输",
        default: 1883,
        required: true
    },
    "NETTY_MAX_PAYLOAD_SIZE": {
        label: "MQTT: 最大载荷 (Bytes)",
        comment: "默认为 65536 (64KB)",
        type: "number",
        group: "MQTT 传输",
        default: 65536,
        required: true
    },
    // === 高级设置 ===
    "SWAGGER_ENABLED": {
        label: "启用 Swagger 文档",
        type: "select",
        options: ["true", "false"],
        default: "false",
        group: "高级设置"
    },
};
