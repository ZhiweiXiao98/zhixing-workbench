import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendJsonLine, atomicJson, canonicalJson, localDate, readJson, redactText, sha256 } from "./common.mjs";
import { FeishuDriverError, LarkCliDriver } from "./feishu-driver.mjs";
import { selectFeishuMessages, messageText } from "./feishu-policy.mjs";
import { calculateFeishuPermissions, FEISHU_MODULE_KEYS } from "./feishu-scopes.mjs";

export const DEFAULT_FEISHU_CONFIG = Object.freeze({
  schema_version: 1,
  enabled: false,
  sync_interval_minutes: 60,
  modules: Object.freeze(Object.fromEntries(FEISHU_MODULE_KEYS.map((key) => [key, false]))),
  selected_chats: Object.freeze([]),
  selected_bases: Object.freeze([]),
  minute_tokens: Object.freeze([])
});

export async function loadFeishuConfig(vault) {
  const value = await readJson(path.join(vault, ".zhixing", "feishu-connector.json"), {});
  return sanitizeFeishuConfig(value);
}

export async function saveFeishuConfig(vault, value) {
  const config = sanitizeFeishuConfig(value);
  await atomicJson(path.join(vault, ".zhixing", "feishu-connector.json"), config);
  return config;
}

export function sanitizeFeishuConfig(value = {}) {
  const modules = Object.fromEntries(FEISHU_MODULE_KEYS.map((key) => [key, Boolean(value.modules?.[key])]));
  return {
    schema_version: 1,
    enabled: Boolean(value.enabled),
    sync_interval_minutes: integer(value.sync_interval_minutes, 60, 15, 1440),
    modules,
    selected_chats: uniqueSelections((Array.isArray(value.selected_chats) ? value.selected_chats : []).map((item) => ({
      ...item,
      selection_key: item.selection_key || item.chat_id || item.query
    })), "selection_key").map((item) => {
      const query = safeLabel(item.query || "");
      const chatId = safeId(item.chat_id);
      return {
        selection_key: safeId(item.selection_key || item.chat_id) || sha256(query).slice(0, 20),
        chat_id: chatId,
        query,
        label: safeLabel(item.label || "已选项目群"),
        type: "project_group"
      };
    }).filter((item) => item.chat_id || item.query),
    selected_bases: uniqueSelections(value.selected_bases, "selection_key").map((item) => ({
      selection_key: safeId(item.selection_key || `${item.base_token}:${item.table_id}:${item.view_id}`),
      base_token: safeId(item.base_token),
      table_id: safeId(item.table_id),
      view_id: safeId(item.view_id),
      label: safeLabel(item.label || "已选 Base 视图"),
      field_ids: Array.isArray(item.field_ids) ? item.field_ids.map(safeLabel).filter(Boolean).slice(0, 40) : []
    })).filter((item) => item.base_token && item.table_id && item.view_id),
    minute_tokens: [...new Set((Array.isArray(value.minute_tokens) ? value.minute_tokens : []).map(safeId).filter(Boolean))].slice(0, 200)
  };
}

