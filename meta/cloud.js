module.exports = {
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
    "SWAGGER_ENABLED": {
        label: "启用 Swagger 文档",
        type: "select",
        options: ["true", "false"],
        default: "false",
        group: "高级设置"
    },
};
