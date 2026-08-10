# 更新记录

## 0.6.2 - 待发布

- 修复 Windows 旧计划任务 XML 缺少 `Enabled` 时被误判为禁用的问题，并在 0.6.1 安装上自动纠正恢复状态。
- 迁移时精确移除并备份旧 `obsidian-capture.ps1` Hook；保留无关 Hook，卸载时安全恢复并保护用户修改。

## 0.6.1 - 2026-08-06

- 修正 Release 根目录的 Windows、macOS 和 Ubuntu 安装入口，并让三端 CI 解包真实资产执行安装生命周期。
- 增加 Codex Skill 所有权、首次安装备份、失败恢复、用户修改冲突保护和 0.6.0 安全认领升级。
- 将浏览器扩展固定到设备配置目录，安装、诊断、Obsidian 入口、文档和更新统一使用同一路径。
- 增加私人版 0.5.0 插件、接收密钥和已确认旧计划任务的可逆迁移，保留全部个人数据。
- 增加 ChatGPT DOM 采集冒烟测试，以及 macOS、Ubuntu 桌面进程常见 Codex 与 `lark-cli` 路径发现。

## 0.6.0 - 2026-08-06

- 首次公开发布知行台套件。
- 支持 Windows x64、macOS Apple Silicon、macOS Intel 和 Ubuntu x64。
- 提供 Obsidian 工作台、Codex 与 ChatGPT 自动采集、主题队列、双层 Wiki 和事务重试。
- 提供默认关闭的飞书只读连接器，覆盖任务、日程、会议纪要、文档/Wiki、指定 Base、审批结果和筛选后的项目群消息。
- 提供安装、诊断、更新、回滚、卸载、隐私扫描与 GitHub Release 流程。
