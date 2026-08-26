/*
 * IoTDB 时序存储配置 —— 云端 (meta/cloud.js) 与边缘端 (meta/edge.js) 共用同一份定义。
 *
 * 之所以抽成独立模块而不是在两边各抄一份：云边配置必须逐字一致，任何单边改动都会造成
 * 现场"云端能连、边缘连不上"这类难排查的漂移。这里用同一个对象展开，从结构上杜绝漂移。
 *
 * 字段来源: thingsboard.yml 的 iotdb 配置段，注释与默认值保持同步。
 * 生效条件: DATABASE_TS_TYPE 或 DATABASE_TS_LATEST_TYPE 任一为 iotdb。
 */

// 历史或最新任一走 IoTDB 时，本组配置才需要填写
const WHEN_IOTDB = { key: ["DATABASE_TS_TYPE", "DATABASE_TS_LATEST_TYPE"], value: "iotdb" };

// 仅当"最新数据"走 IoTDB 时才相关的配置
const WHEN_IOTDB_LATEST = { key: "DATABASE_TS_LATEST_TYPE", value: "iotdb" };

const GROUP = "IoTDB";

module.exports = {
    // === 连接 ===
    "IOTDB_NODE_URLS": {
        label: "IoTDB 节点地址",
        comment: "格式 host:port，多个节点用逗号分隔。单个地址即单机模式，多个地址即集群模式（客户端代码路径相同）。默认: 127.0.0.1:6667",
        type: "text",
        group: GROUP,
        default: "127.0.0.1:6667",
        required: true,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_USER": {
        label: "IoTDB 用户名",
        comment: "默认为: root",
        type: "text",
        group: GROUP,
        default: "root",
        required: true,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_PASSWORD": {
        label: "IoTDB 密码",
        comment: "默认为: root，生产环境请务必修改",
        type: "password",
        group: GROUP,
        default: "root",
        required: true,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_DATABASE": {
        label: "IoTDB 存储组 (数据库前缀)",
        comment: "平台所有时序数据存放在该前缀下，默认为: root.tb。修改后原有数据不会自动迁移，等同于换了一个空库",
        type: "text",
        group: GROUP,
        default: "root.tb",
        required: true,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_POOL_SIZE": {
        label: "写连接池大小",
        comment: "写入 SessionPool 的最大连接数。0 表示自动（2 × CPU 核数），一般无需修改",
        type: "number",
        group: GROUP,
        default: 0,
        min: 0,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_READ_POOL_SIZE": {
        label: "读连接池大小",
        comment: "查询 SessionPool 的最大连接数，与写连接池物理隔离，保证查询洪峰不会挤占写连接导致落库变慢、触发背压。0 表示自动（2 × CPU 核数）",
        type: "number",
        group: GROUP,
        default: 0,
        min: 0,
        dependsOn: WHEN_IOTDB
    },

    // === 数据保留 ===
    "IOTDB_TTL_MS": {
        label: "IoTDB 历史数据保留时间",
        comment: "数据库级原生 TTL，单位为毫秒。0 表示永不过期。例: 31536000000 为 365 天。注意: IoTDB 后端只支持这一种全局 TTL，不支持按租户/按设备的数据级 TTL",
        type: "number",
        group: GROUP,
        default: 0,
        min: 0,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_TTL_FAIL_FAST": {
        label: "TTL 设置失败时阻断启动",
        comment: "false（默认）: TTL 设置失败只记录 ERROR 后继续启动。true: 设置失败即启动失败，适合把 TTL 当作磁盘硬约束的生产环境——宁可不启动，也不让磁盘因 TTL 未生效而无界增长。仅在保留时间大于 0 时有意义",
        type: "select",
        options: ["true", "false"],
        group: GROUP,
        default: "false",
        dependsOn: WHEN_IOTDB
    },

    // === 读路径 ===
    "IOTDB_LATEST_BATCH_SIZE": {
        label: "最新值查询单批 Key 数",
        comment: "一次最新值查询在单条 SELECT LAST 中最多携带的 key 数量，默认 500。PCS/BMS 的 200~350 个测点默认只产生一次 RPC；超过本值时自动分批，避免 SQL 和响应体无限膨胀",
        type: "number",
        group: GROUP,
        default: 500,
        min: 1,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_QUERY_TIMEOUT_MS": {
        label: "查询超时时间",
        comment: "单位为毫秒，默认 60000（1 分钟）。慢查询超过本值会被服务端终止，避免读线程被无限占用",
        type: "number",
        group: GROUP,
        default: 60000,
        min: 0,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_READ_QUEUE_CAPACITY": {
        label: "读线程池队列容量",
        comment: "0 表示自动（读线程数 × 64）。队列满后查询立即失败，绝不在规则引擎/设备状态/订阅线程内联执行，避免这些线程被 IoTDB 查询阻塞",
        type: "number",
        group: GROUP,
        default: 0,
        min: 0,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_READ_SLOW_QUERY_MS": {
        label: "慢查询告警阈值",
        comment: "单位为毫秒，默认 1000。查询耗时达到本值即计入慢查询指标并输出 WARN 日志，用于定位慢查询",
        type: "number",
        group: GROUP,
        default: 1000,
        min: 0,
        dependsOn: WHEN_IOTDB
    },

    // === 写路径 ===
    "IOTDB_WRITE_SHARDS": {
        label: "写入分片数 (落库线程数)",
        comment: "0 表示自动（等于 CPU 核数）。一般无需修改",
        type: "number",
        group: GROUP,
        default: 0,
        min: 0,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_WRITE_BATCH_SIZE": {
        label: "单设备攒批行数",
        comment: "单个设备累积到该行数（不同时间戳计为不同行）即触发落库，默认 1000",
        type: "number",
        group: GROUP,
        default: 1000,
        min: 1,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_WRITE_FLUSH_INTERVAL_MS": {
        label: "攒批窗口 (核心吞吐参数)",
        comment: "缓冲中的数据点最长等待多久被强制落库，单位为毫秒，默认 1000。它同时决定入库延迟上界和攒批深度：窗口越大单次 RPC 携带的点越多、服务端每点 CPU 成本越低。实测 50ms 时约 45 万点/秒，2000ms 时可达 68 万点/秒。业务能接受秒级入库就设 1000~2000，要求亚秒实时性才用 50~500。代价: 写缓冲是纯内存的，进程崩溃会丢失窗口内未落库的数据（正常停机不丢）",
        type: "number",
        group: GROUP,
        default: 1000,
        min: 1,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_WRITE_MAX_PENDING_PER_SHARD": {
        label: "单分片背压水位",
        comment: "每个分片已接收但尚未落库的点数上限，超过后阻塞上游规则引擎，默认 200000。联动公式: 稳态每分片积压峰值 ≈ 总点速率 ÷ 分片数 × 攒批窗口秒数，本值必须大于峰值的 2~3 倍，否则正常运行时就会误触背压。判读: 日志里出现背压且落库耗时正常说明本值偏小；背压且落库耗时到秒级说明 IoTDB 真的过载，调大本值没用",
        type: "number",
        group: GROUP,
        default: 200000,
        min: 1,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_WRITE_MAX_BACKPRESSURE_WAIT_MS": {
        label: "背压等待上限",
        comment: "单位为毫秒。0（默认）表示无限等待，反压如实传导到 Kafka，数据留在 Kafka 等 IoTDB 恢复后追上，不丢数据。大于 0 表示等待超过该时长即快速失败并丢弃该点、释放规则引擎线程。仅当“线程绝不能被长期占用”比“绝不丢点”更重要时才设正值",
        type: "number",
        group: GROUP,
        default: 0,
        min: 0,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_WRITE_STATS_INTERVAL_MS": {
        label: "写入统计日志周期",
        comment: "输出写缓冲统计日志（积压/新增/已写/失败/RPC/背压/落库耗时）的周期，单位为毫秒，默认 10000。0 表示关闭",
        type: "number",
        group: GROUP,
        default: 10000,
        min: 0,
        dependsOn: WHEN_IOTDB
    },

    // === 超时与重试 ===
    "IOTDB_CONNECTION_TIMEOUT_MS": {
        label: "连接超时时间",
        comment: "单次 RPC 的 socket 往返上限，单位为毫秒，默认 15000。不可设为 0：IoTDB 卡住时会导致 RPC 无限等待、积压永不释放、背压永久阻塞规则引擎",
        type: "number",
        group: GROUP,
        default: 15000,
        min: 1,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_SESSION_WAIT_TIMEOUT_MS": {
        label: "连接池等待超时",
        comment: "从连接池获取连接的等待上限，单位为毫秒，默认 10000",
        type: "number",
        group: GROUP,
        default: 10000,
        min: 1,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_MAX_RETRY_COUNT": {
        label: "可重试错误的重试次数",
        comment: "客户端对连接类可重试错误的重试次数，默认 3",
        type: "number",
        group: GROUP,
        default: 3,
        min: 0,
        dependsOn: WHEN_IOTDB
    },
    "IOTDB_RETRY_INTERVAL_MS": {
        label: "重试间隔",
        comment: "单位为毫秒，默认 1000",
        type: "number",
        group: GROUP,
        default: 1000,
        min: 0,
        dependsOn: WHEN_IOTDB
    },

    // === 最新值走 IoTDB 时的强制约束 ===
    // 平台在 latest=iotdb 且 EDQS 开启时会直接拒绝启动: EDQS 初始同步只从 SQL 的
    // ts_kv_latest 表装载，而 IoTDB 最新值走原生 LastCache，不维护该表，允许此组合
    // 会让 EDQS 静默拿到空的最新值。这两项在此固定为 false，避免现场配出起不来的服务。
    "TB_EDQS_SYNC_ENABLED": {
        label: "EDQS 初始同步",
        comment: "最新数据存储为 IoTDB 时必须关闭。IoTDB 最新值走原生 LastCache，不维护 SQL 的 ts_kv_latest 表，而 EDQS 初始同步只从该表装载，开启会导致平台启动失败",
        type: "readonly",
        group: GROUP,
        default: "false",
        required: true,
        dependsOn: WHEN_IOTDB_LATEST
    },
    "TB_EDQS_API_SUPPORTED": {
        label: "EDQS 查询接口",
        comment: "最新数据存储为 IoTDB 时必须关闭，原因同上",
        type: "readonly",
        group: GROUP,
        default: "false",
        required: true,
        dependsOn: WHEN_IOTDB_LATEST
    }
};
