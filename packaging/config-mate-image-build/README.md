# Config Mate 镜像构建包使用说明

这个目录是一个独立的 Docker 镜像构建包，可以直接上传到 x86 或 ARM Linux 服务器后执行 `docker build`。

## 目录说明

```text
config-mate-image-build/
├── Dockerfile.base
├── Dockerfile
├── package.json
├── package-lock.json
├── tb-config-src.js
├── config-meta.js
├── index.html
├── assets/
├── src/
├── meta/
├── build-base.sh
├── build-image.sh
├── build-all.sh
├── save-image.sh
└── deploy/
    ├── docker-compose.yml
    └── .env.example
```

- `Dockerfile.base`：构建基础镜像，包含 Node、Docker CLI、Docker Compose、npm 依赖。
- `Dockerfile`：构建应用镜像，只复制 Config Mate 代码和静态资源。
- `deploy/docker-compose.yml`：现场生产启动 Config Mate 的 compose 文件。
- `deploy/.env.example`：现场环境变量模板。
- `build-base.sh`：构建基础镜像，依赖变化或首次构建时执行。
- `build-image.sh`：构建应用镜像，日常改代码后只执行这个。
- `build-all.sh`：一次性构建基础镜像和应用镜像。
- `save-image.sh`：可选离线镜像导出脚本。

## 1. 上传到构建机器

把整个 `config-mate-image-build` 目录上传到目标机器，例如：

```bash
scp -r config-mate-image-build root@服务器IP:/opt/
```

进入目录：

```bash
cd /opt/config-mate-image-build
```

## 2. 构建镜像

构建包默认已经使用国内源：

- Node 基础镜像：`docker.m.daocloud.io/library/node:18-bookworm-slim`
- Debian apt：阿里云镜像
- npm：`https://registry.npmmirror.com`
- Docker CLI：阿里云 Docker CE 静态包镜像，失败后自动切官方源
- Docker Compose：GitHub release 代理地址，失败后自动切备用代理和官方源

### 首次构建

第一次构建，先构建基础镜像，再构建应用镜像：

```bash
./build-base.sh
./build-image.sh
```

也可以一条命令完成：

```bash
./build-all.sh
```

基础镜像会安装系统依赖、Docker CLI、Docker Compose 和 npm 依赖。以后只要 `package.json`、`package-lock.json`、Docker CLI/Compose 版本不变，就不需要重复构建基础镜像。

### 日常改代码后构建

如果只是修改页面、JS、CSS 或后端业务代码，只需要：

```bash
./build-image.sh
```

这一步不会重新安装 apt 依赖，也不会重新执行 `npm ci`。

### 指定平台

脚本支持指定平台：

```bash
PLATFORM=linux/amd64 ./build-base.sh
PLATFORM=linux/amd64 ./build-image.sh

PLATFORM=linux/arm64 ./build-base.sh
PLATFORM=linux/arm64 ./build-image.sh
```

### 使用原生命令构建

不用脚本也可以：

```bash
docker build -f Dockerfile.base -t tb-config-mate-base:latest .
docker build -t tb-config-mate:latest .
```

如果你的构建机器开启了 buildx，也可以明确指定平台：

```bash
docker build --platform linux/amd64 -f Dockerfile.base -t tb-config-mate-base:latest .
docker build --platform linux/amd64 -t tb-config-mate:latest .
```

如果你的服务器可以访问官方源，也可以切回官方地址：

```bash
docker build \
  --build-arg NODE_IMAGE=node:18-bookworm-slim \
  --build-arg APT_MIRROR=deb.debian.org \
  --build-arg APT_SECURITY_MIRROR=security.debian.org/debian-security \
  --build-arg NPM_REGISTRY=https://registry.npmjs.org \
  --build-arg DOCKER_DOWNLOAD_BASE=https://download.docker.com/linux/static/stable \
  --build-arg COMPOSE_DOWNLOAD_BASE=https://github.com/docker/compose/releases/download \
  -f Dockerfile.base \
  -t tb-config-mate-base:latest .

docker build -t tb-config-mate:latest .
```

