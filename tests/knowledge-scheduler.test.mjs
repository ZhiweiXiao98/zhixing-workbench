import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateSchedule, readScheduleState, runDueKnowledgeCycle } from "../packages/runtime/src/knowledge-scheduler.mjs";

test("没有 last-cycle 但有可整理队列时首次启动立即补跑", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-scheduler-first-"));
  try {
    await mkdir(path.join(root, "raw", "codex"), { recursive: true });
    await writeFile(path.join(root, "raw", "codex", "ingest-status.json"), JSON.stringify({ ready_topics: 3 }), "utf8");
    const calls = [];
    const result = await runDueKnowledgeCycle({
      vault: root,
      now: "2026-08-13T09:00:00.000Z",
      finishedAt: "2026-08-13T09:01:00.000Z",
      executorReady: true,
      run: async (reason) => { calls.push(reason); }
    });
    assert.equal(result.ran, true);
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ["first-startup-catchup"]);
    assert.equal(result.state.last_attempt, "2026-08-13T09:00:00.000Z");
    assert.equal(result.state.last_success, "2026-08-13T09:01:00.000Z");
    assert.equal(result.state.status, "succeeded");
    assert.ok(result.state.next_due);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("下一次真实工作完成可触发首次补跑，失败后进入可见退避", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-scheduler-retry-"));
  try {
    const result = await runDueKnowledgeCycle({
      vault: root,
      now: "2026-08-13T10:00:00.000Z",
      finishedAt: "2026-08-13T10:00:30.000Z",
      newActivity: true,
      executorReady: true,
      run: async () => { throw new Error("虚构执行器失败"); }
    });
    assert.equal(result.ran, true);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "first-activity-catchup");
    assert.equal(result.state.status, "backoff");
    assert.match(result.state.error, /虚构执行器失败/);
    assert.equal(result.state.next_due, "2026-08-13T10:05:30.000Z");
    const blocked = evaluateSchedule({ now: "2026-08-13T10:02:00.000Z", state: result.state,
      queue: { ready_topics: 1 }, executorReady: true });
    assert.equal(blocked.due, false);
    assert.equal(blocked.reason, "backoff");
    assert.deepEqual(await readScheduleState({ vault: root, now: "2026-08-13T10:02:00.000Z" }), result.state);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("23:30 仍保留且采集失败不影响已有队列判断", () => {
  const decision = evaluateSchedule({
    now: "2026-08-13T23:31:00",
    state: { last_success: "2026-08-13T08:00:00", status: "succeeded" },
    queue: { ready_topics: 2 },
    newActivity: false,
    executorReady: true
  });
  assert.equal(decision.due, true);
  assert.equal(decision.reason, "daily-2330");
});

test("进程中断留下的陈旧 running 在重启后转为退避并继续补跑", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-scheduler-interrupted-"));
  try {
    const automation = path.join(root, "raw", "codex", "automation");
    await mkdir(automation, { recursive: true });
    await writeFile(path.join(root, "raw", "codex", "ingest-status.json"), JSON.stringify({ ready_topics: 2 }), "utf8");
    await writeFile(path.join(automation, "schedule-state.json"), JSON.stringify({
      schema_version: 1,
      last_attempt: "2026-08-13T09:50:00.000Z",
      last_success: null,
      next_due: null,
      status: "running",
      error: null,
      failure_count: 0,
      trigger: "daily-2330",
      owner_pid: 2147483647
    }), "utf8");

    const observed = await readScheduleState({ vault: root, now: "2026-08-13T10:00:00.000Z", recoverStale: false });
    assert.equal(observed.status, "running");
    const recovered = await readScheduleState({ vault: root, now: "2026-08-13T10:00:00.000Z" });
    assert.equal(recovered.status, "backoff");
    assert.equal(recovered.next_due, "2026-08-13T10:05:00.000Z");
    assert.match(recovered.error, /运行中中断/);
    assert.equal(recovered.failure_count, 1);

    let runs = 0;
    const waiting = await runDueKnowledgeCycle({ vault: root, now: "2026-08-13T10:04:59.000Z",
      executorReady: true, run: async () => { runs += 1; } });
    assert.equal(waiting.ran, false);
    assert.equal(waiting.reason, "backoff");
    const retried = await runDueKnowledgeCycle({ vault: root, now: "2026-08-13T10:05:00.000Z",
      finishedAt: "2026-08-13T10:06:00.000Z", executorReady: true, run: async () => { runs += 1; } });
    assert.equal(retried.ran, true);
    assert.equal(retried.ok, true);
    assert.equal(runs, 1);
    assert.equal(retried.state.status, "succeeded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("运行中的周期优先于执行器探活失败且不会被降为 idle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-scheduler-running-probe-"));
  const automation = path.join(root, "raw", "codex", "automation");
  try {
    await mkdir(automation, { recursive: true });
    await writeFile(path.join(root, "raw", "codex", "ingest-status.json"), JSON.stringify({ ready_topics: 2 }), "utf8");
    await writeFile(path.join(automation, "schedule-state.json"), JSON.stringify({
      schema_version: 1,
      last_attempt: "2026-08-13T10:00:00.000Z",
      last_success: null,
      next_due: null,
      status: "running",
      error: null,
      failure_count: 0,
      trigger: "retry-after-backoff",
      owner_pid: process.pid
    }), "utf8");

    const decision = evaluateSchedule({ now: "2026-08-13T10:00:30.000Z",
      state: { status: "running", last_attempt: "2026-08-13T10:00:00.000Z", owner_pid: process.pid },
      queue: { ready_topics: 2 }, executorReady: false });
    assert.equal(decision.reason, "already-running");

    const result = await runDueKnowledgeCycle({ vault: root, now: "2026-08-13T10:00:30.000Z",
      executorReady: false, run: async () => assert.fail("运行中的周期不得重复执行") });
    assert.equal(result.ran, false);
    assert.equal(result.reason, "already-running");
    assert.equal(result.state.status, "running");
    assert.equal(JSON.parse(await readFile(path.join(automation, "schedule-state.json"), "utf8")).status, "running");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("partial last-cycle 不能充当成功时间且退避到期后会真实重试", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-scheduler-partial-cycle-"));
  const automation = path.join(root, "raw", "codex", "automation");
  const cyclePath = path.join(automation, "last-cycle.json");
  let cycles = 0;
  const cycleRunner = async () => {
    cycles += 1;
    const summary = cycles === 1
      ? { schema_version: 1, cycle_id: "fixture-partial", status: "partial",
        started_at: "2026-08-13T08:00:00.000Z", finished_at: "2026-08-13T08:00:30.000Z",
        batches: [{ batch_index: 1, status: "partial", committed: 1, failed: 1 }] }
      : { schema_version: 1, cycle_id: "fixture-success", status: "succeeded",
        started_at: "2026-08-13T08:05:30.000Z", finished_at: "2026-08-13T08:06:00.000Z",
        batches: [{ batch_index: 1, status: "succeeded", committed: 1, failed: 0 }] };
    await writeFile(cyclePath, JSON.stringify(summary), "utf8");
    if (summary.status === "partial") throw new Error("后台整理返回 partial");
  };
  try {
    await mkdir(automation, { recursive: true });
    await writeFile(path.join(root, "raw", "codex", "ingest-status.json"), JSON.stringify({ ready_topics: 2 }), "utf8");
    const first = await runDueKnowledgeCycle({ vault: root, now: "2026-08-13T08:00:00.000Z",
      finishedAt: "2026-08-13T08:00:30.000Z", executorReady: true, run: cycleRunner });
    assert.equal(first.ok, false);
    assert.equal(first.state.status, "backoff");
    assert.equal(first.state.next_due, "2026-08-13T08:05:30.000Z");

    const retried = await runDueKnowledgeCycle({ vault: root, now: "2026-08-13T08:05:30.000Z",
      finishedAt: "2026-08-13T08:06:00.000Z", executorReady: true, run: cycleRunner });
    assert.equal(retried.ran, true);
    assert.equal(retried.ok, true);
    assert.equal(retried.state.last_success, "2026-08-13T08:06:00.000Z");
    assert.equal(cycles, 2);
    assert.equal(JSON.parse(await readFile(cyclePath, "utf8")).status, "succeeded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("升级会把 idle 旧 partial 状态修复为按失败次数退避后重试", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-scheduler-dirty-partial-"));
  const automation = path.join(root, "raw", "codex", "automation");
  let runs = 0;
  try {
    await mkdir(automation, { recursive: true });
    await writeFile(path.join(root, "raw", "codex", "ingest-status.json"), JSON.stringify({ ready_topics: 3 }), "utf8");
    await writeFile(path.join(automation, "schedule-state.json"), JSON.stringify({
      schema_version: 1,
      last_attempt: "2026-08-13T07:20:00.000Z",
      last_success: null,
      next_due: "2026-08-13T23:30:00.000Z",
      status: "idle",
      error: "后台整理返回 partial",
      failure_count: 2,
      trigger: "first-startup-catchup",
      owner_pid: null
    }), "utf8");
    await writeFile(path.join(automation, "last-cycle.json"), JSON.stringify({
      schema_version: 1,
      cycle_id: "fixture-dirty-partial",
      status: "partial",
      started_at: "2026-08-13T07:20:00.000Z",
      finished_at: "2026-08-13T07:20:30.000Z",
      batches: [{ batch_index: 1, status: "partial", committed: 1, failed: 1 }]
    }), "utf8");

    const waiting = await runDueKnowledgeCycle({ vault: root, now: "2026-08-13T07:25:00.000Z",
      executorReady: true, run: async () => { runs += 1; } });
    assert.equal(waiting.ran, false);
    assert.equal(waiting.reason, "backoff");
    assert.equal(waiting.state.status, "backoff");
    assert.equal(waiting.state.next_due, "2026-08-13T07:30:30.000Z");
    assert.equal(waiting.state.failure_count, 2);

    const retried = await runDueKnowledgeCycle({ vault: root, now: "2026-08-13T07:30:30.000Z",
      finishedAt: "2026-08-13T07:31:00.000Z", executorReady: true, run: async () => { runs += 1; } });
    assert.equal(retried.ran, true);
    assert.equal(retried.ok, true);
    assert.equal(retried.state.last_success, "2026-08-13T07:31:00.000Z");
    assert.equal(runs, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("旧成功时间早于后续 partial 时升级仍会按退避重试", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-scheduler-success-before-partial-"));
  const automation = path.join(root, "raw", "codex", "automation");
  let runs = 0;
  try {
    await mkdir(automation, { recursive: true });
    await writeFile(path.join(root, "raw", "codex", "ingest-status.json"), JSON.stringify({ ready_topics: 2 }), "utf8");
    await writeFile(path.join(automation, "schedule-state.json"), JSON.stringify({
      schema_version: 1,
      last_attempt: "2026-08-13T23:30:00.000Z",
      last_success: "2026-08-13T08:00:00.000Z",
      next_due: "2026-08-14T23:30:00.000Z",
      status: "idle",
      error: "后台整理返回 partial",
      failure_count: 1,
      trigger: "daily-2330",
      owner_pid: null
    }), "utf8");
    await writeFile(path.join(automation, "last-cycle.json"), JSON.stringify({
      schema_version: 1,
      cycle_id: "fixture-later-partial",
      status: "partial",
      started_at: "2026-08-13T23:30:00.000Z",
      finished_at: "2026-08-13T23:31:00.000Z",
      batches: [{ batch_index: 1, status: "partial", committed: 1, failed: 1 }]
    }), "utf8");

    const waiting = await runDueKnowledgeCycle({ vault: root, now: "2026-08-13T23:34:00.000Z",
      executorReady: true, run: async () => { runs += 1; } });
    assert.equal(waiting.ran, false);
    assert.equal(waiting.reason, "backoff");
    assert.equal(waiting.state.next_due, "2026-08-13T23:36:00.000Z");
    assert.equal(waiting.state.last_success, "2026-08-13T08:00:00.000Z");

    const retried = await runDueKnowledgeCycle({ vault: root, now: "2026-08-13T23:36:00.000Z",
      finishedAt: "2026-08-13T23:37:00.000Z", executorReady: true, run: async () => { runs += 1; } });
    assert.equal(retried.ran, true);
    assert.equal(retried.ok, true);
    assert.equal(retried.state.last_success, "2026-08-13T23:37:00.000Z");
    assert.equal(runs, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("旧 partial 退避已过期且执行器不可用时保持有限探活并在恢复后重试", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-scheduler-executor-unavailable-"));
  const automation = path.join(root, "raw", "codex", "automation");
  let runs = 0;
  try {
    await mkdir(automation, { recursive: true });
    await writeFile(path.join(root, "raw", "codex", "ingest-status.json"), JSON.stringify({ ready_topics: 2 }), "utf8");
    await writeFile(path.join(automation, "schedule-state.json"), JSON.stringify({
      schema_version: 1,
      last_attempt: "2026-08-13T07:20:00.000Z",
      last_success: null,
      next_due: "2026-08-13T23:30:00.000Z",
      status: "idle",
      error: "后台整理返回 partial",
      failure_count: 1,
      trigger: "first-startup-catchup",
      owner_pid: null
    }), "utf8");
    await writeFile(path.join(automation, "last-cycle.json"), JSON.stringify({
      schema_version: 1,
      cycle_id: "fixture-partial-executor-unavailable",
      status: "partial",
      started_at: "2026-08-13T07:20:00.000Z",
      finished_at: "2026-08-13T07:20:30.000Z",
      batches: [{ batch_index: 1, status: "partial", committed: 1, failed: 1 }]
    }), "utf8");

    const unavailable = await runDueKnowledgeCycle({ vault: root, now: "2026-08-13T08:00:00.000Z",
      executorReady: false, run: async () => { runs += 1; } });
    assert.equal(unavailable.ran, false);
    assert.equal(unavailable.reason, "executor-unavailable");
    assert.equal(unavailable.state.status, "backoff");
    assert.equal(unavailable.state.next_due, "2026-08-13T08:05:00.000Z");

    const beforeDue = await runDueKnowledgeCycle({ vault: root, now: "2026-08-13T08:04:59.000Z",
      executorReady: true, run: async () => { runs += 1; } });
    assert.equal(beforeDue.ran, false);
    assert.equal(beforeDue.reason, "backoff");
    assert.equal(runs, 0);

    const recovered = await runDueKnowledgeCycle({ vault: root, now: "2026-08-13T08:05:00.000Z",
      finishedAt: "2026-08-13T08:06:00.000Z", executorReady: true,
      run: async () => { runs += 1; } });
    assert.equal(recovered.ran, true);
    assert.equal(recovered.ok, true);
    assert.equal(recovered.state.last_success, "2026-08-13T08:06:00.000Z");
    assert.equal(runs, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("只有明确成功或全部批次成功的旧 last-cycle 才能作为成功兜底", () => {
  for (const status of ["partial", "failed", "budget-paused"]) {
    const decision = evaluateSchedule({
      now: "2026-08-13T09:00:00.000Z",
      state: { status: "idle", last_success: null },
      lastCycle: { status, finished_at: "2026-08-13T08:00:00.000Z" },
      queue: { ready_topics: 1 },
      executorReady: true
    });
    assert.equal(decision.due, true, `${status} 不得作为成功时间`);
  }
  const legacy = evaluateSchedule({
    now: "2026-08-13T09:00:00.000Z",
    state: { status: "idle", last_success: null },
    lastCycle: { finished_at: "2026-08-13T08:00:00.000Z",
      batches: [{ status: "succeeded" }, { status: "succeeded" }] },
    queue: { ready_topics: 1 },
    executorReady: true
  });
  assert.equal(legacy.due, false);
  assert.equal(legacy.reason, "waiting-daily-time");
});
