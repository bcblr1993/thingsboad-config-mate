# UI 一致性测试说明

Config Mate 的 UI 一致性测试由三部分组成：

- Playwright：启动本地应用并生成页面截图快照，用 `toHaveScreenshot` 做自动比对。
- BackstopJS：生成桌面端和移动端视觉差异 HTML 报告，适合人工 review。
- Stylelint：约束 CSS / SCSS / Less / Vue / React 样式写法，尽早发现无效颜色、重复选择器、命名混乱、硬编码样式等问题。

## 覆盖页面

当前基线覆盖以下核心界面：

- 登录页
- 服务管理
- 集群总览
- 平台配置管理
- 初始化安装
- 历史版本弹窗

Playwright 和 Backstop 都会在测试层 mock `/api/*` 响应，避免测试结果依赖现场 Docker 状态、真实服务启停、主机路径或日志输出。

## 第一次生成 Playwright 基准图

Playwright 会自动启动本地服务，默认使用 `http://127.0.0.1:3311`：

```bash
npm run test:ui:update
```

生成的截图基线位于：

```text
tests/ui/__screenshots__/
```

以后普通验证使用：

```bash
npm run test:ui
```

如果页面视觉是有意调整，先确认差异合理，再重新执行：

```bash
npm run test:ui:update
```

## 第一次生成 BackstopJS 基准图

BackstopJS 不负责启动应用，需要先启动 Config Mate：

```bash
NO_BROWSER=1 PORT=3311 CONFIG_MATE_PASSWORD=123456 node tb-config-src.js --dev
```

另开一个终端生成基准图：

```bash
npm run test:visual:init
```

基准图目录：

```text
tests/backstop/reference/
```

## 运行 BackstopJS 视觉对比

先保持本地服务运行：

```bash
NO_BROWSER=1 PORT=3311 CONFIG_MATE_PASSWORD=123456 node tb-config-src.js --dev
```

再执行：

```bash
npm run test:visual
```

测试截图和报告目录：

```text
tests/backstop/test/
tests/backstop/report/
tests/backstop/ci-report/
```

查看最近一次报告：

```bash
npm run test:visual:report
```

如果差异是预期变化，批准当前结果为新基准：

```bash
npm run test:visual:approve
```

## 运行样式规范检查

```bash
npm run lint:style
```

自动修复可修复问题：

```bash
npm run lint:style:fix
```

当前 Stylelint 已支持：

- CSS：`*.css`
- SCSS：`*.scss`
- Less：`*.less`
- Vue 单文件组件：`*.vue`
- React JSX / TSX 中的样式语法：`*.jsx`、`*.tsx`

## 发现差异后怎么处理

1. 先判断是否为真实 UI 变化。
2. 如果是误伤，例如动态文本、时间、动画、加载态导致变化，优先在测试 mock 或截图 mask 中固定它。
3. 如果是无意变化，回到对应 CSS / HTML / JS 修改点修复，再重新运行测试。
4. 如果是预期变化，更新 Playwright 基准图或批准 Backstop 基准图。
5. 提交时同时带上测试配置、基准图和说明，避免后续同事不知道差异来源。

## 推荐验证顺序

```bash
npm run lint:style
npm run test:ui:update
npm run test:ui
NO_BROWSER=1 PORT=3311 CONFIG_MATE_PASSWORD=123456 node tb-config-src.js --dev
npm run test:visual:init
npm run test:visual
npm run check
git diff --check
```
