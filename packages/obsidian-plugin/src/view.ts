import { shell } from "electron";
import { ItemView, Modal, Notice, setIcon, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { aggregateTasks, eventDimension, filterEvents, metricsForRange, projectOptions, summarizeCalendarDay } from "./core/aggregate";
import {
  dateFromKey,
  dateKey,
  dayLabel,
  dayRange,
  monthGrid,
  monthLabel,
  moveMonth,
  moveRangeAnchor,
  timeLabel,
  weekLabel,
  weekRange
} from "./core/time";
import type {
  ActivityDimension,
  ActivityEvent,
  ActivityFilters,
  ActivitySnapshot,
  ArtifactProof,
  ArtifactRecord,
  DateRange,
  KnowledgeIngestRun,
  KnowledgeIngestRunStatus,
  KnowledgeDigest,
  MetricResult,
  OutcomeAggregate,
  SourceRef,
  TaskAggregate
} from "./core/types";
import type { ActivityService } from "./activity-service";
import type { SuiteHealth, SuiteService } from "./suite-service";
import { FeishuSetupModal } from "./feishu-settings";

export const ACTIVITY_LEDGER_VIEW_TYPE = "activity-ledger-view";

type MainTab = "calendar" | "artifacts" | "tasks" | "metrics" | "history";
type RangeMode = "day" | "week";

const TAB_CONFIG: Array<{ id: MainTab; label: string; icon: string }> = [
  { id: "calendar", label: "日历", icon: "calendar-days" },
  { id: "artifacts", label: "成果", icon: "package-open" },
  { id: "tasks", label: "任务轨迹", icon: "list-checks" },
  { id: "metrics", label: "量化分析", icon: "chart-no-axes-column-increasing" },
  { id: "history", label: "整理记录", icon: "history" }
];

const CONFIDENCE_LABELS: Record<ActivityEvent["confidence"], string> = {
  verified: "已验证",
  observed: "已观测",
  reported: "报告状态",
  inferred: "推断"
};

const ARTIFACT_PROOF_LABELS: Record<ArtifactProof, string> = {
  independent: "独立验证",
  "target-present": "目标存在",
  "report-only": "仅完成报告"
};

export class ActivityLedgerView extends ItemView {
  private snapshot?: ActivitySnapshot;
  private activeTab: MainTab = "calendar";
  private calendarAnchor = new Date();
  private selectedDate = dateKey(new Date());
  private taskAnchor = new Date();
  private taskMode: RangeMode = "week";
  private artifactAnchor = new Date();
  private artifactMode: RangeMode = "week";
  private artifactProof: "all" | ArtifactProof = "all";
  private selectedArtifactId?: string;
  private metricAnchor = new Date();
  private metricMode: RangeMode = "week";
  private selectedMetric: ActivityDimension = "activity";
  private selectedIngestRunId?: string;
  private filters: ActivityFilters = { projectKey: "all", confidence: "all" };
  private loading = true;
  private error?: string;
  private unsubscribe?: () => void;
  private unsubscribeSuite?: () => void;
  private suiteHealth?: SuiteHealth;

  constructor(leaf: WorkspaceLeaf, private readonly service: ActivityService, private readonly suite: SuiteService) {
    super(leaf);
  }

  getViewType(): string {
    return ACTIVITY_LEDGER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "知行台";
  }

  getIcon(): string {
    return "calendar-range";
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass("activity-ledger-view");
    this.unsubscribe = this.service.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.loading = false;
      this.error = undefined;
      this.ensureSelectedDate();
      this.render();
    });
    this.unsubscribeSuite = this.suite.subscribe((health) => {
      this.suiteHealth = health;
      this.render();
    });
    this.render();
    try {
      await this.service.refresh();
    } catch (error) {
      this.loading = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.unsubscribeSuite?.();
    this.unsubscribeSuite = undefined;
  }

  private render(): void {
    const root = this.containerEl.children[1] as HTMLElement | undefined;
    if (!root) {
      return;
    }
    root.empty();
    root.addClass("activity-ledger-root");
    root.dataset.testid = "activity-ledger-root";
    this.renderHeader(root);

    if (this.loading && !this.snapshot) {
      this.renderState(root, "loader-circle", "正在读取活动证据…", true);
      return;
    }
    if (this.error) {
      this.renderState(root, "circle-alert", this.error, false);
      return;
    }
    if (!this.snapshot) {
      this.renderState(root, "inbox", "暂时没有可显示的数据", false);
      return;
    }

    const content = root.createDiv({ cls: "activity-ledger-content" });
    content.dataset.testid = `view-${this.activeTab}`;
    if (this.activeTab === "calendar") {
      this.renderCalendar(content);
    } else if (this.activeTab === "artifacts") {
      this.renderArtifacts(content);
    } else if (this.activeTab === "tasks") {
      this.renderTasks(content);
    } else if (this.activeTab === "metrics") {
      this.renderMetrics(content);
    } else {
      this.renderIngestHistory(content);
    }
    this.renderStatus(root);
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "activity-ledger-header" });
    const brand = header.createDiv({ cls: "activity-ledger-brand" });
    const brandIcon = brand.createSpan({ cls: "activity-ledger-brand-icon" });
    setIcon(brandIcon, "calendar-range");
    const brandText = brand.createDiv();
    brandText.createEl("h2", { text: "知行台" });
    brandText.createDiv({ cls: "activity-ledger-subtitle", text: "工作与知识活动账本" });

    const tabs = header.createDiv({ cls: "activity-ledger-tabs", attr: { role: "tablist" } });
    for (const tab of TAB_CONFIG) {
      const button = this.iconTextButton(tabs, tab.icon, tab.label, `tab-${tab.id}`);
      button.addClass("activity-ledger-tab");
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(this.activeTab === tab.id));
      button.toggleClass("is-active", this.activeTab === tab.id);
      button.addEventListener("click", () => {
        this.activeTab = tab.id;
        this.render();
      });
    }

    const actions = header.createDiv({ cls: "activity-ledger-actions" });
    if (this.snapshot && this.activeTab !== "history") {
      this.renderProjectFilter(actions);
      if (this.activeTab === "artifacts") {
        this.renderArtifactProofFilter(actions);
      } else {
        this.renderConfidenceFilter(actions);
      }
    }
    const refresh = this.iconButton(actions, "refresh-cw", "刷新数据", "refresh-data");
    refresh.addEventListener("click", () => {
      this.loading = true;
      this.render();
      void this.service.refresh().catch((error: unknown) => {
        this.loading = false;
        this.error = error instanceof Error ? error.message : String(error);
        this.render();
      });
    });
  }

  private renderProjectFilter(parent: HTMLElement): void {
    const select = parent.createEl("select", { cls: "activity-ledger-select" });
    select.setAttribute("aria-label", "按项目筛选");
    select.dataset.testid = "project-filter";
    select.createEl("option", { text: "全部项目", value: "all" });
    for (const project of projectOptions(this.snapshot?.events ?? [])) {
      select.createEl("option", { text: project.label, value: project.key });
    }
    select.value = this.filters.projectKey;
    select.addEventListener("change", () => {
      this.filters.projectKey = select.value;
      this.render();
    });
  }

  private renderConfidenceFilter(parent: HTMLElement): void {
    const select = parent.createEl("select", { cls: "activity-ledger-select" });
    select.setAttribute("aria-label", "按可信度筛选");
    select.dataset.testid = "confidence-filter";
    select.createEl("option", { text: "全部可信度", value: "all" });
    for (const confidence of ["verified", "observed", "reported", "inferred"] as const) {
      select.createEl("option", { text: CONFIDENCE_LABELS[confidence], value: confidence });
    }
    select.value = this.filters.confidence;
    select.addEventListener("change", () => {
      this.filters.confidence = select.value as ActivityFilters["confidence"];
      this.render();
    });
  }

  private renderArtifactProofFilter(parent: HTMLElement): void {
    const select = parent.createEl("select", { cls: "activity-ledger-select" });
    select.setAttribute("aria-label", "按成果可信状态筛选");
    select.dataset.testid = "artifact-proof-filter";
    select.createEl("option", { text: "全部成果状态", value: "all" });
    for (const proof of ["independent", "target-present", "report-only"] as const) {
      select.createEl("option", { text: ARTIFACT_PROOF_LABELS[proof], value: proof });
    }
    select.value = this.artifactProof;
    select.addEventListener("change", () => {
      this.artifactProof = select.value as "all" | ArtifactProof;
      this.render();
    });
  }

  private renderArtifacts(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: "activity-ledger-toolbar" });
    this.renderRangeMode(toolbar, this.artifactMode, (mode) => {
      this.artifactMode = mode;
      this.render();
    }, "artifacts");
    this.renderRangeNavigation(toolbar, this.artifactAnchor, this.artifactMode, (anchor) => {
      this.artifactAnchor = anchor;
      this.render();
    }, "artifacts");

    const range = this.artifactMode === "day" ? dayRange(this.artifactAnchor) : weekRange(this.artifactAnchor);
    const outcomes = this.filteredOutcomes(range);
    const settled = outcomes.filter((outcome) => outcome.settlement.status === "succeeded").length;
    const pending = outcomes.filter((outcome) => outcome.settlement.status === "pending").length;
    const failed = outcomes.filter((outcome) => outcome.settlement.status === "failed").length;
    const queue = this.snapshot?.diagnostics.knowledgeQueue;
    const created = outcomes.flatMap((outcome) => outcome.knowledgeChanges).filter((change) => change.action === "created").length;
    const updated = outcomes.flatMap((outcome) => outcome.knowledgeChanges).filter((change) => change.action === "updated").length;
    toolbar.createSpan({
      cls: "activity-artifact-range-summary",
      text: `真实成果 ${outcomes.length} · 新增知识 ${created} · 更新知识 ${updated} · 已沉淀 ${settled} · 待沉淀 ${pending} · 失败 ${failed}${queue ? ` · 整理队列 ${queue.remainingTopics} 个主题` : ""}`
    });
    const layout = parent.createDiv({ cls: "activity-artifacts-layout" });
    layout.dataset.testid = `artifacts-${this.artifactMode}`;
    const list = layout.createDiv({ cls: "activity-artifact-list" });
    const detail = layout.createDiv({ cls: "activity-artifact-detail" });
    if (outcomes.length === 0) {
      this.renderEmpty(list, "package-open", "当前范围没有真实成果");
      this.renderEmpty(detail, "file-search", "成果按真实任务合并，底层提交和对话仍可核对");
      return;
    }

    const availableIds = new Set(outcomes.map((outcome) => outcome.id));
    if (!this.selectedArtifactId || !availableIds.has(this.selectedArtifactId)) {
      this.selectedArtifactId = outcomes[0]?.id;
    }
    const byProject = new Map<string, OutcomeAggregate[]>();
    for (const outcome of outcomes) {
      const projectOutcomes = byProject.get(outcome.projectLabel) ?? [];
      projectOutcomes.push(outcome);
      byProject.set(outcome.projectLabel, projectOutcomes);
    }
    for (const [project, projectOutcomes] of byProject) {
      const group = list.createDiv({ cls: "activity-artifact-group" });
      const heading = group.createDiv({ cls: "activity-task-group-heading" });
      heading.createEl("h3", { text: project });
      heading.createSpan({ text: `${projectOutcomes.length} 项真实成果` });
      for (const outcome of projectOutcomes) {
        this.renderOutcomeRow(group, outcome);
      }
    }
    const selected = outcomes.find((outcome) => outcome.id === this.selectedArtifactId) ?? outcomes[0];
    if (selected) {
      this.renderOutcomeDetail(detail, selected);
    }
  }

  private renderIngestHistory(parent: HTMLElement): void {
    const runs = this.snapshot?.ingestRuns ?? [];
    const queue = this.snapshot?.diagnostics.knowledgeQueue;
    const toolbar = parent.createDiv({ cls: "activity-ledger-toolbar activity-ingest-toolbar" });
    this.renderSuiteHealth(toolbar);
    const schedule = toolbar.createDiv({ cls: "activity-ingest-schedule" });
    const scheduleIcon = schedule.createSpan();
    setIcon(scheduleIcon, "clock-3");
    schedule.createSpan({ text: "每天 23:30 自动整理" });
    toolbar.createSpan({
      cls: "activity-artifact-range-summary",
      text: queue
        ? `可整理 ${queue.readyTopics} · 收集中 ${queue.openTopics}` +
          `${queue.coolingRetryTopics ? ` · 冷却重试 ${queue.coolingRetryTopics}` : ""}` +
          `${queue.needsCompactionTopics ? ` · 待压缩 ${queue.needsCompactionTopics}` : ""}` +
          ` · 总计 ${queue.remainingTopics} 个主题`
        : "整理队列状态尚未建立"
    });

    const layout = parent.createDiv({ cls: "activity-ingest-layout" });
    layout.dataset.testid = "ingest-history";
    const list = layout.createDiv({ cls: "activity-ingest-list" });
    const detail = layout.createDiv({ cls: "activity-ingest-detail" });
    if (runs.length === 0) {
      this.renderEmpty(list, "history", "还没有整理记录");
      this.renderEmpty(detail, "book-dashed", "下一次整理后会在这里留下可追溯记录");
      return;
    }

    const availableIds = new Set(runs.map((run) => run.id));
    if (!this.selectedIngestRunId || !availableIds.has(this.selectedIngestRunId)) {
      this.selectedIngestRunId = runs[0]?.id;
    }
    for (const run of runs) {
      this.renderIngestRunRow(list, run);
    }
    const selected = runs.find((run) => run.id === this.selectedIngestRunId) ?? runs[0];
    if (selected) {
      this.renderIngestRunDetail(detail, selected);
    }
  }

  private renderSuiteHealth(parent: HTMLElement): void {
    const health = this.suiteHealth;
    if (!health) return;
    const panel = parent.createDiv({ cls: "zhixing-suite-health" });
    panel.createSpan({ cls: "zhixing-suite-version", text: `v${health.version}` });
    const receiver = panel.createSpan({ cls: `zhixing-health-chip is-${health.receiver}` });
    setIcon(receiver, health.receiver === "ready" ? "radio-tower" : "triangle-alert");
    receiver.createSpan({ text: health.receiver === "ready" ? "网页采集正常" : "网页采集异常" });
    receiver.setAttribute("title", health.receiverMessage);
    const runtime = panel.createSpan({ cls: `zhixing-health-chip is-${health.runtime}` });
    setIcon(runtime, health.runtime === "ready" ? "brain-circuit" : "circle-dashed");
    runtime.createSpan({ text: health.runtime === "ready" ? "知识整理就绪" : "知识运行时缺失" });
    const codex = panel.createSpan({ cls: `zhixing-health-chip is-${health.codex}` });
    setIcon(codex, health.codex === "ready" ? "terminal" : "circle-dashed");
    codex.createSpan({ text: health.codex === "ready" ? "Codex 就绪" : "Codex 未连接" });
    const feishu = panel.createSpan({ cls: `zhixing-health-chip is-${health.feishu.status === "ready" ? "ready" : health.feishu.status === "disabled" ? "starting" : "unavailable"}` });
    setIcon(feishu, health.feishu.status === "ready" ? "message-square-check" : health.feishu.status === "disabled" ? "message-square-dashed" : "message-square-warning");
    feishu.createSpan({ text: health.feishu.status === "ready" ? `飞书正常${health.feishu.pending ? ` · 待整理 ${health.feishu.pending}` : ""}` :
      health.feishu.status === "disabled" ? "飞书未连接" : health.feishu.failedModules ? `飞书待重试 ${health.feishu.failedModules}` : "飞书不可用" });
    feishu.setAttribute("title", [health.feishu.message, health.feishu.identityLabel,
      health.feishu.lastSync ? `最后同步 ${formatDateTime(health.feishu.lastSync)}` : "",
      health.feishu.selectedChats ? `${health.feishu.selectedChats} 个项目群` : "",
      health.feishu.selectedBases ? `${health.feishu.selectedBases} 个 Base 视图` : ""].filter(Boolean).join(" · "));
    const updateLabel = health.update === "available" ? `可更新 ${health.latestVersion}` : health.update === "current" ? "已是最新版" : "检查更新";
    const copy = this.iconButton(panel, "key-round", "复制浏览器接收密钥", "copy-receiver-token");
    copy.addEventListener("click", () => void this.suite.copyReceiverToken());
    const extension = this.iconButton(panel, "folder-open", "打开浏览器扩展目录", "open-browser-extension-folder");
    extension.addEventListener("click", () => void this.suite.openBrowserExtensionFolder());
    const run = this.iconButton(panel, health.running ? "loader-circle" : "sparkles", health.running ? "正在整理" : "立即整理", "run-knowledge-now");
    run.disabled = health.runtime !== "ready" || health.codex !== "ready" || health.running;
    run.addEventListener("click", () => void this.suite.runKnowledgeNow());
    const sources = this.iconButton(panel, "database", "数据来源设置", "open-data-sources");
    sources.addEventListener("click", () => new FeishuSetupModal(this.app, this.suite).open());
    if (health.feishu.enabled) {
      const sync = this.iconButton(panel, health.feishu.syncing ? "loader-circle" : "refresh-ccw", health.feishu.syncing ? "正在同步飞书" : "立即同步飞书", "sync-feishu-now");
      sync.disabled = health.feishu.syncing || health.feishu.cli === "missing";
      sync.addEventListener("click", () => void this.suite.runFeishuSyncNow(true));
    }
    const update = this.iconTextButton(panel, "cloud-download", updateLabel, "check-suite-update");
    update.addEventListener("click", () => void this.suite.checkForUpdate());
  }

  private renderIngestRunRow(parent: HTMLElement, run: KnowledgeIngestRun): void {
    const display = ingestRunDisplay(run);
    const button = parent.createEl("button", {
      cls: "activity-ingest-row",
      attr: { type: "button", "aria-label": `查看整理记录：${formatDateTime(run.startedAt)}` }
    });
    button.toggleClass("is-active", run.id === this.selectedIngestRunId);
    const marker = button.createSpan({ cls: `activity-ingest-marker is-${display.key}` });
    setIcon(marker, display.icon);
    const body = button.createDiv({ cls: "activity-ingest-row-body" });
    const top = body.createDiv({ cls: "activity-ingest-row-top" });
    top.createSpan({ cls: "activity-ingest-time", text: formatDateTime(run.startedAt) });
    top.createSpan({ cls: `activity-ingest-status is-${display.key}`, text: display.label });
    body.createDiv({
      cls: "activity-ingest-summary",
      text: run.source === "legacy-log"
        ? "旧版只保留运行概要，处理结果不可完整核验"
        : `选中 ${run.selectedTopics} 个主题 · 成功沉淀 ${run.committedTopics} 个 · 待重试/失败 ${run.pendingTopics + run.failedTopics} 个 · 剩余 ${run.remainingTopics} 个`
    });
    body.createDiv({
      cls: "activity-ingest-meta",
      text: [
        ingestTriggerLabel(run),
        run.batchIndex ? `第 ${run.batchIndex} 批` : "",
        run.tokensUsed ? `${run.tokensUsed.toLocaleString("zh-CN")} tokens` : "",
        run.attemptCount > 1 ? `${run.attemptCount} 次尝试` : ""
      ].filter(Boolean).join(" · ")
    });
    button.addEventListener("click", () => {
      this.selectedIngestRunId = run.id;
      this.render();
    });
  }

  private renderIngestRunDetail(parent: HTMLElement, run: KnowledgeIngestRun): void {
    const display = ingestRunDisplay(run);
    const heading = parent.createDiv({ cls: "activity-ingest-detail-heading" });
    const title = heading.createDiv();
    title.createEl("h3", { text: formatDateTime(run.startedAt) });
    title.createDiv({
      cls: "activity-artifact-detail-meta",
      text: `${ingestTriggerLabel(run)} · ${display.label}${run.finishedAt ? ` · 用时 ${durationLabel(run.startedAt, run.finishedAt)}` : ""}`
    });
    if (run.logPath) {
      const openLog = this.iconTextButton(heading, "scroll-text", "查看运行来源", "open-ingest-log");
      openLog.addEventListener("click", () => new SourceEvidenceModal(this.app, {
        type: "codex",
        label: "整理运行来源",
        path: run.logPath,
        excerpt: run.source === "legacy-log"
          ? "这是旧版运行日志。它只能证明任务被触发，不能单独证明 Wiki 已成功写入。"
          : `运行编号：${run.runId}`
      }).open());
    }

    if (run.source === "legacy-log") {
      parent.createDiv({
        cls: "activity-artifact-attribution is-warning",
        text: "旧版记录没有事务级验证信息。这里不根据退出码推断整理成功，结果请以成果和 Wiki 实际内容为准。"
      });
    } else if (display.key === "stalled") {
      parent.createDiv({
        cls: "activity-artifact-attribution is-warning",
        text: "这次整理长时间没有结束记录，可能被中断。未成功写入的内容会保留在队列中等待重试。"
      });
    } else if (run.error) {
      parent.createDiv({
        cls: "activity-artifact-attribution is-warning",
        text: `本次未完全完成：${run.error}`
      });
    }

    const counts = parent.createDiv({ cls: "activity-ingest-counts" });
    this.ingestCount(counts, "选中主题", run.selectedTopics);
    this.ingestCount(counts, "成功沉淀", run.committedTopics);
    this.ingestCount(counts, "待重试/失败", run.pendingTopics + run.failedTopics);
    this.ingestCount(counts, "剩余主题", run.remainingTopics);
    this.ingestCount(counts, "例行归档/辅助证据", run.systemPairs);
    if (run.tokensUsed > 0) {
      this.ingestCount(counts, "本批 tokens", run.tokensUsed);
    }

    const section = parent.createDiv({ cls: "activity-ingest-topics" });
    const sectionHeading = section.createDiv({ cls: "activity-task-group-heading" });
    sectionHeading.createEl("h3", { text: "本次处理内容" });
    sectionHeading.createSpan({ text: `${run.topicResults.length} 个可核验主题` });
    if (run.topicResults.length === 0) {
      this.renderEmpty(
        section,
        "list-minus",
        run.status === "idle" ? "本次没有需要语义整理的内容" : "这条记录没有保留下可展开的主题明细"
      );
      return;
    }
    for (const topic of run.topicResults) {
      const item = section.createDiv({ cls: "activity-ingest-topic" });
      const topicMarker = item.createSpan({ cls: `activity-ingest-topic-marker is-${topic.status}` });
      setIcon(topicMarker, settlementIcon(topic.status));
      const body = item.createDiv({ cls: "activity-ingest-topic-body" });
      const top = body.createDiv({ cls: "activity-ingest-topic-top" });
      top.createSpan({ cls: "activity-ingest-topic-title", text: topic.title });
      top.createSpan({
        cls: `activity-artifact-proof is-${topic.status}`,
        text: settlementLabel(topic.status)
      });
      const explanation = topic.error || topic.reason;
      if (topic.digest) {
        this.renderKnowledgeDigest(body, topic.digest, true);
      } else if (explanation) {
        body.createDiv({ cls: "activity-ingest-topic-summary", text: explanation });
      }
      const created = topic.wikiChanges.filter((change) => change.action === "created").length;
      const updated = topic.wikiChanges.filter((change) => change.action === "updated").length;
      body.createDiv({
        cls: "activity-ingest-meta",
        text: `${topic.sourceEventCount} 条原始证据${created ? ` · 新增 Wiki ${created}` : ""}${updated ? ` · 更新 Wiki ${updated}` : ""}`
      });
      const actions = item.createDiv({ cls: "activity-ingest-topic-actions" });
      if (topic.memoryPath) {
        const open = this.iconTextButton(actions, "book-open-text", "打开我的经历");
        open.addEventListener("click", () => void this.openSource({
          type: "wiki",
          label: topic.memoryPath as string,
          path: topic.memoryPath
        }));
      }
      const evidencePaths = topic.evidencePaths.length > 0
        ? topic.evidencePaths
        : topic.wikiPaths.filter((wikiPath) => wikiPath !== topic.memoryPath);
      for (const wikiPath of evidencePaths.slice(0, topic.memoryPath ? 1 : 2)) {
        const change = topic.wikiChanges.find((item) => item.path === wikiPath);
        const wikiTitle = change?.title ?? wikiPath.split("/").at(-1)?.replace(/\.md$/i, "") ?? "技术证据";
        const open = this.iconTextButton(actions, "database", `查看证据《${wikiTitle}》`);
        open.addEventListener("click", () => void this.openSource({
          type: "wiki",
          label: wikiPath,
          path: wikiPath
        }));
      }
      for (const dailyPath of topic.dailyPaths.slice(0, 2)) {
        const open = this.iconButton(actions, "file-text", `打开每日来源：${dailyPath}`);
        open.addEventListener("click", () => void this.openSource({
          type: "file",
          label: dailyPath,
          path: dailyPath
        }));
      }
    }
  }

  private ingestCount(parent: HTMLElement, label: string, value: number): void {
    const item = parent.createDiv({ cls: "activity-ingest-count" });
    item.createSpan({ text: label });
    item.createEl("strong", { text: String(value) });
  }

  private renderOutcomeRow(parent: HTMLElement, outcome: OutcomeAggregate): void {
    const button = parent.createEl("button", {
      cls: "activity-artifact-row",
      attr: { type: "button", "aria-label": `查看成果：${outcome.title}` }
    });
    button.dataset.artifactId = outcome.id;
    button.toggleClass("is-active", outcome.id === this.selectedArtifactId);
    const marker = button.createSpan({ cls: `activity-artifact-marker is-${outcome.proof}` });
    setIcon(marker, settlementIcon(outcome.settlement.status, outcome.settlement.category));
    const body = button.createDiv({ cls: "activity-artifact-body" });
    const top = body.createDiv({ cls: "activity-artifact-top" });
    top.createSpan({ cls: "activity-artifact-title", text: outcome.title });
    top.createSpan({
      cls: `activity-artifact-proof is-${outcome.settlement.status}`,
      text: settlementLabel(outcome.settlement.status, outcome.settlement.category)
    });
    body.createDiv({
      cls: "activity-artifact-summary",
      text: readableSummary(outcome.digest?.about ?? outcome.summary)
    });
    body.createDiv({
      cls: "activity-artifact-meta",
      text: `${dayLabel(outcome.localDate)} · ${outcome.artifactIds.length} 条底层证据 · ${ARTIFACT_PROOF_LABELS[outcome.proof]}`
    });
    button.addEventListener("click", () => {
      this.selectedArtifactId = outcome.id;
      this.render();
    });
  }

  private renderOutcomeDetail(parent: HTMLElement, outcome: OutcomeAggregate): void {
    const heading = parent.createDiv({ cls: "activity-artifact-detail-heading" });
    const title = heading.createDiv();
    title.createEl("h3", { text: outcome.title });
    title.createDiv({
      cls: "activity-artifact-detail-meta",
      text: `${outcome.projectLabel} · ${dayLabel(outcome.localDate)} · ${settlementLabel(outcome.settlement.status, outcome.settlement.category)} · ${outcome.artifactIds.length || outcome.eventIds.length / 2} 条底层证据`
    });
    if (outcome.memoryRef) {
      const openWiki = this.iconTextButton(heading, "book-open-text", "打开我的经历", "open-outcome-wiki");
      openWiki.addEventListener("click", () => void this.openSource(outcome.memoryRef as SourceRef));
    } else if (outcome.wikiRefs[0]) {
      const openWiki = this.iconTextButton(heading, "book-open", "打开旧版 Wiki", "open-outcome-wiki");
      openWiki.addEventListener("click", () => void this.openSource(outcome.wikiRefs[0] as SourceRef));
    } else {
      const firstArtifact = this.outcomeArtifacts(outcome)[0];
      if (firstArtifact) {
        const openNote = this.iconTextButton(heading, "file-text", "打开成果证据", "open-artifact-note");
        openNote.addEventListener("click", () => void this.openArtifactNote(firstArtifact));
      }
    }
    if (outcome.settlement.status === "failed") {
      parent.createDiv({
        cls: "activity-artifact-attribution is-warning",
        text: `沉淀失败：${outcome.settlement.error || "未记录原因"}。下次整理会自动重试。`
      });
    }

    if (outcome.digest) {
      this.renderKnowledgeDigest(parent, outcome.digest, false);
    }
    this.artifactSection(parent, "解决的问题", outcome.problem ?? "底层证据尚未提供明确的问题描述。");
    this.artifactSection(parent, "形成的成果", outcome.summary);

    const targets = parent.createDiv({ cls: "activity-artifact-section" });
    targets.createEl("h4", { text: "这次留下的记录" });
    if (outcome.wikiRefs.length === 0) {
      targets.createDiv({
        cls: "activity-artifact-section-empty",
        text: outcome.settlement.category === "durable-output"
          ? outcome.settlement.reason || "真实自动化产出已记录，当前证据不足以形成常青 Wiki。"
          : outcome.settlement.status === "not-applicable"
          ? outcome.settlement.reason || "这项成果未发现值得单独沉淀的长期经验。"
          : "尚未形成长期 Wiki。"
      });
    } else {
      const actions = targets.createDiv({ cls: "activity-artifact-targets" });
      if (outcome.memoryRef) {
        const button = this.iconTextButton(actions, "book-open-text", `我的经历：《${outcome.memoryRef.label}》`);
        button.addEventListener("click", () => void this.openSource(outcome.memoryRef as SourceRef));
      }
      for (const source of outcome.evidenceRefs ?? []) {
        const button = this.iconTextButton(actions, "database", `AI 证据：《${source.label}》`);
        button.addEventListener("click", () => void this.openSource(source));
      }
      if (!outcome.memoryRef && (outcome.evidenceRefs?.length ?? 0) === 0) {
        for (const source of outcome.wikiRefs) {
          const button = this.iconTextButton(actions, "book-open", source.label);
          button.addEventListener("click", () => void this.openSource(source));
        }
      }
    }

    const sources = parent.createDiv({ cls: "activity-artifact-section" });
    sources.createEl("h4", { text: `底层证据（${outcome.artifactIds.length}）` });
    const sourceActions = sources.createDiv({ cls: "activity-artifact-targets" });
    for (const source of this.availableSources(outcome.sourceRefs).slice(0, 12)) {
      this.sourceButton(sourceActions, source);
    }
    if (outcome.reuseCount > 0) {
      this.artifactSection(parent, "再次复用", `这篇知识已经被后续 ${outcome.reuseCount} 项真实成果明确引用。`);
    }
  }

  private artifactSection(parent: HTMLElement, title: string, content: string): void {
    const section = parent.createDiv({ cls: "activity-artifact-section" });
    section.createEl("h4", { text: title });
    const body = section.createDiv({ cls: "activity-artifact-section-body" });
    for (const paragraph of content.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      body.createEl("p", { text: paragraph });
    }
  }

  private renderKnowledgeDigest(parent: HTMLElement, digest: KnowledgeDigest, compact: boolean): void {
    const section = parent.createDiv({ cls: `activity-knowledge-digest${compact ? " is-compact" : ""}` });
    if (!compact) {
      const heading = section.createDiv({ cls: "activity-knowledge-digest-heading" });
      const icon = heading.createSpan();
      setIcon(icon, "scan-eye");
      heading.createEl("h4", { text: "一眼看懂" });
    }
    for (const [label, value] of [
      ["这是什么", digest.about],
      ["解决了什么", digest.problem],
      ["得到什么", digest.result],
      ["以后怎么用", digest.nextUse]
    ] as const) {
      const row = section.createDiv({ cls: "activity-knowledge-digest-row" });
      row.createSpan({ text: label });
      row.createDiv({ text: value });
    }
  }

  private filteredOutcomes(range: DateRange): OutcomeAggregate[] {
    return (this.snapshot?.outcomes ?? [])
      .filter((outcome) => outcome.localDate >= range.start && outcome.localDate <= range.end)
      .filter((outcome) => this.filters.projectKey === "all" || outcome.projectKey === this.filters.projectKey)
      .filter((outcome) => this.artifactProof === "all" || outcome.proof === this.artifactProof)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id));
  }

  private outcomeArtifacts(outcome: OutcomeAggregate): ArtifactRecord[] {
    const ids = new Set(outcome.artifactIds);
    return (this.snapshot?.artifacts ?? []).filter((artifact) => ids.has(artifact.id));
  }

  private outcomesForDate(date: string): OutcomeAggregate[] {
    return (this.snapshot?.outcomes ?? []).filter((outcome) =>
      outcome.localDate === date &&
      (this.filters.projectKey === "all" || outcome.projectKey === this.filters.projectKey)
    );
  }

  private renderCalendar(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: "activity-ledger-toolbar" });
    const navigation = toolbar.createDiv({ cls: "activity-ledger-date-nav" });
    this.iconButton(navigation, "chevron-left", "上个月", "calendar-previous").addEventListener("click", () => {
      this.calendarAnchor = moveMonth(this.calendarAnchor, -1);
      this.render();
    });
    navigation.createEl("h3", { text: monthLabel(this.calendarAnchor) });
    this.iconButton(navigation, "chevron-right", "下个月", "calendar-next").addEventListener("click", () => {
      this.calendarAnchor = moveMonth(this.calendarAnchor, 1);
      this.render();
    });
    const today = this.iconTextButton(toolbar, "locate-fixed", "今天", "calendar-today");
    today.addEventListener("click", () => {
      this.calendarAnchor = new Date();
      this.selectedDate = dateKey(new Date());
      this.render();
    });

    const split = parent.createDiv({ cls: "activity-ledger-split" });
    const main = split.createDiv({ cls: "activity-ledger-main" });
    const calendar = main.createDiv({ cls: "activity-calendar" });
    calendar.dataset.testid = "calendar-grid";
    for (const weekday of ["一", "二", "三", "四", "五", "六", "日"]) {
      calendar.createDiv({ cls: "activity-calendar-weekday", text: weekday });
    }
    const visibleEvents = this.filteredEventsForMonth();
    for (const day of monthGrid(this.calendarAnchor)) {
      const summary = summarizeCalendarDay(day.date, visibleEvents);
      summary.outputs = this.outcomesForDate(day.date).length;
      const button = calendar.createEl("button", {
        cls: "activity-calendar-day",
        attr: {
          type: "button",
          "aria-label": `${dayLabel(day.date)}，${summary.tasks} 个任务，${summary.outputs} 个产出，${summary.knowledge} 条知识`
        }
      });
      button.dataset.date = day.date;
      button.toggleClass("is-outside", !day.inMonth);
      button.toggleClass("is-selected", day.date === this.selectedDate);
      button.toggleClass("is-today", day.date === dateKey(new Date()));
      button.createSpan({ cls: "activity-calendar-number", text: String(dateFromKey(day.date).getDate()) });
      const indicators = button.createDiv({ cls: "activity-calendar-indicators" });
      this.indicator(indicators, "task", "任务", summary.tasks);
      this.indicator(indicators, "output", "产出", summary.outputs);
      this.indicator(indicators, "knowledge", "知识", summary.knowledge);
      button.addEventListener("click", () => {
        this.selectedDate = day.date;
        this.render();
      });
    }
    this.renderDayInspector(split, this.selectedDate);
  }

  private renderDayInspector(parent: HTMLElement, date: string): void {
    const inspector = parent.createDiv({ cls: "activity-ledger-inspector" });
    inspector.dataset.testid = "day-inspector";
    const events = filterEvents(this.snapshot?.events ?? [], dayRange(dateFromKey(date)), this.filters)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const outcomes = this.outcomesForDate(date);
    const heading = inspector.createDiv({ cls: "activity-inspector-heading" });
    heading.createEl("h3", { text: dayLabel(date) });
    const actions = heading.createDiv({ cls: "activity-inspector-actions" });
    const settled = outcomes.filter((outcome) => outcome.settlement.status === "succeeded").length;
    const failed = outcomes.filter((outcome) => outcome.settlement.status === "failed").length;
    actions.createSpan({
      text: `${outcomes.length} 项真实成果 · 已沉淀 ${settled} · 失败 ${failed} · ${events.length} 条活动证据`
    });
    if (outcomes.length > 0) {
      const openArtifacts = this.iconButton(actions, "package-open", "查看当天成果", "calendar-open-artifacts");
      openArtifacts.addEventListener("click", () => {
        this.activeTab = "artifacts";
        this.artifactMode = "day";
        this.artifactAnchor = dateFromKey(date);
        this.render();
      });
    }
    if (events.length === 0) {
      this.renderEmpty(inspector, "calendar-x", "当天没有已采集活动");
      return;
    }
    const timeline = inspector.createDiv({ cls: "activity-timeline" });
    for (const event of events) {
      this.renderEventRow(timeline, event, true);
    }
  }

  private renderTasks(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: "activity-ledger-toolbar" });
    this.renderRangeMode(toolbar, this.taskMode, (mode) => {
      this.taskMode = mode;
      this.render();
    }, "tasks");
    this.renderRangeNavigation(toolbar, this.taskAnchor, this.taskMode, (anchor) => {
      this.taskAnchor = anchor;
      this.render();
    }, "tasks");

    const range = this.taskMode === "day" ? dayRange(this.taskAnchor) : weekRange(this.taskAnchor);
    const events = filterEvents(this.snapshot?.events ?? [], range, this.filters);
    const taskEvents = events.filter((event) => event.taskKey && event.kind !== "research_activity");
    const tasks = aggregateTasks(taskEvents);
    const content = parent.createDiv({ cls: "activity-task-content" });
    content.dataset.testid = `tasks-${this.taskMode}`;
    if (tasks.length === 0) {
      this.renderEmpty(content, "list-x", "当前范围没有可归属任务");
      return;
    }

    if (this.taskMode === "day") {
      const ordered = taskEvents.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
      for (const event of ordered) {
        this.renderEventRow(content, event, false);
      }
      return;
    }

    const byProject = new Map<string, TaskAggregate[]>();
    for (const task of tasks) {
      const items = byProject.get(task.projectLabel) ?? [];
      items.push(task);
      byProject.set(task.projectLabel, items);
    }
    for (const [project, projectTasks] of byProject) {
      const group = content.createDiv({ cls: "activity-task-group" });
      const heading = group.createDiv({ cls: "activity-task-group-heading" });
      heading.createEl("h3", { text: project });
      heading.createSpan({ text: `${projectTasks.length} 个任务` });
      for (const task of projectTasks) {
        this.renderTaskRow(group, task);
      }
    }
  }

  private renderMetrics(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: "activity-ledger-toolbar" });
    this.renderRangeMode(toolbar, this.metricMode, (mode) => {
      this.metricMode = mode;
      this.render();
    }, "metrics");
    this.renderRangeNavigation(toolbar, this.metricAnchor, this.metricMode, (anchor) => {
      this.metricAnchor = anchor;
      this.render();
    }, "metrics");

    const range = this.metricMode === "day" ? dayRange(this.metricAnchor) : weekRange(this.metricAnchor);
    const metrics = metricsForRange(
      this.snapshot?.events ?? [],
      range,
      this.filters,
      this.snapshot?.outcomes ?? []
    );
    const strip = parent.createDiv({ cls: "activity-metric-strip" });
    strip.dataset.testid = "metric-strip";
    for (const metric of metrics) {
      const button = strip.createEl("button", { cls: "activity-metric", attr: { type: "button" } });
      button.dataset.dimension = metric.dimension;
      button.toggleClass("is-active", metric.dimension === this.selectedMetric);
      const label = button.createDiv({ cls: "activity-metric-label" });
      const icon = label.createSpan();
      setIcon(icon, metricIcon(metric.dimension));
      label.createSpan({ text: metric.label });
      button.createDiv({ cls: "activity-metric-value", text: String(metric.value) });
      button.createDiv({ cls: "activity-metric-note", text: metric.note });
      button.addEventListener("click", () => {
        this.selectedMetric = metric.dimension;
        this.render();
      });
    }

    const layout = parent.createDiv({ cls: "activity-metrics-layout" });
    this.renderDailyDistribution(layout, range);
    const selected = metrics.find((metric) => metric.dimension === this.selectedMetric) ?? metrics[0];
    if (selected) {
      this.renderMetricEvidence(layout, selected);
    }
  }

  private renderDailyDistribution(parent: HTMLElement, range: DateRange): void {
    const panel = parent.createDiv({ cls: "activity-distribution" });
    panel.createEl("h3", { text: "每日分布" });
    const events = filterEvents(this.snapshot?.events ?? [], range, this.filters);
    const dates: string[] = [];
    for (let cursor = dateFromKey(range.start); dateKey(cursor) <= range.end; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
      dates.push(dateKey(cursor));
    }
    const summaries = dates.map((date) => {
      const summary = summarizeCalendarDay(date, events);
      summary.outputs = this.outcomesForDate(date).length;
      return summary;
    });
    const max = Math.max(1, ...summaries.flatMap((summary) => [summary.tasks, summary.outputs, summary.knowledge]));
    for (const summary of summaries) {
      const row = panel.createDiv({ cls: "activity-distribution-row" });
      row.createSpan({ cls: "activity-distribution-date", text: dayLabel(summary.date) });
      const bars = row.createDiv({ cls: "activity-distribution-bars" });
      this.progressBar(bars, "task", "任务", summary.tasks, max);
      this.progressBar(bars, "output", "产出", summary.outputs, max);
      this.progressBar(bars, "knowledge", "知识", summary.knowledge, max);
    }
  }

  private renderMetricEvidence(parent: HTMLElement, metric: MetricResult): void {
    const panel = parent.createDiv({ cls: "activity-metric-evidence" });
    panel.dataset.testid = "metric-evidence";
    const heading = panel.createDiv({ cls: "activity-inspector-heading" });
    heading.createEl("h3", { text: `${metric.label}构成` });
    heading.createSpan({ text: `${metric.events.length} 条证据` });
    if (metric.events.length === 0) {
      this.renderEmpty(panel, "search-x", metric.note);
      return;
    }
    for (const event of metric.events.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))) {
      this.renderEventRow(panel, event, true);
    }
  }

  private renderTaskRow(parent: HTMLElement, task: TaskAggregate): void {
    const row = parent.createDiv({ cls: "activity-task-row" });
    row.dataset.taskKey = task.taskKey;
    const status = row.createSpan({ cls: `activity-task-status is-${task.status}` });
    setIcon(status, task.status === "completed" ? "circle-check" : task.status === "blocked" ? "circle-pause" : "circle-dot");
    const body = row.createDiv({ cls: "activity-task-body" });
    body.createDiv({ cls: "activity-task-title", text: task.title });
    body.createDiv({
      cls: "activity-task-meta",
      text: `${task.turnCount} 次推进 · ${task.activeDates.length} 个活跃日 · ${CONFIDENCE_LABELS[task.statusConfidence]}`
    });
    const dates = row.createDiv({ cls: "activity-task-dates" });
    for (const date of task.activeDates) {
      dates.createSpan({ text: date.slice(5) });
    }
    const firstSource = this.availableSources(task.sourceRefs)[0];
    if (firstSource) {
      this.sourceButton(row, firstSource);
    }
  }

  private renderEventRow(parent: HTMLElement, event: ActivityEvent, compact: boolean): void {
    const row = parent.createDiv({ cls: `activity-event-row${compact ? " is-compact" : ""}` });
    row.dataset.eventId = event.id;
    const marker = row.createSpan({ cls: `activity-event-marker is-${eventDimension(event)}` });
    setIcon(marker, eventIcon(event));
    const body = row.createDiv({ cls: "activity-event-body" });
    const top = body.createDiv({ cls: "activity-event-top" });
    top.createSpan({ cls: "activity-event-time", text: timeLabel(event.occurredAt) });
    top.createSpan({ cls: "activity-event-title", text: event.title });
    const badges = top.createDiv({ cls: "activity-event-badges" });
    badges.createSpan({ cls: `activity-confidence is-${event.confidence}`, text: CONFIDENCE_LABELS[event.confidence] });
    if (!compact) {
      body.createDiv({ cls: "activity-event-summary", text: event.summary });
    }
    const meta = body.createDiv({ cls: "activity-event-meta" });
    meta.createSpan({ text: event.projectLabel });
    meta.createSpan({ text: event.evidence });
    const sources = row.createDiv({ cls: "activity-event-sources" });
    for (const source of this.availableSources(event.sourceRefs).slice(0, compact ? 1 : 2)) {
      this.sourceButton(sources, source);
    }
  }

  private sourceButton(parent: HTMLElement, source: SourceRef): void {
    const button = this.iconButton(parent, source.url ? "external-link" : source.type === "git" ? "git-commit-horizontal" : "file-text", source.label);
    button.addClass("activity-source-button");
    button.addEventListener("click", () => void this.openSource(source));
  }

  private async openSource(source: SourceRef): Promise<void> {
    if (source.url) {
      window.open(source.url, "_blank");
      return;
    }
    if (!source.path) {
      return;
    }
    const vaultFile = this.app.vault.getAbstractFileByPath(source.path);
    if (vaultFile instanceof TFile && vaultFile.extension === "md") {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(vaultFile);
      return;
    }
    if (source.type === "file" && isAbsolutePath(source.path)) {
      const error = await shell.openPath(source.path);
      if (error) {
        new Notice(`无法打开：${error}`);
      }
      return;
    }
    new SourceEvidenceModal(this.app, source).open();
  }

  private async openArtifactNote(artifact: ArtifactRecord): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(artifact.notePath);
    if (!(file instanceof TFile)) {
      new Notice("成果笔记尚未写入或已被移动");
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: "markdown",
      active: true,
      state: { file: file.path, mode: "preview" }
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  private renderRangeMode(parent: HTMLElement, value: RangeMode, onChange: (mode: RangeMode) => void, prefix: string): void {
    const segmented = parent.createDiv({ cls: "activity-range-mode" });
    for (const mode of ["day", "week"] as const) {
      const button = segmented.createEl("button", {
        text: mode === "day" ? "日" : "周",
        cls: value === mode ? "is-active" : "",
        attr: { type: "button" }
      });
      button.dataset.testid = `${prefix}-mode-${mode}`;
      button.addEventListener("click", () => onChange(mode));
    }
  }

  private renderRangeNavigation(
    parent: HTMLElement,
    anchor: Date,
    mode: RangeMode,
    onChange: (anchor: Date) => void,
    prefix: string
  ): void {
    const navigation = parent.createDiv({ cls: "activity-ledger-date-nav" });
    this.iconButton(navigation, "chevron-left", "上一范围", `${prefix}-previous`).addEventListener("click", () => onChange(moveRangeAnchor(anchor, mode, -1)));
    navigation.createEl("h3", { text: mode === "day" ? dayLabel(dateKey(anchor)) : weekLabel(weekRange(anchor)) });
    this.iconButton(navigation, "chevron-right", "下一范围", `${prefix}-next`).addEventListener("click", () => onChange(moveRangeAnchor(anchor, mode, 1)));
    const today = this.iconTextButton(parent, "locate-fixed", "今天", `${prefix}-today`);
    today.addEventListener("click", () => onChange(new Date()));
  }

  private renderStatus(root: HTMLElement): void {
    const diagnostics = this.snapshot?.diagnostics;
    if (!diagnostics) {
      return;
    }
    const status = root.createDiv({ cls: "activity-ledger-status" });
    const outcomes = this.snapshot?.outcomes ?? [];
    const settled = outcomes.filter((outcome) => outcome.settlement.status === "succeeded").length;
    const pending = outcomes.filter((outcome) => outcome.settlement.status === "pending").length;
    const failed = outcomes.filter((outcome) => outcome.settlement.status === "failed").length;
    status.createSpan({ text: `Codex ${diagnostics.codexSessions} 个任务` });
    status.createSpan({ text: `ChatGPT ${diagnostics.chatgptConversations} 个对话` });
    status.createSpan({ text: `飞书 ${diagnostics.feishuRecords} 条来源更新` });
    status.createSpan({ text: `Wiki ${diagnostics.wikiNotes} 篇` });
    status.createSpan({ text: `Git ${diagnostics.gitRepositories} 个仓库` });
    status.createSpan({ text: `真实成果 ${outcomes.length} · 已沉淀 ${settled} · 待沉淀 ${pending} · 失败 ${failed}` });
    if (diagnostics.knowledgeQueue) {
      status.createSpan({
        text: `待整理 ${diagnostics.knowledgeQueue.remainingTopics} 个主题 · ${diagnostics.knowledgeQueue.remainingPairs} 组问答`
      });
      status.createSpan({
        text: `自动化有内容 ${diagnostics.knowledgeQueue.substantiveAutomationPairs} 次 · 空跑归档 ${diagnostics.knowledgeQueue.noOpAutomationPairs} 次`
      });
    } else {
      status.createSpan({ text: `自动化原始记录 ${diagnostics.excludedAutomations} 次` });
    }
    if (!diagnostics.sessionIndexAvailable) {
      status.createSpan({ cls: "is-warning", text: "Codex 主线程索引不可用" });
    }
    if (diagnostics.malformedLines > 0) {
      status.createSpan({ cls: "is-warning", text: `跳过坏行 ${diagnostics.malformedLines}` });
    }
    if (diagnostics.gitErrors.length > 0) {
      status.createSpan({
        cls: "is-warning",
        text: `Git 读取异常 ${diagnostics.gitErrors.length} 项`,
        attr: {
          title: diagnostics.gitErrors.join("\n"),
          "aria-label": `Git 读取异常：${diagnostics.gitErrors.join("；")}`
        }
      });
    }
    if (diagnostics.artifactWriteErrors.length > 0) {
      status.createSpan({
        cls: "is-warning",
        text: `成果写入异常 ${diagnostics.artifactWriteErrors.length} 项`,
        attr: {
          title: diagnostics.artifactWriteErrors.join("\n"),
          "aria-label": `成果写入异常：${diagnostics.artifactWriteErrors.join("；")}`
        }
      });
    }
    if (!diagnostics.settlementFileAvailable) {
      status.createSpan({ cls: "is-warning", text: "知识沉淀账本尚未建立" });
    }
    if (diagnostics.settlementErrors.length > 0) {
      status.createSpan({
        cls: "is-warning",
        text: `知识沉淀账本异常 ${diagnostics.settlementErrors.length} 项`,
        attr: { title: diagnostics.settlementErrors.join("\n") }
      });
    }
    if (diagnostics.ingestHistoryErrors.length > 0) {
      status.createSpan({
        cls: "is-warning",
        text: `整理记录异常 ${diagnostics.ingestHistoryErrors.length} 项`,
        attr: {
          title: diagnostics.ingestHistoryErrors.join("\n"),
          "aria-label": `整理记录异常：${diagnostics.ingestHistoryErrors.join("；")}`
        }
      });
    }
  }

  private renderState(parent: HTMLElement, icon: string, message: string, spinning: boolean): void {
    const state = parent.createDiv({ cls: "activity-ledger-state" });
    const iconEl = state.createSpan({ cls: spinning ? "is-spinning" : "" });
    setIcon(iconEl, icon);
    state.createDiv({ text: message });
  }

  private renderEmpty(parent: HTMLElement, icon: string, message: string): void {
    const empty = parent.createDiv({ cls: "activity-empty" });
    const iconEl = empty.createSpan();
    setIcon(iconEl, icon);
    empty.createSpan({ text: message });
  }

  private indicator(parent: HTMLElement, kind: "task" | "output" | "knowledge", label: string, value: number): void {
    const row = parent.createDiv({ cls: `activity-calendar-indicator is-${kind}` });
    row.createSpan({ cls: "activity-indicator-dot" });
    row.createSpan({ text: label });
    row.createSpan({ text: String(value) });
  }

  private progressBar(parent: HTMLElement, kind: "task" | "output" | "knowledge", label: string, value: number, max: number): void {
    const item = parent.createDiv({ cls: `activity-progress is-${kind}` });
    item.createSpan({ text: label });
    const progress = item.createEl("progress", { attr: { max: String(max), value: String(value), "aria-label": `${label} ${value}` } });
    item.createSpan({ text: String(value) });
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, testId?: string): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "clickable-icon activity-icon-button",
      attr: { type: "button", "aria-label": label, title: label }
    });
    if (testId) {
      button.dataset.testid = testId;
    }
    setIcon(button, icon);
    return button;
  }

  private iconTextButton(parent: HTMLElement, icon: string, label: string, testId?: string): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "activity-icon-text-button",
      attr: { type: "button", "aria-label": label }
    });
    if (testId) {
      button.dataset.testid = testId;
    }
    const iconEl = button.createSpan();
    setIcon(iconEl, icon);
    button.createSpan({ text: label });
    return button;
  }

  private filteredEventsForMonth(): ActivityEvent[] {
    const grid = monthGrid(this.calendarAnchor);
    const start = grid[0]?.date ?? dateKey(this.calendarAnchor);
    const end = grid.at(-1)?.date ?? dateKey(this.calendarAnchor);
    return filterEvents(this.snapshot?.events ?? [], { start, end }, this.filters);
  }

  private availableSources(sources: SourceRef[]): SourceRef[] {
    return sources.filter((source) =>
      Boolean(source.url) ||
      source.type === "git" ||
      source.type === "file" ||
      Boolean(source.path && this.app.vault.getAbstractFileByPath(source.path))
    );
  }

  private ensureSelectedDate(): void {
    if (!this.snapshot || this.snapshot.events.some((event) => event.localDate === this.selectedDate)) {
      return;
    }
    const latest = this.snapshot.events.at(-1);
    if (latest) {
      this.selectedDate = latest.localDate;
      this.calendarAnchor = dateFromKey(latest.localDate);
    }
  }
}