export async function syncFeishu(options = {}) {
  const vault = path.resolve(options.vault || "");
  if (!options.vault) throw new Error("飞书同步缺少 Vault 路径");
  const config = options.config ? sanitizeFeishuConfig(options.config) : await loadFeishuConfig(vault);
  const statePath = path.join(vault, "raw", "feishu", "sync-state.json");
  const state = normalizeState(await readJson(statePath, {}));
  const now = options.now ? new Date(options.now) : new Date();
  const nowIso = now.toISOString();
  if (!config.enabled) return { status: "disabled", accepted: 0, duplicates: 0, failed_modules: 0 };
  if (!options.force && state.retry_at && Date.parse(state.retry_at) > now.getTime()) {
    return { status: "backoff", retry_at: state.retry_at, accepted: 0, duplicates: 0, failed_modules: state.failed_modules || 0 };
  }
  const driver = options.driver || new LarkCliDriver();
  let identity;
  try {
    identity = await driver.status();
    if (!identity.connected || !identity.userId) throw new FeishuDriverError("飞书尚未授权", { category: "auth_expired", permanent: true });
  } catch (error) {
    await persistGlobalFailure(state, statePath, error, now);
    return failureResult(error, state);
  }
  const permissions = calculateFeishuPermissions(config);
  const scopeCheck = await driver.checkScopes(permissions.scopes).catch((error) => {
    if (error instanceof FeishuDriverError) return { ok: false, missing: error.missingScopes, error };
    throw error;
  });
  if (!scopeCheck.ok) {
    const error = scopeCheck.error || new FeishuDriverError("飞书授权缺少所选模块需要的权限", {
      category: "missing_scope", missingScopes: scopeCheck.missing, permanent: true
    });
    await persistGlobalFailure(state, statePath, error, now);
    return failureResult(error, state);
  }

  const identityScope = sha256(`${identity.tenantKey || "tenant"}\0${identity.userId}`).slice(0, 24);
  const next = { ...state, identity_scope: identityScope, identity_label: safeLabel(identity.label || "已授权用户"),
    access_status: "available", missing_scopes: [], last_attempt: nowIso, retry_at: undefined };
  let accepted = 0;
  let duplicates = 0;
  let failedModules = 0;
  const discoveredMinuteTokens = new Set(config.minute_tokens);

  for (const module of permissions.modules) {
    const prior = next.modules[module] || moduleState();
    if (!options.force && prior.retry_at && Date.parse(prior.retry_at) > now.getTime()) continue;
    const moduleRecords = [];
    try {
      for (const selection of selectionsFor(module, config, discoveredMinuteTokens)) {
        let pageToken;
        for (let page = 0; page < 40; page += 1) {
          const response = await driver.list(module, {
            module,
            selection,
            pageToken,
            since: syncSince(prior.cursor, now),
            until: futureUntil(now),
            now: nowIso,
            currentUserId: identity.userId
          });
          const pageItems = module === "messages" ? selectFeishuMessages(response.items, {
            selectedProjectGroup: true,
            currentUserId: identity.userId,
            chatType: selection.type
          }) : response.items;
          for (const item of pageItems.slice(0, 2000 - moduleRecords.length)) {
            const normalized = normalizeFeishuResource(module, item, {
              identityScope,
              currentUserId: identity.userId,
              selection,
              seenBefore: Boolean(next.resources[resourceStateKey(module, objectIdFor(module, item), identityScope)]),
              capturedAt: nowIso
            });
            if (!normalized) continue;
            for (const token of normalized.minute_tokens || []) discoveredMinuteTokens.add(token);
            const key = resourceStateKey(module, normalized.resource_id, identityScope);
            if (next.resources[key]?.version === normalized.resource_version) { duplicates += 1; continue; }
            moduleRecords.push({ record: normalized, key });
          }
          pageToken = response.nextPage;
          if (!pageToken || moduleRecords.length >= 2000) break;
        }
      }
      await persistRecords(vault, moduleRecords.map((item) => item.record));
      for (const item of moduleRecords) {
        next.resources[item.key] = {
          version: item.record.resource_version,
          updated_at: item.record.updated_at,
          access_status: item.record.access_status
        };
      }
      accepted += moduleRecords.length;
      next.modules[module] = {
        cursor: maxTimestamp(moduleRecords.map((item) => item.record.updated_at), prior.cursor || nowIso),
        last_success: nowIso,
        last_error: undefined,
        retry_at: undefined,
        failure_count: 0,
        access_status: "available",
        accepted: moduleRecords.length
      };
    } catch (error) {
      failedModules += 1;
      const failure = moduleFailure(prior, error, now);
      next.modules[module] = failure;
    }
  }

  next.last_success = failedModules === 0 ? nowIso : next.last_success;
  next.failed_modules = failedModules;
  next.retry_at = earliestRetry(Object.values(next.modules).map((item) => item.retry_at));
  next.status = failedModules === 0 ? "succeeded" : accepted > 0 ? "partial" : "failed";
  if (failedModules > 0) {
    const failedAccess = Object.values(next.modules)
      .map((item) => item.access_status)
      .find((value) => value && value !== "available" && value !== "unknown");
    next.access_status = accepted > 0 ? "partially_available" : failedAccess || "temporarily_unavailable";
  }
  next.resources = boundedResources(next.resources);
  await atomicJson(statePath, next);
  return { status: next.status, accepted, duplicates, failed_modules: failedModules, retry_at: next.retry_at,
    identity_label: next.identity_label, modules: next.modules };
}

