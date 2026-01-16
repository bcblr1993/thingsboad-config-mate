# ThingsBoard Config Mate 用户使用手册

> 版本：v1.4.7 | 更新日期：2026-01-16

## 目录

- [简介](#简介)
- [系统要求](#系统要求)
- [快速开始](#快速开始)
- [命令行参数](#命令行参数)
- [功能说明](#功能说明)
- [常见问题](#常见问题)

---

## 简介

**ThingsBoard Config Mate (TB-CM)** 是一款专为 ThingsBoard Edge/Cloud 设计的可视化配置管理工具。它提供了友好的 Web 界面，让您无需手动编辑配置文件即可管理 ThingsBoard 的环境变量配置。

### 核心功能

- 🎨 **可视化配置编辑** - 分组展示，支持条件依赖
- 🐳 **容器生命周期管理** - 启动/停止/重启服务
- 🕐 **配置版本控制** - 自动备份，支持历史回滚
- 📋 **实时日志查看** - 实时查看容器日志
- 🔍 **运行时配置对比** - 检测本地与容器配置差异

---

## 系统要求

| 组件 | 最低要求 |
|------|----------|
| 操作系统 | Ubuntu 20.04+、CentOS 7+、Rocky Linux 8+ |
| Docker | 20.10+ |
| Docker Compose | v2.0+ (推荐) 或 v1.29+ |

---

## 快速开始

### 1. 下载可执行文件

从 [GitHub Releases](https://github.com/bcblr1993/thingsboad-config-mate/releases) 下载对应平台的可执行文件：

- `tb-config-mate-linux` - Linux 版本
- `tb-config-mate-macos` - macOS 版本
- `tb-config-mate-win.exe` - Windows 版本

### 2. 部署到 ThingsBoard 目录

将可执行文件复制到 ThingsBoard Edge/Cloud 的安装目录（包含 `docker-compose.yml` 的目录）：

```bash
# 下载（以 Linux 为例）
wget https://github.com/bcblr1993/thingsboad-config-mate/releases/download/v1.4.7/tb-config-mate-linux

# 添加执行权限
chmod +x tb-config-mate-linux

# 重命名（可选）
mv tb-config-mate-linux tb-config-mate
```

### 3. 启动工具

```bash
# 前台运行（查看日志）
./tb-config-mate

# 后台运行
./tb-config-mate start

# 指定端口
./tb-config-mate start --port=4000
```

### 4. 访问 Web 界面

打开浏览器访问：`http://服务器IP:3300`

---

## 命令行参数

### 基本用法

```bash
./tb-config-mate [命令] [选项]
```

### 命令列表

| 命令 | 说明 |
|------|------|
| `start` | 后台启动服务 |
| `stop` | 停止后台服务 |
| `restart` | 重启后台服务 |
| `status` | 查看服务状态 |

### 选项

| 选项 | 说明 |
|------|------|
| `--port=N` | 指定服务端口（默认：3300） |
| `-v, --version` | 显示版本号 |
| `-h, --help` | 显示帮助信息 |

### 使用示例

```bash
# 查看版本
./tb-config-mate -v

# 后台启动（端口 4000）
./tb-config-mate start --port=4000

# 查看状态
./tb-config-mate status

# 停止服务
./tb-config-mate stop
```

---

## 功能说明

### 配置编辑

1. **分组展示**：配置项按功能分组，支持展开/折叠
2. **条件依赖**：某些配置项根据其他配置的值显示/隐藏
3. **多种输入类型**：文本、密码、下拉选择、开关
4. **源码模式**：直接编辑原始 `.env` 文件内容

### 容器管理

- **状态显示**：实时显示容器运行状态（Running/Stopped）
- **启动服务**：执行 `docker compose up -d`
- **停止服务**：执行 `docker compose down`（需确认）
- **重启服务**：先停止再启动

### 版本控制

- **自动备份**：每次保存配置自动创建备份
- **历史版本**：查看所有历史版本列表
- **差异对比**：对比当前版本与历史版本差异
- **一键回滚**：恢复到指定历史版本

### 运行时检测

点击刷新按钮可检测：

- 本地 `.env` 文件配置
- 容器内实际运行配置
- 两者之间的差异

### 实时日志

- 实时查看容器日志输出
- 支持自动换行
- 支持清空日志区域

---

## 常见问题

### Q: 页面无法访问？

1. 检查服务是否启动：`./tb-config-mate status`
2. 检查端口是否被占用：`lsof -i:3300`
3. 检查防火墙设置

### Q: 找不到配置文件？

确保在包含以下文件的目录中运行工具：

- `docker-compose.yml`
- `conf/tb-edge.yml`（Edge 模式）或 `conf/thingsboard.yml`（Cloud 模式）

### Q: 保存配置后容器未生效？

修改 `.env` 后需要重启容器才能生效。点击「重启服务」按钮应用新配置。

### Q: 如何查看更多日志？

```bash
# 前台运行查看完整日志
./tb-config-mate
```

---

## 技术支持

- **GitHub Issues**: [提交问题](https://github.com/bcblr1993/thingsboad-config-mate/issues)
- **版本发布**: [Release 页面](https://github.com/bcblr1993/thingsboad-config-mate/releases)

---

© 2026 ThingsBoard Config Mate
