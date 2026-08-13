import path from "node:path";
import { readLastCodexEventAt } from "./codex-desktop-source.mjs";

const DEFAULT_STALE_MS = 36 * 60 * 60_000;

export async function readCodexCliHookHealth(options) {
  const now = toDate(options.now);
  const configured = countHookEvents(options.hooks) === 2;
  const supported = configured && Boolean(options.codexExecutable);
  const lastEventAt = options.vault
    ? await readLastCodexEventAt(path.join(path.resolve(options.vault), "raw", "codex", "events"), "codex_cli_hook")
    : null;
  return {
    source_type: "codex_cli_hook_v1",
    configured,
    supported,
    last_seen_at: options.codexExecutable ? now.toISOString() : null,
    last_event_at: lastEventAt,
    stale: isStale(lastEventAt, now, options.staleAfterMs ?? DEFAULT_STALE_MS),
    error: !configured ? "未配置 Codex CLI Hook" : !options.codexExecutable ? "Codex CLI 未通过版本探活" : null
  };
}

export function factualHealth(value = {}) {
  return {
    source_type: String(value.source_type || "unknown"),
    configured: Boolean(value.configured),
    supported: Boolean(value.supported),
    last_seen_at: validIso(value.last_seen_at),
    last_event_at: validIso(value.last_event_at),
    stale: Boolean(value.stale),
    error: typeof value.error === "string" && value.error ? value.error.slice(0, 500) : null
  };
}

function countHookEvents(config) {
  const hooks = config?.hooks && typeof config.hooks === "object" ? config.hooks : {};
  return ["UserPromptSubmit", "Stop"].filter((eventName) => {
    const entries = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
    return entries.some((entry) => Array.isArray(entry?.hooks) && entry.hooks.some((hook) =>
      typeof hook?.command === "string" && /(?:^|[\\/])capture-hook\.mjs(?:["'\s]|$)/i.test(hook.command)));
  }).length;
}

function isStale(value, now, threshold) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return !Number.isFinite(parsed) || now.getTime() - parsed > threshold;
}

function validIso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function toDate(value) {
  const result = value instanceof Date ? new Date(value) : new Date(value || Date.now());
  return Number.isFinite(result.getTime()) ? result : new Date();
}
