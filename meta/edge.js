module.exports = {
    // === Edge 连接配置 (基础) ===
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

    // === Edge 状态检查 ===
    "CLOUD_CHECK_STATUS_BASE_URL": {
        label: "状态检查 Base URL",
        comment: "默认: https://newcloud.sprixin.com/",
        type: "text",
        group: "Edge 状态检查",
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "https://newcloud.sprixin.com/"
    },
    "CLOUD_CHECK_STATUS_TENANT_USERNAME": {
        label: "状态检查租户账号",
        type: "text",
        group: "Edge 状态检查",
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "cloud@sprixin.com"
    },
    "CLOUD_CHECK_STATUS_TENANT_PASSWORD": {
        label: "状态检查租户密码",
        type: "password",
        group: "Edge 状态检查",
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "eBrfmK0W5tFciz"
    },
    "CLOUD_CHECK_STATUS_PERIOD_MIN": {
        label: "状态检查周期 (分)",
        type: "number",
        group: "Edge 状态检查",
        scope: "edge",
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
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "true"
    },
    "EDGES_STORAGE_MAX_READ_HISTORY_COUNT": {
        label: "历史数据每次上送条数",
        type: "number",
        group: "Edge 存储与队列",
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: 50
    },
    "EDGES_STORAGE_REALTIME_LAG_THRESHOLD_MS": {
        label: "实时数据延迟阈值 (ms)",
        comment: "仅在 TB_QUEUE_TYPE 为 caffeine 时生效",
        type: "number",
        group: "Edge 存储与队列",
        scope: "edge",
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
        scope: "edge",
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
        scope: "edge",
        dependsOn: { key: "APPTYPE", value: "EDGE" },
        default: "false"
    },
    "TELEMETRY_GRPC_CLIENT_HOST": {
        label: "遥测 gRPC 主机地址",
        type: "text",
        group: "Edge 遥测分离",
        scope: "edge",
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
        scope: "edge",
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
        scope: "edge",
        dependsOn: {
            and: [
                { key: "APPTYPE", value: "EDGE" },
                { key: "TELEMETRY_SEPARATION_ENABLED", value: "true" },
                { key: "TB_QUEUE_TYPE", value: "kafka" }
            ]
        }
    }
};
