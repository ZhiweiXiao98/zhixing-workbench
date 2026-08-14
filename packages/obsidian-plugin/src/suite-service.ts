import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Notice, requestUrl, type App } from "obsidian";
import { shell } from "electron";
import { discoverExecutable, probeCodexExecutor } from "../../runtime/src/executable-discovery.mjs";
import { readCodexDesktopHealth, readLastCodexEventAt } from "../../runtime/src/codex-desktop-source.mjs";
import { runOwnedAutomationTick, runOwnedManualKnowledge } from "../../runtime/src/automation-owner.mjs";
import { readScheduleState, type KnowledgeScheduleState } from "../../runtime/src/knowledge-scheduler.mjs";
import { readVaultAutomationOwner } from "../../runtime/src/runtime-lock.mjs";
import { readCodexCliHookHealth } from "../../runtime/src/source-health.mjs";
import {
  isFeishuUrl,
  parseBaseLookupPayload,
  parseRecentBasesPayload,
  parseBaseTablesPayload,
  parseBaseViewsPayload,
  type FeishuBaseCandidate,
  type FeishuBaseLookup,
  type FeishuBaseTable,
  type FeishuBaseView
} from "./feishu-base-picker";
import {
  parseChatCandidatesPayload,
  type FeishuChatCandidate
} from "./feishu-chat-picker";
import {
  safeFeishuPermissionUrl,
  parseFeishuCliPayload,
  readFeishuUserAuthorization,
  withFeishuAppPermissionScopes,
  type FeishuUserAuthorizationState
} from "./feishu-cli-result";

const execFileAsync = promisify(execFile);
const RECEIVER_PORT = 43123;
const RELEASE_API = "https://api.github.com/repos/ZhiweiXiao98/zhixing-workbench/releases/latest";

export interface SuiteHealth {
  version: string;
  receiver: "ready" | "starting" | "unavailable";
  receiverMessage: string;
  runtime: "ready" | "unavailable";
  codex: "ready" | "unavailable";
  web: FactualHealth;
  capture: { cliHook: FactualHealth; desktop: FactualHealth };
  organizer: { runtime: FactualHealth; executor: FactualHealth };
  schedulerHost: FactualHealth;
  schedule: KnowledgeScheduleState;
  update: "current" | "available" | "unchecked" | "error";
  latestVersion?: string;
  lastCycle?: string;
  running: boolean;
  feishu: FeishuHealth;
}

export interface FactualHealth {
  source_type: string;
  configured: boolean;
  supported: boolean;
  last_seen_at: string | null;
  last_event_at: string | null;
  stale: boolean;
  error: string | null;
  phase?: "idle" | "processing" | "waiting" | "error";
  owner_kind?: string | null;
}

export interface FeishuHealth {
  status: "disabled" | "ready" | "attention" | "unavailable";
  enabled: boolean;
  cli: "ready" | "missing";
  identityLabel?: string;
  enabledModules: string[];
  selectedChats: number;
  selectedBases: number;
  lastSync?: string;
  pending: number;
  failedModules: number;
  retryAt?: string;
  message: string;
  syncing: boolean;
  configured: boolean;
  supported: boolean;
  lastSeenAt?: string;
  lastEventAt?: string;
  stale: boolean;
  error?: string;
}

export interface FeishuConnectorConfig {
  schema_version: 1;
  enabled: boolean;
  sync_interval_minutes: number;
  modules: Record<string, boolean>;
  selected_chats: Array<{ selection_key: string; chat_id: string; query?: string; label: string; type: "project_group" }>;
  selected_bases: Array<{ selection_key: string; base_token: string; table_id: string; view_id: string; label: string; field_ids: string[] }>;
  minute_tokens: string[];
}

export interface FeishuAuthorization {
  verificationUrl: string;
  deviceCode: string;
}

interface DeviceConfig {
  schema_version: 1;
  device_id: string;
  receiver_port: number;
  receiver_token: string;
  created_at: string;
}

interface CaptureEvent {
  event: "UserPromptSubmit" | "Stop";
  conversation_id: string;
  turn_id: string;
  content: string;
  message_id?: string;
  title?: string;
  url?: string;
}

interface NormalizedCaptureEvent {
  schema_version: number;
  source: string;
  event: string;
  captured_at: string;
  date: string;
  conversation_id: string;
  turn_id: string;
  message_id: string;
  title: string;
  url: string;
  content: string;
  event_id: string;
}

type Listener = (health: SuiteHealth) => void;

export class SuiteService {
  private server?: Server;
  private token = "";
  private programRoot?: string;
  private listeners = new Set<Listener>();
  private queue = Promise.resolve();
  private health: SuiteHealth;
  private scheduleTimer?: number;
  private feishuDeviceCode = "";
  private codexExecutable?: string;
  private larkExecutable?: string;
  private scheduledWork?: Promise<void>;

