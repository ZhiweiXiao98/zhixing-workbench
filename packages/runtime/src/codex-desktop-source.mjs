import { open, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { appendJsonLine, atomicJson, canonicalJson, localDate, readJson, redactText, sha256 } from "./common.mjs";

const STATE_SCHEMA = 1;
const SOURCE_TYPE = "codex_desktop_sessions_v1";
const CAPTURE_SOURCE = "codex_desktop";
const DEFAULT_STALE_MS = 36 * 60 * 60_000;
const DEFAULT_BOOTSTRAP_LOOKBACK_MS = 24 * 60 * 60_000;
const VERIFIED_PRODUCER_MINORS = new Set([144, 147]);

export async function syncCodexDesktop(options) {
  const vault = path.resolve(options.vault);
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(homedir(), ".codex"));
  const sessionsRoot = path.join(codexHome, "sessions");
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const nowIso = now.toISOString();
  const statePath = path.join(vault, "raw", "codex", "sources", "desktop-state.json");
  const previous = normalizeState(await readJson(statePath, null));
  const state = { ...previous, checkpoints: { ...previous.checkpoints }, last_sync_at: nowIso };
  let files;
  try {
    files = (await listJsonlFiles(sessionsRoot, options.readdir || readdir)).slice(-500);
    state.configured = true;
  } catch (error) {
    const health = failureHealth(state, now, `无法读取 Codex Desktop 会话目录：${safeError(error)}`);
    await atomicJson(statePath, health);
    return result(health, 0, 0, 0);
  }

  const knownIds = await readKnownEventIds(path.join(vault, "raw", "codex", "events"));
  const rawLastEventAt = await readLastCodexEventAt(path.join(vault, "raw", "codex", "events"));
  const bootstrapAfter = rawLastEventAt || new Date(now.getTime() - (options.bootstrapLookbackMs ?? DEFAULT_BOOTSTRAP_LOOKBACK_MS)).toISOString();
  const inspectedMetadata = await inspectNewestDesktopMetadata(sessionsRoot).catch(() => null);
  const appended = [];
  const errors = [];
  let supportedFiles = inspectedMetadata && supportedProducer(inspectedMetadata.producer_version) ? 1 : 0;
  let duplicates = 0;
  let completedTurns = 0;

  for (const file of files) {
    const relative = path.relative(sessionsRoot, file).split(path.sep).join("/");
    const previousCheckpoint = normalizeCheckpoint(state.checkpoints[relative]);
    try {
      const info = await stat(file);
      const startOffset = info.size < previousCheckpoint.offset ? 0 : Math.min(previousCheckpoint.offset, info.size);
      const bootstrapCutoff = Math.min(Date.parse(bootstrapAfter), now.getTime() - 5 * 60_000);
      if (previousCheckpoint.offset === 0 && !previousCheckpoint.session_id && info.mtimeMs <= bootstrapCutoff) {
        state.checkpoints[relative] = { ...previousCheckpoint, offset: info.size, size: info.size, mtime_ms: info.mtimeMs };
        continue;
      }
      if (startOffset === info.size) {
        state.checkpoints[relative] = { ...previousCheckpoint, size: info.size, mtime_ms: info.mtimeMs };
        if (previousCheckpoint.originator === "Codex Desktop" && supportedProducer(previousCheckpoint.producer_version)) supportedFiles += 1;
        continue;
      }
      let checkpoint = { ...previousCheckpoint };
      if (startOffset > 0 && !checkpoint.session_id) {
        const metadataRecords = parseLines((await readFileRange(file, 0, Math.min(info.size, 2 * 1024 * 1024))).toString("utf8"), true).records;
        checkpoint = normalizeDesktopRecords(metadataRecords, checkpoint).checkpoint;
      }
      const slice = await readFileRange(file, startOffset, info.size - startOffset);
      const lastNewline = slice.lastIndexOf(10);
      if (lastNewline < 0) continue;
      const completeBytes = slice.subarray(0, lastNewline + 1);
      checkpoint = { ...checkpoint, offset: startOffset + lastNewline + 1, size: info.size, mtime_ms: info.mtimeMs };
      const parsed = parseLines(completeBytes.toString("utf8"));
      if (parsed.invalid > 0) {
        errors.push(`${relative}: 结构化事件包含 ${parsed.invalid} 行无法解析，游标未推进`);
        continue;
      }
      const records = parsed.records;
      const normalized = normalizeDesktopRecords(records, checkpoint, {
        bootstrapAfter: previousCheckpoint.offset > 0 ? null : bootstrapAfter
      });
      if (normalized.desktop && normalized.supported) supportedFiles += 1;
      if (normalized.error) {
        errors.push(`${relative}: ${normalized.error}，游标未推进`);
        continue;
      }
      state.checkpoints[relative] = normalized.checkpoint;
      for (const event of normalized.events) {
        if (knownIds.has(event.event_id)) {
          duplicates += 1;
          continue;
        }
        knownIds.add(event.event_id);
        appended.push(event);
        if (event.event === "Stop") completedTurns += 1;
      }
    } catch (error) {
      errors.push(`${relative}: ${safeError(error)}`);
    }
  }

  appended.sort((left, right) => left.captured_at.localeCompare(right.captured_at));
  for (const event of appended) {
    await appendJsonLine(path.join(vault, "raw", "codex", "events", `${event.date}.jsonl`), event);
  }
  const newest = appended.reduce((value, event) => maxIso(value, event.captured_at), state.last_event_at || null);
  state.supported = supportedFiles > 0;
  state.producer_versions = [...new Set([...Object.values(state.checkpoints)
    .filter((item) => item?.originator === "Codex Desktop" && item?.producer_version)
    .map((item) => item.producer_version), inspectedMetadata?.producer_version].filter(Boolean))].sort();
  state.last_seen_at = supportedFiles > 0 ? nowIso : state.last_seen_at;
  state.last_event_at = newest;
  state.error = errors.length > 0 ? errors.slice(0, 3).join("；").slice(0, 600) :
    supportedFiles === 0 ? "尚未发现受支持的 Codex Desktop 会话" : null;
  state.stale = isStale(state.last_event_at, now, options.staleAfterMs ?? DEFAULT_STALE_MS);
  await atomicJson(statePath, state);
  return result(state, appended.length, duplicates, completedTurns);
}

