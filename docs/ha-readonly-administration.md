# 双机热备与 Redis Cluster 只读纳管

Config Mate 可以在界面上展示 PostgreSQL / 瀚高双机热备集群和 Redis Cluster 的运行状态，
**不修改它们的任何配置，也不提供启停**。

## 设计约束

这些组件由各自的交付包独立部署，且已经过完整回归验证。本功能的前提是：

- **HA 镜像与交付包零改动**：不修改镜像内脚本、不修改 compose、不修改 `.env`。
- **不依赖 compose 文件路径**：HA 包可以解压在任意目录，甚至不在 `APP_ROOT` 之内。
- **不依赖额外挂载**：只使用 Config Mate 已挂载的 `/var/run/docker.sock`。

因此所有信息都通过 `docker inspect` 和 `docker exec` 获取，调用的命令与现场运维手册
第八节完全一致。

## 自动发现

Config Mate 在每次刷新服务列表时按**容器名**探测：

| 服务 | 容器名 | 说明 |
|---|---|---|
| PostgreSQL 双机热备 | `postgres-ha` | 由交付包 compose 的 `container_name` 固定 |
| 瀚高双机热备 | `highgo-ha` | 同上 |
| Redis Cluster | `redis-cluster-redisN-1` | 由 `redis-cluster.sh up N` 动态生成 |

**探测不到就完全不显示**——没有部署 HA 的现场，界面与之前完全一致，不会多出任何卡片。

PostgreSQL 与瀚高都可用于 iotcloud 和 iotedge，因此两者在 Cloud 和 Edge 模式下都会注册。

## 展示内容

### 服务卡片徽章

- `PRIMARY` / `STANDBY`：本机数据库角色（来自 `pg_is_in_recovery()`）
- `VIP`：虚拟 IP 当前是否在本机（遍历全部网卡匹配，不依赖固定网卡名）
- `License N天` / `License 已过期`：仅瀚高，剩余 30 天内出现，7 天内转为红色

### 服务详情

- **集群概览**：角色、VIP 归属、数据库可写状态、业务库名、本机与对端 IP
- **集群拓扑**：`repmgr cluster show` 的完整结果。
  两个节点的角色一次拿全，**不需要跨机通信**，主节点宕机时在备机上同样能看到全貌
- **流复制**：`pg_stat_replication` 的状态与延迟字节数
- **License**（仅瀚高）：状态、类型、到期日、剩余天数、各产品授权
- **容器生效配置**：`docker inspect` 的 `Config.Env`，即容器实际生效的值（密码类字段脱敏）
- **运行信息**：容器 ID、启动时间、以及从 compose 标签读到的交付包目录

## 为什么不提供启停

**HA 集群**：启动有严格的先主后备顺序（主节点就绪约 30 秒后再启备节点），
顺序错误会触发备库全量 clone。这个决策链条不适合收进一个 Web 按钮。

**Redis Cluster**：启停需要节点数参数，且 compose 是脚本按参数生成的。

界面上对这些服务只显示「只读纳管」标识和详情入口。启停、主备切换、强制重建，
一律使用各自交付包中的 `./start.sh` 与 `./ops.sh`。

## 为什么禁用一键清理

HA 的数据在 docker named volume（如 `pgdata`）里，而 Config Mate 的清理白名单
针对的是 `services/postgres/data` 这类 bind mount 路径。

对 HA 执行清理会「成功」地归档一个空目录并写入审计日志——运维以为数据清干净了，
实际一点没动。这种虚假的安全感比直接报错危险得多，所以直接拒绝，并在提示里
指向正确的做法（`ops.sh` 的「强制销毁本地数据并重建为 Standby」）。

## 互斥提示

发现 HA 后，`/api/services` 会在 `conflicts` 字段返回与之冲突的服务 id：

- `postgres-ha` ↔ `postgres`、`highgo-ha`
- `highgo-ha` ↔ `postgres`、`postgres-ha`
- `redis-cluster` ↔ `redis`

单机 `postgres` 与 HA 会抢占 5432 端口，同时启动会导致连接指向不确定的实例。
HA 现场不应启用 `services/postgres`。

## 修改 HA 配置

Config Mate **不写** HA 的 `.env`。需要修改时：

1. 编辑 HA 交付包目录下的 `.env`（详情页的「交付包目录」给出了它的位置）
2. 在该节点执行 `./start.sh` 重启

界面上展示的是容器**当前生效**的值，因此改完 `.env` 但没重启时，
详情页显示的仍是旧值——这正好可以用来确认配置是否已经生效。

## 已知限制

- **不跨机**：每台机器上的 Config Mate 只管理本机容器。HA 现场建议两台都部署，
  各自访问自己的 3300 端口。数据库层面的主备全貌通过 `repmgr` 已经能看全。
- **不监控 web-redis-ha agent**：该 agent 是宿主机 systemd 服务，容器内无法直接查询。
  如果本机是 primary 且持有 VIP，但业务容器未运行，通常意味着 agent 异常，需要
  登录宿主机执行 `systemctl status web-redis-ha-agent`。
- **不做 HA 决策**：网络分区、脑裂等场景按各 HA 交付包文档的人工接管流程处理，
  Config Mate 只呈现状态。