class SourceEvidenceModal extends Modal {
  constructor(app: App, private readonly source: SourceRef) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("activity-source-modal");
    this.contentEl.createEl("h2", { text: "原始来源" });
    this.contentEl.createDiv({ cls: "activity-source-label", text: this.source.label });
    if (this.source.path) {
      this.contentEl.createEl("code", {
        cls: "activity-source-path",
        text: `${this.source.path}${this.source.line ? `:${this.source.line}` : ""}`
      });
    }
    if (this.source.excerpt) {
      this.contentEl.createEl("pre", { cls: "activity-source-excerpt", text: this.source.excerpt });
    }
    const actions = this.contentEl.createDiv({ cls: "activity-source-actions" });
    const copy = actions.createEl("button", { text: "复制路径", cls: "mod-cta" });
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(`${this.source.path ?? ""}${this.source.line ? `:${this.source.line}` : ""}`);
      new Notice("来源路径已复制");
    });
    if (this.source.path && (this.source.type === "git" || this.source.type === "file")) {
      const open = actions.createEl("button", { text: "在系统中打开" });
      open.addEventListener("click", async () => {
        const error = await shell.openPath(this.source.path ?? "");
        if (error) {
          new Notice(`无法打开：${error}`);
        }
      });
    }
    const close = actions.createEl("button", { text: "关闭" });
    close.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function readableSummary(value: string): string {
  const summary = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4).join(" ");
  return summary.length <= 320 ? summary : `${summary.slice(0, 319).trimEnd()}…`;
}