export async function readCodexDesktopHealth(options) {
  const vault = path.resolve(options.vault);
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(homedir(), ".codex"));
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const state = normalizeState(await readJson(path.join(vault, "raw", "codex", "sources", "desktop-state.json"), null));
  try {
    await stat(path.join(codexHome, "sessions"));
    state.configured = true;
    const metadata = await inspectNewestDesktopMetadata(path.join(codexHome, "sessions"));
    if (metadata) {
      state.supported = supportedProducer(metadata.producer_version);
      state.last_seen_at = now.toISOString();
      state.producer_versions = [metadata.producer_version].filter(Boolean);
      state.error = state.supported
        ? (state.error?.startsWith("不支持的 Codex Desktop 数据版本") ? null : state.error)
        : `不支持的 Codex Desktop 数据版本 ${metadata.producer_version || "未知"}`;
    } else if (!state.supported) {
      state.error = state.error || "尚未发现可识别的 Codex Desktop 会话";
    }
  } catch {
    state.configured = false;
    state.supported = false;
    state.error = "未找到 Codex Desktop 会话目录";
  }
  state.stale = isStale(state.last_event_at, now, options.staleAfterMs ?? DEFAULT_STALE_MS);
  return publicHealth(state);
}

async function inspectNewestDesktopMetadata(sessionsRoot) {
  const files = (await listJsonlFiles(sessionsRoot, readdir)).slice(-30).reverse();
  for (const file of files) {
    let text;
    try { text = (await readFileRange(file, 0, 2 * 1024 * 1024)).toString("utf8"); } catch { continue; }
    for (const record of parseLines(text, true).records.slice(0, 80)) {
      if (record?.type !== "session_meta") continue;
      if (record.payload?.originator === "Codex Desktop") {
        return { producer_version: stringValue(record.payload?.cli_version) };
      }
      break;
    }
  }
  return null;
}

