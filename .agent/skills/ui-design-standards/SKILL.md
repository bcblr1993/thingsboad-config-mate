---
description: 统一 UI/UX 设计规范：提示框、模态框、布局标准及文案风格
---

# UI 设计与交互规范 (UI Design Standards)

本技能旨在确保所有新功能开发遵循统一的视觉风格和交互体验，打造“高端、精致、流畅”的用户界面。

## 1. 核心设计原则

- **视觉统一**: 严格使用定义的 CSS 变量，禁止硬编码颜色 (#Hex)。
- **交互极简**: 优先使用无阻塞的 Toast 提示，阻断性操作必须使用自定义 Modal。
- **微交互**: 按钮、卡片需添加 `hover` 和 `active` 态动画。
- **文案友好**: 使用人性化、清晰的中文提示，避免冷冰冰的报错代码。

## 2. 样式系统 (CSS Variables)

在开发新组件时，**必须**使用以下 CSS 变量：

### 配色方案

| 变量名 | 颜色值 | 用途 |
| :--- | :--- | :--- |
| `--primary` | `#2A7DEC` (蓝) | 主按钮、链接、高亮状态 |
| `--success` | `#00B894` (绿) | 成功提示、运行状态、确认操作 |
| `--danger` | `#D63031` (红) | 错误提示、危险操作（删除/停止） |
| `--bg` | `#F4F7FA` | 全局背景色 |
| `--card-bg` | `#FFFFFF` | 卡片、弹窗背景 |
| `--text` | `#2D3436` | 正文文字 |
| `--border` | `#DFE6E9` | 边框、分割线 |

### 布局与间距

- **圆角**: `--radius: 8px` (所有卡片、按钮统一圆角)
- **阴影**:
  - 常态: `box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04)`
  - 悬停: `box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08)`

## 3. 标准交互组件

### 3.1 消息提示 (Toast)

**禁止使用** `alert()`。所有非阻断性反馈必须使用 `showToast`。

```javascript
// 成功提示 (自动消失)
showToast('✅ 配置保存成功', 'success');

// 错误提示 (红色背景)
showToast('❌ 连接失败，请检查网络', 'error');
```

### 3.2 确认对话框 (Confirm)

**禁止使用** `confirm()`。危险操作必须使用 `customConfirm`。

```javascript
// 参数: (提示内容 HTML, 确认按钮文字, 确认按钮颜色)
if (!await customConfirm('确定要停止服务吗？<br>此操作将中断业务。', '停止服务', '#D63031')) {
    return;
}
// 用户点击确认后继续...
```

### 3.3 模态框 (Modal)

新功能弹窗请复用以下 HTML 结构：

```html
<div id="my-modal" class="modal-overlay">
    <div class="modal-content">
        <div class="modal-header">
            <div class="modal-title">标题</div>
            <div class="close-btn" onclick="closeMyModal()">&times;</div>
        </div>
        <div class="modal-body">
            <!-- 内容区域 -->
        </div>
        <div class="modal-footer">
            <button class="btn btn-ghost" onclick="closeMyModal()">取消</button>
            <button class="btn btn-primary" onclick="submitMyModal()">确定</button>
        </div>
    </div>
</div>
```

## 4. 布局规范

### 4.1 卡片式布局

所有配置项、表单组必须包裹在 `.card` 中。

```html
<div class="card">
    <div class="card-title">基本信息</div>
    <div class="card-content">...</div>
</div>
```

### 4.2 响应式 Grid

对于平铺的配置项，使用 Grid 布局确保自适应：

```css
.group-content {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); /* 宽屏多列，窄屏单列 */
    gap: 12px;
}
```

## 5. 提示信息优化

- **错误信息**: 不要只说 "Error"，要告诉用户 **“发生了什么”、“原因可能是什么”** 以及 **“建议怎么做”**。
  - ❌ `Save failed.`
  - ✅ `保存失败：检测到端口 3300 被占用，请尝试更换端口或关闭相关进程。`
- **加载状态**: 异步操作期间，按钮必须进入 `disabled` 状态并显示 `loading...` 或更改文案（如 `停止中...`），防止重复点击。

## 6. 微交互 (Micro-interactions)

- **按钮**: 必须有 `hover` 变色和 `transform: translateY(-1px)` 的轻微上浮效果。
- **输入框**: `focus` 时必须有 `--primary` 颜色的 `box-shadow` 光晕。
- **列表项**: `hover` 时背景色轻微变深（如 `#F8FAFC`）。