function settlementLabel(
  status: OutcomeAggregate["settlement"]["status"],
  category?: string
): string {
  if (category === "durable-output" && status === "not-applicable") {
    return "已记录";
  }
  switch (status) {
    case "succeeded": return "已沉淀";
    case "pending": return "待沉淀";
    case "failed": return "沉淀失败";
    case "not-applicable": return "无需沉淀";
  }
}

function settlementIcon(
  status: OutcomeAggregate["settlement"]["status"],
  category?: string
): string {
  if (category === "durable-output" && status === "not-applicable") {
    return "send";
  }
  switch (status) {
    case "succeeded": return "book-check";
    case "pending": return "clock-3";
    case "failed": return "circle-alert";
    case "not-applicable": return "minus";
  }
}

function eventIcon(event: ActivityEvent): string {
  switch (event.kind) {
    case "task_completed":
      return "circle-check";
    case "task_blocked":
      return "circle-pause";
    case "task_started":
      return "play";
    case "task_progress":
      return "move-right";
    case "output_created":
      return "package-check";
    case "knowledge_created":
      return "book-plus";
    case "knowledge_updated":
      return "book-open-check";
    case "knowledge_reused":
      return "links";
    case "research_activity":
      return "messages-square";
  }
}

function metricIcon(dimension: ActivityDimension): string {
  switch (dimension) {
    case "activity":
      return "activity";
    case "output":
      return "package-check";
    case "knowledge":
      return "book-open-check";
    case "reuse":
      return "links";
    case "focus":
      return "scan-eye";
  }
}

