# Config Mate 设计系统

> 与 [ui-foundation.md](./ui-foundation.md) 配合阅读：foundation 描述"分层与迁移工程进度"，本文描述"未来视觉规范"。

## 概览

Config Mate 是一个运维控制台。视觉风格定位为 **企业级、克制、稳定**。颜色仅用于表达层级 / 状态 / 风险，不做装饰；空间感来自留白和层级，而不是阴影或渐变。

本设计系统基于 CSS 变量（`--cm-*` token），不依赖任何前端框架，可以在纯 HTML 页面里直接使用。

### 预览方式

重构版不再保留独立 UI 预览页，避免把设计草稿带入生产镜像。视觉验证以
`index.html` 的实际业务页面、Playwright 截图和 Backstop 基准图为准。

---

## 颜色

### 语义化分层

| 用途 | Token | 默认值（蓝） | 说明 |
|------|-------|-------------|------|
| 页背景 | `--cm-background` | `#F6F8FB` | 整个页面最底层 |
| 卡片 / 浮层 | `--cm-surface` `--cm-card` | `#FFFFFF` | 内容承载面 |
| 弱表面 | `--cm-surface-muted` | `#F8FAFC` | 表头、toolbar 底色 |
| 边框（主） | `--cm-border` | `#D8E2EE` | 卡片、表格外边框 |
| 边框（弱） | `--cm-border-subtle` | `#E7EDF5` | 表格行分隔、内分割 |
| 主文字 | `--cm-foreground` | `#111827` | 正文、数据 |
| 辅助文字 | `--cm-muted` | `#667085` | 标签、辅助说明 |
| 极弱文字 | `--cm-muted-foreground` | `#7A8699` | placeholder、占位 |

### 主色与状态色

| 用途 | Token | 默认值 |
|------|-------|--------|
| 主色 | `--cm-primary` | `#2563EB` |
| 主色 hover | `--cm-primary-hover` | `#1D4ED8` |
| 主色弱底 | `--cm-primary-soft` | `#EFF6FF` |
| 成功 | `--cm-success` / `-soft` / `-border` | `#059669` / `#ECFDF5` / `#A7F3D0` |
| 警告 | `--cm-warning` / `-soft` / `-border` | `#D97706` / `#FFFBEB` / `#FDE68A` |
| 危险 | `--cm-danger` / `-soft` / `-border` | `#DC2626` / `#FEF2F2` / `#FECACA` |
| 信息 | `--cm-info` / `-soft` | `#0284C7` / `#F0F9FF` |

### 使用规则

- **不为美观叠加颜色**。每一处颜色必须对应一个含义：层级、状态、风险。
- **状态色不与主色混用**。例如"运行中"用 `--cm-success`，不要用主蓝。
- **危险动作必须可识别**：危险按钮使用 `--cm-danger-soft` 底 + `--cm-danger` 文字，hover 时反白。

---

## 字体

### 字号层级（6 级）

| 层级 | 字号 | 字重 | 行高 | 用途 |
|------|------|------|------|------|
| Display | 22px (`--cm-text-xl`) | 600 | 1.3 | 页面大标题 |
| H2 | 18px (`--cm-text-lg`) | 600 | 1.35 | 区块标题 |
| H3 | 15px (`--cm-text-md`) | 600 | 1.4 | 卡片标题、表单组标题 |
| Body | 14px (`--cm-text-base`) | 400 | 1.55 | 正文、表单字段值 |
| Small | 13px (`--cm-text-sm`) | 400 | 1.5 | 辅助文字、表格内容 |
| Caption | 12px (`--cm-text-xs`) | 500 | 1.4 | 标签、徽章、breadcrumb |

### 字族

- 正文：系统字体（已封装为 `--cm-font-sans`）
- 代码：等宽字体（已封装为 `--cm-font-mono`），用于镜像版本号、配置 key、命令、日志

---

## 间距

`--cm-space-1` 至 `--cm-space-8` 对应 4 / 8 / 12 / 16 / 20 / 24 / 32 像素。

### 推荐用法

- 字段内联：`--cm-space-1`（4）
- 字段与标签：`--cm-space-2`（8）
- 卡片内 padding：`--cm-space-5`（20）
- 区块之间：`--cm-space-6`（24）至 `--cm-space-8`（32）
- 顶部导航与主区：`--cm-space-6`（24）水平

---

## 圆角

| Token | 值 | 用途 |
|-------|-----|------|
| `--cm-radius-xs` | 4 | 标签、tag |
| `--cm-radius-sm` | 6 | 小按钮、menu item |
| `--cm-radius-md` | 8 | 按钮、输入框 |
| `--cm-radius-lg` | 10 | Alert、提示条 |
| `--cm-radius-xl` | 14 | 卡片、模态框 |
| `--cm-radius-full` | 999 | 头像、徽章 |

---

## 阴影

