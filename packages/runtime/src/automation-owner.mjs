import { syncCodexDesktop } from "./codex-desktop-source.mjs";
import { beginScheduleAttempt, finishScheduleAttempt, readScheduleState, runDueKnowledgeCycle } from "./knowledge-scheduler.mjs";
import { acquireVaultAutomationLock, withLeaseHeartbeat } from "./runtime-lock.mjs";

export async function runOwnedAutomationTick(options) {
  const lease = await acquireVaultAutomationLock({ vault: options.vault, ownerKind: options.ownerKind,
    now: options.lockNow, leaseMs: options.leaseMs, heartbeatMs: options.heartbeatMs });
  if (!lease.acquired) return busyResult(lease);
  await options.onAcquired?.(lease.owner);
  return withLeaseHeartbeat(lease, async () => {
    const capture = options.syncDesktop
      ? await options.syncDesktop({ vault: options.vault, codexHome: options.codexHome, now: options.now })
      : await syncCodexDesktop({ vault: options.vault, codexHome: options.codexHome, now: options.now });
    const scheduled = await runDueKnowledgeCycle({
      vault: options.vault,
      now: options.now,
      finishedAt: options.finishedAt,
      newActivity: Number(capture?.completed_turns || 0) > 0,
      executorReady: Boolean(options.executorReady),
      recoverInterrupted: lease.recovered,
      run: options.runKnowledge
    });
    return { acquired: true, owner: lease.owner, capture, ...scheduled };
  }, { onHeartbeat: options.onHeartbeat });
}

export async function runOwnedManualKnowledge(options) {
  const lease = await acquireVaultAutomationLock({ vault: options.vault, ownerKind: options.ownerKind || "manual",
    now: options.lockNow, leaseMs: options.leaseMs, heartbeatMs: options.heartbeatMs });
  if (!lease.acquired) return { ...busyResult(lease), ok: false };
  await options.onAcquired?.(lease.owner);
  return withLeaseHeartbeat(lease, async () => {
    let state = await readScheduleState({ vault: options.vault, now: options.now, recoverInterrupted: lease.recovered });
    state = await beginScheduleAttempt({ vault: options.vault, state, now: options.now, trigger: "manual" });
    try {
      await options.runKnowledge("manual");
      state = await finishScheduleAttempt({ vault: options.vault, state, now: options.finishedAt || new Date(), ok: true });
      return { acquired: true, ran: true, ok: true, reason: "manual", state };
    } catch (error) {
      state = await finishScheduleAttempt({ vault: options.vault, state, now: options.finishedAt || new Date(), ok: false, error });
      return { acquired: true, ran: true, ok: false, reason: "manual", state,
        error: String(error instanceof Error ? error.message : error || "整理失败") };
    }
  }, { onHeartbeat: options.onHeartbeat });
}

function busyResult(lease) {
  return { acquired: false, ran: false, ok: true, reason: "owner-busy", owner: lease.owner,
    error: ownerMessage(lease.owner) };
}

function ownerMessage(owner) {
  if (owner?.owner_kind === "background") return "后台正在处理采集或整理，请稍后再试";
  if (owner?.owner_kind === "obsidian") return "Obsidian 正在处理采集或整理，请稍后再试";
  return "知行台正在处理采集或整理，请稍后再试";
}