async function readFileRange(file, position, length) {
  if (length <= 0) return Buffer.alloc(0);
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function readLastCodexEventAt(eventsRoot, captureSource) {
  let names;
  try {
    names = (await readdir(eventsRoot)).filter((name) => name.endsWith(".jsonl")).sort().reverse();
  } catch {
    return null;
  }
  let latest = null;
  for (const name of names) {
    let text;
    try { text = await readFile(path.join(eventsRoot, name), "utf8"); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      try {
        const item = JSON.parse(line);
        if (captureSource && item.capture_source !== captureSource) continue;
        if (typeof item.captured_at === "string") latest = maxIso(latest, item.captured_at);
      } catch {}
    }
    if (latest && !captureSource) break;
  }
  return latest;
}

export function normalizeDesktopRecords(records, baseCheckpoint = {}, options = {}) {
  const checkpoint = normalizeCheckpoint(baseCheckpoint);
  const events = [];
  let activeTurnId = checkpoint.active_turn_id || null;
  let desktop = checkpoint.originator === "Codex Desktop";
  let supported = desktop && supportedProducer(checkpoint.producer_version);
  let error = null;
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    if (record.type === "session_meta") {
      const payload = record.payload || {};
      checkpoint.session_id = stringValue(payload.id || payload.session_id);
      checkpoint.cwd = stringValue(payload.cwd);
      checkpoint.originator = stringValue(payload.originator);
      checkpoint.producer_version = stringValue(payload.cli_version);
      checkpoint.is_subagent = Boolean(payload.source?.subagent);
      desktop = checkpoint.originator === "Codex Desktop";
      supported = desktop && supportedProducer(checkpoint.producer_version);
      if (desktop && !supported) error = `不支持的 Codex Desktop 数据版本 ${checkpoint.producer_version || "未知"}`;
      continue;
    }
    if (!desktop || !supported || checkpoint.is_subagent) continue;
    if (!checkpoint.session_id) {
      error = "会话缺少 session_meta.id";
      continue;
    }
    const payload = record.payload || {};
    if (record.type === "event_msg" && payload.type === "task_started") {
      activeTurnId = stringValue(payload.turn_id);
      checkpoint.active_turn_id = activeTurnId;
      continue;
    }
    if (record.type === "turn_context" && payload.turn_id) {
      activeTurnId = stringValue(payload.turn_id);
      checkpoint.active_turn_id = activeTurnId;
      if (payload.cwd) checkpoint.cwd = stringValue(payload.cwd);
      continue;
    }
    if (record.type !== "event_msg") continue;
    const capturedAt = validIso(record.timestamp) || validIso(payload.completed_at) || null;
    if (!capturedAt || (options.bootstrapAfter && capturedAt <= options.bootstrapAfter)) continue;
    if (payload.type === "user_message") {
      if (!activeTurnId) {
        error = "用户消息缺少可关联的 turn_id";
        continue;
      }
      const event = createEvent("UserPromptSubmit", capturedAt, checkpoint, activeTurnId, payload.message);
      if (event) events.push(event);
      continue;
    }
    if (payload.type === "task_complete" || payload.type === "turn_aborted") {
      const turnId = stringValue(payload.turn_id || activeTurnId);
      if (!turnId) {
        error = "完成事件缺少 turn_id";
        continue;
      }
      const content = payload.type === "turn_aborted" ? "本轮任务已中止" : payload.last_agent_message;
      const event = createEvent("Stop", capturedAt, checkpoint, turnId, content);
      if (event) events.push(event);
      if (turnId === activeTurnId) {
        activeTurnId = null;
        checkpoint.active_turn_id = null;
      }
    }
  }
  return { desktop, supported, error, checkpoint, events };
}

