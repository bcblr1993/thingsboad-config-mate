# Styles 清理计划（阶段 6）

## Context

[assets/styles.css](../assets/styles.css) 是从 ThingsBoard Config Mate
诞生时累积下来的单文件样式表，到本次重构时已 **5909 行 / 111KB / 615 处
硬编码颜色值**。它仍是业务页面的视觉主体——不能直接删，但应该**渐进拆
解**到设计系统。

新分层（已建好结构）：

```
assets/styles/
├── tokens.css            # 设计令牌（颜色/间距/圆角/字号）— Slate 主题已落地
├── base.css              # 全局基础（body / scrollbar / ::selection）
├── components.css        # 通用组件（按钮 / 卡片 / 输入 / 徽章 / 弹窗）
├── layout.css            # 顶部 / 内容区 / 底部操作栏
├── pages/                # ★ 本次新建空目录，规划接收 styles.css 中按页拆分的部分
│   └── (deployment.css)
│   └── (config.css)
│   └── (logs.css)
│   └── (history.css)
│   └── (install.css)
```

## 为什么本次不直接动 styles.css

**风险：删错一行 = 视觉立即崩坏，影响生产现场。** styles.css 的 5909 行
互相耦合（同名 class 多处定义、最后一条胜出），没有完整 visual
regression 测试覆盖前，激进重构得不偿失。

## 渐进拆解步骤（每步 1 个 commit、每步可回滚）

### 6.1 字面颜色 → token（最低风险，最大收益）

615 处硬编码颜色（`#2563EB`、`#0F172A`、`#F8FAFC` 等）逐个替换为
`var(--cm-primary)` / `var(--cm-foreground)` / `var(--cm-background)`
等 token。

**做法**：
1. `grep -oE '#[0-9a-fA-F]{6}' assets/styles.css | sort | uniq -c | sort -rn`
   找出现次数最多的颜色
2. 与 [tokens.css](../assets/styles/tokens.css) 对照映射
3. 一次替换一种颜色，每次 commit 后切换主题验证视觉一致

**收益**：将来切换主题（如 dark mode）零代码改动。

### 6.2 按页 / 按模块拆分

把 styles.css 按业务模块切成 `pages/*.css` 文件：

| 拆出内容 | 目标文件 |
|---------|---------|
| 服务卡片、服务详情、cleanup | `pages/deployment.css` |
| 配置分组、字段组、source 编辑器 | `pages/config.css` |
| 日志面板、终端样式、过滤器 | `pages/logs.css` |
| 历史时间线、diff 视图 | `pages/history.css` |
| 安装进度、终端输出 | `pages/install.css` |

**做法**：
1. 选一个模块（先 `install` 因为是最少耦合的）
2. 把对应 selectors 从 styles.css 剪到 `pages/install.css`
3. [index.html](../index.html) 加 `<link rel="stylesheet" href="assets/styles/pages/install.css">`
4. 浏览器对比安装流程视觉
5. 通过则 commit，失败则 revert

### 6.3 去重

styles.css 与 [components.css](../assets/styles/components.css) 已有重叠
（按钮、卡片、输入框）。逐项核对去重，**保留 components.css 版本**。

### 6.4 删除 styles.css

最后一步。所有内容已迁出后，从 [index.html](../index.html) 移除
`<link rel="stylesheet" href="assets/styles.css">`，删除文件。

## 工时预估

| 子阶段 | 内容 | 工期 | 风险 |
|--------|------|------|------|
| 6.1 | 颜色 → token | 1-2 天 | 低（视觉一致即过） |
| 6.2 | install 模块拆分 | 0.5d | 低 |
| 6.2 | logs 模块拆分 | 1d | 中 |
| 6.2 | history 模块拆分 | 1d | 中 |
| 6.2 | deployment 模块拆分 | 2d | 中-高 |
| 6.2 | config 模块拆分 | 2d | 中-高 |
| 6.3 | 去重 | 1d | 中 |
| 6.4 | 删 styles.css | 0.5d | 低 |
| **合计** | | **9-10 天** | |

## 本次（阶段 6 的第一步）做了什么

- ✅ 建立 `assets/styles/pages/` 空目录（含 `.gitkeep`）
- ✅ 写本文档锁定后续路径
- ✅ **不动** styles.css（视觉零回归）

未来 6.1-6.4 子阶段每个都对应一个独立 PR，可单独 review 与合并。
