# 发布与更新

## 统一版本

根包、Obsidian 插件、浏览器扩展、Codex 插件和运行时使用同一语义版本。标签格式为 `v<版本>`。

## Release 资产

标签触发 GitHub Actions：

1. 安装锁定依赖。
2. 运行类型检查、全部测试、生产构建和隐私门禁。
3. 一个候选资产 job 从白名单目录组装四个平台资产，并生成 `update-manifest.json` 和 `SHA256SUMS`。
4. 候选 `release/` 作为单一 GitHub Actions artifact 上传；后续 job 不再重新打包。
5. Windows x64、macOS arm64、macOS x64 和 Ubuntu x64 runner 下载同一 artifact，分别执行对应包根目录入口，并验证安装、诊断、更新、故障回滚、卸载和个人数据保留。
6. 发布 job 只下载已经通过四端验证的同一 artifact，并把其中原始字节发布为稳定 Release。

四个平台共享一套 JavaScript 实现，平台资产只区分安装入口与支持标识。

## 更新事务

更新器下载适配当前平台的资产，核对 SHA256 后解压到临时目录。安装器先备份当前插件、程序、浏览器扩展和需要替换的 Skill，替换失败时恢复安装前状态。安装状态最后写入，个人 Vault 内容与 `device.json` 不参与替换。

浏览器扩展使用设备配置目录下的固定路径；更新只替换该目录内容。Skill 只在套件所有权和内容哈希一致时更新或卸载，用户修改保留并作为冲突报告。

Obsidian 只提示可用更新。实际更新必须由用户在 `zhixing-manager` 或命令行中确认。
