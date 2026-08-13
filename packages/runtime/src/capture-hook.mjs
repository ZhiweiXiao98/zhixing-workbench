import path from "node:path";
import { appendJsonLine, atomicJson, canonicalJson, localDate, readJson, readStdin, redactText, resolveInstall, sha256 } from "./common.mjs";

const input = await readStdin();
if (!input.trim()) process.exit(0);
if (process.env.ZHIXING_CAPTURE_DISABLED === "1") process.exit(0);

try {
  const payload = JSON.parse(input);
  const installed = await resolveInstall();
  if (!installed.vaultRoot) throw new Error("尚未配置知行台 Vault");
  const eventName = String(payload.hook_event_name || payload.event || "");
  const sessionId = String(payload.session_id || payload.thread_id || payload.conversation_id || "unknown");
  const turnId = String(payload.turn_id || payload.id || "unknown");
  const optOutKey = `${sessionId}:${turnId}`;
  const statePath = path.join(installed.vaultRoot, ".zhixing", "capture-state.json");
  const state = await readJson(statePath, { opt_out_turns: [] });
  const rawContent = eventName === "UserPromptSubmit"
    ? payload.prompt
    : eventName === "Stop" ? payload.last_assistant_message : null;
  if (typeof rawContent !== "string" || !rawContent.trim()) process.exit(0);
  if (/^\s*\[no-obsidian\]/i.test(rawContent)) {
    state.opt_out_turns = [...new Set([...(state.opt_out_turns || []), optOutKey])].slice(-500);
    await atomicJson(statePath, state);
    process.exit(0);
  }
  if (eventName === "Stop" && Array.isArray(state.opt_out_turns) && state.opt_out_turns.includes(optOutKey)) {
    state.opt_out_turns = state.opt_out_turns.filter((key) => key !== optOutKey);
    await atomicJson(statePath, state);
    process.exit(0);
  }

  const capturedAt = new Date().toISOString();
  const record = {
    schema_version: 1,
    source: "codex",
    capture_source: "codex_cli_hook",
    event: eventName,
    captured_at: capturedAt,
    date: localDate(),
    session_id: sessionId,
    turn_id: turnId === "unknown" ? capturedAt : turnId,
    cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
    content: redactText(rawContent).trim()
  };
  record.event_id = `codex:${sha256(canonicalJson({
    event: record.event,
    session_id: record.session_id,
    turn_id: record.turn_id,
    cwd: record.cwd,
    content: record.content
  })).slice(0, 32)}`;
  const target = path.join(installed.vaultRoot, "raw", "codex", "events", `${record.date}.jsonl`);
  await appendJsonLine(target, record);
} catch (error) {
  process.stderr.write(`知行台采集失败: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