| Token | 用途 |
|-------|------|
| `--cm-shadow-sm` | 卡片默认（极弱） |
| `--cm-shadow-md` | hover 提升、轻悬浮元素 |
| `--cm-shadow-lg` | 模态框、底部操作栏（粘性） |

阴影 **不用于装饰**，只在层级真正改变时使用。

---

## 组件规范

### 按钮

| 类型 | Class | 触发场景 |
|------|-------|---------|
| 主操作 | `.cm-btn.cm-btn-primary` | 表单提交、确认操作 |
| 默认 | `.cm-btn` | 次要操作 |
| 幽灵 | `.cm-btn.cm-btn-ghost` | 工具栏轻量操作 |
| 危险 | `.cm-btn.cm-btn-danger` | 删除、销毁、不可逆 |
| 图标 | `.cm-btn.cm-btn-icon` | 工具栏单图标 |
| 小尺寸 | `.cm-btn.cm-btn-sm` | 表格内联操作 |

**规则**：一屏内 **最多一个** `cm-btn-primary`。多个并列操作时只对主路径用主色。

### 输入框

`.cm-field-input` — 36px 高、md 圆角、focus 时主色边框 + ring。错误态加 `.is-error`，下方接 `.cm-field-error`。

### 卡片

`.card`（沿用现有） — `--cm-radius-xl` 圆角 + `--cm-shadow-sm`。内 padding 默认 `--cm-space-5`。

### 表格

- 表头：`--cm-surface-muted` 底，`--cm-text-xs` 大写字母 + `letter-spacing: 0.04em`
- 行：14px padding，hover 切到 `--cm-surface-muted`
- 操作列：右对齐，使用 `cm-btn-sm`

### 状态徽章

`.cm-badge.<status>` — running / stopped / pending / error / info。徽章内含 6px 圆点 + 文字，full 圆角。

### 弹窗

最大宽度 480px（确认）/ 720px（表单）。
- header：标题左 + 关闭按钮右
- body：正文 + 可选表单
- footer：右对齐按钮组，次要在左、主要在右

### 空状态

`.cm-preview-empty` — 居中图标 + 标题 + 描述 + 单个 CTA。**不要**在空状态里堆按钮。

---

## 布局

### 顶层结构（推荐）

```
┌────────────────────────────────────────────────┐
│ 顶部导航 (56px)                                  │
├──────────┬──────────────────────────────────────┤
│ Sidebar  │ Page Header                           │
│ (240px)  ├──────────────────────────────────────┤
│          │ Content                               │
│          │   KPI / Toolbar / Table / Form ...    │
└──────────┴──────────────────────────────────────┘
```

### 响应式断点

| 宽度 | 行为 |
|------|------|
| `≥ 1024px` | 双栏（Sidebar 240px + 内容自适应） |
| `768-1023px` | Sidebar 折叠为图标栏 72px |
| `< 768px` | Sidebar 完全收起，顶部出现汉堡按钮触发抽屉 |

### 内容区最大宽度

主区 `max-width: 1320px` + 居中。超宽屏不让内容拉得过宽，提升可读性。

---

## 页面布局模板

### 列表页（最常见）

```
Page Header (标题 + 面包屑 + 操作按钮)
  ├── KPI 卡片组（可选，4 张）
  ├── 工具条（搜索 + 筛选 + 排序）
  ├── 数据表格（含分页）
  └── 空状态（如果无数据）
```

### 详情页

```
Page Header (标题 + 状态徽章 + 操作组)
  ├── 摘要卡片组（KPI 风格，3-4 张）
  ├── 标签页（基本信息 / 配置 / 日志 / 历史）
  └── 标签内容
```

### 表单页

```
Page Header (标题 + 取消/保存按钮)
  ├── 表单卡片 1（基础信息）
  ├── 表单卡片 2（高级选项）
  └── 底部固定操作栏 (.action-bar)
```

---

## 迁移路径（指给未来）

1. **本期（阶段 0）**：完成预览页 + 三主题切换。
2. **阶段 1**：用户定稿主题 → 把对应主题的颜色覆盖回写到 [assets/styles/tokens.css](../assets/styles/tokens.css)。业务页面**自动继承**，无需改 HTML。
3. **阶段 2**：在 [index.html](../index.html) 引入左侧菜单结构。这是破坏性改动，需单独立项。
4. **阶段 3**：按 [ui-foundation.md](./ui-foundation.md) 的既定顺序（服务编排 → 日志 → 历史 → 安装 → 表单）替换旧 `styles.css`。
5. **阶段 4**：删除 `assets/styles.css`，仅保留 `styles/*.css` 分层。

---

## 关键文件

| 文件 | 说明 |
|------|------|
| [assets/styles/tokens.css](../assets/styles/tokens.css) | 设计令牌（颜色 / 圆角 / 间距 / 字号） |
| [assets/styles/base.css](../assets/styles/base.css) | 全局基础样式 |
| [assets/styles/components.css](../assets/styles/components.css) | 通用组件样式 |
| [assets/styles/layout.css](../assets/styles/layout.css) | 页面框架样式 |
