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

    // === PostgreSQL 配置 ===
    "SPRING_DATASOURCE_URL": {
        label: "PostgreSQL 连接 URL",
        comment: "格式必须为: jdbc:postgresql://host:port/db_name",
        type: "text",
        group: "SQL 数据库",
        required: true
    },
    "SPRING_DATASOURCE_USERNAME": {
        label: "PostgreSQL 用户名",
        comment: "对应连接数据库的用户名",
        type: "text",
        group: "SQL 数据库",
        required: true
    },
    "SPRING_DATASOURCE_PASSWORD": {
        label: "PostgreSQL 密码",
        comment: "对应连接数据库的密码",
        type: "password",
        group: "SQL 数据库",
        required: true
    },

    // === Edge 连接配置 (基础) ===
    "CLOUD_ROUTING_KEY": {
        label: "Edge 边缘键 (Routing Key)",
        comment: "Edge 上云的边缘键,需要提前在平台创建边缘实例后获取该值",
        type: "text",
        group: "Edge 连接配置",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        required: true
    },
    "CLOUD_ROUTING_SECRET": {
        label: "Edge 边缘密钥 (Secret)",
        comment: "Edge 上云的边缘密钥,需要提前在平台创建边缘实例后获取该值",
        type: "password",
        group: "Edge 连接配置",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        required: true
    },
    "CLOUD_RPC_HOST": {
        label: "Edge 边缘与云端通信 RPC 地址",
        comment: "默认为: newcloud.sprixin.com，外部私有化部署修改为私有化地址",
        type: "text",
        group: "Edge 连接配置",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "newcloud.sprixin.com",
        required: true
    },

    // === 云边通信状态检查 ===
    "CLOUD_CHECK_STATUS_ENABLED": {
        label: "启用通信状态检查",
        comment: "该功能需保持开启状态",
        type: "readonly",
        default: "true",
        group: "云边通信状态检查",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        required: true
    },
    "CLOUD_CHECK_STATUS_BASE_URL": {
        label: "云边通信状态检查 Base URL",
        comment: "https://newcloud.sprixin.com/ 默认为公司云平台地址，外部私有化部署修改为私有化地址",
        type: "text",
        group: "云边通信状态检查",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "https://newcloud.sprixin.com/",
        required: true
    },
    "CLOUD_CHECK_STATUS_TENANT_USERNAME": {
        label: "状态检查租户账号",
        comment: "默认为: cloud@sprixin.com，此账号需要在云平台创建",
        type: "text",
        group: "云边通信状态检查",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "cloud@sprixin.com",
        required: true
    },
    "CLOUD_CHECK_STATUS_TENANT_PASSWORD": {
        label: "状态检查租户密码",
        comment: "默认为: eBrfmK0W5tFciz，此密码需要在云平台创建",
        type: "password",
        group: "云边通信状态检查",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "eBrfmK0W5tFciz",
        required: true
    },
    "CLOUD_CHECK_STATUS_PERIOD_MIN": {
        label: "状态检查周期 (分)",
        comment: "默认为: 10,单位为分钟",
        type: "number",
        group: "云边通信状态检查",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: 10,
        required: true
    },

    // === 离线恢复策略调优 ===
    "EDGES_STORAGE_HISTORY_STATUS": {
        label: "是否启用离线恢复后实时遥测数据优先功能【断点续传】",
        comment: "启用该功能后，网络恢复时系统将采用“实时数据优先”策略：优先上送网络恢复后的最新数据，中断期间的历史数据以低优先级顺序补传。未启用该功能时，系统将按时间顺序补传中断期间的历史数据，直到数据同步至当前。注意: 未使用 kafka 时历史数据需在实时数据空闲时自动上送，使用 kafka 时根据 EDGES_STORAGE_KAFKA_BACKFILL_THRESHOLD_MS 参数指定的空闲时间上送",
        type: "select",
        options: ["true", "false"],
        group: "离线恢复策略",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "true"
    },
    "EDGES_STORAGE_MAX_READ_HISTORY_COUNT": {
        label: "历史数据上送条数",
        comment: "启用离线恢复后实时遥测数据优先（断点续传）功能时，历史数据单次上送条数默认为 50 条，值越大恢复越快，但会增加内存和网络开销，过大可能影响实时数据以及系统稳定性，建议谨慎调整。最大不建议超过 1000",
        type: "number",
        group: "离线恢复策略",
        dependsOn: {
            and: [
                { key: "APPTYPE", value: "EDGE" },
                { key: "EDGES_STORAGE_HISTORY_STATUS", value: "true" }
            ]
        },
        default: 50
    },

    "EDGES_STORAGE_KAFKA_BACKFILL_THRESHOLD_MS": {
        label: "历史数据上送策略",
        comment: "仅当使用 kafka 时生效。回填历史数据的间隔时间，每次上送完一批数据后，休眠该时长再继续下一轮回填。单位：毫秒，默认 1000 ms（1 秒）。",
        type: "number",
        group: "离线恢复策略",
        dependsOn: {
            and: [
                { key: "APPTYPE", value: "EDGE" },
                { key: "TB_QUEUE_TYPE", value: "kafka" },
                { key: "EDGES_STORAGE_HISTORY_STATUS", value: "true" }
            ]
        },
        default: 1000
    },



    // === 遥测分离配置 (Edge) ===
    "TELEMETRY_SEPARATION_ENABLED": {
        label: "使用启用遥测分离",
        comment: "是否开启遥测分离该功能为面向大容量边缘数据上云场景的增强特性。启用后，遥测数据将通过独立通道进行上送，需确保云端已开放 7071 GRPC 端口。一般仅在遥测数据上云量超过 10 万点/秒 的场景下建议开启；对于常规项目或无大容量上云需求的场景，不建议启用该配置。",
        type: "select",
        options: ["true", "false"],
        group: "Edge 遥测分离",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "false"
    },
    "TELEMETRY_GRPC_CLIENT_HOST": {
        label: "云平台遥测分离 GRPC 地址",
        comment: "默认为: newcloud.sprixin.com，外部私有化部署修改为私有化地址",
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

    "TB_QUEUE_TELEMETRY_TS_KV_CLOUD_EVENT_PARTITIONS": {
        label: "遥测分离队列分区数",
        comment: "配置该参数后，遥测数据将按照指定的队列分区数量进行并行上送，默认值为 2。例如，在 10 万条/秒的数据量场景下，启用遥测分离配置并保持默认值 2 时，每个队列分区约承担 5 万条/秒的数据上送。该参数可根据现场实际负载情况进行动态调整，数值越大表示并行处理能力越强、可支持的数据量越大，但同时对服务器的 CPU、内存和网络资源要求也越高。",
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
        comment: "选择时序数据的存储引擎 (sql 或 cassandra) 注意: sql 方式只能在 2.6w/s 点的项目使用，超过 2.6w/s 点的项目请使用 cassandra",
        type: "select",
        options: ["sql", "cassandra"],
        group: "核心存储",
        required: true
    },
    "DATABASE_TS_LATEST_TYPE": {
        label: "最新数据存储类型",
        comment: "最新数据的存储引擎，注意: pg 方式只能在 2.6w/s 点的项目使用，redis 方式只能在 6w/s 项目使用，超过以上请使用 redis-cluster , 注意: cassandra 目前不推荐",
        type: "select",
        options: ["sql", "cassandra", "redis", "redis-cluster"],
        group: "核心存储",
        required: true
    },
    "SQL_TTL_TS_EXECUTION_INTERVAL": {
        label: "PG 历史数据清理检测间隔时间",
        comment: "该参数用于配置历史数据清理任务的执行周期，单位为毫秒，默认值为 7,200,000 ms（2 小时）。",
        type: "number",
        default: 7200000,
        group: "核心存储",
        dependsOn: { key: "DATABASE_TS_TYPE", value: "sql" }
    },
    "SQL_TTL_TS_TS_KEY_VALUE_TTL": {
        label: "PG 历史数据保留时间",
        comment: "该参数用于配置历史数据的保留时间，单位为秒。  0 表示记录永不过期。默认值为: 259200 (3天)",
        type: "number",
        default: 259200,
        group: "核心存储",
        dependsOn: { key: "DATABASE_TS_TYPE", value: "sql" }
    },


    // === Cassandra 配置 ===

    "CASSANDRA_URL": {
        label: "Cassandra 集群节点的地址",
        comment: "Cassandra 集群节点的地址，多个节点用逗号分隔。",
        type: "text",
        group: "Cassandra",
        required: true,
        dependsOn: { key: ["DATABASE_TS_TYPE", "DATABASE_TS_LATEST_TYPE"], value: "cassandra" }
    },
    "CASSANDRA_KEYSPACE_NAME": {
        label: "Cassandra Keyspace 名称",
        comment: "Cassandra Keyspace 名称, 默认为: thingsboard，使用其他名称请确保该名称已创建",
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
        hidden: true,
        dependsOn: { key: ["DATABASE_TS_TYPE", "DATABASE_TS_LATEST_TYPE"], value: "cassandra" }
    },
    "CASSANDRA_USERNAME": {
        label: "Cassandra 用户名",
        type: "text",
        group: "Cassandra",
        hidden: true,
        dependsOn: { key: ["DATABASE_TS_TYPE", "DATABASE_TS_LATEST_TYPE"], value: "cassandra" }
    },
    "CASSANDRA_PASSWORD": {
        label: "Cassandra 密码",
        type: "password",
        group: "Cassandra",
        hidden: true,
        dependsOn: { key: ["DATABASE_TS_TYPE", "DATABASE_TS_LATEST_TYPE"], value: "cassandra" }
    },
    "TS_KV_TTL": {
        label: "Cassandra 历史数据保留时间",
        comment: "单位: 秒。0 表示永不过期",
        type: "number",
        default: 0,
        min: 0,
        group: "Cassandra",
        dependsOn: { key: ["DATABASE_TS_TYPE"], value: "cassandra" }
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
        dependsOn: { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis-cluster" }] }
    },

    // === Redis Standalone 单机模式 ===
    "REDIS_HOST": {
        label: "Redis 主机地址",
        comment: "Redis 主机地址",
        type: "text",
        group: "缓存配置",
        default: "127.0.0.1",
        required: true,
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis-cluster" }] },
                { key: "REDIS_CONNECTION_TYPE", value: "standalone" }
            ]
        }
    },
    "REDIS_PORT": {
        label: "Redis 端口",
        comment: "Redis 端口，默认值为 6379",
        type: "number",
        group: "缓存配置",
        default: 6379,
        required: true,
        min: 1,
        max: 65535,
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis-cluster" }] },
                { key: "REDIS_CONNECTION_TYPE", value: "standalone" }
            ]
        }
    },

    // === Redis Cluster 集群模式 ===
    "REDIS_NODES": {
        label: "Redis 集群节点列表",
        comment: "Redis 集群节点列表，多个节点用逗号分隔，格式: host1:port1,host2:port2",
        type: "text",
        group: "缓存配置",
        required: true,
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis-cluster" }] },
                { key: "REDIS_CONNECTION_TYPE", value: "cluster" }
            ]
        }
    },

    // === Redis 通用配置 ===
    "REDIS_PASSWORD": {
        label: "Redis 密码",
        comment: "Redis 密码，为空则不使用密码",
        type: "password",
        group: "缓存配置",
        dependsOn: { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis-cluster" }] }
    },
    "REDIS_DB": {
        label: "Redis 库索引",
        comment: "Redis 库索引，默认为 0，范围为 0-15",
        type: "number",
        default: 0,
        group: "缓存配置",
        dependsOn: {
            and: [
                { or: [{ key: "CACHE_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis" }, { key: "DATABASE_TS_LATEST_TYPE", value: "redis-cluster" }] },
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
        required: true,
        min: 1,
        max: 9007199254740991
    },
    "TBEL_MAX_RESULT_SIZE": {
        label: "TBEL: 最大结果大小",
        comment: "默认为 300000",
        type: "number",
        group: "规则引擎脚本",
        default: 300000,
        required: true,
        min: 1,
        max: 9007199254740991
    },
    "TBEL_MAX_SCRIPT_BODY_SIZE": {
        label: "TBEL: 最大脚本体大小",
        comment: "默认为 50000",
        type: "number",
        group: "规则引擎脚本",
        default: 50000,
        required: true,
        min: 1,
        max: 9007199254740991
    },
    "JS_MAX_TOTAL_ARGS_SIZE": {
        label: "JS: 最大参数大小",
        comment: "默认为 100000",
        type: "number",
        group: "规则引擎脚本",
        default: 100000,
        required: true,
        min: 1,
        max: 9007199254740991
    },
    "JS_MAX_RESULT_SIZE": {
        label: "JS: 最大结果大小",
        comment: "默认为 300000",
        type: "number",
        group: "规则引擎脚本",
        default: 300000,
        required: true,
        min: 1,
        max: 9007199254740991
    },
    "JS_MAX_SCRIPT_BODY_SIZE": {
        label: "JS: 最大脚本体大小",
        comment: "默认为 50000",
        type: "number",
        group: "规则引擎脚本",
        default: 50000,
        required: true,
        min: 1,
        max: 9007199254740991
    },

    // === 消息队列 ===
    "TB_QUEUE_TYPE": {
        label: "队列类型 (Queue Type)",
        comment: "队列类型，in-memory 为内存队列，使用 in-memory 内存队列上云事件表使用 PG 进行存储，使用 kafka 为 Kafka 队列，使用 kafka 队列主题进行存储",
        type: "select",
        options: ["kafka", "in-memory"],
        group: "消息队列",
        default: "in-memory",
        required: true
    },
    "TB_KAFKA_SERVERS": {
        label: "Kafka 服务器地址",
        comment: "Kafka 服务器地址，多个地址用逗号分隔，格式: host1:port1,host2:port2",
        type: "text",
        group: "消息队列",
        required: true,
        dependsOn: { key: "TB_QUEUE_TYPE", value: "kafka" }
    },

    "SQL_TTL_CLOUD_EVENTS_EXECUTION_INTERVAL": {
        label: "PG 上云事件表清理检测间隔时间",
        comment: "PG 上云事件表清理检测间隔时间，单位为毫秒。默认值为 7200000 毫秒，(2 小时)。注意: 仅在 TB_QUEUE_TYPE 为 in-memory 时生效",
        type: "number",
        default: 7200000,
        group: "消息队列",
        dependsOn: { key: "TB_QUEUE_TYPE", value: "in-memory" }
    },
    "SQL_TTL_CLOUD_EVENTS_TTL": {
        label: " PG 上云事件表保留时间",
        comment: "PG 上云事件表保留时间，单位为秒。默认值为 259200 秒，(3 天)。注意: 仅在 TB_QUEUE_TYPE 为 in-memory 时生效",
        type: "number",
        default: 259200,
        group: "消息队列",
        dependsOn: { key: "TB_QUEUE_TYPE", value: "in-memory" }
    },
    "TB_QUEUE_KAFKA_CLOUD_EVENT_MAX_POLL_RECORDS": {
        label: "上云通用事件(Cloud_Event)最大拉取数",
        comment: "上云通用事件(Cloud_Event)最大拉取数，单位为条。默认值为 100。注意: 仅在 TB_QUEUE_TYPE 为 kafka 时生效",
        type: "number",
        default: 100,
        group: "消息队列",
        dependsOn: { key: "TB_QUEUE_TYPE", value: "kafka" }
    },
    "TB_QUEUE_KAFKA_CLOUD_EVENT_TS_MAX_POLL_RECORDS": {
        label: "上云遥测事件(TS_KV_Cloud_Event)最大拉取数",
        comment: "上云遥测事件(TS_KV_Cloud_Event)最大拉取数，单位为条。默认值为 200。注意: 仅在 TB_QUEUE_TYPE 为 kafka 时生效",
        type: "number",
        default: 200,
        group: "消息队列",
        dependsOn: { key: "TB_QUEUE_TYPE", value: "kafka" }
    },
    "TB_QUEUE_KAFKA_TELEMETRY_TS_KV_CLOUD_EVENT_MAX_POLL_RECORDS": {
        label: "开启遥测分离时，遥测分离的上云事件最大拉取数",
        comment: "开启遥测分离时，遥测分离上云事件(Telemetry_Ts_Kv_Cloud_Event)最大拉取数，单位为条。默认值为 200。注意: 仅在 TB_QUEUE_TYPE 为 kafka 时生效",
        type: "number",
        default: 200,
        group: "消息队列",
        dependsOn: {
            and: [
                { key: "TB_QUEUE_TYPE", value: "kafka" },
                { key: "TELEMETRY_SEPARATION_ENABLED", value: "true" }
            ]
        }
    },

    // === MQTT 传输 ===
    "MQTT_BIND_PORT": {
        label: "MQTT: 监听端口",
        comment: "默认 1883。⚠️ 修改后需同步更新 docker-compose.yml 端口映射",
        type: "number",
        group: "MQTT 传输",
        default: 1883,
        required: true,
        min: 1,
        max: 65535
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
