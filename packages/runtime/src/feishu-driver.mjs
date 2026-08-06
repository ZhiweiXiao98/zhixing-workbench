import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { authorizationArgs } from "./feishu-scopes.mjs";

const execFileAsync = promisify(execFile);
const READ_COMMANDS = new Set([
  "auth status",
  "auth check",
  "task +get-my-tasks",
  "calendar +agenda",
  "vc +search",
  "vc +recording",
  "minutes +detail",
  "drive +search",
  "docs +fetch",
  "base +record-list",
  "approval tasks query",
  "approval instances get",
  "im +chat-messages-list",
  "im +chat-search"
]);

export class FeishuDriverError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "FeishuDriverError";
    this.category = options.category || "unknown";
    this.missingScopes = options.missingScopes || [];
    this.retryAfterMs = options.retryAfterMs;
    this.permanent = Boolean(options.permanent);
  }
}

export class LarkCliDriver {
  constructor(options = {}) {
    this.bin = options.bin || process.env.LARK_CLI_BIN || (process.platform === "win32" ? "lark-cli.cmd" : "lark-cli");
    this.exec = options.exec || executeFile;
  }

  async status() {
    const payload = await this.read(["auth", "status", "--json", "--verify"]);
    const data = payload.data || payload;
    const identity = data.identities?.user || payload.identities?.user || data.user || data.profile || {};
    const tokenStatus = String(identity.tokenStatus || identity.token_status || "").toLowerCase();
    const identityStatus = String(identity.status || "").toLowerCase();
    return {
      connected: payload.ok !== false && Boolean(identity.openId || identity.open_id) &&
        !/expired|invalid|missing|logged.?out/.test(`${tokenStatus} ${identityStatus}`) && data.verified !== false,
      userId: String(identity.open_id || identity.openId || data.open_id || data.openId || ""),
      tenantKey: String(identity.tenant_key || identity.tenantKey || data.tenant_key || data.tenantKey || "tenant"),
      label: String(identity.userName || identity.name || identity.display_name || data.name || "已授权用户"),
      scopes: stringArray(identity.scope || identity.scopes || data.scopes || data.scope)
    };
  }

  async checkScopes(scopes) {
    if (!scopes.length) return { ok: true, missing: [] };
    try {
      const payload = await this.read(["auth", "check", "--scope", scopes.join(" "), "--json"]);
      const missing = stringArray(payload.missing_scopes || payload.data?.missing_scopes);
      return { ok: payload.ok !== false && missing.length === 0, missing };
    } catch (error) {
      if (error instanceof FeishuDriverError && error.category === "missing_scope") {
        return { ok: false, missing: error.missingScopes };
      }
      throw error;
    }
  }

  async beginAuthorization(config) {
    return this.writeAuthorization(authorizationArgs(config));
  }

  async completeAuthorization(deviceCode) {
    if (!/^[A-Za-z0-9._-]{6,256}$/.test(String(deviceCode || ""))) throw new Error("授权设备码无效");
    return this.writeAuthorization(["auth", "login", "--device-code", deviceCode, "--json"]);
  }

  async list(module, request = {}) {
    if (module === "messages" && !request.selection?.chat_id && request.selection?.query) {
      request = { ...request, selection: await this.resolveChat(request.selection) };
    }
    const args = commandFor(module, request);
    if (!args) return { items: [], nextPage: undefined };
    const payload = await this.read(args);
    return this.enrichPage(module, pageFromPayload(payload, request));
  }

  async resolveChat(selection) {
    const payload = await this.read(["im", "+chat-search", "--as", "user", "--query", selection.query,
      "--chat-modes", "group,topic", "--page-size", "20", "--json"]);
    const matches = findItems(payload.data ?? payload).filter((item) => {
      const name = String(item.name || item.chat_name || item.title || "").trim().toLocaleLowerCase();
      return name === String(selection.query).trim().toLocaleLowerCase();
    });
    if (matches.length !== 1) {
      throw new FeishuDriverError(matches.length > 1 ? "群名匹配到多项，请使用更精确的群名或群 ID" : "没有找到这个项目群，请检查群名或群 ID", {
        category: "selection_required",
        permanent: true
      });
    }
    const chatId = matches[0].chat_id || matches[0].id;
    if (!chatId) throw new FeishuDriverError("群聊搜索结果缺少可用 ID", { category: "invalid_output" });
    return { ...selection, chat_id: String(chatId) };
  }

