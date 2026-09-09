# HA 交付包已知缺陷

> **本文记录的是 PostgreSQL HA / 瀚高 HA 交付包自身的缺陷，不是 Config Mate 的问题。**
> 这两套 HA 由独立仓库交付（`postgres-ha-cluster` / `highgoHA`），Config Mate 只做只读纳管，
> 详见 [双机热备只读纳管](ha-readonly-administration.md)。
>
> 记录目的：这些问题在现场部署时会直接导致失败或误判，且从现象很难定位到根因。
> 在交付包修复前，本文的「临时规避」是现场唯一可行的做法。

发现时间：2026-09-09
验证环境：10.8.8.157（CentOS 7.9）/ 10.8.8.235（Linx 6.0.80），Docker 23.0.5

---

## HA-001 · `pg_isready` 未指定端口，自定义 `PG_PORT` 必然启动失败

| | |
|---|---|
| **严重度** | 高 —— 直接导致容器无限重启，集群完全起不来 |
| **影响范围** | 瀚高 HA 与 PostgreSQL HA **都存在**，任何 `PG_PORT` 非编译默认值的场景 |
| **状态** | **待修复** |

### 现象

`.env` 中把 `PG_PORT` 改为非默认端口后启动，容器反复重启，日志中循环出现：

```
[WARN][check-highgo] health_check_failure reason=pg_isready_failed consecutive=60
[ERROR][setup-primary] PostgreSQL 启动超时
pg_ctl: another server might be running; trying to start server anyway
```

`repmgr cluster show` 报 `FATAL: role "repmgr" does not exist`——初始化在创建 repmgr 角色之前就中断了。

### 根因

`scripts/setup-primary.sh`（`setup-standby.sh` 同）等待数据库就绪时没有传端口：

```bash
for i in $(seq 1 30); do
    if su - highgo -c "pg_isready -q"; then    # ← 缺少 -p "${PG_PORT}"
        ...
    fi
    if [ $i -eq 30 ]; then
        ha_log_error "PostgreSQL 启动超时"
        exit 1
    fi
done
```

`pg_isready` 不带 `-p` 时使用编译期默认端口（瀚高 5866 / PostgreSQL 5432）。
数据库已按 `PG_PORT` 正常监听在自定义端口，但健康检查始终查默认端口，30 次全部失败后
`exit 1`，容器随之重启，循环往复。

`su - highgo` 是**登录 shell**，会重置环境变量，因此即使在 compose 中传入 `PG_PORT`
也到不了 `pg_isready`。

### 实测对比

| 配置 | `postgres_ready` 结果 | RestartCount |
|---|---|---|
| `PG_PORT=5867`（自定义） | 30 次全失败 → 启动超时 | 5 且持续增长 |
| `PG_PORT=5866`（默认） | `attempts=1 elapsed=0s` | 0 |

数据库本身在两种配置下都正常：`port = 5867` 已正确写入 `postgresql.conf`，
`pg_isready -U highgo -p 5867` 手工执行返回 0。**只有健康检查这一环是错的。**

### 为什么 PostgreSQL 版没被发现

PG 版 `setup-primary.sh` 有完全相同的写法，但现场 `PG_PORT` 一直用 5432，
与编译默认值巧合一致，因此从未暴露。**它同样存在这个缺陷。**

### 临时规避

**保持 `PG_PORT` 为编译默认值**（瀚高 5866 / PostgreSQL 5432）。
若该端口已被占用，只能先停占用方，不能靠改 `PG_PORT` 绕开。

### 修复建议

```bash
# 方案一：显式传端口（最小改动）
if su - highgo -c "pg_isready -q -p ${PG_PORT}"; then

# 方案二：通过 su 传递 PGPORT
if su - highgo -c "PGPORT=${PG_PORT} pg_isready -q"; then
```

同时建议全仓库排查所有 `pg_isready` / `psql` 调用是否都带了端口——
`web-redis-ha/scripts/web-redis-ha.sh` 的瀚高版存在同类问题（见附录 A-5）。

---

## HA-002 · `.env` 值含空格导致 `start.sh` 加载失败

| | |
|---|---|
| **严重度** | 中 —— 启动直接中断，但报错信息能提示到行号 |
| **影响范围** | **仅瀚高 HA**（PG HA 的 `start.sh` 不 source `.env`） |
| **状态** | **待修复** |

### 现象

`.env` 中写入含空格的值后执行 `./start.sh`，容器未创建，报：

