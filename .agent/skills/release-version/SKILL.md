---
name: release-version
description: 发布新版本 - 确保 package.json 版本号与 Git Tag 一致
---

# 发布新版本工作流

本 Skill 用于规范 ThingsBoard Config Mate 的版本发布流程，确保 `package.json` 版本号与 Git Tag 保持一致。

## 前置条件

1. 所有功能开发已完成
2. 代码已提交到 `main` 分支
3. 确定新版本号（遵循语义化版本规范 SemVer）

## 发布步骤

### 1. 确定版本号

询问用户目标版本号，格式为 `X.Y.Z`，例如 `1.4.8`

### 2. 更新 package.json

```bash
# 修改 package.json 中的 version 字段
```

将 `"version": "旧版本号"` 更新为 `"version": "新版本号"`

### 3. 验证版本号

```bash
// turbo
node tb-config-src.js -v
```

确认输出 `ThingsBoard Config Mate vX.Y.Z` 与目标版本一致

### 4. 提交版本更新

```bash
git add package.json
git commit -m "chore: 更新版本号至 vX.Y.Z"
git push origin main
```

### 5. 创建并推送 Git Tag

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

### 6. 验证发布

- 确认 GitHub Actions 自动触发构建
- 检查 Release 页面是否生成发布包

## 版本号规范

- **主版本号 (Major)**: 不兼容的 API 变更
- **次版本号 (Minor)**: 向后兼容的功能新增
- **修订号 (Patch)**: 向后兼容的问题修复

## 注意事项

> [!IMPORTANT]
> 每次发布新版本前必须先更新 `package.json` 中的 `version` 字段，确保与 Git Tag 完全一致。

> [!WARNING]
> 请勿直接创建 Tag 而不更新 `package.json`，否则命令行和页面显示的版本号将不正确。
