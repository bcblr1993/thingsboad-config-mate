# Config Mate 前端工程化重构设计方案

> 分支：`feat/frontend-refactor-design`
> 主题：在保证现有功能完全不变的前提下，让前端项目具备更好的工程化能力。
> 原则：**先方案，不动业务代码；先小步，每步可回滚；先必要，不追时髦。**

---

## 一、当前项目现状分析

### 1.1 技术栈快照

| 维度 | 现状 | 文件 |
|------|------|------|
| 框架 | 无（Vanilla JS） | - |
| 模块系统 | 无（IIFE + `window.*` 全局命名空间） | [assets/api.js](../assets/api.js), [assets/modules/*.js](../assets/modules) |
| 构建工具 | 无（pkg 仅用于二进制打包） | [package.json](../package.json) |
| 类型系统 | 无（0 个 JSDoc，0 个 .d.ts） | - |
| 包管理 | npm | - |
| 后端 | Node.js 原生 HTTP，无 Express | [tb-config-src.js](../tb-config-src.js) |
| 路由 | 单页 + anchor 切换（`#deployment-panel`、`#config-workspace`） | [assets/app.js:221-236](../assets/app.js) |
| 状态管理 | 顶层 `var/let` 全局变量 | [assets/app.js:1-26](../assets/app.js) |
| 鉴权 | Cookie session + `setUnauthorizedHandler(401)` | [assets/api.js:34-36](../assets/api.js) |
| 启动方式 | `npm run dev`（端口 3300） | - |

### 1.2 前端代码体量与组织

| 文件 | 大小 | 函数数 | 模式 |
|------|------|--------|------|
| [assets/app.js](../assets/app.js) | **~93KB / 2422 行 / 127 函数** | 主应用逻辑（业务+DOM+状态混合） | 顶层声明 |
| [assets/api.js](../assets/api.js) | 102 行 | IIFE → `window.ConfigMateApi` 暴露 28 个端点 | IIFE |
| [assets/modules/ui-core.js](../assets/modules/ui-core.js) | 4.6KB | toast / modal / confirm / copy | IIFE → `window.ConfigMateUi` |
| [assets/modules/services-ui.js](../assets/modules/services-ui.js) | 12.6KB | 服务卡片渲染、cleanup 模态 | IIFE |
| [assets/modules/logs-ui.js](../assets/modules/logs-ui.js) | 20.1KB | EventSource 日志流（工厂模式 `createLogViewer`） | IIFE 工厂 |
| [assets/modules/history-ui.js](../assets/modules/history-ui.js) | 15.4KB | 配置历史 diff 与恢复（工厂模式 `createHistoryUi`） | IIFE 工厂 |
| [assets/styles.css](../assets/styles.css) | ~111KB | 旧样式，与新 `styles/*.css` 共存 | 单文件 |
| [assets/styles/](../assets/styles/) | tokens/base/components/layout | 新 UI Foundation | 分层 |

### 1.3 加载顺序（[index.html](../index.html)）

```
CSS:  styles.css → tokens.css → base.css → components.css → layout.css
JS:   api.js → ui-core.js → services-ui.js → logs-ui.js → history-ui.js → app.js
```

### 1.4 已有工程化基础（不要忽视）

- ✅ CSS 已分层（tokens / base / components / layout），`--cm-*` 语义化 token 完整。
- ✅ logs-ui / history-ui 已采用**工厂模式 + 依赖注入**（接受 `options.api`, `options.showToast`），是优秀样板。
- ✅ api.js 内置 401 拦截器和 unauthorizedHandler，已有"拦截器"雏形。
- ✅ 后端是无框架原生 HTTP，路由分发清晰（[tb-config-src.js:677-744](../tb-config-src.js)），前端不存在模板渲染耦合。

---

## 二、当前项目主要问题

按"维护痛点"严重度排序：

### P0（直接影响维护效率）

1. **app.js 巨石化**：单文件 93KB / 2422 行 / 127 函数，业务逻辑、DOM 操作、HTTP 调用、状态变更全部混在顶层作用域。任何小改动都得在 2 千多行里搜索。
2. **全局命名空间污染**：`window.ConfigMateApi` / `window.ConfigMateUi` / `window.historyUi` / 顶层 `var`，模块之间无清晰契约。
3. **状态散落**：configValues / configMeta / latestServices / isDirty / isActionPending 等顶层变量分布在 [app.js:1-26](../assets/app.js)、[1485](../assets/app.js)、[1737](../assets/app.js)，没有单一入口可观测。
4. **魔法字符串**：服务状态 `'running'`/`'stopped'`/`'pending'`、操作类型、错误码散布全文，[services-ui.js:2-4](../assets/modules/services-ui.js) 才有局部 const。

### P1（影响新功能开发速度）

5. **API 调用与 UI 耦合**：[app.js:95](../assets/app.js) 把 `showLoginOverlay` 直接传给 API 层做 401 handler。业务层和展示层互相知道。
6. **Loading / 错误处理不统一**：[api.js](../assets/api.js) 只处理 401，其他错误都靠业务代码 `showToast` 散点处理。
7. **无类型保护**：0 JSDoc / 0 TypeScript，函数参数全靠人脑记忆。重构风险大。
8. **路由能力薄弱**：仅 2 个 anchor 切换，未来无法平滑扩展到 5+ 页面或带 query 参数的深链。
9. **表单逻辑分散**：[app.js:974 validateField()](../assets/app.js)、[1303 validateConfig()](../assets/app.js) 各管一段，无统一 schema 表达力。

### P2（工程基建空白）

10. **无构建/打包/产物分发**：所有 JS/CSS 直接走 HTTP 服务，没有压缩、没有 hash、没有 source map。
11. **无 lint / format / 测试**：[package.json scripts](../package.json) 里没有 `lint` / `test` / `format`。
12. **无环境变量分层**：dev/prod 行为靠 `--dev` 命令行 flag，前端没有 envSetup。
13. **无组件库目录**：通用 UI 都在 ui-core.js 一个文件里，未来要加 Tooltip / DatePicker / Tabs 时无落点。

---

## 三、推荐的新工程目录结构

> 关键决策：**继续使用 Vanilla JS + 浏览器原生 ESM**（不引入 Vue/React，不引入 Webpack/Vite），但用 `<script type="module">` 让代码可以 import/export。这是**对当前架构最小侵入**的工程化方式。

```
.
├── assets/                                # 前端根
│   ├── index.html                         # （已存在）入口模板，未来逐步精简
│   ├── styles/                            # 样式分层（已存在，继续延用）
│   │   ├── tokens.css                     # 设计令牌（颜色/间距/圆角/阴影/字号）
│   │   ├── base.css                       # 全局基础
│   │   ├── components.css                 # 组件样式（按钮/卡片/输入）
│   │   ├── layout.css                     # 框架样式（顶部/侧边/主区）
│   │   └── pages/                         # ★ 新增：页面级样式
│   │       ├── deployment.css
│   │       └── config.css
│   │
│   ├── src/                               # ★ 新增：所有 JS 模块的根
│   │   ├── main.js                        # 入口（替代 app.js 顶层）
│   │   │
│   │   ├── core/                          # 基础设施层
│   │   │   ├── http.js                    # HTTP 客户端 + 拦截器（替代 api.js）
│   │   │   ├── store.js                   # 简易响应式状态容器
│   │   │   ├── router.js                  # 基于 hash 的轻量路由
│   │   │   ├── event-bus.js               # 跨模块事件总线
│   │   │   ├── errors.js                  # 错误类型与统一处理
│   │   │   ├── logger.js                  # 日志封装（dev/prod 分级）
│   │   │   └── env.js                     # 环境与运行时配置
│   │   │
│   │   ├── api/                           # 接口层（按域拆分）
│   │   │   ├── auth.api.js                # 鉴权
│   │   │   ├── config.api.js              # 业务配置
│   │   │   ├── service.api.js             # 服务编排
│   │   │   ├── install.api.js             # 初始化
│   │   │   ├── system.api.js              # 系统/运行时
│   │   │   └── index.js                   # barrel export
│   │   │
│   │   ├── services/                      # 业务 service 层（编排 API + 状态）
│   │   │   ├── auth.service.js
│   │   │   ├── deployment.service.js
│   │   │   ├── config.service.js
│   │   │   ├── log.service.js
│   │   │   └── history.service.js
│   │   │
│   │   ├── stores/                        # 各域状态切片
│   │   │   ├── auth.store.js
│   │   │   ├── deployment.store.js
│   │   │   ├── config.store.js
│   │   │   └── ui.store.js                # 全局 UI 状态（loading, toast queue, modal stack）
│   │   │
│   │   ├── pages/                         # 页面级容器（每个一个文件）
│   │   │   ├── deployment.page.js
│   │   │   ├── config.page.js
│   │   │   ├── logs.page.js
│   │   │   └── history.page.js
│   │   │
│   │   ├── components/                    # 可复用 UI 组件
│   │   │   ├── modal/
│   │   │   │   └── modal.js
│   │   │   ├── toast/
│   │   │   │   └── toast.js
│   │   │   ├── table/
│   │   │   │   └── table.js
│   │   │   ├── form/
│   │   │   │   ├── field.js
│   │   │   │   └── validator.js
│   │   │   ├── log-viewer/
│   │   │   │   └── log-viewer.js          # 迁移自 logs-ui.js
│   │   │   └── history-viewer/
│   │   │       └── history-viewer.js      # 迁移自 history-ui.js
│   │   │
│   │   ├── constants/                     # 枚举与魔法值
│   │   │   ├── service-status.js          # running/stopped/pending/error
│   │   │   ├── error-codes.js
│   │   │   ├── routes.js                  # 路由路径
│   │   │   └── ui.js                      # 防抖时长、轮询周期等
│   │   │
│   │   ├── utils/                         # 纯函数工具
│   │   │   ├── dom.js                     # 极简 DOM helper
│   │   │   ├── format.js                  # 日期/字节/百分比格式化
│   │   │   ├── debounce.js
│   │   │   └── permission.js              # 权限工具
│   │   │
│   │   └── types/                         # JSDoc typedef（即 "类型定义"）
│   │       ├── api.types.js               # @typedef + 重导出
│   │       ├── deployment.types.js
│   │       └── config.types.js
│   │
│   └── public/                            # 静态资源
│       ├── favicon.svg
│       └── icons/
│
├── docs/                                  # 文档（已存在）
│   ├── ui-foundation.md                   # 已存在
│   ├── ui-design-system.md                # 已存在（本次新增）
│   ├── frontend-refactor-plan.md          # 本文件
│   └── frontend-architecture.md           # 重构落地后补
│
├── src/server/                            # 后端（不在本方案范围）
└── tb-config-src.js                       # 后端入口
```

---

## 四、各目录职责说明（细化 20 个规范）

### 4.1 目录结构规范

- `core/`：**只能依赖浏览器原生 API**，不依赖任何业务概念。变更频率最低。
- `api/`：**只描述接口**，不含业务流程。一个接口一个函数，返回 Promise。
- `services/`：**业务流程编排**。可调用多个 api、读写 store、发事件。**禁止操作 DOM**。
- `stores/`：**状态容器**。只暴露 get/subscribe/dispatch，不含业务逻辑。
- `pages/`：**装配中心**。订阅 store、调用 service、操作 DOM。**禁止直接调 API**。
- `components/`：**纯 UI**，通过 props 接收数据、通过事件回调通知外部。**禁止读 store**。
- `constants/` / `utils/` / `types/`：**纯函数 / 纯常量**，无副作用。

依赖方向：`pages` → `services` → `api` → `core`；`pages` → `components`；`stores` ↔ `services`。**反向依赖严禁**。

### 4.2 页面分层规范（替代当前的"全在 app.js"）

每个页面文件统一三段式：

```js
// pages/deployment.page.js
import { mount as mountServiceList } from '@/components/service-list/service-list.js';
import { deploymentService } from '@/services/deployment.service.js';
import { deploymentStore } from '@/stores/deployment.store.js';

export function mount(rootEl) {
    // 1. 订阅 store
    const unsub = deploymentStore.subscribe(state => render(rootEl, state));
    // 2. 触发首次数据加载
    deploymentService.refresh();
    // 3. 返回销毁函数
    return () => unsub();
}

function render(rootEl, state) { /* 仅 DOM */ }
```

### 4.3 组件拆分规范

- **粒度**：一个组件 = 一个目录（`components/<name>/`），含 `<name>.js` + 可选 `<name>.css`。
- **契约**：导出 `mount(el, props)` / `update(props)` / `destroy()` 三件套，或工厂函数返回这三个方法（参考已有的 [logs-ui.js](../assets/modules/logs-ui.js) `createLogViewer`）。
- **状态**：组件内部状态用闭包，**不读全局 store**。
- **样式**：组件级样式放同目录 css 文件，class 用 `.cm-<component>-*` 前缀避免冲突。

### 4.4 API 请求封装规范

替代当前 [api.js](../assets/api.js) 单文件 28 端点：

```js
// core/http.js
const interceptors = { request: [], response: [], error: [] };

