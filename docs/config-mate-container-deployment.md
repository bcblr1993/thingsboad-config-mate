# Config Mate 容器镜像构建与现场安装包接入说明

## 1. 当前改造做了什么

Config Mate 已从“安装包目录里的本地配置工具”改造成“容器化部署控制台”：

- Config Mate 自身构建为 Docker 镜像：`tb-config-mate:latest`。
- 容器内包含 Node.js、项目代码、Docker CLI、Docker Compose v2 插件。
- 容器不运行 Docker daemon，而是通过挂载宿主机 `/var/run/docker.sock` 管理宿主机 Docker。
- 容器挂载整个安装包根目录，并通过 `APP_ROOT` 识别 `services/iotcloud/.env` 或 `services/iotedge/.env`。
- Web 默认端口为 `3300`，如需调整宿主机端口，直接修改 `docker-compose.yml` 的端口映射。
- Web 必须使用 `CONFIG_MATE_PASSWORD` 登录，因为挂载 docker.sock 后权限很高。

## 2. install.sh 当前职责

Cloud 包和 Edge 包的 `install.sh` 现在职责一致。`APP_TYPE` 可以写入 `.config-mate.env`，但不是必须项；Config Mate 会自动识别安装包类型。

现在 `install.sh` 做这些事：

1. 检查必须用 root 执行。
2. 检查 Docker 是否已安装；没有则优先使用安装包内 `docker/` 离线安装，否则在线安装。
3. 检查 Docker Compose；如果已有 `docker compose`，会创建 `/usr/bin/docker-compose` 兼容入口。
4. 加载 `images/` 目录下的所有镜像 tar 包。
5. 创建 `proxy` 网络。
6. 确保 docker 组存在，并重启 Docker。
7. 确保 `/etc/timezone` 存在。
8. 生成或复用 `.config-mate.env`。
9. 只启动 `config-mate` 容器。

现在 `install.sh` 不再自动启动 iotcloud/iotedge 业务服务。业务服务、依赖服务、初始化安装、日志查看等都进入 Web 控制台处理。

`.config-mate.env` 内容示例：

```env
CONFIG_MATE_PASSWORD=自动生成或已有密码
```

安装包类型识别优先级：

1. 容器环境变量 `APP_TYPE=CLOUD|EDGE`，如果明确提供则优先使用。
2. 业务配置文件 `services/iotcloud/.env` 或 `services/iotedge/.env` 中的 `APP_TYPE`。
3. 兼容旧字段 `APPTYPE`。
4. 根据 `services/iotcloud` 或 `services/iotedge` 目录自动识别。

因此，如果现场已有安装包，不需要为了区分 Cloud/Edge 专门修改 `install.sh`。

## 3. 构建 Config Mate 镜像

在项目根目录执行：

```bash
cd /path/to/thingsboad-config-mate
npm ci
docker build -t tb-config-mate:latest .
```

如果要明确构建 Apple Silicon / ARM64 镜像：

```bash
docker build --platform linux/arm64 -t tb-config-mate:latest .
```

如果现场服务器是 x86_64：

```bash
docker build --platform linux/amd64 -t tb-config-mate:latest .
```

保存为离线镜像包：

```bash
mkdir -p images
docker save tb-config-mate:latest | gzip > images/tb-config-mate_latest.tar.gz
```

也可以直接用 npm 脚本：

```bash
npm run docker:build
npm run docker:save
```

注意：`npm run docker:build` 默认按当前机器架构构建。如果要跨架构，请使用上面的 `docker build --platform ...`。

## 4. 放入已有现场安装包

假设现场已有安装包目录：

```bash
/opt/sprixin-iotcloud
```

把离线镜像放进去：

```bash
mkdir -p /opt/sprixin-iotcloud/images
cp tb-config-mate_latest.tar.gz /opt/sprixin-iotcloud/images/
```

如果是 Edge 包：

