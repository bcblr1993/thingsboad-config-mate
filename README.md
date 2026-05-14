# ThingsBoard Config Mate (TB-CM)

ThingBoard Config Mate 是一个专为 ThingsBoard Docker 部署环境设计的轻量级、可视化配置管理工具。它旨在解决手动修改环境变量繁琐、容易出错的问题，提供直观的 Web 界面来管理配置、监控状态并控制服务。

## ✨ 核心特性

* **🛠️ 可视化配置管理**：提供直观的表单界面，轻松修改数据库、缓存、消息队列等几十项核心参数，无需直接编辑 `.env` 文件。
* **🚀 Docker 集成**：深度集成 Docker Compose，支持一键停止、重启服务，并根据应用类型（Cloud/Edge）自动识别服务名称。
* **📊 实时状态监控**：自动检测容器运行状态，并通过右上角徽章实时反馈（Running/Stopped）。
* **📜 实时日志查看**：内置实时日志查看器，支持自动滚动、换行切换，方便在重启服务后立即排查问题。
* **💻 源码模式**：支持在 UI 模式和源码（Raw Text）模式间切换，满足高级用户直接编辑配置的需求。
* **🔌 双模式运行**：
  * **App Mode**：自动以独立窗口模式启动（类似桌面软件）。
  * **Web Mode**：支持浏览器远程访问，适合服务器部署。
* **📦 离线部署**：支持通过 Docker 镜像离线包部署，也保留 `pkg` 二进制构建能力。

## 🚀 快速开始

### 容器化现场部署

推荐将 Config Mate 作为独立容器运行在 `services/config-mate`，并挂载现场安装包根目录与 Docker Socket：

```bash
cd /opt/sprixin-iotcloud
docker load -i images/tb-config-mate_latest.tar.gz

mkdir -p services/config-mate
cd services/config-mate

cat > .env <<EOF
CONFIG_MATE_PASSWORD=请替换为强口令
EOF

docker compose up -d
```

访问 `http://服务器IP:3300` 后可在 Web 控制台中管理 `postgres`、`redis`、`kafka`、`cassandra`、`netdata`、`wechat` 以及 `iotcloud/iotedge`。

这个标准目录下不需要配置 `DEPLOY_ROOT`，compose 会通过 `services/config-mate/../..` 自动挂载整个安装包根目录。`APP_TYPE` 可选，标准安装包中存在 `services/iotcloud` 会自动识别为 Cloud，存在 `services/iotedge` 会自动识别为 Edge；如果业务 `.env` 中写了 `APP_TYPE` 或 `APPTYPE`，也会自动读取。

> 注意：该模式会挂载 `/var/run/docker.sock`，Config Mate 容器具备宿主机 Docker 管理权限，请务必设置 `CONFIG_MATE_PASSWORD` 并仅在可信网络开放端口。

### 开发环境运行

如果您本机已安装 Node.js (v18+)：

1. 进入项目目录：

    ```bash
    cd tb-config-mate
    ```

2. 安装依赖：

    ```bash
    npm install
    ```

3. 启动开发服务器：

    ```bash
    # 使用 nodemon 启动热重载开发模式，避免每次重启都打开新窗口
    npm run dev
    ```

### 生产环境构建

为了在没有 Node.js 环境的服务器上运行，我们可以将其打包为独立可执行文件。

1. **构建二进制文件**：

    ```bash
    npm run build
    ```

    构建完成后，`dist/` 目录下会生成适用于 Linux、macOS 和 Windows 的可执行文件。

2. **部署**：
    将对应的二进制文件（例如 `tb-config-mate-linux`）上传到服务器的 `docker-compose.yml` 同级目录。

3. **运行**：

    ```bash
    chmod +x tb-config-mate-linux
    ./tb-config-mate-linux
    ```

    工具会自动打开本地浏览器（如果支持），或者您可以访问控制台输出的地址（默认 `http://localhost:3300`）。

## 📖 使用指南

1. **配置修改**：在 Web 界面中修改对应配置项。修改后，"保存配置" 按钮会变色提示。
2. **保存与应用**：
    * **仅保存配置**：只更新 `.env` 文件，不重启服务。
    * **保存并重启服务**：更新 `.env` 文件并执行 `docker compose restart`。
3. **服务控制**：
    * 点击顶部的 **停止服务** / **重启服务** 按钮可直接控制容器。
    * 点击 **实时日志** 按钮可打开日志窗口，监控服务启动日志。
4. **状态监控**：
    * 右上角的胶囊徽章会显示 `Running` (绿色) 或 `Stopped` (灰色)，每 5 秒自动刷新。

## 📚 文档

* [现场快速使用说明](docs/config-mate-user-quick-start.md)
* [容器化部署说明](docs/config-mate-container-deployment.md)
* [Compose 配置说明](docs/config-mate-compose-simple.md)
* [工程化重构路线](docs/engineering-refactor-roadmap.md)

## 🛠️ 技术栈

* **后端**：Node.js (原生 HTTP 模块, 无 Express 依赖以减小体积)
* **前端**：HTML5, CSS3, Vanilla JS
* **打包**：Vercel Pkg

## 📝 注意事项

* 工具默认端口为 `3300`。
* 请确保运行用户有执行 `docker` 命令的权限。
* 工具会优先读取目录下的 `.env` 文件。

## 📄 License

MIT
