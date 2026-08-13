import path from "node:path";
import { stat } from "node:fs/promises";
import { atomicJson, localDate, readJson } from "./common.mjs";

const STATE_SCHEMA = 1;
const BASE_RETRY_MS = 5 * 60_000;
const MAX_RETRY_MS = 6 * 60 * 60_000;
const LEGACY_RUNNING_STALE_MS = 90 * 60_000;
const ORPHAN_RUNNING_GRACE_MS = 2 * 60_000;
const ABSOLUTE_RUNNING_STALE_MS = 6 * 60 * 60_000;

export async function readScheduleState(options) {
  const target = schedulePath(options.vault);
  const now = toDate(options.now);
  const state = normalizeState(await readJson(target, null), now);
  if (options.recoverStale === false) return state;
  if (state.status !== "running" || (!options.recoverInterrupted && !staleRunning(state, now))) return state;
  const recovered = {
    ...state,
    status: "backoff",
    next_due: new Date(now.getTime() + BASE_RETRY_MS).toISOString(),
    error: "上次整理进程在运行中中断，将自动重试",
    failure_count: Math.max(1, Number(state.failure_count || 0) + 1),
    owner_pid: null
  };
  await atomicJson(target, recovered);
  return recovered;
}

export async function runDueKnowledgeCycle(options) {
  const vault = path.resolve(options.vault);
  const now = toDate(options.now);
  let state = await readScheduleState({ vault, now, recoverInterrupted: options.recoverInterrupted });
  const [lastCycle, queue] = await Promise.all([
    readJson(path.join(vault, "raw", "codex", "automation", "last-cycle.json"), null),
    readJson(path.join(vault, "raw", "codex", "ingest-status.json"), null)
  ]);
  state = await repairLegacyFailedSchedule({ vault, state, lastCycle, queue, newActivity: options.newActivity, now });
  const decision = evaluateSchedule({ now, state, lastCycle, queue, newActivity: options.newActivity,
    executorReady: options.executorReady });
  if (!decision.due) {
    if (decision.reason === "already-running") return { ran: false, ok: true, reason: decision.reason, state };
    state = await markScheduleIdle({ vault, state, now, nextDue: decision.next_due });
    return { ran: false, ok: true, reason: decision.reason, state };
  }
  state = await beginScheduleAttempt({ vault, state, now, trigger: decision.reason });
  try {
    await options.run(decision.reason);
    state = await finishScheduleAttempt({ vault, state, now: options.finishedAt || new Date(), ok: true });
    return { ran: true, ok: true, reason: decision.reason, state };
  } catch (error) {
    state = await finishScheduleAttempt({ vault, state, now: options.finishedAt || new Date(), ok: false, error });
    return { ran: true, ok: false, reason: decision.reason, state, error: safeError(error) };
  }
}

export function evaluateSchedule(options) {
  const now = toDate(options.now);
  const state = normalizeState(options.state, now);
  const lastSuccess = validIso(state.last_success) || successfulCycleTime(options.lastCycle);
  const readyTopics = Math.max(0, Number(options.queue?.ready_topics ?? options.queue?.candidate_topics ?? 0));
  const hasWork = readyTopics > 0 || Boolean(options.newActivity);
  if (state.status === "running") return { due: false, reason: "already-running", next_due: state.next_due };
  if (!options.executorReady) return state.status === "backoff"
    ? { due: false, reason: "executor-unavailable", next_due: backoffProbeDue(state.next_due, now) }
    : { due: false, reason: "executor-unavailable", next_due: futureDue(state.next_due, now) };
  if (state.next_due && state.status === "backoff" && Date.parse(state.next_due) > now.getTime()) {
    return { due: false, reason: "backoff", next_due: state.next_due };
  }
  if (!hasWork) return { due: false, reason: "queue-empty", next_due: nextDailyDue(now).toISOString() };
  if (state.status === "backoff") return { due: true, reason: "retry-after-backoff", next_due: null };
  if (!lastSuccess) return { due: true, reason: options.newActivity ? "first-activity-catchup" : "first-startup-catchup", next_due: null };
  const today = localDate(now);
  const lastDate = localDate(new Date(lastSuccess));
  if (lastDate < today) return { due: true, reason: "missed-day-catchup", next_due: null };
  const dailyDue = dailyDueFor(now);
  if (now.getTime() >= dailyDue.getTime()) return { due: true, reason: "daily-2330", next_due: null };
  return { due: false, reason: "waiting-daily-time", next_due: dailyDue.toISOString() };
}

export async function markScheduleIdle(options) {
  const now = toDate(options.now);
  const state = normalizeState(options.state, now);
  const requestedDue = validIso(options.nextDue);
  const keepBackoff = state.status === "backoff" && Boolean(
    (state.next_due && Date.parse(state.next_due) > now.getTime()) ||
    (requestedDue && Date.parse(requestedDue) > now.getTime())
  );
  const nextDue = keepBackoff ? laterFutureDue(state.next_due, requestedDue, now) : requestedDue || nextDailyDue(now).toISOString();
  const updated = { ...state, status: keepBackoff ? "backoff" : "idle", next_due: nextDue };
  const target = schedulePath(options.vault);
  if (JSON.stringify(updated) !== JSON.stringify(state) || !await exists(target)) await atomicJson(target, updated);
  return updated;
}

export async function beginScheduleAttempt(options) {
  const now = toDate(options.now);
  const state = normalizeState(options.state, now);
  const updated = {
    ...state,
    last_attempt: now.toISOString(),
    next_due: null,
    status: "running",
    error: null,
    trigger: String(options.trigger || "automatic").slice(0, 80),
    owner_pid: process.pid
  };
  await atomicJson(schedulePath(options.vault), updated);
  return updated;
}

