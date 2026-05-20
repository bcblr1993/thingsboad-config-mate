# Config Mate AI 开发规则

本文件用于约束后续所有 Claude / AI 开发行为。除非用户明确覆盖，否则必须遵守。

## 项目定位

Config Mate 是现场部署控制台，界面服务于高频运维操作：清晰、克制、稳定、可扫描。不要把页面做成营销站、展示页或装饰型大屏。

## UI 一致性原则

- 当前项目不直接引入 React 版 shadcn/ui。
- 借鉴 shadcn/ui 的设计系统方式：先使用语义化 token，再使用统一组件类，最后才写模块局部样式。
- 基础样式入口：
  - `assets/styles/tokens.css`：颜色、圆角、阴影、间距、字体、状态色。
  - `assets/styles/base.css`：全局基础样式。
  - `assets/styles/components.css`：按钮、输入框、卡片、弹窗、状态等通用组件。
  - `assets/styles/layout.css`：页面结构和工作台布局。
- 优先复用已有组件类、`--cm-*` 样式变量和当前设计规范。
- 不允许引入新的 UI 风格、颜色体系、圆角体系、阴影体系或按钮/表单/弹窗体系。
- 不允许随意修改全局样式入口。确需修改时，必须说明影响范围，并优先证明局部样式无法满足需求。
- 修改 UI 时不得改变接口、鉴权、Docker 操作、清理逻辑、安装逻辑等业务行为。

## 基准截图规则

- 非明确 UI 改版需求，不允许自动更新 Playwright 或 BackstopJS 基准截图。
- UI 测试失败时，不允许直接执行 `npm run test:ui:update`、`npm run test:visual:init` 或 `npm run test:visual:approve` 来掩盖问题。
- 只有当用户明确要求 UI 改版、视觉调整、更新基准图，或确认当前视觉差异为预期结果时，才允许更新或批准基准截图。

## 强制验证门禁

每次开发完成后，AI 必须自动执行以下命令，不得只给出“建议执行”：

```bash
npm run lint:style
npm run test:ui
npm run test:visual
npm run build
```

`npm run test:visual` 需要本地服务可访问时，先启动项目服务，例如：

```bash
NO_BROWSER=1 PORT=3311 CONFIG_MATE_PASSWORD=123456 node tb-config-src.js --dev
```

## 失败处理

- 如果 UI 测试失败，必须自动分析失败截图、BackstopJS 差异报告、失败选择器和最近改动。
- 必须优先修复导致差异的代码或测试稳定性问题。
- 修复后必须重新执行失败命令，直到通过或明确说明环境阻塞。
- 不允许通过删除测试、放宽阈值、跳过页面、更新基准图来绕过失败，除非用户明确授权。

## 最终输出要求

每次完成开发后，最终回复必须包含测试结果报告，至少列出：

- 已执行的命令。
- 每条命令的通过/失败结果。
- UI 差异是否存在。
- 如果存在失败，说明根因、修复动作和复测结果。
- 是否更新了基准截图；如更新，必须说明用户授权来源。
