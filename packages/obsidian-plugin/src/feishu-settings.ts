import { Modal, Notice, Setting, setIcon, type App } from "obsidian";
import type { FeishuConnectorConfig, SuiteService } from "./suite-service";
import {
  createBaseSelection,
  readableSelectionLabel,
  type FeishuBaseCandidate,
  type FeishuBaseTable,
  type FeishuBaseView
} from "./feishu-base-picker";
import {
  createChatSelection,
  type FeishuChatCandidate
} from "./feishu-chat-picker";
import { isFeishuAuthorizationRequired } from "./feishu-cli-result";
import { runFeishuAuthorizationFlow } from "./feishu-authorization-flow";

const MODULES = [
  ["tasks", "我的任务", "分配给我的任务及状态变化"],
  ["calendar", "日程", "我参加的日程"],
  ["meetings", "会议", "我参加过的会议和结果"],
  ["minutes", "会议纪要与妙记", "有权访问的总结、待办和决策"],
  ["documents", "文档与 Wiki", "我创建或明显编辑过的资料"],
  ["base", "多维表格", "明确选择的 Base 视图"],
  ["approvals", "审批结果", "与我有关的已办和已发起结果"],
  ["messages", "项目群消息", "明确选择的项目群中的工作结论" ]
] as const;

export class FeishuSetupModal extends Modal {
  private step = 0;
  private config?: FeishuConnectorConfig;
  private authorizationStarted = false;
  private authorizationReady = false;
  private authorizationLabel = "";
  private busy = false;
  private chatQuery = "";
  private chatCandidates: FeishuChatCandidate[] = [];
  private chatLookupMessage = "";
  private baseQuery = "";
  private baseCandidates: FeishuBaseCandidate[] = [];
  private baseTables: FeishuBaseTable[] = [];
  private baseViews: FeishuBaseView[] = [];
  private pickerBase?: FeishuBaseCandidate;
  private selectedTableId = "";
  private selectedViewId = "";
  private baseLookupMessage = "";

  constructor(app: App, private readonly suite: SuiteService) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("zhixing-feishu-modal");
    void this.load();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async load(): Promise<void> {
    this.config = await this.suite.getFeishuConfig();
    await this.refreshAuthorization();
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    const heading = root.createDiv({ cls: "zhixing-feishu-heading" });
    const icon = heading.createSpan({ cls: "zhixing-feishu-icon" });
    setIcon(icon, "message-square-more");
    const title = heading.createDiv();
    title.createEl("h2", { text: "连接飞书" });
    title.createDiv({ cls: "zhixing-feishu-step-label", text: `${this.step + 1} / 5 · ${stepTitle(this.step)}` });
    const progress = root.createDiv({ cls: "zhixing-feishu-progress" });
    for (let index = 0; index < 5; index += 1) progress.createSpan({ cls: index <= this.step ? "is-active" : "" });
    const body = root.createDiv({ cls: "zhixing-feishu-body" });
    if (!this.config) {
      body.createDiv({ cls: "zhixing-feishu-loading", text: "正在读取连接状态…" });
      return;
    }
    if (this.step === 0) this.renderConnect(body);
    else if (this.step === 1) this.renderModules(body);
    else if (this.step === 2) this.renderSelections(body);
    else if (this.step === 3) this.renderPreview(body);
    else this.renderConfirm(body);
    this.renderActions(root);
  }

  private renderConnect(parent: HTMLElement): void {
    const health = this.suite.snapshot().feishu;
    const statusKind = health.cli === "missing" ? "unavailable" : this.authorizationReady ? "ready" : "attention";
    const status = parent.createDiv({ cls: `zhixing-feishu-status is-${statusKind}` });
    const statusIcon = status.createSpan();
    setIcon(statusIcon, health.cli === "missing" ? "triangle-alert" : this.authorizationReady ? "badge-check" : "shield-alert");
    const statusText = status.createDiv();
    statusText.createEl("strong", { text: health.cli === "missing" ? "未检测到 lark-cli" : this.authorizationReady ? `${this.authorizationLabel || "飞书"}已授权` : "需要授权飞书" });
    statusText.createSpan({ text: health.cli === "missing" ? "请先安装最新版 lark-cli，再回到这里检测。" : this.authorizationReady ? health.message : "选择模块后，可在下一步完成个人授权。" });

    const refresh = parent.createEl("button", { text: "重新检测" });
    refresh.disabled = this.busy;
    refresh.addEventListener("click", () => void this.refresh());
    if (health.enabled) {
      const pause = parent.createEl("button", { text: "暂停飞书同步" });
      pause.addEventListener("click", () => void this.pause());
      const cache = parent.createEl("button", { cls: "mod-warning", text: "清理飞书本地缓存" });
      cache.addEventListener("click", () => void this.clearCache());
    }
    parent.createDiv({ cls: "zhixing-feishu-privacy", text: "授权由飞书官方 CLI 保管。知行台不保存 access token，也不会向飞书写入内容。" });
  }

