# 知行台套件

知行台套件把 Obsidian 变成一个可追溯的个人知识工作台：自动收集 Codex、ChatGPT 和用户主动连接的飞书资料，按真实任务整理每日成果，再把可复用经验写成两层知识。

- **我的经历**：用自然中文记录目标、阻碍、判断、行动、结果和下次怎么做。
- **AI 证据**：保存问题、根因、失败尝试、验证方式和原始来源，供后续检索核验。
- **知行台**：在日历、成果、任务轨迹、量化分析和整理记录中查看每天发生了什么。

## 支持平台

| 平台 | 支持与验证 |
| --- | --- |
| Windows x64 | 支持；发布门禁在 Windows runner 执行真实安装包生命周期 |
| macOS Apple Silicon | 支持；发布门禁在 `macos-15` arm64 runner 执行真实安装包生命周期 |
| macOS Intel | 支持；发布门禁在 `macos-15-intel` x64 runner 执行真实安装包生命周期 |
| Ubuntu x64 | 支持；发布门禁在 Ubuntu runner 执行真实安装包生命周期 |
| Chrome / Edge / Chromium | ChatGPT 自动采集 |
| 飞书 / Lark | 可选只读连接器，需要官方 `lark-cli` 和用户授权 |
| Safari | 暂未支持浏览器采集 |

## 安装

1. 从 [Releases](https://github.com/ZhiweiXiao98/zhixing-workbench/releases) 下载与你系统对应的压缩包并解压。
2. 确认已安装 Node.js 22 或更高版本。Windows 双击根目录的 `安装知行台.cmd`；macOS 与 Ubuntu 在解压目录运行：

```bash
sh install-zhixing.sh
```

3. 在 Obsidian 的“设置 → 第三方插件”启用“知行台”。
4. 打开知行台的“整理记录”，点击文件夹图标打开浏览器扩展的固定目录；在 Chrome、Edge 或 Chromium 中选择“加载已解压的扩展”并指向这个目录。
5. 点击钥匙图标复制本机接收密钥，在扩展的“本机连接”中粘贴并检查连接。
6. 安装器会追加知行台自己的 Codex Hook，并保留原有 Hook；使用命令行安装时可用 `--skip-hooks` 跳过。

### 可选：连接飞书

先安装飞书官方 CLI：

```bash
npm install -g @larksuite/cli@latest
```

在“知行台 → 整理记录”点击数据库图标，按五步向导连接飞书、选择模块、选择项目群和多维表格、预览范围并确认开启。项目群可以输入群名查找，或从最近使用列表中直接选择；多维表格可以输入名称查找，再选择数据表与视图，也可以粘贴飞书知识库或 Base 链接自动识别。连接器默认关闭，只使用当前用户身份做只读采集；授权凭据由 `lark-cli` 保管，不写入 Vault。

首版实际支持程度：

| 模块 | 支持内容 |
| --- | --- |
| 任务 | 分配给当前用户的任务、推进、完成和阻塞状态 |
| 日程与会议 | 当前用户参加的日程、会议记录和可发现的录制结果 |
| 会议纪要 | 有权限的总结、章节、明确待办和决策 |
| 文档与 Wiki | 当前用户近期明显编辑过的文档发现、版本和有权读取的正文 |
| Base | 用户明确选择的 Base、表和视图，支持指定字段投影 |
| 审批 | 当前用户已办、已发起审批及有权读取的实例结果 |
| 消息 | 用户选择的项目群内，提及本人、本人工作结论或含明确任务、决策、问题、方案、交付链接的消息；提及时保留相邻必要上下文 |

同一飞书对象按对象 ID 和版本增量更新；跨来源只有在项目和 Issue/任务标识等明确线索一致时才自动归并，避免把相似标题误合并。

也可以把本仓库作为 Codex 插件市场加入，再安装三个中文 Skill：

```bash
codex plugin marketplace add ZhiweiXiao98/zhixing-workbench --ref v0.6.1
codex plugin add zhixing-workbench@zhixing-workbench
```

## 首次验收

打开 Obsidian 左侧的日历账本图标：

1. “成果”页能看到匿名欢迎样例或新采集的任务。
2. “整理记录”页能分别看到 Codex Desktop、CLI Hook、网页接收、知识执行器、后台调度和飞书的配置、探活、最后事件与错误状态。
3. 在 ChatGPT 当前页面点击扩展的“采集本页”，队列应从“待发送”变成“已全部发送”。
4. 回到 Obsidian，状态中的“最近接收”时间应更新；原始记录位于 Vault 的 `raw/chatgpt/events/`。
5. 完成一轮 Codex Desktop 对话后，桌面采集状态应显示最后事件时间；即使采集异常，“立即整理”仍可处理已有队列。
6. 后台调度显示心跳后可以关闭 Obsidian；电脑在 23:30 睡眠或离线时，会在恢复后补跑已有队列。

## 更新

知行台只检查公开 Release，不会静默更新。可以在 Obsidian 的组件状态中检查新版本，也可以运行：

```bash
node scripts/zhixing.mjs update --check
node scripts/zhixing.mjs update --confirm
```

更新前会备份当前程序并验证 SHA256。浏览器扩展始终更新到同一个设备目录，更新后在浏览器扩展管理页点击一次“重新加载”即可继续使用。更新范围只包含插件、运行时、套件拥有且未被用户修改的 Skill、Hook 程序和浏览器扩展；不会覆盖 `raw/`、`wiki/`、`成果/`、手写笔记或设备配置。

首次安装发现同名 Skill 时会先备份，卸载时恢复。已经被用户修改的 Skill 会保留并报告冲突，不会静默覆盖或删除。

## 诊断与卸载

```bash
node scripts/zhixing.mjs diagnose
node scripts/zhixing.mjs uninstall --confirm
```

卸载只移除知行台程序和它追加的 Hook，默认保留全部 Vault 数据。删除个人数据必须由用户在 Vault 中单独操作。

## 隐私

- 接收器只监听 `127.0.0.1`，每台设备首次安装时生成独立随机密钥。
- 密钥保存在设备配置中，不进入仓库、Release 或日志。
- 飞书内容只通过官方 `lark-cli` 读取，不执行资料中的命令或提示词，不发送到互联网搜索，也不启用任何飞书写回。
- Vault 只保存来源对象、版本、时间、可打开链接和知识整理所需内容，不保存飞书 access token 或 app secret。
- 仓库中的 Vault 内容全部是虚构样例。
- 发布流程会扫描工作树和完整 Git 历史，阻止私人路径、凭据和真实项目材料进入公开资产。

## 开发

```bash
npm run bootstrap
npm run verify
npm run package:release
```

技术设计见 [架构决策](docs/architecture.md)、[安装与首次验收](docs/installation.md)、[隐私边界](docs/privacy.md) 和 [发布更新](docs/release.md)。

## 许可证

[MIT](LICENSE) · Copyright (c) 2026 肖志伟
