# Config Mate UI 基座设计说明

## 背景

当前项目是静态 HTML、Vanilla JS 和 CSS 组织方式，不适合直接引入 React 版 shadcn/ui。更合理的方式是借鉴 shadcn 的设计系统思想：把视觉规则抽象为 token，把常用控件抽象为组件语义，再逐步迁移具体页面。

## 文件分层

```text
assets/styles/
├── tokens.css      # 颜色、状态、圆角、阴影、间距、字体
├── base.css        # 全局基础样式
├── components.css  # 按钮、输入框、卡片、弹窗、状态等通用组件
└── layout.css      # 页面框架、头部、工作台、底部操作栏
```

旧文件 `assets/styles.css` 暂时保留，新增样式文件在它之后加载，用于逐步覆盖和收敛旧风格。

## Token 规则

新增样式优先使用 `--cm-*` 变量，例如：

- `--cm-background`
- `--cm-foreground`
- `--cm-card`
- `--cm-border`
- `--cm-primary`
- `--cm-success`
- `--cm-warning`
- `--cm-danger`
- `--cm-radius-md`
- `--cm-shadow-sm`

保留旧变量别名：

- `--primary`
- `--bg`
- `--card-bg`
- `--text`
- `--muted`
- `--border`
- `--success`
- `--danger`
- `--radius`

这样可以先兼容旧 CSS，再逐步把旧样式迁移到 `--cm-*`。

## 迁移顺序

1. 服务编排 UI：统一服务卡片、按钮、状态徽章、配置详情表格。
2. 日志 UI：统一终端、工具栏、过滤器、全屏状态。
3. 历史版本 UI：统一弹窗、列表、diff 查看器、操作按钮。
4. 初始化安装 UI：统一进度、日志和结果状态。
5. 业务配置表单：统一分组导航、字段卡片、输入框、底部操作栏。

## 设计原则

- 运维控制台优先清晰和稳定，不做营销式视觉。
- 颜色只表达层级、状态和风险，不做无意义装饰。
- 页面结构用统一 section/header/toolbar/content 模式。
- 高风险操作必须视觉上可识别，但不要破坏整体秩序。
- 所有新增 UI 必须可在小屏和宽屏下保持信息可读。
