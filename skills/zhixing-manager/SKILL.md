---
name: zhixing-manager
description: 安装、诊断、更新或卸载知行台套件，也用于检查飞书只读连接器和数据源状态。用户询问知行台版本、组件健康、跨平台安装、飞书连接、更新检查、回滚或卸载时使用。任何更新与卸载都必须先得到用户确认。
---

# 知行台套件管理

## 原则

- 先运行诊断，再决定操作。
- 安装和更新只替换程序、技能、Hook 与浏览器扩展，不改写 `raw/`、`wiki/`、`成果/`、手写笔记或设备配置。
- 更新、卸载和 Hook 变更必须让用户明确确认；检查更新可以直接执行。
- 不在输出或日志中显示接收密钥。
- 飞书凭据由官方 `lark-cli` 管理。诊断只报告 CLI、授权、模块和同步状态，不显示用户 ID、appId、token、Base token 或群 ID。
- 飞书连接、授权、范围选择、同步和缓存清理优先引导用户使用 Obsidian 的“知行台 → 整理记录 → 数据来源设置”。

## 找到管理程序

从安装状态文件读取 `program_root`：Windows 为 `%APPDATA%/ZhixingWorkbench/install.json`，macOS 为 `~/Library/Application Support/ZhixingWorkbench/install.json`，Linux 为 `${XDG_CONFIG_HOME:-~/.config}/zhixing-workbench/install.json`。开发仓库中可直接使用根目录的 `scripts/zhixing.mjs`。

## 常用动作

```bash
node scripts/zhixing.mjs diagnose
node scripts/zhixing.mjs update --check
node scripts/zhixing.mjs update --confirm
node scripts/zhixing.mjs uninstall --confirm
```

安装需要用户给出或选择 Vault：

```bash
node scripts/zhixing.mjs install --vault "/path/to/vault"
```

## 诊断结果

向非技术用户分别说明：Obsidian 插件、Codex Hook、ChatGPT 接收器、飞书连接器、知识运行时、Node、Codex CLI 和更新源。失败时给出一条可以执行的下一步，不要求用户读代码。
