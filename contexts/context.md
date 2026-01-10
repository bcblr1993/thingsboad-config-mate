# Project Context: ThingsBoard Config Mate

## 1. 项目概述
**ThingsBoard Config Mate** 是一个用于配置和管理 ThingsBoard Docker 环境的轻量级 GUI 工具。
它作为一个单一的可执行文件（通过 `pkg` 打包）运行，提供 Web 界面来修改 `thingsboard.yml` 环境变量、管理服务生命周期（Docker Compose）以及查看实时日志。

- **GitHub 仓库**: [bcblr1993/thingsboad-config-mate](https://github.com/bcblr1993/thingsboad-config-mate)
- **当前版本**: `v1.0.5`

## 2. 技术栈
- **Runtime**: Node.js (v18+)
- **Backend Framework**: Express.js (轻量级 API 服务)
- **Frontend**: Vanilla HTML/CSS/JavaScript (单文件 `index.html`，不仅是静态页，还包含所有 UI 逻辑)
- **Packaging**: `pkg` (将 Node 源码打包为 Linux/macOS/Windows 可执行文件)
- **External Dependencies**:
  - `docker-compose`: 必须在宿主机安装并配置好环境变量。

## 3. 核心功能与实现机制

### 3.1 配置文件解析
- **位置**: 同级目录下的 `thingsboard.yml` (或 `docker-compose.yml` 中的环境变量部分)。
- **机制**: 后端读取 YAML 文件，提取 `THINGSBOARD_` 等环境变量，通过 API 返回给前端。
- **源码模式**: 支持直接编辑 YAML 原始内容。

### 3.2 服务控制 (Service Control)
- **控制方式**: 通过 `child_process.exec` 调用宿主机的 `docker-compose` 命令。
- **竞态处理 (Race Configuration)**:
  - 为了防止后端状态轮询 (`checkStatus`) 与用户手动操作 (`stop`/`restart`) 冲突，前端引入了 `isActionPending` 标志位。
  - 当用户点击操作时，`isActionPending = true`，轮询暂停更新 UI。
  - 操作完成（或失败）后，恢复轮询。

### 3.3 实时日志 (Real-time Logs)
- **通信**: Server-Sent Events (SSE) `/api/logs`。
- **实现**: 后端通过 `docker-compose logs -f` 获取流，实时推送给前端。

### 3.4 UI 交互 (v1.0.5 升级)
- **Toast 通知**: 替代原生 `alert()`，提供更友好的成功/失败反馈。
- **Modal 确认框**: 替代原生 `confirm()`，提供带有颜色警告（如红色停止按钮）的操作确认。
- **状态锁 (Dirty Check)**:
  - "保存配置" 和 "保存并重启" 按钮默认禁用。
  - 只有当 UI 检测到配置变更 (Dirty State) 时才会激活。

## 4. CI/CD 工作流
- **工具**: GitHub Actions (`.github/workflows/release.yml`)
- **触发条件**: 推送 `v*` 开头的 Tag (如 `v1.0.5`)。
- **产物**: 自动构建 Linux, macOS, Windows 三端二进制文件，并发布到 GitHub Releases。
- **权限**: Workflow 必须配置 `permissions: contents: write` 才能创建 Release。

## 5. 开发指南

### 5.1 本地运行
```bash
# 安装依赖
npm install

# 开发模式启动 (需本地有 thingsboard.yml)
npm start

# 构建二进制文件
npm run build
# 产物在 dist/ 目录下
```

### 5.2 版本发布流程
```bash
# 1. 提交代码
git add .
git commit -m "feat: 描述变更"
git push

# 2. 打标签触发发布
git tag v1.0.x
git push origin v1.0.x
```

### 5.3 常用维护命令
- **清理旧 Tag**: `git tag -d v1.0.x && git push --delete origin v1.0.x`
- **查看 Logs**: 前端调用 `showLogs(true)` 可进入手动监控模式。

## 6. 最近会话重点 (v1.0.0 -> v1.0.5)
- **v1.0.0**: 初始化项目，上传 GitHub。
- **v1.0.1**: 修复 Release 403 权限错误。
- **v1.0.2**: 修复按钮状态竞态问题 (Mutex Logic)。
- **v1.0.3**: 初步引入 Toast 和 Modal UI。
- **v1.0.4**: 优化保存按钮的可用状态逻辑。
- **v1.0.5**: 彻底移除所有遗留的 `alert/confirm`，修复 UI 一致性。

此文件旨在帮助 AI Agent 快速理解项目上下文，接手后续开发。