```bash
mkdir -p /opt/sprixin-iotedge/images
cp tb-config-mate_latest.tar.gz /opt/sprixin-iotedge/images/
```

## 5. 现场安装包需要有 config-mate compose

安装包根目录的 `docker-compose.yml` 需要包含：

```yaml
services:
  config-mate:
    image: tb-config-mate:latest
    container_name: tb-config-mate
    env_file:
      - .config-mate.env
    ports:
      - "3300:3300"
    working_dir: "${PWD:?Please run docker compose from the deploy package root}"
    environment:
      APP_ROOT: "${PWD:?Please run docker compose from the deploy package root}"
      PORT: "3300"
      NO_BROWSER: "1"
      TZ: Asia/Shanghai
    volumes:
      - "${PWD:?Please run docker compose from the deploy package root}:${PWD:?Please run docker compose from the deploy package root}"
      - /var/run/docker.sock:/var/run/docker.sock
    restart: always
```

关键点：必须在安装包根目录执行 `docker compose up -d`，让 `$PWD` 映射到容器内相同绝对路径，避免业务 compose 里的 `./data`、`./conf` 相对路径解析错误。

## 6. 有 install.sh 的推荐启动方式

进入安装包根目录：

```bash
cd /opt/sprixin-iotcloud
sudo bash install.sh
```

安装完成后查看日志：

```bash
tail -n 80 install.log
```

日志会打印：

```text
Config Mate Web: http://服务器IP:3300
Config Mate 管理口令: xxxxxxxxxxxxxxxx
```

访问 Web 后，用操作员名称 + 管理口令登录。

## 7. 不改 install.sh 的手动启动方式

如果现场安装包已经存在，但暂时不想替换 `install.sh`，可以手动加载和启动。

Cloud 示例：

```bash
cd /opt/sprixin-iotcloud

docker load -i images/tb-config-mate_latest.tar.gz

cat > .config-mate.env <<EOF
CONFIG_MATE_PASSWORD=$(openssl rand -hex 12)
EOF

docker compose up -d
```

如果服务器只有 `docker-compose` 命令：

```bash
docker-compose up -d
```

查看密码：

```bash
cat .config-mate.env
```

Edge 包同样可以使用这套命令。只要安装包内存在 `services/iotedge`，或者 `services/iotedge/.env` 中存在 `APP_TYPE=EDGE` / `APPTYPE=EDGE`，Config Mate 会自动识别为 Edge。

## 8. 更新已有现场 Config Mate 镜像

新版本镜像做好后，放到现场 `images/` 目录，然后执行：

```bash
cd /opt/sprixin-iotcloud
docker load -i images/tb-config-mate_latest.tar.gz
docker compose up -d
```

如果仍使用旧 `docker-compose`：

```bash
docker-compose up -d
```

确认运行：

```bash
docker ps --filter name=tb-config-mate
docker logs --tail=80 tb-config-mate
```

## 9. 常见问题

### 页面提示 Docker 不可用

检查是否挂载 docker.sock：

```bash
docker inspect tb-config-mate --format '{{json .Mounts}}'
```

需要包含：

```text
/var/run/docker.sock:/var/run/docker.sock
```

### 页面提示 APP_ROOT 路径错误

通常是没有在安装包根目录执行启动命令。请确认：

```bash
pwd
ls services
```

目录下应能看到 `services/iotcloud` 或 `services/iotedge`。

### 镜像架构不匹配

查看服务器架构：

```bash
uname -m
```

- `aarch64` 对应 `linux/arm64`
- `x86_64` 对应 `linux/amd64`

重新按正确架构构建：

```bash
docker build --platform linux/arm64 -t tb-config-mate:latest .
```

或：

```bash
docker build --platform linux/amd64 -t tb-config-mate:latest .
```

### 忘记管理口令

查看安装包根目录：

```bash
cat .config-mate.env
```

修改 `CONFIG_MATE_PASSWORD` 后重启：

```bash
docker compose up -d
```