export async function finishScheduleAttempt(options) {
  const now = toDate(options.now);
  const state = normalizeState(options.state, now);
  if (options.ok) {
    const updated = {
      ...state,
      last_attempt: state.last_attempt || now.toISOString(),
      last_success: now.toISOString(),
      next_due: nextDailyDue(now).toISOString(),
      status: "succeeded",
      error: null,
      failure_count: 0,
      owner_pid: null
    };
    await atomicJson(schedulePath(options.vault), updated);
    return updated;
  }
  const failureCount = Math.max(1, Number(state.failure_count || 0) + 1);
  const delay = retryDelay(failureCount);
  const updated = {
    ...state,
    last_attempt: state.last_attempt || now.toISOString(),
    next_due: new Date(now.getTime() + delay).toISOString(),
    status: "backoff",
    error: safeError(options.error),
    failure_count: failureCount,
    owner_pid: null
  };
  await atomicJson(schedulePath(options.vault), updated);
  return updated;
}

async function repairLegacyFailedSchedule(options) {
  const state = normalizeState(options.state, options.now);
  const failure = failedCycleEvidence(options.lastCycle);
  const readyTopics = Math.max(0, Number(options.queue?.ready_topics ?? options.queue?.candidate_topics ?? 0));
  const lastSuccess = validIso(state.last_success);
  const failureIsCovered = lastSuccess && Date.parse(lastSuccess) >= Date.parse(failure?.finished_at || "");
  if (!failure || failureIsCovered || state.status === "running" || state.status === "backoff" ||
      (readyTopics === 0 && !options.newActivity)) return state;
  const failureCount = Math.max(1, Number(state.failure_count || 0));
  const attemptedAt = [validIso(state.last_attempt), failure.finished_at]
    .filter(Boolean).map((value) => Date.parse(value));
  const retryBase = attemptedAt.length > 0 ? Math.max(...attemptedAt) : toDate(options.now).getTime();
  const updated = {
    ...state,
    status: "backoff",
    next_due: new Date(retryBase + retryDelay(failureCount)).toISOString(),
    error: state.error || `上次整理状态为 ${failure.status}，将自动重试`,
    failure_count: failureCount,
    owner_pid: null
  };
  await atomicJson(schedulePath(options.vault), updated);
  return updated;
}

export function normalizeScheduleState(value, now = new Date()) {
  return normalizeState(value, now);
}

function normalizeState(value, now = new Date()) {
  return {
    schema_version: STATE_SCHEMA,
    last_attempt: validIso(value?.last_attempt),
    last_success: validIso(value?.last_success),
    next_due: validIso(value?.next_due) || nextDailyDue(toDate(now)).toISOString(),
    status: ["idle", "running", "succeeded", "backoff"].includes(value?.status) ? value.status : "idle",
    error: typeof value?.error === "string" && value.error ? value.error.slice(0, 500) : null,
    failure_count: Math.max(0, Number(value?.failure_count || 0)),
    trigger: typeof value?.trigger === "string" ? value.trigger.slice(0, 80) : null,
    owner_pid: Number.isInteger(value?.owner_pid) && value.owner_pid > 0 ? value.owner_pid : null
  };
}

function schedulePath(vault) {
  return path.join(path.resolve(vault), "raw", "codex", "automation", "schedule-state.json");
}

function dailyDueFor(now) {
  const due = new Date(now);
  due.setHours(23, 30, 0, 0);
  return due;
}

function nextDailyDue(now) {
  const due = dailyDueFor(now);
  if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1);
  return due;
}

function futureDue(value, now) {
  return value && Date.parse(value) > now.getTime() ? value : nextDailyDue(now).toISOString();
}

function backoffProbeDue(value, now) {
  return value && Date.parse(value) > now.getTime()
    ? value
    : new Date(now.getTime() + BASE_RETRY_MS).toISOString();
}

function laterFutureDue(current, requested, now) {
  const candidates = [validIso(current), validIso(requested)]
    .filter((value) => value && Date.parse(value) > now.getTime());
  return candidates.sort((left, right) => Date.parse(right) - Date.parse(left))[0]
    || new Date(now.getTime() + BASE_RETRY_MS).toISOString();
}

function successfulCycleTime(lastCycle) {
  const finishedAt = validIso(lastCycle?.finished_at);
  if (!finishedAt) return null;
  if (lastCycle?.status === "succeeded") return finishedAt;
  if (lastCycle?.status != null) return null;
  const batches = Array.isArray(lastCycle?.batches) ? lastCycle.batches : [];
  return batches.length > 0 && !lastCycle?.error && batches.every((batch) => batch?.status === "succeeded")
    ? finishedAt
    : null;
}

function failedCycleEvidence(lastCycle) {
  const status = String(lastCycle?.status || "");
  const finishedAt = validIso(lastCycle?.finished_at);
  return finishedAt && ["partial", "failed", "budget-paused"].includes(status)
    ? { status, finished_at: finishedAt }
    : null;
}

function retryDelay(failureCount) {
  return Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(Math.max(1, failureCount) - 1, 8));
}

function staleRunning(state, now) {
  if (state.status !== "running") return false;
  const attempted = state.last_attempt ? Date.parse(state.last_attempt) : Number.NaN;
  if (!Number.isFinite(attempted)) return true;
  const age = now.getTime() - attempted;
  if (age >= ABSOLUTE_RUNNING_STALE_MS) return true;
  if (state.owner_pid) return age >= ORPHAN_RUNNING_GRACE_MS && !processAlive(state.owner_pid);
  return age >= LEGACY_RUNNING_STALE_MS;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function toDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function validIso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error || "整理失败").replace(/[\r\n]+/g, " ").slice(0, 500);
}

async function exists(target) {
  try { await stat(target); return true; } catch { return false; }
}
