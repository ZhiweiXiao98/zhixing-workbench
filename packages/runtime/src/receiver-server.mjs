import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendJsonLine, canonicalJson, localDate, redactText, resolveInstall, sha256 } from "./common.mjs";

export async function createReceiver(options = {}) {
  const installed = await resolveInstall({ vault: options.vault });
  const vaultRoot = options.vault ? path.resolve(options.vault) : installed.vaultRoot;
  const token = options.token || installed.device?.receiver_token;
  const port = Number(options.port ?? installed.device?.receiver_port ?? 43123);
  if (!vaultRoot) throw new Error("尚未配置知行台 Vault");
  if (!token || String(token).length < 24) throw new Error("本机接收密钥不存在或无效");

  const server = http.createServer(async (request, response) => {
    applyCors(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.url === "/health" && request.method === "GET") {
      if (!authorized(request, token)) return json(response, 401, { ok: false });
      return json(response, 200, { ok: true, service: "zhixing-receiver" });
    }
    if (request.url !== "/capture/v1/events" || request.method !== "POST") {
      return json(response, 404, { ok: false });
    }
    if (!authorized(request, token)) return json(response, 401, { ok: false });

    try {
      const body = await readRequestJson(request);
      const events = Array.isArray(body.events) ? body.events.slice(0, 100) : [];
      const result = await persistEvents(vaultRoot, events);
      return json(response, 200, { ok: true, ...result });
    } catch (error) {
      return json(response, 400, { ok: false, error: safeError(error) });
    }
  });
  server.listen(port, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

async function persistEvents(vaultRoot, events) {
  const byDate = new Map();
  const valid = [];
  let rejected = 0;
  for (const event of events) {
    if (!isValidEvent(event)) {
      rejected += 1;
      continue;
    }
    const capturedAt = new Date().toISOString();
    const date = localDate();
    const record = {
      schema_version: 1,
      source: "chatgpt_web",
      event: String(event.event),
      captured_at: capturedAt,
      date,
      conversation_id: String(event.conversation_id),
      turn_id: String(event.turn_id),
      message_id: String(event.message_id || ""),
      title: redactText(String(event.title || "未命名对话")).slice(0, 300),
      url: /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(String(event.url || "")) ? String(event.url) : undefined,
      content: redactText(String(event.content)).trim()
    };
    record.event_id = `chatgpt:${sha256(canonicalJson({
      conversation_id: record.conversation_id,
      turn_id: record.turn_id,
      message_id: record.message_id,
      event: record.event,
      content: record.content
    })).slice(0, 32)}`;
    valid.push({ event, record });
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(record);
  }

  const existing = new Set();
  for (const date of byDate.keys()) {
    const filePath = path.join(vaultRoot, "raw", "chatgpt", "events", `${date}.jsonl`);
    const text = await readJsonLines(filePath);
    for (const value of text) if (value?.event_id) existing.add(value.event_id);
  }
  let accepted = 0;
  let duplicates = 0;
  const ackKeys = [];
  for (const { event, record } of valid) {
    ackKeys.push(eventKey(event));
    if (existing.has(record.event_id)) {
      duplicates += 1;
      continue;
    }
    const filePath = path.join(vaultRoot, "raw", "chatgpt", "events", `${record.date}.jsonl`);
    await appendJsonLine(filePath, record);
    existing.add(record.event_id);
    accepted += 1;
  }
  return { accepted, duplicates, rejected, ack_keys: ackKeys };
}

async function readJsonLines(filePath) {
  try {
    const { readFile } = await import("node:fs/promises");
    return (await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch { return []; }
}

function isValidEvent(event) {
  return event && ["UserPromptSubmit", "Stop"].includes(event.event)
    && typeof event.conversation_id === "string" && event.conversation_id.length > 0
    && typeof event.turn_id === "string" && event.turn_id.length > 0
    && typeof event.content === "string" && event.content.trim().length > 0;
}

function eventKey(event) {
  return [event.conversation_id, event.turn_id, event.event, event.message_id || ""].join(":");
}

function authorized(request, token) {
  return request.headers["x-obsidian-capture-token"] === token;
}

function applyCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Obsidian-Capture-Token");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error("请求内容超过安全上限");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error).slice(0, 160);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  createReceiver().then((server) => {
    const address = server.address();
    process.stdout.write(`知行台本机接收器已启动: 127.0.0.1:${address.port}\n`);
  }).catch((error) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
}