  async enrichPage(module, page) {
    if (module === "documents") {
      const items = [];
      for (const item of page.items.slice(0, 20)) {
        const doc = item.url || item.link || item.wiki_url || item.document_url || item.token || item.doc_token || item.document_id;
        if (!doc) { items.push(item); continue; }
        try {
          const detail = await this.read(["docs", "+fetch", "--as", "user", "--doc", String(doc), "--scope", "full",
            "--detail", "simple", "--doc-format", "markdown", "--json"]);
          items.push({ ...item, fetched_content: extractContent(detail.data ?? detail) });
        } catch (error) {
          if (error instanceof FeishuDriverError && ["permission", "auth_expired"].includes(error.category)) {
            items.push({ ...item, inaccessible: true });
          } else {
            throw error;
          }
        }
      }
      return { ...page, items };
    }
    if (module === "meetings") {
      const ids = page.items.map((item) => item.meeting_id || item.id).filter(Boolean).slice(0, 50);
      if (!ids.length) return page;
      try {
        const recording = await this.read(["vc", "+recording", "--as", "user", "--meeting-ids", ids.join(","), "--json"]);
        const artifacts = findItems(recording.data ?? recording);
        const byMeeting = new Map(artifacts.map((item) => [String(item.meeting_id || item.id || ""), item]));
        return { ...page, items: page.items.map((item) => ({ ...item, ...(byMeeting.get(String(item.meeting_id || item.id || "")) || {}) })) };
      } catch (error) {
        if (error instanceof FeishuDriverError && error.category === "permission") return page;
        throw error;
      }
    }
    if (module === "approvals") {
      const items = [];
      for (const item of page.items.slice(0, 30)) {
        const instanceCode = item.instance_code || item.instanceCode;
        if (!instanceCode) { items.push(item); continue; }
        try {
          const detail = await this.read(["approval", "instances", "get", "--as", "user", "--instance-code", String(instanceCode), "--json"]);
          items.push({ ...item, approval_detail: detail.data ?? detail });
        } catch (error) {
          if (error instanceof FeishuDriverError && error.category === "permission") items.push({ ...item, inaccessible: true });
          else throw error;
        }
      }
      return { ...page, items };
    }
    return page;
  }

  async read(args) {
    assertReadOnlyArgs(args);
    const { stdout, stderr } = await this.exec(this.bin, args, {
      timeout: 90_000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: notifierFreeEnv()
    });
    return checkedPayload(parseJsonOutput(`${stdout || ""}\n${stderr || ""}`));
  }

  async writeAuthorization(args) {
    if (args[0] !== "auth" || args[1] !== "login") throw new Error("仅允许飞书官方登录流程");
    const { stdout, stderr } = await this.exec(this.bin, args, {
      timeout: args.includes("--no-wait") ? 30_000 : 10 * 60_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      env: notifierFreeEnv()
    });
    const payload = checkedPayload(parseJsonOutput(`${stdout || ""}\n${stderr || ""}`));
    return {
      deviceCode: String(payload.device_code || payload.data?.device_code || ""),
      verificationUrl: String(payload.verification_url || payload.data?.verification_url || ""),
      completed: Boolean(payload.ok && !(payload.device_code || payload.data?.device_code))
    };
  }
}

export function assertReadOnlyArgs(args) {
  const words = args.filter((value) => !String(value).startsWith("--"));
  const key = words.slice(0, args[0] === "approval" ? 3 : 2).join(" ");
  if (!READ_COMMANDS.has(key)) throw new Error(`飞书命令不在只读白名单：${key}`);
  if (args.includes("--yes") || args.some((value) => /^(?:create|update|delete|write|approve|reject|cancel|transfer|rollback|remind)$/i.test(value))) {
    throw new Error("飞书连接器禁止写操作");
  }
}

export function commandFor(module, request = {}) {
  const since = request.since || dateDaysAgo(30);
  const until = request.until || dateDaysAgo(-30);
  const page = request.pageToken ? ["--page-token", String(request.pageToken)] : [];
  switch (module) {
    case "tasks": return ["task", "+get-my-tasks", "--as", "user", "--json", ...page];
    case "calendar": return ["calendar", "+agenda", "--as", "user", "--start", since, "--end", until, "--json"];
    case "meetings": return ["vc", "+search", "--as", "user", "--start", since, "--end", request.now || new Date().toISOString(),
      "--participant-ids", request.currentUserId, "--page-size", "30", "--json", ...page];
    case "minutes": {
      const tokens = (request.selection?.minute_tokens || []).filter(Boolean).slice(0, 50);
      return tokens.length ? ["minutes", "+detail", "--as", "user", "--minute-tokens", tokens.join(","),
        "--summary", "--todo", "--chapter", "--json"] : null;
    }
    case "documents": return ["drive", "+search", "--as", "user", "--query", "", "--edited-since", since,
      "--doc-types", "doc,docx,wiki", "--sort", "edit_time", "--page-size", "20", "--json", ...page];
    case "base": {
      const selection = request.selection || {};
      if (!selection.base_token || !selection.table_id || !selection.view_id) return null;
      const offset = Number(request.pageToken || 0);
      const fields = (selection.field_ids || []).flatMap((field) => ["--field-id", String(field)]);
      return ["base", "+record-list", "--as", "user", "--base-token", selection.base_token,
        "--table-id", selection.table_id, "--view-id", selection.view_id, "--offset", String(offset),
        "--limit", "100", ...fields, "--json"];
    }
    case "approvals": return ["approval", "tasks", "query", "--as", "user", "--topic", String(request.selection?.topic || 2),
      "--start-timestamp", String(Math.floor(Date.parse(since) / 1000)), "--end-timestamp", String(Math.floor(Date.parse(request.now || new Date().toISOString()) / 1000)),
      "--page-size", "100", "--json", ...page];
    case "messages": {
      const chat = request.selection || {};
      if (!chat.chat_id || chat.type !== "project_group") return null;
      return ["im", "+chat-messages-list", "--as", "user", "--chat-id", chat.chat_id, "--start", since,
        "--end", request.now || new Date().toISOString(), "--order", "asc", "--page-size", "50",
        "--no-reactions", "--json", ...page];
    }
    default: throw new Error(`未知飞书模块：${module}`);
  }
}