如果现场有自己的内网 npm 或文件服务器，也可以把上面的 build arg 换成内网地址。

使用脚本时也可以透传 build arg：

```bash
EXTRA_BUILD_ARGS="--build-arg NPM_REGISTRY=http://你的内网npm源" ./build-base.sh
```

如果 Docker CLI 或 Docker Compose 下载仍然失败，可以指定你现场可访问的下载源：

```bash
EXTRA_BUILD_ARGS='--build-arg DOCKER_DOWNLOAD_BASE=http://你的内网源/docker-static --build-arg COMPOSE_DOWNLOAD_BASE=http://你的内网源/docker-compose' ./build-base.sh
```

源地址规则：

- Docker CLI：`${DOCKER_DOWNLOAD_BASE}/x86_64/docker-27.5.1.tgz`
- Docker Compose：`${COMPOSE_DOWNLOAD_BASE}/v2.32.4/docker-compose-linux-x86_64`

## 3. 生成离线镜像包

构建完成后生成离线包：

```bash
docker save tb-config-mate:latest | gzip > tb-config-mate_latest.tar.gz
```

也可以使用脚本：

```bash
./save-image.sh
```

把 `tb-config-mate_latest.tar.gz` 放到现场安装包的 `images/` 目录：

```bash
mkdir -p /opt/sprixin-iotcloud/images
cp tb-config-mate_latest.tar.gz /opt/sprixin-iotcloud/images/
```

Edge 包示例：

```bash
mkdir -p /opt/sprixin-iotedge/images
cp tb-config-mate_latest.tar.gz /opt/sprixin-iotedge/images/
```

## 4. 现场启动 Config Mate

进入现场安装包根目录，必须是整个 `sprixin-iotcloud` 或 `sprixin-iotedge`：

```bash
cd /opt/sprixin-iotcloud
```

加载镜像：

```bash
docker load -i images/tb-config-mate_latest.tar.gz
```

复制启动文件：

```bash
mkdir -p services/config-mate
cp /opt/config-mate-image-build/deploy/docker-compose.yml services/config-mate/docker-compose.yml
cp /opt/config-mate-image-build/deploy/.env.example services/config-mate/.env
```

编辑 `services/config-mate/.env`：

```bash
vi services/config-mate/.env
```

最少需要修改：

```env
CONFIG_MATE_PASSWORD=现场登录密码
```

如果是 Edge 包：

```env
CONFIG_MATE_PASSWORD=现场登录密码
```

`APP_TYPE` 一般留空即可。程序会自动按 `services/iotcloud` 或 `services/iotedge` 识别 Cloud/Edge。

进入 `services/config-mate` 启动：

```bash
cd services/config-mate
```

```bash
docker compose up -d
```

如果服务器只有旧命令：

```bash
docker-compose up -d
```

## 5. 访问页面

浏览器打开：

```text
http://服务器IP:3300
```

登录：

- 操作员名称：现场操作人名称，例如 `admin`
- 管理口令：`services/config-mate/.env` 中的 `CONFIG_MATE_PASSWORD`

## 6. 常用维护命令

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
cd /opt/sprixin-iotcloud/services/config-mate
docker compose down
```

## 7. 注意事项

- 必须在 `services/config-mate` 目录执行 `docker compose up -d`。
- 不需要配置 `DEPLOY_ROOT`；`docker-compose.yml` 会用当前目录 `$PWD/../..` 作为 `APP_ROOT`，并挂载到容器内相同绝对路径，不能改成 `/app` 之类的路径。
- 必须挂载 `/var/run/docker.sock`，否则页面只能查看配置，不能控制宿主机容器。
- 这个容器拥有宿主机 Docker 管理权限，必须设置强登录密码。
- 不建议只映射 `services/iotcloud` 或 `services/iotedge`，否则无法管理 PostgreSQL、Redis、Kafka、Cassandra 等依赖服务。
