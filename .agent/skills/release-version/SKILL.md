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

### 2. 生成变更日志 (Changelog)

运行以下命令获取自上个版本以来的变更摘要：

```bash
# 获取上一版本标签
PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo $(git rev-list --max-parents=0 HEAD))

# 定义临时文件
CHANGELOG_TMP=$(mktemp)

# 生成版本标题和日期
echo "## [$VERSION] - $(date +%Y-%m-%d)" > $CHANGELOG_TMP
echo "" >> $CHANGELOG_TMP

# 提取并分类提交信息
echo "### ✨ 新增 (New)" >> $CHANGELOG_TMP
git log ${PREV_TAG}..HEAD --grep="^feat" --pretty=format:"- %s (%h)" >> $CHANGELOG_TMP
echo "" >> $CHANGELOG_TMP
echo "" >> $CHANGELOG_TMP

echo "### 🐛 修复 (Fixed)" >> $CHANGELOG_TMP
git log ${PREV_TAG}..HEAD --grep="^fix" --pretty=format:"- %s (%h)" >> $CHANGELOG_TMP
echo "" >> $CHANGELOG_TMP
echo "" >> $CHANGELOG_TMP

echo "### 🔄 更新 (Updated)" >> $CHANGELOG_TMP
git log ${PREV_TAG}..HEAD --grep="^chore\|^refactor\|^style\|^perf" --pretty=format:"- %s (%h)" >> $CHANGELOG_TMP
echo "" >> $CHANGELOG_TMP
echo "" >> $CHANGELOG_TMP

# 读取现有 CHANGELOG 内容（跳过标题行，如果不需要保留顶部说明可直接拼接）
# 这里假设 CHANGELOG.md 存在，我们将新内容插入到所有版本记录之前
# 为了简单，我们将新内容 + 旧内容 写入临时文件，然后覆盖

if [ -f "CHANGELOG.md" ]; then
    # 保留文件头 (前6行通常是标题和说明)，然后插入新内容?
    # 简单策略：直接拼接
    cat CHANGELOG.md >> $CHANGELOG_TMP
else
    echo "# Changelog\n\n" > "CHANGELOG.md" 
    cat CHANGELOG.md >> $CHANGELOG_TMP
fi

# 覆盖原文件
mv $CHANGELOG_TMP CHANGELOG.md

echo "✅ CHANGELOG.md has been updated."
cat CHANGELOG.md | head -n 20
```

> 请检查生成的 `CHANGELOG.md` 内容是否正确。

### 3. 更新 package.json

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
```bash
git add package.json CHANGELOG.md
git commit -m "chore: 发布版本 vX.Y.Z 并更新变更日志"
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
