# Config Mate docker-compose 简单说明

## 1. compose 内容

推荐在现场安装包中创建独立目录：

```text
sprixin-iotcloud/
└── services/
    ├── postgres/
    ├── redis/
    ├── kafka/
    ├── iotcloud/
    └── config-mate/
        ├── docker-compose.yml
        └── .env
```

`services/config-mate/docker-compose.yml` 内容：

```yaml
services:
  config-mate:
    image: tb-config-mate:latest
    container_name: tb-config-mate
    env_file:
      - .env
    ports:
      - "3300:3300"
    working_dir: "${PWD:?Please run docker compose from services/config-mate}/../.."
    environment:
      APP_ROOT: "${PWD:?Please run docker compose from services/config-mate}/../.."
      PORT: "3300"
      NO_BROWSER: "1"
      TZ: Asia/Shanghai
    volumes:
      - "${PWD:?Please run docker compose from services/config-mate}/../..:${PWD:?Please run docker compose from services/config-mate}/../.."
      - /var/run/docker.sock:/var/run/docker.sock
    restart: always
```

这个文件已经通过 `env_file` 读取同目录 `.env`，启动时不需要再写 `--env-file`。

## 2. .env

在 `services/config-mate/.env` 中只保留 Config Mate 自己需要的配置：

```env
CONFIG_MATE_PASSWORD=请改成一个安全口令

# 一般留空。程序会根据 ../../services/iotcloud 或 ../../services/iotedge 自动识别。
APP_TYPE=
```

如果现场同时存在 Cloud 和 Edge，可以明确指定：

```env
APP_TYPE=CLOUD
```

或：

```env
APP_TYPE=EDGE
```

## 3. 启动方式

先进入整个安装包根目录加载镜像：

```bash
cd /opt/sprixin-iotcloud
```

或：

```bash
cd /opt/sprixin-iotedge
```

```bash
docker load -i images/tb-config-mate_latest.tar.gz
```

然后进入 `services/config-mate` 启动：

```bash
mkdir -p services/config-mate
cd services/config-mate
```

```bash
docker compose up -d
```

如果现场只有旧命令：

```bash
docker-compose up -d
```

访问：

```text
http://服务器IP:3300
```

## 4. DEPLOY_ROOT 是否需要配置

不需要。

只要 `config-mate` 目录固定放在 `services/config-mate`，compose 会通过 `${PWD}/../..` 自动得到安装包根目录：

```text
/opt/sprixin-iotcloud/services/config-mate/../.. = /opt/sprixin-iotcloud
```

如果把 `config-mate` 放到其他位置，就需要同步调整 `working_dir`、`APP_ROOT` 和第一条 `volumes`。

## 5. 字段说明

- `env_file: .env`：把登录口令和可选 `APP_TYPE` 传给容器。
- `ports: "3300:3300"`：宿主机 3300 端口映射到容器 3300 端口；如果要换端口，直接改左侧端口，例如 `"3301:3300"`。
- `working_dir` / `APP_ROOT`：使用当前执行目录 `$PWD/../..`，所以必须在 `services/config-mate` 目录执行 `docker compose up -d`。
- `volumes` 第一行：把安装包目录挂载到容器内相同绝对路径，避免业务 compose 中的 `./data`、`./conf`、`./logs` 相对路径解析错误。
- `/var/run/docker.sock`：让 Config Mate 控制宿主机 Docker，权限很高，必须设置强登录口令。
- `restart: always`：宿主机或 Docker 重启后自动恢复。

## 6. 常用命令

查看容器：

```bash
docker ps --filter name=tb-config-mate
```

查看日志：

```bash
docker logs --tail=100 tb-config-mate
```

重启：

```bash
docker restart tb-config-mate
```

停止：

```bash
docker compose down
```

旧命令：

```bash
docker-compose down
```

## 7. 常见问题

### 页面提示 Docker 不可用

检查是否挂载了：

```yaml
- /var/run/docker.sock:/var/run/docker.sock
```

同时确认宿主机 Docker 正常：

```bash
docker ps
```

### 页面提示 APP_ROOT 路径错误

通常是没有在 `services/config-mate` 目录执行启动命令。请确认：

```bash
pwd
ls ../..
```

`../..` 下应能看到 `services/iotcloud` 或 `services/iotedge`。
