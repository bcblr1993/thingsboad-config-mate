# UI 测试说明

Config Mate 的 UI 测试由两部分组成：

- **Playwright**：启动本地应用，对关键交互做功能断言（路由切换、导航锁定、确认弹窗、配置计数、异步指标保持等）。
- **Stylelint**：约束 CSS 写法，发现无效颜色、重复选择器、硬编码样式等问题。当前只产生 warning，不影响退出码。

> **关于视觉回归**：本项目曾使用 BackstopJS 和 Playwright `toHaveScreenshot` 做像素级比对，已于 2026-09 移除。
> 原因是像素基准图对 UI 迭代的阻力远大于它捕获的缺陷——每次正常的界面调整都要重新审批一批基准图。
> UI 一致性现在依靠 [ui-design-system.md](ui-design-system.md) 的设计系统约定和 code review 保证。
> 请不要重新引入 BackstopJS，也不要新增 `toHaveScreenshot` 断言。

## 覆盖范围

当前用例覆盖以下界面与交互：

- 登录页渲染与未登录状态下跳过启动检查
- 服务管理页服务卡片渲染
- 集群总览页 KPI 渲染与路由往返后异步指标保持
- 平台配置管理页字段渲染、分组计数与依赖过滤的一致性
- 初始化安装页日志按钮、安装期间导航锁定与阶段进度
- 动作确认弹窗不等待慢接口即时弹出
- 历史版本弹窗列表渲染

测试层会 mock `/api/*` 响应，避免结果依赖现场 Docker 状态、真实服务启停、主机路径或日志输出。
Mock 定义见 [tests/ui/fixtures/api.ts](../tests/ui/fixtures/api.ts)。

## 运行

```bash
npm run test:ui
```

Playwright 会按 [playwright.config.ts](../playwright.config.ts) 自行拉起测试服务（默认端口 3311）。
如需手工启动服务：

```bash
NO_BROWSER=1 PORT=3311 CONFIG_MATE_PASSWORD=123456 node tb-config-src.js --dev
```

测试报告输出到 `tests/ui/report/`，失败时会附带截图与 trace。

## 运行样式检查

```bash
npm run lint:style        # 只报告
npm run lint:style:fix    # 自动修复可修复项
```

## 新增用例的原则

- **断言行为，不断言像素**。断言元素可见、文本内容、元素数量、按钮启用状态，而不是整页外观。
- 用稳定的选择器：优先 `id`、`data-*` 属性，避免依赖 class 组合或 DOM 层级。
- 新增交互功能时补充对应用例，尤其是涉及"操作期间锁定"、"确认弹窗"、"轮询状态收敛"这类容易回归的逻辑。
