---
description: 编译并打包 ThingsBoard Config Mate 为全平台独立二进制文件 (Linux/macOS/Windows)
---

# 构建发布版本 (Build Release)

本技能用于将 Node.js 源码打包为无需依赖环境的独立可执行文件。

## 1. 准备工作

确保本地已安装 Node.js (v18+) 和 NPM。

```bash
# 检查 Node 版本
node -v
# 检查 NPM 版本
npm -v
```

## 2. 安装/更新依赖

在构建前，务必确保依赖是最新的。

```bash
npm install
```

## 3. 执行构建命令

使用 `pkg` 工具进行打包。

```bash
npm run build
```

> **说明**: 该命令对应 `package.json` 中的 `pkg . --out-path dist/`，会自动读取 `package.json` 中的 `bin` 入口 (`tb-config-src.js`)。

## 4. 验证构建产物

构建完成后，检查 `dist/` 目录下的产物。

```bash
ls -lh dist/
```

预期输出应包含：

- `tb-config-mate-linux`
- `tb-config-mate-macos`
- `tb-config-mate-win.exe`

## 5. (可选) 本地测试运行

选择当前平台的二进制文件进行测试运行。

```bash
# MacOS 示例
./dist/tb-config-mate-macos --port=3400
```

访问 `http://localhost:3400` 验证服务是否正常启动。