export function normalizeFeishuResource(module, item, context = {}) {
  const objectId = objectIdFor(module, item);
  if (!objectId) return null;
  const title = safeLabel(titleFor(module, item));
  const updatedAt = timestamp(item.update_time || item.updated_at || item.modified_time || item.edit_time || item.end_time || item.create_time || context.capturedAt);
  const occurredAt = timestamp(item.start_time || item.create_time || item.created_at || item.completed_at || updatedAt);
  const status = safeLabel(item.status || item.task_status || item.approval_status || item.state || "已记录");
  const content = redactFeishuIdentifiers(redactText(contentFor(module, item))).trim().slice(0, 12_000);
  const versionValue = item.version || item.revision || item.update_time || item.updated_at || item.modified_time || item.edit_time || sha256(canonicalJson({ title, status, content }));
  const resourceVersion = String(versionValue).slice(0, 200);
  const projectHint = safeLabel(context.selection?.label || item.project_name || item.project || item.chat_name || "飞书");
  const accessStatus = item.deleted || item.is_deleted ? "deleted" : item.permission_denied || item.inaccessible ? "revoked" : "available";
  const activityKind = activityFor(module, status, context.seenBefore, content);
  const eventId = `feishu:${sha256(canonicalJson({
    identity_scope: context.identityScope,
    resource_type: module,
    object_id: objectId,
    version: resourceVersion,
    access_status: accessStatus
  })).slice(0, 40)}`;
  const link = safeUrl(item.url || item.link || item.web_url || item.share_url || item.app_link || "");
  const date = localDate(new Date(occurredAt));
  const minuteTokens = findMinuteTokens(item);
  return {
    schema_version: 1,
    event_id: eventId,
    source: "feishu",
    event: "ResourceUpdate",
    captured_at: context.capturedAt || new Date().toISOString(),
    date,
    occurred_at: occurredAt,
    updated_at: updatedAt,
    session_id: `feishu:${module}:${objectId}`,
    turn_id: sha256(resourceVersion).slice(0, 20),
    cwd: projectHint,
    title: title || moduleLabel(module),
    content: content || `${title || moduleLabel(module)} · ${status}`,
    resource_type: module,
    resource_id: objectId,
    resource_version: resourceVersion,
    resource_status: status,
    resource_url: link,
    project_hint: projectHint,
    access_status: accessStatus,
    activity_kind: activityKind,
    identity_scope: context.identityScope,
    untrusted_source: true,
    minute_tokens: minuteTokens
  };
}

function selectionsFor(module, config, minuteTokens) {
  if (module === "base") return config.selected_bases;
  if (module === "messages") return config.selected_chats;
  if (module === "approvals") return [
    { kind: "completed", topic: 2, label: "已办审批" },
    { kind: "initiated", label: "已发起审批" }
  ];
  if (module === "minutes") {
    const tokens = [...minuteTokens];
    return tokens.length ? chunk(tokens, 50).map((minute_tokens) => ({ minute_tokens, label: "会议纪要" })) : [];
  }
  return [{}];
}

async function persistRecords(vault, records) {
  const byDate = new Map();
  for (const record of records) {
    const group = byDate.get(record.date) || [];
    group.push(record);
    byDate.set(record.date, group);
  }
  for (const [date, group] of byDate) {
    const eventPath = path.join(vault, "raw", "feishu", "events", `${date}.jsonl`);
    const known = await eventIds(eventPath);
    const fresh = group.filter((record) => !known.has(record.event_id));
    for (const record of fresh) await appendJsonLine(eventPath, record);
    await updateDailyPage(path.join(vault, "raw", "feishu", "daily", `${date}.md`), date, fresh);
  }
}