export const http = {
    async request(url, options = {}) {
        let req = { url, options };
        for (const fn of interceptors.request) req = await fn(req) || req;

        const res = await fetch(req.url, req.options);
        if (!res.ok) {
            const err = new HttpError(res.status, await res.text());
            for (const fn of interceptors.error) await fn(err);
            throw err;
        }
        let payload = await res.json();
        for (const fn of interceptors.response) payload = await fn(payload) || payload;
        return payload;
    },
    use(type, fn) { interceptors[type].push(fn); }
};
```

**强制拦截器**：401 跳登录、全局 loading、5xx 上报、请求超时。

接口按域分文件：
```js
// api/service.api.js
import { http } from '@/core/http.js';
export const serviceApi = {
    list: () => http.request('/api/services'),
    config: (id) => http.request(`/api/services/${id}/config`),
    cleanup: (id) => http.request(`/api/services/${id}/cleanup`, { method: 'POST' })
};
```

### 4.5 业务 Service 层规范

```js
// services/deployment.service.js
import { serviceApi } from '@/api/service.api.js';
import { deploymentStore } from '@/stores/deployment.store.js';
import { uiStore } from '@/stores/ui.store.js';
import { eventBus } from '@/core/event-bus.js';

export const deploymentService = {
    async refresh() {
        uiStore.setLoading('deployment', true);
        try {
            const list = await serviceApi.list();
            deploymentStore.setServices(list);
            eventBus.emit('deployment:refreshed', list);
        } finally {
            uiStore.setLoading('deployment', false);
        }
    },
    async cleanup(serviceId) { /* 编排 */ }
};
```

**规则**：service 函数都 async / 都返回 Promise；只读 store、不直接渲染。

### 4.6 状态管理规范

**不引入 Redux/Pinia**。手写极简响应式 store（约 30 行），满足当前规模：

```js
// core/store.js
export function createStore(initial) {
    let state = initial;
    const listeners = new Set();
    return {
        get: () => state,
        set(next) {
            state = typeof next === 'function' ? next(state) : { ...state, ...next };
            listeners.forEach(fn => fn(state));
        },
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        }
    };
}
```

每个域一个 store 实例。**禁止跨 store 直接读写**，通过 service 协调。

### 4.7 路由管理规范

替代当前 [app.js:221-236 scrollToWorkbenchSection](../assets/app.js)：

```js
// core/router.js
const routes = new Map();
export const router = {
    add(path, handler) { routes.set(path, handler); },
    navigate(path) { window.location.hash = path; },
    start() {
        window.addEventListener('hashchange', dispatch);
        dispatch();
    }
};
function dispatch() {
    const hash = window.location.hash.slice(1) || '/';
    const [path, query] = hash.split('?');
    const handler = routes.get(path);
    if (handler) handler({ query: new URLSearchParams(query) });
}
```

路由表集中：[constants/routes.js](../assets/src/constants/routes.js)。

### 4.8 权限控制规范

```js
// core/auth.js
export const auth = {
    user: null,
    hasRole(role) { return this.user?.roles?.includes(role); },
    canAccess(routePath) { /* 路由级 */ },
    canPerform(action) { /* 操作级 */ }
};
```

页面在 `mount()` 入口检查；按钮通过 `permission.js` 工具决定显隐。

### 4.9 样式和主题规范

- **token 优先**：所有颜色/间距/圆角必须用 `--cm-*`，禁止 hardcode。
- **主题切换**：通过 `:root[data-theme=*]` 覆盖。本次已选定 **Slate Tooling**，定稿后回写到 [tokens.css](../assets/styles/tokens.css) 即可。
- **命名空间**：组件类用 `.cm-<component>-*`；页面专属类用 `.cm-page-<name>-*`。
- **不要 BEM**：用扁平 `.cm-modal-header` 即可，避免 `.modal__header--active` 噪声。
- **不要内联 style**：除非是动态计算值（如百分比进度条宽度）。

### 4.10 类型定义规范

**不引入 TypeScript**（避免引入构建工具）。改用 **JSDoc + .d.ts hint**：

```js
// types/deployment.types.js
/**
 * @typedef {Object} ServiceInfo
 * @property {string} id
 * @property {string} name
 * @property {'running'|'stopped'|'pending'|'error'} status
 * @property {string} image
 * @property {number} cpuPercent
 */