function ingestRunDisplay(run: KnowledgeIngestRun): {
  key: KnowledgeIngestRunStatus | "stalled";
  label: string;
  icon: string;
} {
  if (run.status === "running" && Date.now() - Date.parse(run.startedAt) > 6 * 60 * 60 * 1000) {
    return { key: "stalled", label: "可能中断", icon: "circle-alert" };
  }
  switch (run.status) {
    case "running": return { key: "running", label: "整理中", icon: "loader-circle" };
    case "idle": return { key: "idle", label: "无需处理", icon: "minus-circle" };
    case "succeeded": return { key: "succeeded", label: "已完成", icon: "circle-check" };
    case "partial": return { key: "partial", label: "部分完成", icon: "circle-dot-dashed" };
    case "failed": return { key: "failed", label: "待重试", icon: "circle-alert" };
    case "unknown": return { key: "unknown", label: "旧版记录", icon: "circle-help" };
  }
}

function ingestTriggerLabel(run: KnowledgeIngestRun): string {
  if (run.source === "current-status") {
    return "最近确认结果";
  }
  if (run.trigger === "automatic") {
    return "夜间自动整理";
  }
  if (run.trigger === "manual") {
    return "手动整理";
  }
  return "旧版运行";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function durationLabel(start: string, end: string): string {
  const duration = Math.max(0, Date.parse(end) - Date.parse(start));
  if (!Number.isFinite(duration)) {
    return "未知";
  }
  if (duration < 60_000) {
    return `${Math.max(1, Math.round(duration / 1000))} 秒`;
  }
  return `${Math.round(duration / 60_000)} 分钟`;
}

function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
