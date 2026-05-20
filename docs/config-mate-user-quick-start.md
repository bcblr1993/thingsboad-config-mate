# Config Mate 现场快速使用说明

## 1. 准备文件

现场安装包目录示例：

```text
/opt/sprixin-iotcloud
```

或：

```text
/opt/sprixin-iotedge
```

把 Config Mate 镜像文件放到安装包的 `images` 目录：

```text
/opt/sprixin-iotcloud/images/tb-config-mate_linux_amd64.tar.gz
```

如果是 ARM 服务器，使用：

```text
tb-config-mate_linux_arm64.tar.gz
```

## 2. 进入安装包目录

Cloud 示例：

```bash
cd /opt/sprixin-iotcloud
```

Edge 示例：

```bash
cd /opt/sprixin-iotedge
```

## 3. 加载镜像

x86 服务器：

```bash
docker load -i images/tb-config-mate_linux_amd64.tar.gz
```

ARM 服务器：

```bash
docker load -i images/tb-config-mate_linux_arm64.tar.gz
```

## 4. 创建 Config Mate 目录

推荐把 Config Mate 放到 `services/config-mate`，和 `postgres`、`redis`、`kafka`、`iotcloud/iotedge` 保持同级：

```bash
mkdir -p services/config-mate
cd services/config-mate
```

目录结构示例：

```text
/opt/sprixin-iotcloud/services/config-mate/
├── docker-compose.yml
└── .env
```

## 5. 创建启动配置

在 `services/config-mate` 目录创建 `.env`：

```bash
cat > .env <<EOF
CONFIG_MATE_PASSWORD=请改成你的登录密码
EOF
```

说明：

- `CONFIG_MATE_PASSWORD`：admin 登录密码；不设置时默认使用 `123456`，生产环境建议改成强口令。

一般不需要配置 `APP_TYPE`，程序会自动识别 Cloud 或 Edge。

## 6. 创建启动文件

如果安装包里已经有 Config Mate 的 compose 配置，可以跳过这一步。

如果没有，在 `services/config-mate` 目录创建 `docker-compose.yml`：

```yaml
services:
  config-mate:
    image: tb-config-mate:latest
    container_name: tb-config-mate
    env_file:
      - .env
    ports:
      - "3300:3300"
    working_dir: "${PWD}/../.."
    environment:
      APP_ROOT: "${PWD}/../.."
      PORT: "3300"
      NO_BROWSER: "1"
      TZ: Asia/Shanghai
    volumes:
      - "${PWD}/../..:${PWD}/../.."
      - /var/run/docker.sock:/var/run/docker.sock
    restart: always
```

注意：

- 必须在 `services/config-mate` 目录执行 `docker compose`。
- 不需要配置 `DEPLOY_ROOT`，因为 `${PWD}/../..` 会自动指向整个 `sprixin-iotcloud` 或 `sprixin-iotedge` 安装包根目录。
- 不建议只映射 `services/iotcloud` 或 `services/iotedge`，否则页面无法统一管理 `postgres`、`redis`、`kafka`、`cassandra` 等服务。
- `/var/run/docker.sock` 用于让 Config Mate 控制宿主机 Docker 容器，必须挂载。

## 7. 启动 Config Mate

```bash
docker compose up -d
```

如果现场使用旧版命令：

```bash
docker-compose up -d
```

## 8. 访问页面

浏览器打开：

```text
http://服务器IP:3300
```

如果你把端口改成了 `3301`：

```text
http://服务器IP:3301
```

登录时输入：

- 管理员账号：`admin`
- 管理口令：`services/config-mate/.env` 里的 `CONFIG_MATE_PASSWORD`，未配置时为 `123456`

## 9. 查看运行状态

```bash
docker ps --filter name=tb-config-mate
```

查看日志：

```bash
docker logs --tail=100 tb-config-mate
```

## 10. 停止或重启

重启：

```bash
docker restart tb-config-mate
```

停止：

```bash
docker stop tb-config-mate
```

再次启动：

```bash
docker compose up -d
```

## 11. 更新 Config Mate

把新的镜像文件放到 `images` 目录后执行：

```bash
docker load -i ../../images/tb-config-mate_linux_amd64.tar.gz
docker compose up -d
```

ARM 服务器把文件名换成：

```bash
images/tb-config-mate_linux_arm64.tar.gz
```