  constructor(private readonly app: App, private readonly version: string) {
    this.health = {
      version,
      receiver: "starting",
      receiverMessage: "正在启动本机接收器",
      runtime: "unavailable",
      codex: "unavailable",
      web: emptyFactualHealth("chatgpt_web_receiver_v1"),
      capture: {
        cliHook: emptyFactualHealth("codex_cli_hook_v1"),
        desktop: emptyFactualHealth("codex_desktop_sessions_v1")
      },
      organizer: {
        runtime: emptyFactualHealth("knowledge_runtime_v1"),
        executor: emptyFactualHealth("codex_exec_v1")
      },
      schedulerHost: emptyFactualHealth("background_scheduler_v1"),
      schedule: emptyScheduleState(),
      update: "unchecked",
      running: false,
      feishu: emptyFeishuHealth()
    };
  }

  async start(): Promise<void> {
    const device = await this.ensureDeviceConfig();
    this.token = device.receiver_token;
    await this.findProgramRoot();
    await this.startReceiver();
    await this.refreshHealth();
    this.scheduleTimer = window.setInterval(() => void this.runScheduledWork(), 60_000);
    window.setTimeout(() => void this.runScheduledWork(), 5_000);
  }

  async stop(): Promise<void> {
    window.clearInterval(this.scheduleTimer);
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
      this.server = undefined;
    }
    this.listeners.clear();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.health);
    return () => this.listeners.delete(listener);
  }

  snapshot(): SuiteHealth {
    return this.health;
  }

  async copyReceiverToken(): Promise<void> {
    await navigator.clipboard.writeText(this.token);
    new Notice("本机接收密钥已复制，请粘贴到浏览器扩展");
  }

  async openBrowserExtensionFolder(): Promise<void> {
    const install = await readJson(path.join(configRoot(), "install.json"), null);
    const target = typeof install?.browser_extension_root === "string"
      ? install.browser_extension_root : path.join(configRoot(), "browser-extension");
    const manifest = await readJson(path.join(target, "manifest.json"), null);
    if (!manifest?.version) {
      new Notice("浏览器扩展尚未安装，请先重新运行知行台安装器");
      return;
    }
    const error = await shell.openPath(target);
    if (error) {
      console.error("Zhixing browser extension folder open failed", error);
      new Notice("浏览器扩展目录无法打开，请在诊断信息中查看路径");
      return;
    }
    new Notice("已打开浏览器扩展目录，请在浏览器中选择“加载已解压的扩展”");
  }

  async checkForUpdate(): Promise<void> {
    try {
      const response = await requestUrl({ url: RELEASE_API, method: "GET" });
      const tag = String(response.json?.tag_name || "").replace(/^v/, "");
      if (!tag) throw new Error("发布信息缺少版本号");
      this.setHealth({
        latestVersion: tag,
        update: compareVersions(tag, this.version) > 0 ? "available" : "current"
      });
    } catch (error) {
      console.error("Zhixing update check failed", error);
      this.setHealth({ update: "error" });
    }
  }

  async runKnowledgeNow(): Promise<void> {
    if (!this.programRoot || !this.health.organizer.executor.supported || this.health.running) {
      if (!this.health.running) new Notice("知识整理执行器尚未就绪，请在状态提示中查看原因");
      return;
    }
    const vault = this.vaultBasePath();
    const runner = path.join(this.programRoot, "runtime", "run-cycle.mjs");
    const result = await runOwnedManualKnowledge({
      vault,
      ownerKind: "manual",
      onAcquired: async () => this.setHealth({ running: true }),
      runKnowledge: async () => {
        await this.runFeishuSyncNow(false);
        await execFileAsync(process.execPath, [runner, "--vault", vault, "--trigger", "manual"], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ZHIXING_CAPTURE_DISABLED: "1",
            ...(this.codexExecutable ? { CODEX_BIN: this.codexExecutable } : {}) },
          timeout: 6 * 60 * 60_000,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024
        });
      }
    });
    if (result.reason === "owner-busy") {
      new Notice(result.error || "知行台正在处理采集或整理，请稍后再试");
    } else if (result.ok) {
      new Notice("知行台整理完成，可在“整理记录”查看结果");
    } else {
      console.error("Zhixing knowledge cycle failed", result.error);
      new Notice("知行台整理未完成，内容已保留在队列中等待重试");
    }
    this.setHealth({ running: false, ...(result.state ? { schedule: result.state } : {}) });
    await this.refreshHealth();
  }

  async refreshHealth(): Promise<void> {
    await this.findProgramRoot();
    const [codex, lark] = await Promise.all([discoverExecutable("codex"), discoverExecutable("lark-cli")]);
    this.codexExecutable = codex?.path;
    this.larkExecutable = lark?.path;
    const vault = this.vaultBasePath();
    const codexHome = codexHomePath();
    const [lastCycle, schedule, hooks, desktop, executor, webLastEvent, installState, backgroundState, automationOwner] = await Promise.all([
      readJson(path.join(vault, "raw", "codex", "automation", "last-cycle.json"), null),
      readScheduleState({ vault, recoverStale: false }),
      readJson(path.join(codexHome, "hooks.json"), {}),
      readCodexDesktopHealth({ vault, codexHome }),
      probeCodexExecutor(codex?.path),
      readLastCodexEventAt(path.join(vault, "raw", "chatgpt", "events")),
      readJson(path.join(configRoot(), "install.json"), null),
      readJson(path.join(vault, "raw", "codex", "automation", "background-state.json"), null),
      readVaultAutomationOwner({ vault })
    ]);
    const cliHook = await readCodexCliHookHealth({ vault, hooks, codexExecutable: codex?.path });
    const now = new Date().toISOString();
    const runtimeHealth: FactualHealth = {
      source_type: "knowledge_runtime_v1",
      configured: Boolean(this.programRoot),
      supported: Boolean(this.programRoot),
      last_seen_at: this.programRoot ? now : null,
      last_event_at: typeof lastCycle?.finished_at === "string" ? lastCycle.finished_at : null,
      stale: false,
      error: this.programRoot ? null : "知行台知识运行时缺失"
    };
    const executorHealth: FactualHealth = {
      source_type: "codex_exec_v1",
      configured: Boolean(codex),
      supported: Boolean(codex && executor.supported),
      last_seen_at: codex && executor.supported ? now : null,
      last_event_at: typeof lastCycle?.finished_at === "string" ? lastCycle.finished_at : null,
      stale: false,
      error: executor.error
    };
    const web = {
      source_type: "chatgpt_web_receiver_v1",
      configured: Boolean(this.token),
      supported: this.health.receiver === "ready",
      last_seen_at: this.health.receiver === "ready" ? now : null,
      last_event_at: webLastEvent,
      stale: staleSince(webLastEvent),
      error: this.health.receiver === "ready" ? null : this.health.receiverMessage
    };
    const schedulerConfigured = Boolean(installState?.background_scheduler?.installed && !installState?.background_scheduler?.conflict);
    const backgroundOwnsAutomation = automationOwner?.owner_kind === "background";
    const schedulerRecent = backgroundOwnsAutomation || Boolean(backgroundState?.last_seen_at &&
      Date.now() - Date.parse(backgroundState.last_seen_at) <= 3 * 60_000);
    const processing = Boolean(automationOwner);
    const schedulerHost: FactualHealth = {
      source_type: "background_scheduler_v1",
      configured: schedulerConfigured,
      supported: schedulerConfigured && schedulerRecent && backgroundState?.supported === true,
      last_seen_at: typeof backgroundState?.last_seen_at === "string" ? backgroundState.last_seen_at : null,
      last_event_at: typeof backgroundState?.last_event_at === "string" ? backgroundState.last_event_at : null,
      stale: !schedulerRecent && !processing,
      phase: processing ? "processing" : backgroundState?.phase === "error" ? "error" :
        backgroundState?.phase === "waiting" ? "waiting" : "idle",
      owner_kind: automationOwner?.owner_kind || backgroundState?.owner_kind || null,
      error: processing ? null : installState?.background_scheduler?.error || backgroundState?.error ||
        (schedulerConfigured && !schedulerRecent ? "后台调度等待本次登录启动或心跳已中断" :
          schedulerConfigured ? null : "后台调度尚未注册")
    };
    const feishu = await this.readFeishuHealth();
    this.setHealth({
      runtime: this.programRoot ? "ready" : "unavailable",
      codex: executorHealth.supported ? "ready" : "unavailable",
      web,
      capture: { cliHook, desktop },
      organizer: { runtime: runtimeHealth, executor: executorHealth },
      schedulerHost,
      schedule,
      lastCycle: typeof lastCycle?.finished_at === "string" ? lastCycle.finished_at : undefined,
      feishu
    });
  }

  async getFeishuConfig(): Promise<FeishuConnectorConfig> {
    const target = ".zhixing/feishu-connector.json";
    try {
      return normalizeFeishuConfig(JSON.parse(await this.app.vault.adapter.read(target)));
    } catch {
      return normalizeFeishuConfig({});
    }
  }

  async getFeishuUserAuthorization(): Promise<FeishuUserAuthorizationState> {
    const result = await executeLarkCli(["auth", "status", "--json", "--verify"], {
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      env: larkCliEnv()
    }, this.larkExecutable);
    return readFeishuUserAuthorization(parseFeishuCliPayload(`${result.stdout}\n${result.stderr}`));
  }

  getRequiredFeishuScopes(config: FeishuConnectorConfig): string[] {
    return feishuScopes(config);
  }

  async saveFeishuConfig(value: FeishuConnectorConfig): Promise<FeishuConnectorConfig> {
    const config = normalizeFeishuConfig(value);
    await this.ensureVaultDirectory(".zhixing");
    await this.app.vault.adapter.write(".zhixing/feishu-connector.json", `${JSON.stringify(config, null, 2)}\n`);
    await this.refreshHealth();
    return config;
  }

  async findFeishuChats(value: string): Promise<FeishuChatCandidate[]> {
    const query = value.trim();
    if (!query) throw new Error("请输入项目群名称");
    const result = await executeLarkCli([
      "im", "+chat-search", "--as", "user", "--query", query.slice(0, 64),
      "--search-types", "private,public_joined,external", "--page-size", "20", "--json"
    ], feishuReadOptions(), this.larkExecutable);
    const candidates = parseChatCandidatesPayload(parseFeishuCliPayload(`${result.stdout}\n${result.stderr}`));
    if (candidates.length === 0) throw new Error("没有找到匹配的项目群，请换一个更准确的名称");
    return candidates;
  }

  async listRecentFeishuChats(): Promise<FeishuChatCandidate[]> {
    const result = await executeLarkCli([
      "im", "+chat-list", "--as", "user", "--sort", "active_time", "--page-size", "20", "--json"
    ], feishuReadOptions(), this.larkExecutable);
    const candidates = parseChatCandidatesPayload(parseFeishuCliPayload(`${result.stdout}\n${result.stderr}`));
    if (candidates.length === 0) throw new Error("没有找到最近使用的项目群，可以输入群名继续查找");
    return candidates;
  }

  async findFeishuBases(value: string): Promise<FeishuBaseLookup> {
    const query = value.trim();
    if (!query) throw new Error("请输入多维表格名称，或粘贴飞书链接");
    const args = isFeishuUrl(query)
      ? ["base", "+url-resolve", "--url", query, "--as", "user", "--json"]
      : ["base", "+title-resolve", "--title", query.slice(0, 30), "--as", "user", "--json"];
    const result = await executeLarkCli(args, feishuReadOptions(), this.larkExecutable);
    const lookup = parseBaseLookupPayload(parseFeishuCliPayload(`${result.stdout}\n${result.stderr}`));
    if (lookup.kind === "resolved") {
      const views = await this.listFeishuBaseViews(lookup.selection.base_token, lookup.selection.table_id);
      const view = views.find((item) => item.id === lookup.selection.view_id);
      if (view) lookup.selection.label = lookup.selection.label.replace(/所选视图$/, view.name);
    }
    if (lookup.kind === "candidates" && lookup.candidates.length === 0) {
      throw new Error(isFeishuUrl(query) ? "这个链接没有解析到可选择的多维表格" : "没有找到匹配的多维表格，请换一个更准确的名称");
    }
    return lookup;
  }

  async listRecentFeishuBases(): Promise<FeishuBaseCandidate[]> {
    const result = await executeLarkCli([
      "drive", "+search", "--as", "user", "--query", "", "--doc-types", "bitable",
      "--sort", "edit_time", "--page-size", "20", "--json"
    ], feishuReadOptions(), this.larkExecutable);
    const candidates = parseRecentBasesPayload(parseFeishuCliPayload(`${result.stdout}\n${result.stderr}`));
    if (candidates.length === 0) throw new Error("没有找到最近使用的多维表格，可以输入名称继续查找");
    return candidates;
  }

  async listFeishuBaseTables(baseToken: string): Promise<FeishuBaseTable[]> {
    try {
      const result = await executeLarkCli([
        "base", "+table-list", "--base-token", baseToken, "--as", "user", "--json"
      ], feishuReadOptions(), this.larkExecutable);
      const tables = parseBaseTablesPayload(parseFeishuCliPayload(`${result.stdout}\n${result.stderr}`));
      if (tables.length === 0) throw new Error("这个多维表格中没有可选择的数据表");
      return tables;
    } catch (error) {
      throw withFeishuAppPermissionScopes(error, baseReadScopes(), "飞书应用尚未开通多维表格只读权限");
    }
  }

  async listFeishuBaseViews(baseToken: string, tableId: string): Promise<FeishuBaseView[]> {
    try {
      const result = await executeLarkCli([
        "base", "+view-list", "--base-token", baseToken, "--table-id", tableId, "--as", "user", "--json"
      ], feishuReadOptions(), this.larkExecutable);
      const views = parseBaseViewsPayload(parseFeishuCliPayload(`${result.stdout}\n${result.stderr}`));
      if (views.length === 0) throw new Error("这个数据表中没有可选择的视图");
      return views;
    } catch (error) {
      throw withFeishuAppPermissionScopes(error, baseReadScopes(), "飞书应用尚未开通多维表格只读权限");
    }
  }

  async openFeishuPermissionPage(value: string): Promise<void> {
    const url = safeFeishuPermissionUrl(value);
    if (!url) throw new Error("飞书没有返回可用的官方权限页面");
    await shell.openExternal(url);
  }

  async beginFeishuAuthorization(config: FeishuConnectorConfig): Promise<FeishuAuthorization> {
    const scopes = feishuScopes(config);
    if (scopes.length === 0) throw new Error("请先选择至少一个飞书模块");
    this.feishuDeviceCode = "";
    const result = await executeLarkCli(["auth", "login", "--scope", scopes.join(" "), "--no-wait", "--json"], {
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      env: larkCliEnv()
    }, this.larkExecutable);
    const payload = parseFeishuCliPayload(`${result.stdout}\n${result.stderr}`);
    const verificationUrl = String(payload.verification_url || payload.data?.verification_url || "");
    const deviceCode = String(payload.device_code || payload.data?.device_code || "");
    if (!verificationUrl || !deviceCode) throw new Error("飞书没有返回可用的授权地址");
    this.feishuDeviceCode = deviceCode;
    await shell.openExternal(verificationUrl);
    return { verificationUrl, deviceCode: "stored-in-memory" };
  }

  async completeFeishuAuthorization(): Promise<void> {
    if (!this.feishuDeviceCode) throw new Error("请先开始飞书授权");
    const deviceCode = this.feishuDeviceCode;
    try {
      await executeLarkCli(["auth", "login", "--device-code", deviceCode, "--json"], {
        timeout: 10 * 60_000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        env: larkCliEnv()
      }, this.larkExecutable);
      await this.refreshHealth();
    } finally {
      this.feishuDeviceCode = "";
    }
  }

  async runFeishuSyncNow(notify = true): Promise<void> {
    if (!this.programRoot || this.health.feishu.syncing) return;
    const config = await this.getFeishuConfig();
    if (!config.enabled) return;
    const runner = path.join(this.programRoot, "runtime", "feishu-cli.mjs");
    this.setHealth({ feishu: { ...this.health.feishu, syncing: true, message: "正在同步飞书" } });
    try {
      await execFileAsync(process.execPath, [runner, "--vault", this.vaultBasePath(), "--force"], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ZHIXING_CAPTURE_DISABLED: "1",
          ...(this.larkExecutable ? { LARK_CLI_BIN: this.larkExecutable } : {}) },
        timeout: 30 * 60_000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      });
      if (notify) new Notice("飞书只读同步完成，新增内容已进入整理队列");
    } catch (error) {
      console.error("Zhixing Feishu sync failed", safeCommandError(error));
      if (notify) new Notice("飞书同步未完成，已保留失败状态并等待重试");
    } finally {
      this.setHealth({ feishu: { ...this.health.feishu, syncing: false } });
      await this.refreshHealth();
    }
  }

  async clearFeishuCache(): Promise<void> {
    const target = "raw/feishu";
    if (await this.app.vault.adapter.exists(target)) await this.app.vault.adapter.rmdir(target, true);
    await this.ensureVaultDirectory("raw/feishu/events");
    await this.ensureVaultDirectory("raw/feishu/daily");
    await this.refreshHealth();
    new Notice("飞书本地原始缓存已清理，长期 Wiki 保持不变");
  }

  private async startReceiver(): Promise<void> {
    this.server = http.createServer((request, response) => {
      this.queue = this.queue.then(() => this.handleRequest(request, response), () => this.handleRequest(request, response));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        this.server?.once("error", reject);
        this.server?.listen(RECEIVER_PORT, "127.0.0.1", () => resolve());
      });
      this.setHealth({ receiver: "ready", receiverMessage: `本机端口 ${RECEIVER_PORT} 已就绪` });
    } catch (error) {
      this.server = undefined;
      if ((error as NodeJS.ErrnoException)?.code === "EADDRINUSE" && await this.probeExistingReceiver()) {
        this.setHealth({ receiver: "ready", receiverMessage: `本机端口 ${RECEIVER_PORT} 已有知行台接收器` });
        return;
      }
      const message = (error as NodeJS.ErrnoException)?.code === "EADDRINUSE"
        ? `端口 ${RECEIVER_PORT} 已被占用`
        : "本机接收器启动失败";
      this.setHealth({ receiver: "unavailable", receiverMessage: message });
    }
  }

  private async probeExistingReceiver(): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${RECEIVER_PORT}/health`, {
        headers: { "X-Obsidian-Capture-Token": this.token }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Obsidian-Capture-Token");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") return sendJson(response, 204, {});
    if (!secureEqual(request.headers["x-obsidian-capture-token"], this.token)) {
      return sendJson(response, 401, { ok: false });
    }
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, { ok: true, service: "zhixing-obsidian" });
    }
    if (request.method !== "POST" || request.url !== "/capture/v1/events") {
      return sendJson(response, 404, { ok: false });
    }
    try {
      const body = await requestJson(request);
      const result = await this.persistEvents(Array.isArray(body.events) ? body.events.slice(0, 100) : []);
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: String(error).slice(0, 120) });
    }
  }

  private async persistEvents(events: unknown[]): Promise<{ accepted: number; duplicates: number; rejected: number; ack_keys: string[] }> {
    const date = localDate();
    const target = `raw/chatgpt/events/${date}.jsonl`;
    const exists = await this.app.vault.adapter.exists(target);
    const current = exists ? await this.app.vault.adapter.read(target) : "";
    const known = new Set(current.split(/\r?\n/).flatMap((line) => {
      try { const value = JSON.parse(line); return value.event_id ? [value.event_id as string] : []; } catch { return []; }
    }));
    const added: string[] = [];
    const ackKeys: string[] = [];
    let duplicates = 0;
    let rejected = 0;
    for (const raw of events) {
      if (!validEvent(raw)) { rejected += 1; continue; }
      ackKeys.push(eventKey(raw));
      const record = normalizeEvent(raw, date);
      if (known.has(record.event_id)) { duplicates += 1; continue; }
      known.add(record.event_id);
      added.push(JSON.stringify(record));
    }
    if (added.length > 0) {
      await this.ensureVaultDirectory("raw/chatgpt/events");
      const separator = current && !current.endsWith("\n") ? "\n" : "";
      await this.app.vault.adapter.write(target, `${current}${separator}${added.join("\n")}\n`);
    }
    return { accepted: added.length, duplicates, rejected, ack_keys: ackKeys };
  }

  private async ensureVaultDirectory(directory: string): Promise<void> {
    let current = "";
    for (const segment of directory.split("/")) {
      current = current ? `${current}/${segment}` : segment;
      if (!await this.app.vault.adapter.exists(current)) await this.app.vault.adapter.mkdir(current);
    }
  }

  private async ensureDeviceConfig(): Promise<DeviceConfig> {
    const root = configRoot();
    const target = path.join(root, "device.json");
    const existing = await readJson(target, null);
    if (existing?.receiver_token && String(existing.receiver_token).length >= 24) return existing as DeviceConfig;
    const created: DeviceConfig = {
      schema_version: 1,
      device_id: randomBytes(16).toString("hex"),
      receiver_port: RECEIVER_PORT,
      receiver_token: randomBytes(32).toString("base64url"),
      created_at: new Date().toISOString()
    };
    await atomicJson(target, created);
    return created;
  }

  private async findProgramRoot(): Promise<void> {
    const install = await readJson(path.join(configRoot(), "install.json"), null);
    if (typeof install?.program_root === "string") {
      const runner = path.join(install.program_root, "runtime", "run-cycle.mjs");
      try { await readFile(runner, "utf8"); this.programRoot = install.program_root; return; } catch {}
    }
    this.programRoot = undefined;
  }

  private async runScheduledWork(): Promise<void> {
    if (this.scheduledWork) return this.scheduledWork;
    this.scheduledWork = this.performScheduledWork();
    try { await this.scheduledWork; } finally { this.scheduledWork = undefined; }
  }

  private async performScheduledWork(): Promise<void> {
    const vault = this.vaultBasePath();
    await this.runFeishuIfDue();
    await this.refreshHealth();
    if (this.health.schedulerHost.supported) return;
    if (!this.programRoot || this.health.running) return;
    const result = await runOwnedAutomationTick({
      vault,
      codexHome: codexHomePath(),
      ownerKind: "obsidian",
      executorReady: this.health.organizer.runtime.supported && this.health.organizer.executor.supported,
      runKnowledge: async () => {
        if (!this.programRoot) throw new Error("知行台知识运行时缺失");
        this.setHealth({ running: true });
        try {
          await execFileAsync(process.execPath, [path.join(this.programRoot, "runtime", "run-cycle.mjs"),
            "--vault", vault, "--trigger", "automatic"], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ZHIXING_CAPTURE_DISABLED: "1",
              ...(this.codexExecutable ? { CODEX_BIN: this.codexExecutable } : {}) },
            timeout: 6 * 60 * 60_000,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024
          });
        } finally {
          this.setHealth({ running: false });
        }
      }
    });
    if (result.state) this.setHealth({ schedule: result.state });
    if (result.ran && !result.ok) console.error("Zhixing automatic knowledge cycle failed", result.error);
    await this.refreshHealth();
  }

  private async runFeishuIfDue(): Promise<void> {
    const config = await this.getFeishuConfig();
    if (!config.enabled || this.health.feishu.syncing) return;
    const lastSync = this.health.feishu.lastSync ? Date.parse(this.health.feishu.lastSync) : 0;
    const interval = config.sync_interval_minutes * 60_000;
    if (Date.now() - lastSync >= interval) await this.runFeishuSyncNow(false);
  }

  private async readFeishuHealth(): Promise<FeishuHealth> {
    const config = await this.getFeishuConfig();
    const cli = Boolean(this.larkExecutable);
    const state = await readJson(path.join(this.vaultBasePath(), "raw", "feishu", "sync-state.json"), {});
    const enabledModules = Object.entries(config.modules).filter(([, enabled]) => enabled).map(([key]) => key);
    const pending = config.enabled ? await countPendingFeishu(this.vaultBasePath()) : 0;
    if (!config.enabled) {
      return { ...emptyFeishuHealth(), cli: cli ? "ready" : "missing", enabledModules,
        selectedChats: config.selected_chats.length, selectedBases: config.selected_bases.length };
    }
    const failedModules = Number(state.failed_modules || 0);
    const lastSuccess = typeof state.last_success === "string" ? state.last_success : undefined;
    const stale = staleSince(lastSuccess || null);
    const status = !cli || !this.programRoot ? "unavailable" :
      failedModules > 0 || state.status === "failed" || !lastSuccess || stale ? "attention" : "ready";
    const message = !cli ? "未找到 lark-cli" : !this.programRoot ? "知行台运行时缺失" :
      failedModules > 0 ? `${failedModules} 个模块等待重试` : !lastSuccess ? "等待首次同步" :
        stale ? "飞书已久未同步" : "飞书只读同步正常";
    return {
      status,
      enabled: true,
      cli: cli ? "ready" : "missing",
      identityLabel: typeof state.identity_label === "string" ? state.identity_label : undefined,
      enabledModules,
      selectedChats: config.selected_chats.length,
      selectedBases: config.selected_bases.length,
      lastSync: lastSuccess,
      pending,
      failedModules,
      retryAt: typeof state.retry_at === "string" ? state.retry_at : undefined,
      message,
      syncing: this.health.feishu.syncing,
      configured: true,
      supported: cli && Boolean(this.programRoot),
      lastSeenAt: typeof state.last_attempt === "string" ? state.last_attempt : undefined,
      lastEventAt: lastSuccess,
      stale,
      error: typeof state.error === "string" ? state.error : failedModules > 0 ? `${failedModules} 个模块同步失败` : undefined
    };
  }

  private vaultBasePath(): string {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    if (!adapter.getBasePath) throw new Error("知行台仅支持本地桌面 Vault");
    return adapter.getBasePath();
  }

  private setHealth(change: Partial<SuiteHealth>): void {
    this.health = { ...this.health, ...change };
    for (const listener of this.listeners) listener(this.health);
  }
}

function configRoot(): string {
  if (process.env.ZHIXING_CONFIG) return path.resolve(process.env.ZHIXING_CONFIG);
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"), "ZhixingWorkbench");
  if (process.platform === "darwin") return path.join(homedir(), "Library", "Application Support", "ZhixingWorkbench");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "zhixing-workbench");
}

async function readJson(target: string, fallback: any): Promise<any> {
  try { return JSON.parse(await readFile(target, "utf8")); } catch { return fallback; }
}

async function atomicJson(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function localDate(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function secureEqual(value: string | string[] | undefined, expected: string): boolean {
  if (typeof value !== "string") return false;
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validEvent(value: unknown): value is CaptureEvent {
  const item = value as Record<string, unknown>;
  return Boolean(item && ["UserPromptSubmit", "Stop"].includes(String(item.event))
    && typeof item.conversation_id === "string" && item.conversation_id
    && typeof item.turn_id === "string" && item.turn_id
    && typeof item.content === "string" && item.content.trim());
}

function normalizeEvent(event: CaptureEvent, date: string): NormalizedCaptureEvent {
  const stable = JSON.stringify([event.conversation_id, event.turn_id, event.event, event.message_id || "", event.content]);
  return {
    schema_version: 1,
    source: "chatgpt_web",
    event: event.event,
    captured_at: new Date().toISOString(),
    date,
    conversation_id: event.conversation_id,
    turn_id: event.turn_id,
    message_id: event.message_id || "",
    title: redact(event.title || "未命名对话").slice(0, 300),
    url: /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(event.url || "") ? (event.url || "") : "",
    content: redact(event.content).trim(),
    event_id: `chatgpt:${createHash("sha256").update(stable).digest("hex").slice(0, 32)}`
  };
}

function redact(value: string): string {
  return value
    .replace(/\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, "[已隐藏密钥]")
    .replace(/\b(?:ghp|github_pat|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{16,}\b/g, "[已隐藏凭据]")
    .replace(/\b(authorization|api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*[^\s,]{6,}/gi, "$1=[已隐藏]");
}

function eventKey(event: CaptureEvent): string {
  return [event.conversation_id, event.turn_id, event.event, event.message_id || ""].join(":");
}

async function requestJson(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 2 * 1024 * 1024) throw new Error("请求内容超过安全上限");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(status === 204 ? undefined : JSON.stringify(value));
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

const FEISHU_SCOPE_MAP: Record<string, string[]> = {
  tasks: ["task:task:read"],
  calendar: ["calendar:calendar.event:read"],
  meetings: ["vc:meeting.search:read", "vc:recording:read"],
  minutes: ["minutes:minutes.basic:read", "minutes:minutes.artifacts:read"],
  documents: ["search:docs:read", "docs:document.content:read", "docx:document:readonly"],
  base: ["search:docs:read", "base:table:read", "base:view:read", "base:record:read"],
  approvals: ["approval:task:read", "approval:instance:read"],
  messages: ["im:chat:read", "im:message:readonly"]
};

function emptyFeishuHealth(): FeishuHealth {
  return { status: "disabled", enabled: false, cli: "missing", enabledModules: [], selectedChats: 0,
    selectedBases: 0, pending: 0, failedModules: 0, message: "飞书连接器未开启", syncing: false,
    configured: false, supported: false, stale: false };
}

function emptyFactualHealth(sourceType: string): FactualHealth {
  return { source_type: sourceType, configured: false, supported: false, last_seen_at: null,
    last_event_at: null, stale: true, error: null };
}

function emptyScheduleState(): KnowledgeScheduleState {
  return { schema_version: 1, last_attempt: null, last_success: null, next_due: null,
    status: "idle", error: null, failure_count: 0, trigger: null, owner_pid: null };
}

function staleSince(value: string | null, threshold = 36 * 60 * 60_000): boolean {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return !Number.isFinite(parsed) || Date.now() - parsed > threshold;
}

function codexHomePath(): string {
  return path.resolve(process.env.CODEX_HOME || path.join(homedir(), ".codex"));
}

function normalizeFeishuConfig(value: any): FeishuConnectorConfig {
  const keys = Object.keys(FEISHU_SCOPE_MAP);
  const modules = Object.fromEntries(keys.map((key) => [key, Boolean(value?.modules?.[key])]));
  const chats = Array.isArray(value?.selected_chats) ? value.selected_chats : [];
  const bases = Array.isArray(value?.selected_bases) ? value.selected_bases : [];
  return {
    schema_version: 1,
    enabled: Boolean(value?.enabled),
    sync_interval_minutes: Math.min(1440, Math.max(15, Number(value?.sync_interval_minutes || 60))),
    modules,
    selected_chats: chats.map((item: any) => ({ selection_key: safeIdentifier(item?.selection_key || item?.chat_id) ||
      createHash("sha256").update(String(item?.query || "")).digest("hex").slice(0, 20),
      chat_id: safeIdentifier(item?.chat_id), query: safeDisplay(item?.query || ""), label: safeDisplay(item?.label || "已选项目群"), type: "project_group" as const }))
      .filter((item: any) => item.chat_id || item.query).slice(0, 100),
    selected_bases: bases.map((item: any) => ({
      selection_key: safeIdentifier(item?.selection_key || `${item?.base_token}:${item?.table_id}:${item?.view_id}`),
      base_token: safeIdentifier(item?.base_token), table_id: safeIdentifier(item?.table_id), view_id: safeIdentifier(item?.view_id),
      label: safeDisplay(item?.label || "已选 Base 视图"),
      field_ids: (Array.isArray(item?.field_ids) ? item.field_ids : []).map(safeDisplay).filter(Boolean).slice(0, 40)
    })).filter((item: any) => item.base_token && item.table_id && item.view_id).slice(0, 100),
    minute_tokens: (Array.isArray(value?.minute_tokens) ? value.minute_tokens : []).map(safeIdentifier).filter(Boolean).slice(0, 200)
  };
}

function feishuScopes(config: FeishuConnectorConfig): string[] {
  return [...new Set(Object.entries(config.modules).filter(([, enabled]) => enabled)
    .flatMap(([module]) => FEISHU_SCOPE_MAP[module] || []))].sort();
}

function baseReadScopes(): string[] {
  return (FEISHU_SCOPE_MAP.base || []).filter((scope) => scope.startsWith("base:"));
}

async function countPendingFeishu(vault: string): Promise<number> {
  const processed = new Set<string>();
  const ingest = await readJson(path.join(vault, "raw", "codex", "ingest-state.json"), {});
  for (const id of Array.isArray(ingest.processed_event_ids) ? ingest.processed_event_ids : []) processed.add(String(id));
  const directory = path.join(vault, "raw", "feishu", "events");
  let names: string[] = [];
  try { names = (await readdir(directory)).filter((name) => name.endsWith(".jsonl")).sort().slice(-45); } catch { return 0; }
  let pending = 0;
  for (const name of names) {
    const lines = (await readFile(path.join(directory, name), "utf8")).split(/\r?\n/);
    for (const line of lines) {
      try { const item = JSON.parse(line); if (item.event_id && !processed.has(item.event_id)) pending += 1; } catch {}
    }
  }
  return pending;
}

function safeIdentifier(value: unknown): string {
  return String(value || "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 300);
}

function safeDisplay(value: unknown): string {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
}

function safeCommandError(error: unknown): string {
  return String(error instanceof Error ? error.message : error).replace(/[\r\n]+/g, " ").slice(0, 300);
}

function larkCliEnv(): NodeJS.ProcessEnv {
  return { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" };
}

function feishuReadOptions(): Parameters<typeof execFileAsync>[2] {
  return { timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: larkCliEnv() };
}

async function executeLarkCli(args: string[], options: Parameters<typeof execFileAsync>[2], located?: string): Promise<{ stdout: string; stderr: string }> {
  const executable = located || (await discoverExecutable("lark-cli"))?.path;
  if (!executable) throw new Error("未找到官方 lark-cli，请重新安装最新版 @larksuite/cli");
  try {
    const result = await execFileAsync(executable, args, options);
    return { stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
  } catch (error: any) {
    const output = `${String(error?.stdout || "")}\n${String(error?.stderr || "")}`;
    try { parseFeishuCliPayload(output); } catch (parsed) {
      if (parsed instanceof Error && parsed.message !== "飞书没有返回可识别的结果，请稍后重试") throw parsed;
    }
    throw new Error("飞书暂时无法完成这次只读查询，请稍后重试");
  }
}