export {};
```

VSCode / WebStorm 都能识别。后续如团队规模扩大，可平滑迁到 .d.ts 或 TS。

### 4.11 常量和枚举管理规范

```js
// constants/service-status.js
export const SERVICE_STATUS = Object.freeze({
    RUNNING: 'running',
    STOPPED: 'stopped',
    PENDING: 'pending',
    ERROR: 'error'
});

export const SERVICE_STATUS_LABEL = Object.freeze({
    [SERVICE_STATUS.RUNNING]: '运行中',
    [SERVICE_STATUS.STOPPED]: '已停止',
    // ...
});
```

**强制规则**：任何字符串字面量在代码里出现两次以上，必须提到 constants。

### 4.12 错误处理规范

三层处理：

| 层 | 责任 |
|----|------|
| HTTP 层 | 抛 `HttpError`（含 status / code / message） |
| Service 层 | 捕获 HttpError，转成 `BizError` 或重抛；**禁止吞错** |
| Page 层 | 捕获后调用 `toast.error()` 或定向跳转 |

```js
// core/errors.js
export class HttpError extends Error { constructor(status, body) { super(); this.status = status; this.body = body; } }
export class BizError extends Error { constructor(code, message) { super(message); this.code = code; } }
```

### 4.13 Loading 和异常状态处理规范

**集中在 `ui.store.js`**：

```js
uiStore.setLoading('deployment', true);   // 任意业务可注册命名 loading
uiStore.setLoading('deployment', false);
```

UI 层订阅 `uiStore` 来决定是否显示骨架屏/Spinner。**所有按钮的 disabled 都来自命名 loading**，不再用 [app.js:1485 isActionPending](../assets/app.js) 这种散点标志。

异常态：
- 空数据 → 空状态组件
- 加载失败 → 错误占位 + 重试按钮
- 鉴权失败 → 自动跳登录（已具备）
- 网络错误 → 顶部全局 banner

### 4.14 表单处理规范

替代当前 [app.js:974](../assets/app.js)、[1303](../assets/app.js) 分散校验：

```js
// components/form/validator.js
export function validate(values, schema) { /* 返回 { ok, errors } */ }

