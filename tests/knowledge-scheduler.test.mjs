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
