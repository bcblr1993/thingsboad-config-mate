---
description: 向 ThingsBoard Config Mate 添加新的环境变量配置项 (支持 Cloud/Edge)
---

# 添加配置项 (Add Config Item)

本技能指导如何在可视化界面中增加一个新的配置参数。

## 1. 确定配置元数据位置

根据配置项所属的应用类型 (`CLOUD` 或 `EDGE`)，选择对应的元数据文件：

- **Cloud (Everything)**: `meta/cloud.js`
- **Edge Only**: `meta/edge.js`

## 2. 定义配置对象

在目标 `.js` 文件的 `module.exports` 对象中添加新的 Key。
Key **必须**与 `.env` 文件中的实际环境变量名保持一致（通常全大写，下划线分隔）。

**通用模板:**

```javascript
    "YOUR_ENV_VAR_NAME": {
        label: "配置项显示名称 (中文)",
        group: "分组名称 (如: Database, Security)",
        type: "text", // 可选: text, password, select, number, boolean, readonly
        default: "default_value",
        required: false, // 是否必填
        comment: "详细的中文说明文案，显示在输入框下方",
        // (可选) 下拉选项
        // options: ["OPTION_A", "OPTION_B"],
        // (可选) 依赖关系 (仅当 PARENT_KEY 等于某些值时显示)
        // dependsOn: { key: "PARENT_KEY", value: "TARGET_VALUE" }
    },
```

## 3. 实操示例

假设要添加一个名为 `Rate Limit Enabled` 的开关，对应环境变量 `TB_RATE_LIMIT_ENABLED`:

**步骤 A: 编辑 `meta/cloud.js`**

```javascript
// 找到合适的位置 (例如 API Usage 分组附近)
    "TB_RATE_LIMIT_ENABLED": {
        label: "启用速率限制",
        group: "API Usage",
        type: "select",
        options: ["true", "false"],
        default: "false",
        comment: "开启后，系统将对 API 请求进行速率限制以保护服务稳定性。"
    },
```

## 4. 验证

1. 启动开发服务器: `npm run dev`
2. 打开浏览器访问 `http://localhost:3300`
3. 确认新配置项已出现在指定分组中。
4. 修改值并保存，检查 `.env` 文件是否正确写入了 `TB_RATE_LIMIT_ENABLED=...`。