// 调用方
const schema = {
    name: [required(), pattern(/^[a-z0-9-]+$/), maxLength(32)],
    port: [required(), range(1, 65535)]
};
const result = validate(formValues, schema);
```

字段组件统一：`<input class="cm-field-input"> + 错误态 .is-error + 帮助文 .cm-field-helper`，以 [components.css](../assets/styles/components.css) 的通用组件为准。

### 4.15 表格列表页规范

每个列表页都遵循相同的结构：

```
PageHeader (标题 + 操作)
  ↓
KPI 卡片组（可选）
  ↓
Toolbar (搜索 + 筛选 + 排序)
  ↓
Table (含 hover、分页、空状态)
  ↓
分页器（独立组件）
```

抽 `components/table/table.js` 统一处理列定义、行点击、分页、加载态。

### 4.16 弹窗组件规范

统一 `components/modal/modal.js`，API：

```js
const modal = createModal({ title, body, footer, size: 'sm|md|lg' });
modal.open();
modal.close();
```

**禁止**直接操作 DOM 加 `.is-open`。所有 [confirm-modal](../index.html)、[diff-modal](../index.html) 等都走这个组件。

### 4.17 移动端适配规范

- **断点**：`< 768px` / `768-1023px` / `≥ 1024px`
- **侧边栏**：< 768px 收起为抽屉
- **表格**：< 768px 启用横向滚动（`overflow-x: auto`）
- **表单**：`cm-form-grid` 自动从 2 列 → 1 列
- **触摸**：所有按钮最小 36px 高，符合可点击区域
- **测试**：CI 加 Playwright 设备视口测试（远期）

### 4.18 环境变量和配置规范

前端无构建工具，环境变量靠后端注入：

```html
<!-- index.html 加一个 inline script，后端模板替换或 SSE 推送 -->
<script>
    window.__CM_ENV__ = {
        apiBase: '/api',
        wsBase: '/ws',
        version: '__VERSION__',
        appType: 'CLOUD'
    };