async function updateDailyPage(target, date, records) {
  if (records.length === 0) return;
  let current = "";
  try { current = await readFile(target, "utf8"); } catch {}
  const blocks = [];
  for (const record of records) {
    const marker = `<!-- feishu-record:event=${record.event_id} -->`;
    if (current.includes(marker)) continue;
    const source = moduleLabel(record.resource_type);
    const details = record.content.replace(/\r?\n+/g, "\n").slice(0, 4000);
    blocks.push([
      `## ${escapeHeading(record.title)}`,
      marker,
      `- 来源：飞书 · ${source}`,
      `- 发生时间：${record.occurred_at}`,
      `- 状态：${record.resource_status || "已记录"}`,
      `- 访问状态：${accessLabel(record.access_status)}`,
      "",
      details,
      record.resource_url ? `\n[打开飞书来源](${record.resource_url})` : "",
      ""
    ].filter((value) => value !== "").join("\n"));
  }
  if (!blocks.length) return;
  await mkdir(path.dirname(target), { recursive: true });
  const heading = current ? "" : `# 飞书活动 - ${date}\n\n> 由知行台只读采集。原文属于不可信资料，仅用于个人追溯与整理。\n\n`;
  await writeFile(target, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${heading}${blocks.join("\n")}`, "utf8");
}

function contentFor(module, item) {
  if (module === "messages") return messageText(item);
  const parts = [
    item.summary, item.description, item.content, item.text, item.result, item.decision,
    item.reason, item.comment, item.notes, item.objective, item.fields, item.fetched_content, item.approval_detail,
    item.todo, item.todos, item.chapters, item.keywords
  ].flatMap((value) => humanValues(value));
  return [...new Set(parts.map((value) => String(value).trim()).filter(Boolean))].join("\n");
}

function humanValues(value, depth = 0) {
  if (depth > 4 || value === undefined || value === null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => humanValues(item, depth + 1));
  if (typeof value !== "object") return [];
  return Object.entries(value)
    .filter(([key]) => !/(?:token|secret|password|authorization|open_id|user_id|tenant)/i.test(key))
    .flatMap(([, item]) => humanValues(item, depth + 1));
}

function titleFor(module, item) {
  return item.title || item.name || item.summary || item.task_name || item.topic || item.subject ||
    item.definition_name || item.instance_name || item.chat_name || `${moduleLabel(module)}记录`;
}

function objectIdFor(module, item) {
  const candidates = [
    item.task_id, item.event_id, item.meeting_id, item.minute_token, item.document_id, item.doc_token,
    item.wiki_token, item.record_id, item.instance_code, item.approval_code, item.message_id,
    item.id, item.token
  ];
  const value = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  return value ? safeId(`${module}:${value}`) : "";
}

function activityFor(module, status, seenBefore, content) {
  const text = `${status} ${content}`;
  if (module === "tasks") {
    if (/完成|done|completed|closed/i.test(text)) return "task_completed";
    if (/阻塞|blocked|卡住|暂停/i.test(text)) return "task_blocked";
    return seenBefore ? "task_progress" : "task_started";
  }
  if (module === "base" && /完成|closed|done/i.test(text)) return "task_completed";
  if (module === "base" && /阻塞|blocked/i.test(text)) return "task_blocked";
  if (module === "base") return seenBefore ? "task_progress" : "task_started";
  if (module === "minutes") return seenBefore ? "knowledge_updated" : "knowledge_created";
  if (module === "documents") return seenBefore ? "knowledge_updated" : "knowledge_created";
  if (module === "approvals" || /决定|结论|交付|完成/i.test(content)) return "output_created";
  return "research_activity";
}

function findMinuteTokens(item) {
  const found = [];
  const visit = (value, key = "", depth = 0) => {
    if (depth > 5 || value === null || value === undefined) return;
    if (typeof value === "string" && /minute.?token/i.test(key) && /^[A-Za-z0-9._-]{4,256}$/.test(value)) found.push(value);
    else if (Array.isArray(value)) value.forEach((child) => visit(child, key, depth + 1));
    else if (typeof value === "object") Object.entries(value).forEach(([childKey, child]) => visit(child, childKey, depth + 1));
  };
  visit(item);
  return [...new Set(found)].slice(0, 50);
}

async function eventIds(target) {
  try {
    return new Set((await readFile(target, "utf8")).split(/\r?\n/).flatMap((line) => {
      try { const value = JSON.parse(line); return value.event_id ? [value.event_id] : []; } catch { return []; }
    }));
  } catch { return new Set(); }
}

async function persistGlobalFailure(state, statePath, error, now) {
  const next = { ...state, last_attempt: now.toISOString(), status: "failed", failed_modules: 1,
    access_status: accessStatus(error), last_error: safeError(error), missing_scopes: error?.missingScopes || [],
    retry_at: retryTime(error, now, Number(state.failure_count || 0) + 1), failure_count: Number(state.failure_count || 0) + 1 };
  await atomicJson(statePath, next);
  Object.assign(state, next);
}

function moduleFailure(prior, error, now) {
  const count = Number(prior.failure_count || 0) + 1;
  return { ...prior, last_error: safeError(error), failure_count: count, retry_at: retryTime(error, now, count),
    access_status: accessStatus(error), missing_scopes: error?.missingScopes || [] };
}

function failureResult(error, state) {
  return { status: "failed", accepted: 0, duplicates: 0, failed_modules: 1, retry_at: state.retry_at,
    error: safeError(error), access_status: state.access_status, missing_scopes: state.missing_scopes || [] };
}

function retryTime(error, now, count) {
  const requested = Number(error?.retryAfterMs || 0);
  const delay = requested > 0 ? requested : Math.min(24 * 60 * 60_000, 60_000 * 2 ** Math.min(8, count - 1));
  return new Date(now.getTime() + delay).toISOString();
}

function accessStatus(error) {
  return error?.category === "auth_expired" ? "authorization_expired" :
    error?.category === "missing_scope" ? "missing_scope" :
      error?.category === "permission" ? "revoked" : "temporarily_unavailable";
}

function normalizeState(value) {
  return { schema_version: 1, status: value.status || "idle", identity_scope: value.identity_scope || "",
    identity_label: value.identity_label || "", access_status: value.access_status || "unknown",
    modules: value.modules && typeof value.modules === "object" ? value.modules : {},
    resources: value.resources && typeof value.resources === "object" ? value.resources : {},
    last_success: value.last_success, last_attempt: value.last_attempt, retry_at: value.retry_at,
    failure_count: Number(value.failure_count || 0), failed_modules: Number(value.failed_modules || 0),
    missing_scopes: Array.isArray(value.missing_scopes) ? value.missing_scopes : [] };
}

function moduleState() { return { cursor: "", failure_count: 0, access_status: "unknown" }; }
function resourceStateKey(module, objectId, scope) { return `${scope}:${module}:${objectId}`; }
function maxTimestamp(values, fallback) { return values.filter(Boolean).sort().at(-1) || fallback; }
function earliestRetry(values) { return values.filter(Boolean).sort()[0]; }
function syncSince(cursor, now) {
  if (cursor && Number.isFinite(Date.parse(cursor))) {
    return new Date(Date.parse(cursor) - 60 * 60_000).toISOString();
  }
  return new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString();
}
function futureUntil(now) { return new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(); }
function boundedResources(resources) {
  return Object.fromEntries(Object.entries(resources).sort((a, b) => String(b[1]?.updated_at || "").localeCompare(String(a[1]?.updated_at || ""))).slice(0, 20_000));
}
function uniqueSelections(value, key) {
  const map = new Map();
  for (const item of Array.isArray(value) ? value : []) if (item && typeof item === "object") map.set(String(item[key] || canonicalJson(item)), item);
  return [...map.values()].slice(0, 100);
}
function integer(value, fallback, min, max) { const parsed = Number.parseInt(String(value ?? fallback), 10); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; }
function safeId(value) { return String(value || "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 300); }
function safeLabel(value) { return redactText(String(value || "")).replace(/[\r\n]+/g, " ").trim().slice(0, 300); }
function safeUrl(value) { try { const url = new URL(String(value || "")); return url.protocol === "https:" ? url.toString() : ""; } catch { return ""; } }
function timestamp(value) {
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric) : new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
function moduleLabel(module) { return ({ tasks: "任务", calendar: "日程", meetings: "会议", minutes: "会议纪要", documents: "文档与 Wiki", base: "Base", approvals: "审批", messages: "项目群消息" })[module] || "飞书"; }
function accessLabel(value) { return ({ available: "可访问", deleted: "来源已删除", revoked: "访问已撤回" })[value] || "状态待确认"; }
function escapeHeading(value) { return String(value || "飞书记录").replace(/[\r\n#]/g, " ").trim().slice(0, 160); }
function safeError(error) { return String(error instanceof Error ? error.message : error).replace(/[\r\n]+/g, " ").slice(0, 300); }
function chunk(values, size) { const groups = []; for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size)); return groups; }
function redactFeishuIdentifiers(value) { return String(value || "").replace(/\b(?:ou|on|oc|cli|app|tenant)_[A-Za-z0-9_-]{6,}\b/g, "[飞书标识]"); }
