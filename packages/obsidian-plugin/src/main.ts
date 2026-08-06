import { Notice, Plugin, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import { ActivityService, isActivityPath } from "./activity-service";
import { updateGraphConfigText } from "./graph-filter";
import { ACTIVITY_LEDGER_VIEW_TYPE, ActivityLedgerView } from "./view";
import { SuiteService } from "./suite-service";

interface PluginData {
  graphDenoiseInitialized?: boolean;
}

export default class ActivityLedgerPlugin extends Plugin {
  private service!: ActivityService;
  private suite!: SuiteService;

  async onload(): Promise<void> {
    this.service = new ActivityService(this.app);
    this.suite = new SuiteService(this.app, this.manifest.version);
    this.registerView(ACTIVITY_LEDGER_VIEW_TYPE, (leaf: WorkspaceLeaf) => new ActivityLedgerView(leaf, this.service, this.suite));

    this.addRibbonIcon("calendar-range", "打开知行台", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-activity-ledger",
      name: "打开知行台",
      callback: () => void this.activateView()
    });
    this.addCommand({
      id: "refresh-activity-ledger",
      name: "刷新知行台数据",
      callback: () => void this.service.refresh()
    });
    this.addCommand({
      id: "organize-activity-artifacts",
      name: "重新整理成果笔记",
      callback: () => void this.service.refresh()
    });
    this.addCommand({
      id: "simplify-global-graph",
      name: "简化关系图（隐藏自动成果）",
      callback: () => void this.setGraphDenoise("enable", true)
    });
    this.addCommand({
      id: "restore-global-graph",
      name: "恢复关系图中的自动成果",
      callback: () => void this.setGraphDenoise("disable", true)
    });

    const schedule = (file: TAbstractFile) => {
      if (isActivityPath(file.path)) {
        this.service.scheduleRefresh();
      }
    };
    this.registerEvent(this.app.vault.on("create", schedule));
    this.registerEvent(this.app.vault.on("modify", schedule));
    this.registerEvent(this.app.vault.on("delete", schedule));
    this.registerEvent(this.app.vault.on("rename", schedule));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.service.scheduleRefresh()));
    this.registerInterval(window.setInterval(() => this.service.scheduleRefresh(), 5 * 60 * 1000));

    const data = await this.loadData() as PluginData | null;
    if (!data?.graphDenoiseInitialized) {
      const applied = await this.setGraphDenoise("enable", false);
      if (applied) {
        await this.saveData({ ...data, graphDenoiseInitialized: true } satisfies PluginData);
      }
    }
    void this.suite.start().catch((error: unknown) => console.error("Zhixing suite failed to start", error));
  }

  async onunload(): Promise<void> {
    this.service.destroy();
    await this.suite.stop();
    this.app.workspace.detachLeavesOfType(ACTIVITY_LEDGER_VIEW_TYPE);
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(ACTIVITY_LEDGER_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: ACTIVITY_LEDGER_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private async setGraphDenoise(mode: "enable" | "disable", notify: boolean): Promise<boolean> {
    const graphPath = `${this.app.vault.configDir}/graph.json`;
    try {
      const exists = await this.app.vault.adapter.exists(graphPath);
      const current = exists ? await this.app.vault.adapter.read(graphPath) : "{}";
      const updated = updateGraphConfigText(current, mode);
      if (!updated.ok) {
        throw new Error(updated.error ?? "无法更新关系图配置");
      }
      if (updated.changed) {
        await this.app.vault.adapter.write(graphPath, updated.content);
      }
      if (notify) {
        new Notice(mode === "enable" ? "关系图简洁模式已开启，重新打开关系图即可查看" : "关系图已恢复显示自动成果");
      }
      return true;
    } catch (error) {
      console.error("Activity Ledger graph filter update failed", error);
      if (notify) {
        new Notice(`关系图设置失败：${error instanceof Error ? error.message : String(error)}`);
      }
      return false;
    }
  }
}
