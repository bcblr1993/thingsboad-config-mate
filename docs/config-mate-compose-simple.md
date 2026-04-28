# Config Mate docker-compose 简单说明

## 1. compose 内容

```yaml
services:
  config-mate:
    image: tb-config-mate:latest
    container_name: tb-config-mate
    ports:
      - "${CONFIG_MATE_PORT:-3300}:3300"
    working_dir: "${DEPLOY_ROOT:?DEPLOY_ROOT is required}"
    environment:
      APP_ROOT: "${DEPLOY_ROOT:?DEPLOY_ROOT is required}"
      APP_TYPE: "${APP_TYPE:-}"
      CONFIG_MATE_PASSWORD: "${CONFIG_MATE_PASSWORD:?CONFIG_MATE_PASSWORD is required}"
      PORT: "3300"
      NO_BROWSER: "1"
      TZ: Asia/Shanghai
    volumes:
      - "${DEPLOY_ROOT:?DEPLOY_ROOT is required}:${DEPLOY_ROOT:?DEPLOY_ROOT is required}"
      - /var/run/docker.sock:/var/run/docker.sock
    restart: always
```

## 2. 这个服务是做什么的

`config-mate` 是部署控制台容器。

它运行 Web 页面，默认容器内端口是 `3300`。它通过挂载宿主机的 Docker socket 来操作宿主机上的容器，所以可以在 Web 页面里启动、停止、重启、查看日志、清理数据。

## 3. 必须准备的环境变量

推荐在安装包根目录创建 `.config-mate.env`：

```env
DEPLOY_ROOT=/opt/sprixin-iotcloud
CONFIG_MATE_PORT=3300
CONFIG_MATE_PASSWORD=请改成一个安全口令
```

Edge 包示例：

```env
DEPLOY_ROOT=/opt/sprixin-iotedge
CONFIG_MATE_PORT=3300
CONFIG_MATE_PASSWORD=请改成一个安全口令
```

`APP_TYPE` 可以不写。程序会自动识别：

- 有 `services/iotcloud` 就按 Cloud 处理
- 有 `services/iotedge` 就按 Edge 处理
- 如果业务 `.env` 里有 `APP_TYPE=CLOUD` 或 `APP_TYPE=EDGE`，也会自动读取

如果你想强制指定，也可以写：

```env
APP_TYPE=CLOUD
```

或：

```env
APP_TYPE=EDGE
```

## 4. 每个字段怎么理解

### image

```yaml
image: tb-config-mate:latest
```

使用本地已经加载好的 Config Mate 镜像。

如果现场是离线环境，需要先执行：

```bash
docker load -i images/tb-config-mate_latest.tar.gz
```

### container_name

```yaml
container_name: tb-config-mate
```

容器固定名称，方便查看：

```bash
docker logs tb-config-mate
docker restart tb-config-mate
```

### ports

```yaml
ports:
  - "${CONFIG_MATE_PORT:-3300}:3300"
```

左边是宿主机端口，右边是容器端口。

如果 `.config-mate.env` 中写：

```env
CONFIG_MATE_PORT=3301
```

访问地址就是：

```text
http://服务器IP:3301
```

不写时默认是：

```text
http://服务器IP:3300
```

### working_dir

```yaml
working_dir: "${DEPLOY_ROOT:?DEPLOY_ROOT is required}"
```

容器进入后的工作目录。

这里必须是安装包根目录，例如：

```env
DEPLOY_ROOT=/opt/sprixin-iotcloud
```

### APP_ROOT

```yaml
APP_ROOT: "${DEPLOY_ROOT:?DEPLOY_ROOT is required}"
```

告诉 Config Mate 当前安装包根目录在哪里。

Config Mate 会从这个目录下读取：

```text
services/iotcloud/.env
services/iotcloud/conf/
```

或：

```text
services/iotedge/.env
services/iotedge/conf/
```

### APP_TYPE

```yaml
APP_TYPE: "${APP_TYPE:-}"
```

应用类型，可选。

可以为空，程序会自动识别 Cloud 或 Edge。

### CONFIG_MATE_PASSWORD

```yaml
CONFIG_MATE_PASSWORD: "${CONFIG_MATE_PASSWORD:?CONFIG_MATE_PASSWORD is required}"
```

Web 登录口令，必须配置。

因为容器挂载了 Docker socket，权限很高，所以不能裸奔。

### PORT

```yaml
PORT: "3300"
```

容器内部 Web 服务端口。

一般不要改。宿主机想换端口，改 `CONFIG_MATE_PORT` 即可。

### NO_BROWSER

```yaml
NO_BROWSER: "1"
```

表示容器启动后不要尝试自动打开浏览器。

服务器环境必须保留。

### TZ

```yaml
TZ: Asia/Shanghai
```

设置容器时区，保证日志时间更符合现场使用习惯。

### volumes 第一行

```yaml
- "${DEPLOY_ROOT}:${DEPLOY_ROOT}"
```

把安装包根目录挂载进容器。

注意：左右两边路径必须一致。

例如：

```yaml
- /opt/sprixin-iotcloud:/opt/sprixin-iotcloud
```

这样做是为了让业务 compose 里的相对路径不会错乱，例如：

```text
./data
./conf
./logs
```

### volumes 第二行

```yaml
- /var/run/docker.sock:/var/run/docker.sock
```

把宿主机 Docker 控制入口挂载进容器。

Config Mate 就是通过这个 socket 控制宿主机上的 Docker 容器。

这是高权限挂载，所以必须设置登录口令。

### restart

```yaml
restart: always
```

宿主机重启或 Docker 重启后，Config Mate 自动恢复运行。

## 5. 启动方式

进入安装包根目录：

```bash
cd /opt/sprixin-iotcloud
```

加载镜像：

```bash
docker load -i images/tb-config-mate_latest.tar.gz
```

准备环境变量：

```bash
cat > .config-mate.env <<EOF
DEPLOY_ROOT=$(pwd)
CONFIG_MATE_PORT=3300
CONFIG_MATE_PASSWORD=请改成一个安全口令
EOF
```

启动：

```bash
docker compose --env-file .config-mate.env up -d config-mate
```

如果现场只有旧命令：

```bash
docker-compose --env-file .config-mate.env up -d config-mate
```

## 6. 查看运行状态

```bash
docker ps --filter name=tb-config-mate
docker logs --tail=100 tb-config-mate
```

访问：

```text
http://服务器IP:3300
```

如果改了端口，例如 `CONFIG_MATE_PORT=3301`，则访问：

```text
http://服务器IP:3301
```

## 7. 常见问题

### 提示 DEPLOY_ROOT is required

说明 `.config-mate.env` 里没有配置：

```env
DEPLOY_ROOT=/你的安装包绝对路径
```

### 提示 CONFIG_MATE_PASSWORD is required

说明没有配置登录口令：

```env
CONFIG_MATE_PASSWORD=你的口令
```

### 页面提示 Docker 不可用

检查是否挂载了：

```yaml
- /var/run/docker.sock:/var/run/docker.sock
```

同时确认宿主机 Docker 正常：

```bash
docker ps
```

