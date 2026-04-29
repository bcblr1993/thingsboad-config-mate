# Config Mate 工程化重构路线

## 目标

Config Mate 后续会持续承担现场安装包配置、服务编排、日志查看、数据清理和审计等能力。为了避免功能继续堆在单文件中，重构目标是：

- 后端按职责拆分，业务逻辑可测试。
- 前端结构、样式、交互分离，减少大 HTML 文件维护成本。
- 容器构建、离线镜像、现场启动说明保持一致。
- 高风险操作必须有白名单、确认、审计和可回滚备份。
- 每次改动都有基础自动检查，避免靠人工刷新页面兜底。

## 当前第一阶段已完成

- `index.html` 只保留页面结构。
- `assets/styles.css` 承载页面样式。
- `assets/app.js` 承载前端交互逻辑。
- `src/server/app-context.js` 统一处理 `APP_ROOT`、`APP_TYPE`、Cloud/Edge 识别。
- `src/server/http.js` 统一处理 JSON 响应和请求体读取。
- `src/server/services/registry.js` 统一维护 Docker 服务白名单和清理数据目录白名单。
- `src/server/docker/compose.js` 统一处理 Docker CLI 探测、Compose v2/v1 兼容、Compose 参数和安全执行。
- `src/server/services/runtime.js` 统一处理服务状态查询和启动/停止/重启动作。
- `src/server/routes/system.js` 统一处理健康检查、登录状态、登录/退出、版本、部署信息等系统路由。
- `test/app-context.test.js` 覆盖现场目录识别规则。
- `test/service-registry.test.js` 覆盖服务注册表 Cloud/Edge 过滤和路径解析。
- `test/docker-compose.test.js` 覆盖 Docker Compose 探测和 fallback。
- `test/service-runtime.test.js` 覆盖服务状态和动作编排。
- `npm run check` 统一执行语法检查和单元测试。

## 推荐目录结构

```text
.
├── assets/                 # 前端静态资源
│   ├── app.js              # 前端交互逻辑
│   └── styles.css          # 页面样式
├── src/
│   └── server/
│       ├── app-context.js  # 安装包识别
│       ├── http.js         # HTTP 工具
│       ├── docker/         # Docker CLI/Compose 封装
│       ├── services/       # 服务注册表、状态、动作
│       ├── config/         # .env/YAML 读写、历史版本
│       ├── audit/          # 审计日志和备份 manifest
│       └── routes/         # API 路由
├── test/                   # 单元测试
├── docs/                   # 现场和维护文档
├── tb-config-src.js        # 入口文件，后续只保留组装逻辑
└── index.html              # 页面结构
```

## 后续阶段

### 第二阶段：后端服务层与路由拆分

把 `tb-config-src.js` 中剩余的 API 路由、日志 SSE、清理备份逻辑拆到独立模块。

验收标准：

- `tb-config-src.js` 只负责启动 HTTP 服务和组装依赖。
- Docker 操作全部通过白名单服务定义执行。
- 服务状态、服务配置展示、清理计划都有单元测试。
- 现有 API 路径保持不变。

当前进度：

- 已完成系统路由拆分：健康检查、登录状态、登录/退出、版本、部署信息。
- 下一步拆分服务路由：服务列表、服务配置、启动/停止/重启、清理计划和清理执行。

### 第三阶段：配置读写层拆分

把 `.env` 解析、保存、历史版本、源码模式、YAML 初始化拆到 `src/server/config/`。

验收标准：

- 保存配置和源码保存都复用同一套备份策略。
- 历史恢复有路径穿越防护测试。
- Cloud/Edge 元数据加载和实际 `.env` 路径保持一致。

### 第四阶段：前端模块化

把 `assets/app.js` 拆成状态管理、API 客户端、服务面板、配置表单、日志窗口、弹窗等模块。

验收标准：

- 前端单个文件不超过 800 行。
- 关键渲染函数有明确输入输出。
- 日志窗口保持最大行数和批量渲染，避免长时间打开卡死。

### 第五阶段：构建与发布标准化

完善 GitHub Actions 和发布文档。

验收标准：

- PR 运行静态检查和单元测试。
- tag 发布生成 `linux/amd64` 和 `linux/arm64` 离线镜像包。
- 现场快速使用说明和 compose 示例与镜像行为一致。

## 每次改动必须执行

```bash
npm run check
git diff --check
```

涉及 Web 页面时，还需要验证：

```bash
APP_ROOT=/path/to/sprixin-iotcloud CONFIG_MATE_PASSWORD=test NO_BROWSER=1 PORT=3311 node tb-config-src.js --dev
curl -I http://localhost:3311/
curl -I http://localhost:3311/assets/app.js
curl -I http://localhost:3311/assets/styles.css
```