</script>
```

`core/env.js` 读取 `window.__CM_ENV__`，其他模块只从这里取。

### 4.19 构建和部署规范

**第一阶段不引入构建工具**。原生 ESM 即可工作（现代浏览器已支持 `<script type="module">`）。

**第二阶段（可选）**引入 esbuild（单二进制、零配置）：

```bash
esbuild assets/src/main.js --bundle --minify --outfile=assets/dist/main.js
```

打包产物加 hash 通过后端 ETag 自动管理。

### 4.20 后续模块扩展规范

新增一个业务模块的标准动作：

1. `constants/<module>.js` — 该域的枚举常量
2. `types/<module>.types.js` — JSDoc 类型
3. `api/<module>.api.js` — 接口定义
4. `services/<module>.service.js` — 业务编排
5. `stores/<module>.store.js` — 状态
6. `pages/<module>.page.js` — 页面装配
7. `constants/routes.js` 注册路由
8. 顶部导航 + 侧边菜单加入口

→ Pull Request 模板里加 checklist。

---

## 五、重构迁移路线（六个阶段，每个阶段独立可发布）

| 阶段 | 目标 | 影响范围 | 工期估计 | 可回滚 |
|------|------|---------|---------|--------|
| **0** | 设计方案 + 分支 + 团队对齐 | 仅文档 | 1 天 | ✓ |
| **1** | 引入 ESM 基础设施（core/）+ 改造 api.js 为 http.js + 新旧并存 | api 层 | 2-3 天 | ✓ |
| **2** | 抽 store + ui.store（loading/toast）+ services 层骨架 | 状态管理 | 3-4 天 | ✓ |
| **3** | 拆 app.js：每次抽 1 个业务域到 pages/services（先 logs，再 history，再 services，再 config） | 业务模块 | 1-2 周 | 每域独立回滚 |
| **4** | 落地路由 + 权限工具 + 表单 schema 校验 | 跨页能力 | 1 周 | ✓ |
| **5** | 引入 lint / format / 基础测试 / esbuild（可选） | 工程基建 | 3-5 天 | ✓ |
| **6** | 清理 styles.css 旧样式 + 统一组件库 | 视觉 | 1 周 | ✓ |

总计：3-4 周（单人 / 半时）。

---

## 六、第一阶段最小改造方案（最重要的一步）

> **目标**：让"新架构"和"老代码"能在同一个页面同时运行，每改一行都能立即看到效果，**任何时候停手都不破坏现有功能**。

### 6.1 改动清单（约 7 个新文件 + 1 行 HTML 变更）

```diff
# 新增（不动旧文件）
+ assets/src/core/http.js                  # 新 HTTP 层（包装现有 fetch）
+ assets/src/core/store.js                 # 极简 store
+ assets/src/core/event-bus.js             # 事件总线
+ assets/src/core/env.js                   # 环境
+ assets/src/api/index.js                  # 等同旧 ConfigMateApi，但用 ESM 重导出
+ assets/src/main.js                       # ESM 入口（空壳）
+ assets/src/bridge.js                     # ★ 关键：把 ESM 模块挂到 window.* 兼容旧代码