function pageFromPayload(payload, request) {
  const data = payload.data ?? payload;
  const items = findItems(data);
  const next = findValue(data, ["page_token", "next_page_token", "nextPageToken", "next_cursor"]);
  const hasMore = Boolean(findValue(data, ["has_more", "hasMore"]));
  if (request.module === "base" || request.selection?.base_token) {
    const offset = Number(request.pageToken || 0);
    return { items, nextPage: hasMore ? String(offset + Math.max(1, items.length)) : undefined };
  }
  return { items, nextPage: next ? String(next) : undefined };
}

function findItems(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["items", "records", "tasks", "events", "meetings", "minutes", "documents", "messages", "list"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  for (const child of Object.values(value)) {
    const found = findItems(child);
    if (found.length) return found;
  }
  return [];
}

function findValue(value, keys) {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) if (value[key] !== undefined) return value[key];
  for (const child of Object.values(value)) {
    const found = findValue(child, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function extractContent(value) {
  if (!value || typeof value !== "object") return "";
  for (const key of ["content", "markdown", "text", "body"]) {
    if (typeof value[key] === "string") return value[key];
  }
  for (const child of Object.values(value)) {
    const found = extractContent(child);
    if (found) return found;
  }
  return "";
}

function checkedPayload(payload) {
  if (payload?.ok !== false) return payload;
  const error = payload.error || {};
  const subtype = String(error.subtype || error.type || "unknown");
  const message = String(error.message || "飞书命令执行失败");
  const missingScopes = stringArray(error.missing_scopes || payload.missing_scopes);
  const rateLimited = /rate.?limit|429|1254290/i.test(`${subtype} ${message}`);
  const authExpired = /expired|invalid.?token|unauthorized/i.test(`${subtype} ${message}`) && missingScopes.length === 0;
  const permission = /permission|forbidden|91403|2091005/i.test(`${subtype} ${message}`);
  throw new FeishuDriverError(message, {
    category: missingScopes.length ? "missing_scope" : rateLimited ? "rate_limit" : authExpired ? "auth_expired" : permission ? "permission" : subtype,
    missingScopes,
    retryAfterMs: rateLimited ? retryAfter(error) : undefined,
    permanent: missingScopes.length > 0 || authExpired || permission
  });
}

function parseJsonOutput(value) {
  const text = String(value || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new FeishuDriverError("飞书 CLI 未返回 JSON", { category: "invalid_output" });
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch { throw new FeishuDriverError("飞书 CLI 返回了无法解析的结果", { category: "invalid_output" }); }
}

function retryAfter(error) {
  const seconds = Number(error.retry_after || error.retry_after_seconds || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
}

function stringArray(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return typeof value === "string" ? value.split(/[\s,]+/).filter(Boolean) : [];
}

function dateDaysAgo(days) {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return value.toISOString();
}

function notifierFreeEnv() {
  return { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" };
}

async function executeFile(command, args, options) {
  try {
    const executable = process.platform === "win32" && /lark-cli(?:\.cmd)?$/i.test(command)
      ? await resolveWindowsLarkExecutable()
      : command;
    return await execFileAsync(executable, args, options);
  } catch (error) {
    const combined = `${error?.stdout || ""}\n${error?.stderr || ""}`;
    if (combined.includes("{")) return { stdout: combined, stderr: "" };
    if (error?.code === "ENOENT") throw new FeishuDriverError("未找到 lark-cli", { category: "cli_missing", permanent: true });
    throw new FeishuDriverError(String(error?.message || error), { category: "command_failed" });
  }
}

async function resolveWindowsLarkExecutable() {
  const located = await execFileAsync("where.exe", ["lark-cli.cmd"], { timeout: 5_000, windowsHide: true })
    .then((result) => result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))
    .catch(() => []);
  for (const shim of located) {
    const candidate = path.join(path.dirname(shim), "node_modules", "@larksuite", "cli", "bin", "lark-cli.exe");
    try { await access(candidate); return candidate; } catch {}
  }
  throw new FeishuDriverError("已找到 lark-cli 命令，但没有找到官方可执行文件；请重新安装最新版 @larksuite/cli", {
    category: "cli_missing",
    permanent: true
  });
}