  private renderModules(parent: HTMLElement): void {
    for (const [key, label, description] of MODULES) {
      new Setting(parent)
        .setName(label)
        .setDesc(description)
        .addToggle((toggle) => toggle.setValue(Boolean(this.config?.modules[key])).onChange((value) => {
          if (this.config) this.config.modules[key] = value;
        }));
    }
  }

  private renderSelections(parent: HTMLElement): void {
    if (!this.authorizationReady) {
      this.renderAuthorizationGate(parent);
      parent.createDiv({ cls: "zhixing-feishu-privacy", text: "完成授权后，才会显示群聊和多维表格选择。私聊与未选择的内容不会进入知行台。" });
      return;
    }
    if (this.config?.modules.messages) {
      const group = parent.createDiv({ cls: "zhixing-feishu-selection" });
      group.createEl("h3", { text: "项目群" });
      group.createDiv({ text: "输入群名查找，或从最近使用的项目群中直接选择。" });
      this.renderSelectedChats(group);
      const lookup = group.createDiv({ cls: "zhixing-feishu-chat-lookup" });
      const input = lookup.createEl("input", { type: "text", placeholder: "例如：AI研发小组" });
      input.value = this.chatQuery;
      input.disabled = this.busy || !this.authorizationReady;
      input.addEventListener("input", () => { this.chatQuery = input.value; });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); void this.lookupChat(); }
      });
      const search = lookup.createEl("button", { text: this.busy ? "正在查找" : "查找" });
      search.disabled = this.busy || !this.authorizationReady;
      search.addEventListener("click", () => void this.lookupChat());
      const recent = lookup.createEl("button", { text: "最近使用" });
      recent.disabled = this.busy || !this.authorizationReady;
      recent.addEventListener("click", () => void this.browseRecentChats());
      this.renderChatCandidates(group);
      if (this.chatLookupMessage) group.createDiv({ cls: "zhixing-feishu-chat-message", text: this.chatLookupMessage });
    }
    if (this.config?.modules.base) {
      const base = parent.createDiv({ cls: "zhixing-feishu-selection" });
      base.createEl("h3", { text: "多维表格" });
      base.createDiv({ text: "输入名称查找，或直接粘贴飞书中的多维表格链接。知识库链接也可以。" });
      this.renderSelectedBases(base);
      const lookup = base.createDiv({ cls: "zhixing-feishu-base-lookup" });
      const input = lookup.createEl("input", { type: "text", placeholder: "例如：AI 开发任务；也可以粘贴飞书链接" });
      input.value = this.baseQuery;
      input.disabled = this.busy || !this.authorizationReady;
      input.addEventListener("input", () => { this.baseQuery = input.value; });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); void this.lookupBase(); }
      });
      const search = lookup.createEl("button", { text: this.busy ? "正在查找" : "查找" });
      search.disabled = this.busy || !this.authorizationReady;
      search.addEventListener("click", () => void this.lookupBase());
      const recent = lookup.createEl("button", { text: "最近使用" });
      recent.disabled = this.busy || !this.authorizationReady;
      recent.addEventListener("click", () => void this.browseRecentBases());
      this.renderBaseCandidates(base);
      this.renderBasePicker(base);
      if (this.baseLookupMessage) base.createDiv({ cls: "zhixing-feishu-base-message", text: this.baseLookupMessage });
    }
    if (!this.config?.modules.messages && !this.config?.modules.base) {
      const empty = parent.createDiv({ cls: "zhixing-feishu-empty" });
      setIcon(empty.createSpan(), "list-checks");
      empty.createSpan({ text: "当前模块不需要额外选择范围" });
    }
    parent.createDiv({ cls: "zhixing-feishu-privacy", text: "私聊、未选择的群和未选择的 Base 默认不会进入知行台。" });
  }

  private renderPreview(parent: HTMLElement): void {
    const enabled = MODULES.filter(([key]) => this.config?.modules[key]);
    const summary = parent.createDiv({ cls: "zhixing-feishu-preview" });
    summary.createEl("h3", { text: `将开启 ${enabled.length} 个只读模块` });
    for (const [, label, description] of enabled) {
      const row = summary.createDiv();
      setIcon(row.createSpan(), "check");
      row.createDiv().createEl("strong", { text: label });
      row.createSpan({ text: description });
    }
    if (this.config?.modules.messages) {
      const policy = parent.createDiv({ cls: "zhixing-feishu-policy" });
      setIcon(policy.createSpan(), "shield-check");
      policy.createSpan({ text: "消息只保留提及你、你发出的工作结论，或含明确任务、决策、问题、方案与交付链接的内容。" });
    }
    const health = this.suite.snapshot().feishu;
    if (health.cli !== "missing") {
      const auth = parent.createEl("button", { cls: "mod-cta zhixing-feishu-primary", text: this.authorizationStarted ? "正在等待飞书授权" : this.authorizationReady ? "补充所选模块权限" : "连接飞书" });
      auth.disabled = this.busy;
      auth.addEventListener("click", () => void this.authorize());
    }
  }

  private renderConfirm(parent: HTMLElement): void {
    const summary = parent.createDiv({ cls: "zhixing-feishu-confirm" });
    metric(summary, "模块", String(Object.values(this.config?.modules || {}).filter(Boolean).length));
    metric(summary, "项目群", String(this.config?.selected_chats.length || 0));
    metric(summary, "Base 视图", String(this.config?.selected_bases.length || 0));
    metric(summary, "同步间隔", `${this.config?.sync_interval_minutes || 60} 分钟`);
    new Setting(parent).setName("开启飞书只读同步").setDesc("错过同步后会在 Obsidian 下次启动时补跑")
      .addToggle((toggle) => toggle.setValue(Boolean(this.config?.enabled)).onChange((value) => { if (this.config) this.config.enabled = value; }));
    const interval = new Setting(parent).setName("同步间隔");
    interval.addDropdown((dropdown) => dropdown
      .addOptions({ "30": "30 分钟", "60": "1 小时", "120": "2 小时", "360": "6 小时" })
      .setValue(String(this.config?.sync_interval_minutes || 60))
      .onChange((value) => { if (this.config) this.config.sync_interval_minutes = Number(value); }));
    if (!this.authorizationReady) parent.createDiv({ cls: "zhixing-feishu-warning", text: "尚未完成个人授权，飞书同步暂时不会启动。" });
  }

  private renderActions(parent: HTMLElement): void {
    const actions = parent.createDiv({ cls: "zhixing-feishu-actions" });
    const close = actions.createEl("button", { text: "取消" });
    close.addEventListener("click", () => this.close());
    if (this.step > 0) {
      const back = actions.createEl("button", { text: "上一步" });
      back.addEventListener("click", () => { this.step -= 1; this.render(); });
    }
    const next = actions.createEl("button", { cls: "mod-cta", text: this.step === 4 ? "确认开启" : "下一步" });
    next.disabled = this.busy;
    next.addEventListener("click", () => void this.next());
  }

  private async next(): Promise<void> {
    if (!this.config) return;
    if (this.step === 1 && !Object.values(this.config.modules).some(Boolean)) {
      new Notice("请至少选择一个飞书模块");
      return;
    }
    if (this.step === 2) {
      if (this.config.modules.messages && this.config.selected_chats.length === 0) {
        new Notice("已开启项目群消息，请至少选择一个项目群");
        return;
      }
      if (this.config.modules.base && this.config.selected_bases.length === 0) {
        new Notice("已开启 Base，请至少选择一个 Base 视图");
        return;
      }
    }
    if (this.step < 4) {
      this.step += 1;
      if (this.step === 4) this.config.enabled = true;
      this.render();
      return;
    }
    this.busy = true;
    await this.suite.saveFeishuConfig(this.config);
    if (this.config.enabled) await this.suite.runFeishuSyncNow(true);
    this.close();
  }

  private async authorize(): Promise<void> {
    if (!this.config || this.busy) return;
    this.busy = true;
    this.render();
    try {
      const status = await runFeishuAuthorizationFlow({
        begin: async () => { await this.suite.beginFeishuAuthorization(this.config!); },
        onWaiting: () => {
          this.authorizationStarted = true;
          this.render();
          new Notice("请在飞书官方页面确认，完成后这里会自动连接");
        },
        complete: async () => { await this.suite.completeFeishuAuthorization(); },
        readState: async () => this.suite.getFeishuUserAuthorization()
      });
      this.authorizationReady = status.ready;
      this.authorizationLabel = status.label || "";
      if (!this.authorizationReady) throw new Error("飞书没有确认授权，请重新连接");
      this.chatLookupMessage = "";
      this.baseLookupMessage = "";
      new Notice("飞书已连接，可以开始选择内容");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.authorizationStarted = false;
      this.busy = false;
      this.render();
    }
  }

  private renderAuthorizationGate(parent: HTMLElement): void {
    const gate = parent.createDiv({ cls: "zhixing-feishu-authorization-gate" });
    setIcon(gate.createSpan(), "shield-check");
    const copy = gate.createDiv();
    copy.createEl("strong", { text: this.authorizationStarted ? "等待飞书确认" : "连接飞书后选择内容" });
    copy.createSpan({ text: this.authorizationStarted
      ? "请在刚打开的飞书官方页面同意授权，完成后这里会自动连接。"
      : "点击一次即可打开飞书官方授权页。授权完成后，群聊和多维表格选择会自动出现。" });
    const button = gate.createEl("button", {
      cls: "mod-cta",
      text: this.authorizationStarted ? "正在等待授权" : "连接飞书"
    });
    button.disabled = this.busy || this.authorizationStarted;
    button.addEventListener("click", () => void this.authorize());
  }

  private async refreshAuthorization(): Promise<void> {
    try {
      const status = await this.suite.getFeishuUserAuthorization();
      this.authorizationReady = status.ready;
      this.authorizationLabel = status.label || "";
    } catch {
      this.authorizationReady = false;
      this.authorizationLabel = "";
    }
  }

  private lookupError(error: unknown): string {
    if (isFeishuAuthorizationRequired(error)) {
      this.authorizationReady = false;
      return "需要先授权飞书，才能查找群聊和多维表格";
    }
    return error instanceof Error ? error.message : "飞书暂时无法完成这次只读查询，请稍后重试";
  }

  private renderSelectedChats(parent: HTMLElement): void {
    if (!this.config?.selected_chats.length) return;
    const selected = parent.createDiv({ cls: "zhixing-feishu-chat-selected" });
    for (const item of this.config.selected_chats) {
      const row = selected.createDiv();
      setIcon(row.createSpan(), "messages-square");
      row.createSpan({ text: item.label });
      const remove = row.createEl("button", { attr: { "aria-label": `移除 ${item.label}` } });
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        if (!this.config) return;
        this.config.selected_chats = this.config.selected_chats.filter((value) => value.selection_key !== item.selection_key);
        this.render();
      });
    }
  }

  private renderChatCandidates(parent: HTMLElement): void {
    if (this.chatCandidates.length === 0) return;
    const results = parent.createDiv({ cls: "zhixing-feishu-chat-results" });
    results.createDiv({ cls: "zhixing-feishu-chat-caption", text: "选择一个项目群" });
    for (const candidate of this.chatCandidates.slice(0, 12)) {
      const row = results.createDiv();
      const copy = row.createDiv();
      copy.createEl("strong", { text: candidate.name });
      copy.createSpan({ text: candidate.external ? "外部群" : "内部群" });
      const choose = row.createEl("button", { text: this.isChatSelected(candidate.chatId) ? "已选择" : "选择" });
      choose.disabled = this.busy || this.isChatSelected(candidate.chatId);
      choose.addEventListener("click", () => this.addChat(candidate));
    }
  }

  private async lookupChat(): Promise<void> {
    if (!this.chatQuery.trim()) { new Notice("请输入项目群名称"); return; }
    this.busy = true;
    this.chatCandidates = [];
    this.chatLookupMessage = "正在飞书中查找项目群…";
    this.render();
    try {
      this.chatCandidates = await this.suite.findFeishuChats(this.chatQuery);
      this.chatLookupMessage = this.chatCandidates.length === 1 ? "找到 1 个项目群，请选择" : `找到 ${this.chatCandidates.length} 个项目群，请选择`;
    } catch (error) {
      this.chatLookupMessage = this.lookupError(error);
      new Notice(this.chatLookupMessage);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async browseRecentChats(): Promise<void> {
    this.busy = true;
    this.chatCandidates = [];
    this.chatLookupMessage = "正在读取最近使用的项目群…";
    this.render();
    try {
      this.chatCandidates = await this.suite.listRecentFeishuChats();
      this.chatLookupMessage = `找到 ${this.chatCandidates.length} 个最近使用的项目群，请选择`;
    } catch (error) {
      this.chatLookupMessage = this.lookupError(error);
      new Notice(this.chatLookupMessage);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private addChat(candidate: FeishuChatCandidate): void {
    if (!this.config) return;
    const selection = createChatSelection(candidate);
    const values = this.config.selected_chats.filter((item) => item.selection_key !== selection.selection_key);
    this.config.selected_chats = [...values, selection];
    this.chatQuery = "";
    this.chatLookupMessage = `已添加：${selection.label}`;
    this.render();
  }

  private isChatSelected(chatId: string): boolean {
    return Boolean(this.config?.selected_chats.some((item) => item.chat_id === chatId));
  }

  private renderSelectedBases(parent: HTMLElement): void {
    if (!this.config?.selected_bases.length) return;
    const selected = parent.createDiv({ cls: "zhixing-feishu-base-selected" });
    for (const item of this.config.selected_bases) {
      const row = selected.createDiv();
      setIcon(row.createSpan(), "table-2");
      row.createSpan({ text: item.label });
      const remove = row.createEl("button", { attr: { "aria-label": `移除 ${item.label}` } });
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        if (!this.config) return;
        this.config.selected_bases = this.config.selected_bases.filter((value) => value.selection_key !== item.selection_key);
        this.render();
      });
    }
  }

  private renderBaseCandidates(parent: HTMLElement): void {
    if (this.baseCandidates.length === 0) return;
    const results = parent.createDiv({ cls: "zhixing-feishu-base-results" });
    results.createDiv({ cls: "zhixing-feishu-base-caption", text: "选择一个多维表格" });
    for (const candidate of this.baseCandidates.slice(0, 8)) {
      const row = results.createDiv();
      const copy = row.createDiv();
      copy.createEl("strong", { text: candidate.title });
      if (candidate.ownerName) copy.createSpan({ text: `所有者：${candidate.ownerName}` });
      const choose = row.createEl("button", { text: "选择" });
      choose.disabled = this.busy;
      choose.addEventListener("click", () => void this.chooseBase(candidate));
    }
  }

  private renderBasePicker(parent: HTMLElement): void {
    if (!this.pickerBase || this.baseTables.length === 0) return;
    const picker = parent.createDiv({ cls: "zhixing-feishu-base-picker" });
    picker.createEl("strong", { text: this.pickerBase.title });
    const controls = picker.createDiv();
    const table = controls.createEl("select", { attr: { "aria-label": "选择数据表" } });
    for (const item of this.baseTables) table.createEl("option", { text: item.name, value: item.id });
    table.value = this.selectedTableId;
    table.disabled = this.busy;
    table.addEventListener("change", () => void this.chooseTable(table.value));
    const view = controls.createEl("select", { attr: { "aria-label": "选择视图" } });
    for (const item of this.baseViews) view.createEl("option", { text: item.name, value: item.id });
    view.value = this.selectedViewId;
    view.disabled = this.busy || this.baseViews.length === 0;
    view.addEventListener("change", () => { this.selectedViewId = view.value; });
    const add = picker.createEl("button", { cls: "mod-cta", text: "添加这个视图" });
    add.disabled = this.busy || !this.selectedViewId;
    add.addEventListener("click", () => this.addPickedBase());
  }

  private async lookupBase(): Promise<void> {
    if (!this.baseQuery.trim()) { new Notice("请输入多维表格名称，或粘贴飞书链接"); return; }
    this.busy = true;
    this.baseCandidates = [];
    this.pickerBase = undefined;
    this.baseTables = [];
    this.baseViews = [];
    this.baseLookupMessage = "正在飞书中查找…";
    this.render();
    try {
      const result = await this.suite.findFeishuBases(this.baseQuery);
      if (result.kind === "resolved") {
        this.addBaseSelection(result.selection);
        this.baseQuery = "";
        this.baseLookupMessage = `已添加：${result.selection.label}`;
      } else {
        this.baseCandidates = result.candidates;
        this.baseLookupMessage = result.candidates.length === 1 ? "找到 1 个结果，请选择" : `找到 ${result.candidates.length} 个结果，请选择`;
      }
    } catch (error) {
      this.baseLookupMessage = this.lookupError(error);
      new Notice(this.baseLookupMessage);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async browseRecentBases(): Promise<void> {
    this.busy = true;
    this.baseCandidates = [];
    this.pickerBase = undefined;
    this.baseTables = [];
    this.baseViews = [];
    this.baseLookupMessage = "正在读取最近使用的多维表格…";
    this.render();
    try {
      this.baseCandidates = await this.suite.listRecentFeishuBases();
      this.baseLookupMessage = `找到 ${this.baseCandidates.length} 个最近使用的多维表格，请选择`;
    } catch (error) {
      this.baseLookupMessage = this.lookupError(error);
      new Notice(this.baseLookupMessage);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async chooseBase(candidate: FeishuBaseCandidate): Promise<void> {
    this.busy = true;
    this.pickerBase = candidate;
    this.baseCandidates = [];
    this.baseTables = [];
    this.baseViews = [];
    this.baseLookupMessage = "正在读取数据表和视图…";
    this.render();
    try {
      this.baseTables = await this.suite.listFeishuBaseTables(candidate.baseToken);
      this.selectedTableId = this.baseTables[0]?.id || "";
      await this.loadViews();
      this.baseLookupMessage = "请选择数据表和视图，然后添加";
    } catch (error) {
      this.baseLookupMessage = this.lookupError(error);
      new Notice(this.baseLookupMessage);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async chooseTable(tableId: string): Promise<void> {
    this.selectedTableId = tableId;
    this.busy = true;
    this.baseViews = [];
    this.baseLookupMessage = "正在读取视图…";
    this.render();
    try {
      await this.loadViews();
      this.baseLookupMessage = "请选择数据表和视图，然后添加";
    } catch (error) {
      this.baseLookupMessage = this.lookupError(error);
      new Notice(this.baseLookupMessage);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async loadViews(): Promise<void> {
    if (!this.pickerBase || !this.selectedTableId) return;
    this.baseViews = await this.suite.listFeishuBaseViews(this.pickerBase.baseToken, this.selectedTableId);
    this.selectedViewId = this.baseViews[0]?.id || "";
  }

  private addPickedBase(): void {
    if (!this.pickerBase) return;
    const table = this.baseTables.find((item) => item.id === this.selectedTableId);
    const view = this.baseViews.find((item) => item.id === this.selectedViewId);
    const selection = createBaseSelection({
      baseToken: this.pickerBase.baseToken,
      tableId: this.selectedTableId,
      viewId: this.selectedViewId,
      label: readableSelectionLabel(this.pickerBase.title, table?.name || "数据表", view?.name || "视图")
    });
    this.addBaseSelection(selection);
    this.baseQuery = "";
    this.pickerBase = undefined;
    this.baseTables = [];
    this.baseViews = [];
    this.baseLookupMessage = `已添加：${selection.label}`;
    this.render();
  }

  private addBaseSelection(selection: FeishuConnectorConfig["selected_bases"][number]): void {
    if (!this.config) return;
    const values = this.config.selected_bases.filter((item) => item.selection_key !== selection.selection_key);
    this.config.selected_bases = [...values, selection];
  }

  private async refresh(): Promise<void> {
    this.busy = true;
    await Promise.all([this.suite.refreshHealth(), this.refreshAuthorization()]);
    this.busy = false;
    this.render();
  }

  private async clearCache(): Promise<void> {
    if (!window.confirm("只清理本机 raw/feishu 缓存和同步状态。已经形成的长期 Wiki 会保留。确认继续？")) return;
    await this.suite.clearFeishuCache();
    this.render();
  }

  private async pause(): Promise<void> {
    if (!this.config) return;
    this.config.enabled = false;
    await this.suite.saveFeishuConfig(this.config);
    new Notice("飞书自动同步已暂停，已有知识和原始记录保持不变");
    this.render();
  }
}

function stepTitle(step: number): string {
  return ["连接飞书", "选择模块", "选择群聊与 Base", "预览采集范围", "确认开启"][step] || "设置";
}

function metric(parent: HTMLElement, label: string, value: string): void {
  const item = parent.createDiv();
  item.createSpan({ text: label });
  item.createEl("strong", { text: value });
}