function createEvent(event, capturedAt, checkpoint, turnId, content) {
  const safeContent = redactText(content).trim();
  if (!safeContent) return null;
  const record = {
    schema_version: 1,
    source: "codex",
    capture_source: CAPTURE_SOURCE,
    producer_version: checkpoint.producer_version,
    event,
    captured_at: capturedAt,
    date: localDate(new Date(capturedAt)),
    session_id: checkpoint.session_id,
    turn_id: turnId,
    cwd: checkpoint.cwd || undefined,
    content: safeContent
  };
  record.event_id = `codex:${sha256(canonicalJson({
    event: record.event,
    session_id: record.session_id,
    turn_id: record.turn_id,
    cwd: record.cwd,
    content: record.content
  })).slice(0, 32)}`;
  return record;
}

async function listJsonlFiles(root, readDirectory) {
  const files = [];
  async function visit(directory) {
    const entries = await readDirectory(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(target);
    }
  }
  await visit(root);
  return files.sort();
}

async function readKnownEventIds(eventsRoot) {
  const ids = new Set();
  let names;
  try { names = (await readdir(eventsRoot)).filter((name) => name.endsWith(".jsonl")); } catch { return ids; }
  for (const name of names) {
    let text;
    try { text = await readFile(path.join(eventsRoot, name), "utf8"); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      try { const item = JSON.parse(line); if (item.event_id) ids.add(String(item.event_id)); } catch {}
    }
  }
  return ids;
}

function parseLines(text, allowTrailingPartial = false) {
  const records = [];
  const lines = text.split(/\r?\n/);
  if (allowTrailingPartial && !/\r?\n$/.test(text)) lines.pop();
  let invalid = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { invalid += 1; }
  }
  return { records, invalid };
}

function supportedProducer(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\./);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major === 0 && VERIFIED_PRODUCER_MINORS.has(minor);
}

function normalizeState(value) {
  return {
    schema_version: STATE_SCHEMA,
    source_type: SOURCE_TYPE,
    configured: Boolean(value?.configured),
    supported: Boolean(value?.supported),
    last_seen_at: validIso(value?.last_seen_at),
    last_event_at: validIso(value?.last_event_at),
    last_sync_at: validIso(value?.last_sync_at),
    stale: Boolean(value?.stale),
    error: typeof value?.error === "string" ? value.error : null,
    producer_versions: Array.isArray(value?.producer_versions) ? value.producer_versions.map(stringValue).filter(Boolean) : [],
    checkpoints: value?.checkpoints && typeof value.checkpoints === "object" ? value.checkpoints : {}
  };
}

function normalizeCheckpoint(value) {
  return {
    offset: Math.max(0, Number(value?.offset || 0)),
    size: Math.max(0, Number(value?.size || 0)),
    mtime_ms: Math.max(0, Number(value?.mtime_ms || 0)),
    session_id: stringValue(value?.session_id),
    cwd: stringValue(value?.cwd),
    originator: stringValue(value?.originator),
    producer_version: stringValue(value?.producer_version),
    is_subagent: Boolean(value?.is_subagent),
    active_turn_id: stringValue(value?.active_turn_id) || null
  };
}

function failureHealth(state, now, error) {
  return { ...state, configured: false, supported: false, last_sync_at: now.toISOString(), stale: true, error };
}

function result(state, accepted, duplicates, completedTurns) {
  return { ...publicHealth(state), accepted, duplicates, completed_turns: completedTurns };
}

function publicHealth(state) {
  return {
    source_type: SOURCE_TYPE,
    configured: Boolean(state.configured),
    supported: Boolean(state.supported),
    last_seen_at: state.last_seen_at || null,
    last_event_at: state.last_event_at || null,
    stale: Boolean(state.stale),
    error: state.error || null,
    producer_versions: state.producer_versions || []
  };
}

function isStale(value, now, threshold) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return !Number.isFinite(parsed) || now.getTime() - parsed > threshold;
}

function validIso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function maxIso(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1000) : "";
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error).replace(/[\r\n]+/g, " ").slice(0, 300);
}
