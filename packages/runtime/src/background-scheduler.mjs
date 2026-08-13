import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { atomicJson, readJson, resolveInstall } from "./common.mjs";
import { discoverExecutable, probeCodexExecutor } from "./executable-discovery.mjs";
import { runOwnedAutomationTick } from "./automation-owner.mjs";
import { acquireBackgroundHostLock, withLeaseHeartbeat } from "./runtime-lock.mjs";
import { runCycle } from "./run-cycle.mjs";

const DEFAULT_INTERVAL_MS = 60_000;

export async function runBackgroundTick(options = {}) {
  const now = toDate(options.now);
  const configOptions = options.configRoot
    ? { env: { ...process.env, ZHIXING_CONFIG: path.resolve(options.configRoot) } }
    : undefined;
  const installed = options.install || await resolveInstall(configOptions);
  if (!installed.vaultRoot || !installed.programRoot) {
    return { active: false, ran: false, ok: false, reason: "not-installed", error: "知行台尚未完成安装" };
  }
  const currentRuntime = path.dirname(fileURLToPath(import.meta.url));
  if (!options.install && path.resolve(installed.programRoot, "runtime") !== path.resolve(currentRuntime)) {
    return { active: false, ran: false, ok: true, reason: "superseded" };
  }
  const vault = path.resolve(installed.vaultRoot);
  const statePath = path.join(vault, "raw", "codex", "automation", "background-state.json");
  const previous = await readJson(statePath, {});
  try {
    const codex = options.discoverCodex
      ? await options.discoverCodex()
      : await discoverExecutable("codex", options.discoveryOptions);
    const executor = options.probeExecutor
      ? await options.probeExecutor(codex?.path)
      : await probeCodexExecutor(codex?.path, options.discoveryOptions);
    const scheduled = await runOwnedAutomationTick({
      vault,
      codexHome: options.codexHome,
      ownerKind: "background",
      now,
      syncDesktop: options.syncDesktop,
      executorReady: Boolean(codex && executor.supported),
      onAcquired: async (owner) => atomicJson(statePath, {
        schema_version: 1,
        configured: true,
        supported: true,
        last_seen_at: now.toISOString(),
        last_event_at: previous.last_event_at || null,
        last_run_at: previous.last_run_at || null,
        status: "ready",
        phase: "processing",
        owner_kind: owner?.owner_kind || "background",
        error: null,
        pid: process.pid
      }),
      runKnowledge: async (reason) => {
        if (options.runKnowledge) return options.runKnowledge({ vault, codex, reason });
        const summary = await runCycle({ vault, codex: codex.path, trigger: "automatic" });
        if (["failed", "partial"].includes(summary.status)) throw new Error(`后台整理返回 ${summary.status}`);
      }
    });
    const waiting = scheduled.reason === "owner-busy";
    const state = {
      schema_version: 1,
      configured: true,
      supported: true,
      last_seen_at: now.toISOString(),
      last_event_at: scheduled.capture?.last_event_at || previous.last_event_at || null,
      last_run_at: scheduled.ran ? now.toISOString() : previous.last_run_at || null,
      status: scheduled.ok ? "ready" : "attention",
      phase: waiting ? "waiting" : scheduled.ok ? "idle" : "error",
      owner_kind: waiting ? scheduled.owner?.owner_kind || null : null,
      error: scheduled.ok ? null : scheduled.error || scheduled.state?.error || null,
      pid: process.pid
    };
    await atomicJson(statePath, state);
    return { active: true, ...scheduled, executor, background: state };
  } catch (error) {
    const state = {
      schema_version: 1,
      configured: true,
      supported: false,
      last_seen_at: now.toISOString(),
      last_event_at: previous.last_event_at || null,
      last_run_at: previous.last_run_at || null,
      status: "error",
      phase: "error",
      owner_kind: null,
      error: safeError(error),
      pid: process.pid
    };
    await atomicJson(statePath, state).catch(() => undefined);
    return { active: true, ran: false, ok: false, reason: "tick-error", error: state.error, background: state };
  }
}

export async function runBackgroundLoop(options = {}) {
  const interval = Math.max(10_000, Number(options.intervalMs || DEFAULT_INTERVAL_MS));
  const resolvedConfig = options.configRoot || (await resolveInstall()).configRoot;
  const hostLease = await acquireBackgroundHostLock({ configRoot: resolvedConfig, ownerKind: "background-host",
    leaseMs: options.hostLeaseMs, heartbeatMs: options.hostHeartbeatMs });
  if (!hostLease.acquired) {
    return { active: false, ran: false, ok: true, reason: "host-already-running", owner: hostLease.owner };
  }
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return withLeaseHeartbeat(hostLease, async () => {
    try {
      while (!stopped) {
        const result = await runBackgroundTick(options);
        if (!result.active) return result;
        if (options.once) return result;
        await delay(interval);
      }
      return { active: false, ran: false, ok: true, reason: "stopped" };
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  });
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    const next = values[index + 1];
    if (next && !next.startsWith("--")) { result[key.slice(2)] = next; index += 1; }
    else result[key.slice(2)] = true;
  }
  return result;
}

function toDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error || "后台调度失败").replace(/[\r\n]+/g, " ").slice(0, 500);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  runBackgroundLoop({ configRoot: args.config, once: Boolean(args.once) }).then((result) => {
    if (args.once) process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok && result.reason === "not-installed") process.exitCode = 2;
  }).catch((error) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
}