# 修改（仅 1 处）
  index.html
+ <script type="module" src="assets/src/main.js"></script>   # 在旧脚本之前
```

### 6.2 兼容桥（bridge.js）的作用

```js
// assets/src/bridge.js
import { http } from './core/http.js';
import { eventBus } from './core/event-bus.js';
// ...

// 把新模块挂到全局，让 app.js 老代码不用改也能用上新能力
window.__CM__ = { http, eventBus /* ... */ };

// 同时也保留 window.ConfigMateApi 调用（让 api.js 继续生效）
```

### 6.3 验证

- `npm run dev` 启动后，业务页面所有功能正常（登录、部署、配置、日志、历史）
- 浏览器控制台执行 `window.__CM__.http` 能拿到新 HTTP 客户端
- 浏览器控制台执行 `window.ConfigMateApi.authStatus()` 仍然返回原结果

### 6.4 回滚

```bash
# 删除 6 个新文件 + 还原 index.html 一行
git checkout main -- index.html
rm -rf assets/src
```

零成本回滚。

---

## 七、风险控制方案

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 浏览器不支持 ESM | 极低 | 高 | 现代浏览器 96%+ 支持，运维控制台用户用现代浏览器；保留 `<script nomodule>` 降级到 app.js |
| ESM 和 IIFE 混用产生重复执行 | 中 | 中 | bridge.js 严格单向挂载；任何模块**最多 import 一次**；用 `assert` 检测重复 |
| 重构过程导致已有 bug 修复丢失 | 中 | 高 | 每个阶段独立 PR；强制 code review；保留 git blame 链路 |
| 性能下降（小文件多请求） | 低 | 低 | 阶段 5 引入 esbuild bundling；Cloudflare/Nginx 启 HTTP/2 |
| 团队不适应模块化思维 | 中 | 中 | 出 1 份《新模块开发示例》文档 + Pair coding |
| 服务端静态文件路径变更 | 低 | 中 | 静态服务 [tb-config-src.js:641 serveStaticAsset](../tb-config-src.js) 已经按 `/assets/**` 通配，不会因子目录失效 |

**关键原则**：

1. **每阶段独立可发布**：不留半成品分支。
2. **新旧并行至少一周**：阶段 3 拆分时，先双写（新代码运行 + 旧代码做 fallback 校对），观察一周再剔除旧代码。
3. **业务零中断**：所有重构 PR 必须附"功能回归测试 checklist"，覆盖登录 / 部署 / 配置 / 日志 / 历史 / 安装 6 大场景。

---

## 八、验证方案

### 8.1 自动化（远期）

```bash
npm run lint                 # ESLint + stylelint
npm run test:unit            # 纯函数单测（utils / validator / store）
npm run test:e2e             # Playwright 跑核心用户路径
npm run check                # 已有的 node scripts/check.js
```

### 8.2 人工回归（每阶段必做）

| 场景 | 操作 | 通过标准 |
|------|------|---------|
| 登录 | 输入正确账号 → 期望进入工作台 | 看到 deployment-panel |
| 鉴权失败 | 401 模拟 → 期望跳登录 | 自动 logout |
| 服务编排 | 点击启动/重启/停止 | 状态徽章变化、toast 出现 |
| 配置编辑 | 修改 .env 字段 → 保存 | 脏标恢复、底部 action-bar 消失 |
| 日志查看 | 点击服务日志 → 实时流 | 终端滚动、过滤可用 |
| 历史回滚 | 选版本 → diff → 恢复 | 配置回到旧值 |
| 初始化 | 触发 install | 进度条 + 终端日志 |
| 移动端 | 拖窄到 < 768px | 抽屉、表格横滚 |

### 8.3 性能基线

- 首屏白屏时间：保持 ≤ 当前
- 主 JS 体积：阶段 5 之后 < 200KB gzipped
- API 响应：无回归

---

## 九、后续扩展建议

### 9.1 已选定主题落地

你已选定 **Slate Tooling**。建议**阶段 1 之前的预备工作**直接做：

主题已统一沉淀到 [tokens.css](../assets/styles/tokens.css) 的 `:root`，后续只在 token 层调整颜色。

### 9.2 优先级建议

| 优先做 | 暂缓 |
|--------|------|
| ✅ 阶段 1（基础设施） | ❌ 引入 React/Vue（成本远大于收益） |
| ✅ 阶段 3 拆 logs / history（已经是工厂模式，最易拆） | ❌ 引入 TypeScript（先用 JSDoc 过渡） |
| ✅ 阶段 4 路由（为多页面扩展铺路） | ❌ 引入 Tailwind（已有 token 系统更合适） |
| ✅ Slate 主题回写 | ❌ 引入 Storybook（团队规模未达到） |

### 9.3 哪些地方先不动（明确边界）

| 不动 | 理由 |
|------|------|
| [tb-config-src.js](../tb-config-src.js) 后端逻辑 | 不在本方案范围 |
| [config-meta.js](../config-meta.js) 配置元数据 | 是数据契约，影响后端 |
| [assets/styles.css](../assets/styles.css) 旧样式 | 阶段 6 才动，保证视觉零回归 |
| Docker 打包流程 | 与前端解耦，不需改 |
| pkg 二进制构建 | 仅打包 Node，与前端无关 |

### 9.4 哪些地方先重构（最易出成果）

| 先重构 | 理由 |
|--------|------|
| [api.js](../assets/api.js) 102 行 → http.js | 小、独立、影响面清晰 |
| [logs-ui.js](../assets/modules/logs-ui.js) / [history-ui.js](../assets/modules/history-ui.js) | 已是工厂模式，迁 ESM 几乎 0 改动 |
| 抽 constants / utils | 纯函数，安全 |
| 抽 ui.store + loading | 立竿见影减少 [app.js:1485 isActionPending](../assets/app.js) 类散点状态 |

### 9.5 需要你确认的事项

1. **方案整体方向是否同意？** 关键决策："继续 Vanilla + 原生 ESM"，不引入 React/Vue/Webpack/Vite。
2. **是否同意先把 Slate 主题回写到 tokens.css 作为预备工作？** （影响视觉、不改逻辑）
3. **重构节奏**：每周一个阶段，还是每两周一个阶段？
4. **是否需要团队评审会议？** 我可以再产出 1 份《迁移示例 PR》作为 Day 1 落地参考。

---

## 附录 A · 关键文件索引

| 描述 | 路径 |
|------|------|
| 后端入口 | [tb-config-src.js](../tb-config-src.js) |
| 静态文件路由 | [tb-config-src.js:641-675](../tb-config-src.js) |
| HTML 入口 | [index.html](../index.html) |
| 旧 API 层 | [assets/api.js](../assets/api.js) |
| 主应用逻辑 | [assets/app.js](../assets/app.js) |
| UI 工具集 | [assets/modules/ui-core.js](../assets/modules/ui-core.js) |
| 服务编排 UI | [assets/modules/services-ui.js](../assets/modules/services-ui.js) |
| 日志 UI（工厂模式） | [assets/modules/logs-ui.js](../assets/modules/logs-ui.js) |
| 历史 UI（工厂模式） | [assets/modules/history-ui.js](../assets/modules/history-ui.js) |
| 新设计系统 | [docs/ui-design-system.md](./ui-design-system.md) |
| UI Foundation 历史 | [docs/ui-foundation.md](./ui-foundation.md) |
