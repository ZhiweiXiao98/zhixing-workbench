# 安装与首次验收

## 图形入口

Windows 用户解压 Release 后双击 `安装知行台.cmd`。macOS 与 Ubuntu 用户在解压目录运行：

```bash
sh install-zhixing.sh
```

入口会先检查 Node.js 版本，再要求填写 Obsidian Vault 文件夹。安装完成后，在 Obsidian 的“设置 → 第三方插件”启用“知行台”。

## 浏览器扩展

1. 打开 Chrome、Edge 或 Chromium 的扩展管理页并开启开发者模式。
2. 选择“加载已解压的扩展”，指向安装包的 `packages/browser-extension`。
3. 在 Obsidian 打开“知行台 → 整理记录”，点击钥匙图标复制本机接收密钥。
4. 打开浏览器扩展的“本机连接”，粘贴密钥并点击“保存并检查”。

扩展离线时会保留最多 2000 条待发送事件，每分钟重试一次。密钥只保存在设备配置和浏览器本地存储中。

## Codex 插件

```bash
codex plugin marketplace add ZhiweiXiao98/zhixing-workbench --ref v0.6.0
codex plugin add zhixing-workbench@zhixing-workbench
```

新建 Codex 任务后即可使用 `obsidian-knowledge`、`investigate-work-history` 和 `zhixing-manager`。

## 飞书连接器

飞书为可选数据来源，默认关闭。三端统一安装最新版官方 CLI：

```bash
npm install -g @larksuite/cli@latest
```

1. 打开“知行台 → 整理记录”，点击数据库图标。
2. 确认已检测到 `lark-cli`，选择需要的任务、日程、会议、纪要、文档、Base、审批或项目群消息。
3. 项目群与 Base 开启后，填写精确群名、群 ID/链接和 Base 视图链接；普通用户直接填写群名即可由连接器只读解析。
4. 在预览页核对内容类型，点击“授权所选模块”。浏览器完成飞书设备授权后回到 Obsidian 确认。
5. 点击“确认开启”。完成后状态条显示授权身份、启用范围、最后同步、待整理数量和失败重试。

连接器仅执行只读命令。新增权限通过同一个预览页集中申请；企业策略或资源权限不足时，状态会列出待补权限或不可访问来源。

## 首次验收

1. 左侧知行台图标可以打开日历、成果、任务轨迹、量化分析和整理记录。
2. 整理记录显示 `v0.6.0`，网页采集、知识运行时和飞书入口显示明确状态。
3. 在 ChatGPT 已保存的对话中点击“立即采集当前对话”，扩展显示“已全部发送”。
4. 回到知行台刷新，当天出现 ChatGPT 对话证据。
5. 点击“立即整理”后，处理结果出现在整理记录；失败内容仍留在队列中。
6. 已连接飞书时，点击“立即同步飞书”，当天日历能看到飞书来源；同一明确任务不会因为飞书、Codex 和 Git 证据而机械拆成多项。

## 支持边界

- Obsidian 移动端不启动本机接收器和知识运行时。
- Safari 扩展未包含在首版。
- 自动语义整理需要本机已登录并可调用 Codex CLI。
- Git 扫描只读取本地候选仓库，不上传仓库内容。
- Windows 已验证官方 `lark-cli` 1.0.84 的命令契约与本机只读运行路径；macOS 和 Ubuntu 通过同一 Node 核心、平台安装与虚构契约测试。首个 Release 不宣称三端真实企业飞书账号端到端验收。
- 文档正文、会议纪要和审批详情以当前用户真实可访问范围为准；删除或撤权后保留历史追溯并显示来源状态。
