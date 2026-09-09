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

## 关于视觉回归

本项目**不再使用**像素级视觉回归（BackstopJS 与 Playwright `toHaveScreenshot` 已于 2026-09 移除）。

原因：像素基准图对 UI 迭代的阻力远大于它捕获的缺陷。UI 一致性依靠上面的设计系统约定和 code review 保证，不依靠截图比对。

不要重新引入 BackstopJS，也不要新增 `toHaveScreenshot` 断言。

## 验证门禁

每次开发完成后，AI 必须自动执行以下命令，不得只给出“建议执行”：

```bash
npm run check      # 语法检查 + 后端单元测试
npm run test:ui    # Playwright 功能断言
```

涉及构建产物或依赖变更时，追加：

```bash
npm run build
```

`npm run test:ui` 会自行拉起测试服务；如需手工启动：

```bash
NO_BROWSER=1 PORT=3311 CONFIG_MATE_PASSWORD=123456 node tb-config-src.js --dev
```

`npm run lint:style` 为可选项。它当前只产生 warning、不影响退出码，可在专门整理样式时执行。

## 失败处理

- 测试失败时，必须分析失败选择器、报错堆栈和最近改动，优先修复代码或测试稳定性问题。
- 修复后必须重新执行失败命令，直到通过或明确说明环境阻塞。
- 不允许通过删除测试、跳过用例来绕过失败，除非用户明确授权。

## 最终输出要求

每次完成开发后，最终回复必须包含测试结果报告，至少列出：

- 已执行的命令。
- 每条命令的通过/失败结果。
- 如果存在失败，说明根因、修复动作和复测结果。