```
=========================================
 HighGo HA - 节点启动
=========================================
./.env:行8: 瀚高联调: 未找到命令
```

对应配置行：

```dotenv
WECOM_NOTIFY_SITE_NAME=10.8.8 瀚高联调
```

### 根因

瀚高 `start.sh` 用 shell `source` 加载配置：

```bash
if [ -f ".env" ]; then
    set -a
    . ./.env      # ← 按 shell 语法解析，值中的空格会被当作命令分隔
    set +a
fi
```

`KEY=value with space` 在 shell 中等价于「设置 `KEY=value` 后执行命令 `with`」，
因此报「未找到命令」。

而 Docker Compose 读取 `.env` 时按 `KEY=VALUE` 整行解析，**空格是合法的**。
于是同一份 `.env` 对 compose 有效、对 `start.sh` 无效。

### 为什么 PostgreSQL 版没被发现

两个包的 `start.sh` 并不同源：

| | PG HA | 瀚高 HA |
|---|---|---|
| 大小 | 1208 字节 | 2164 字节 |
| 是否 source `.env` | ❌ 否 | ✅ 是 |
| 是否支持角色参数 | ❌ 否 | ✅ `./start.sh primary\|standby` |

同一份含空格的 `.env`，在 PG HA 下能正常启动，在瀚高 HA 下失败。

### 临时规避

`.env` 中**所有值都不要包含空格**，尤其是 `WECOM_NOTIFY_SITE_NAME` 这类描述性字段。
用连字符或下划线代替，例如 `WECOM_NOTIFY_SITE_NAME=highgo-ha-lab`。

### 修复建议

1. 改用逐行解析代替 `source`，与 Compose 的解析语义保持一致；
2. 或在部署文档的 `.env` 说明中明确「值不得包含空格」；
3. 顺带统一两个包的 `start.sh`——目前瀚高版支持 `primary|standby` 角色参数，
   但交付包里只有一个 `docker-compose.yml`，按 `install.sh` 提示执行
   `./start.sh primary` 会因找不到 `docker-compose-primary.yml` 而失败（见附录 A-4）。

---

## 附录：此前联调中发现的其他问题

以下问题在同一批交付包中发现，同样**待修复**，严重度与优先级供参考。

| 编号 | 问题 | 影响 | 严重度 |
|---|---|---|---|
| A-1 | 主备交付包各含一份**完全相同**的镜像（sha256 一致），纯冗余 | PG 浪费 211MB，瀚高浪费 **1.2GB** | 中 |
| A-2 | 瀚高交付包内置真实现场凭据（`.env` 含真实密码、VIP、内网 IP；`web-redis-ha.env.example` 含真实 Redis 密码） | 包发到其他现场，运维不改就会全网同密码 | **高** |
| A-3 | 瀚高 compose 主备密码兜底不对称：primary 有 `${POSTGRES_PASSWORD:-<硬编码>}`，standby 无 | `.env` 缺失时主备凭据不一致，复制建立失败且报错点在 repmgr 层，排查绕远 | 中 |
| A-4 | 瀚高 `install.sh` 提示执行 `./start.sh primary`，但包内只有 `docker-compose.yml`，无 `docker-compose-primary.yml` | 按提示操作必然失败，只有不带参数的 `./start.sh` 可用 | 中 |
| A-5 | `web-redis-ha.sh` 瀚高版的 `psql` 调用缺 `-p ${PG_PORT}`（与 HA-001 同源） | 端口非默认时主库判定恒为假，主节点上 Web 永远不启动且日志不说明原因 | **高** |
| A-6 | `web-redis-ha` 默认容器名与标准安装包不符：PG 版写 `redis`，实际是 `redis-redis-1`（瀚高版已修正但未同步回 PG 版） | agent 持续报 `redis_missing` | 中 |

---

## 附录：运维需要知道的行为差异（非缺陷）

**瀚高三权分立会拦截 OS 用户查询业务表。** 运维手册中形如
`su - highgo -c "psql ..."` 的命令用于查询系统状态没问题，但查业务表会报：

```
ERROR:  You have no right to select it.
```

需改用业务用户连接：

```bash
docker exec -e PGPASSWORD=<密码> highgo-ha \
  psql -h 127.0.0.1 -p 5866 -U postgres -d <业务库> -tAc "SELECT ..."
```

Config Mate 的 HA 探测只调用系统函数（`pg_is_in_recovery()`、`pg_stat_replication`、
`repmgr cluster show`），不查业务表，因此不受此限制影响。
