import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectBackgroundSchedulerRegistration, registerBackgroundScheduler, removeBackgroundScheduler,
  startupEntryDefinition } from "../packages/runtime/src/background-registration.mjs";
import { runBackgroundLoop, runBackgroundTick } from "../packages/runtime/src/background-scheduler.mjs";

test("三端只注册一个套件自有后台入口并共用同一调度运行时", () => {
  const definitions = [
    startupEntryDefinition({ platform: "win32", home: "C:\\Users\\Example",
      env: { APPDATA: "C:\\Users\\Example\\AppData\\Roaming" }, nodePath: "C:\\Node\\node.exe",
      programRoot: "C:\\Program", configRoot: "C:\\Config" }),
    startupEntryDefinition({ platform: "darwin", home: "/Users/example", env: {}, nodePath: "/usr/local/bin/node",
      programRoot: "/opt/zhixing", configRoot: "/Users/example/Library/Application Support/ZhixingWorkbench" }),
    startupEntryDefinition({ platform: "linux", home: "/home/example", env: {}, nodePath: "/usr/bin/node",
      programRoot: "/opt/zhixing", configRoot: "/home/example/.config/zhixing-workbench" })
  ];
  assert.deepEqual(definitions.map((item) => item.kind), ["windows-startup", "launch-agent", "xdg-autostart"]);
  for (const definition of definitions) {
    assert.match(definition.content, /background-scheduler\.mjs/);
    assert.match(definition.content, /zhixing-workbench-background-scheduler:v1/);
    assert.doesNotMatch(definition.content, /ChatGPT Web Capture|Obsidian Daily Ingest|Watchdog/);
  }
});

test("后台启动项安装与卸载受内容哈希保护", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-background-register-"));
  const appData = path.join(root, "appdata");
  try {
    const options = { platform: "win32", home: root, env: { APPDATA: appData }, nodePath: process.execPath,
      programRoot: path.join(root, "program"), configRoot: path.join(root, "config") };
    const change = await registerBackgroundScheduler(options);
    assert.equal(change.state.installed, true);
    assert.equal((await inspectBackgroundSchedulerRegistration(change.state)).configured, true);
    assert.match(await readFile(change.state.entry_path, "utf8"), /background-scheduler\.mjs/);
    const removed = await removeBackgroundScheduler(change.state);
    assert.equal(removed.removed, true);
    assert.equal((await inspectBackgroundSchedulerRegistration(change.state)).configured, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("用户修改后台启动项后更新和卸载都保留文件并报告冲突", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-background-conflict-"));
  try {
    const options = { platform: "linux", home: root, env: { XDG_CONFIG_HOME: path.join(root, ".config") },
      nodePath: "/usr/bin/node", programRoot: path.join(root, "program"), configRoot: path.join(root, "config") };
    const first = await registerBackgroundScheduler(options);
    await writeFile(first.state.entry_path, `${await readFile(first.state.entry_path, "utf8")}# 用户保留内容\n`, "utf8");
    const updated = await registerBackgroundScheduler({ ...options, previousState: first.state });
    assert.equal(updated.state.conflict, true);
    assert.match(await readFile(first.state.entry_path, "utf8"), /用户保留内容/);
    const removed = await removeBackgroundScheduler(first.state);
    assert.equal(removed.conflict, true);
    assert.match(await readFile(first.state.entry_path, "utf8"), /用户保留内容/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Obsidian 关闭并跨过 23:30 后，后台 tick 在睡眠恢复时补跑", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-background-catchup-"));
  const vault = path.join(root, "vault");
  try {
    await mkdir(path.join(vault, "raw", "codex", "automation"), { recursive: true });
    await writeFile(path.join(vault, "raw", "codex", "automation", "schedule-state.json"), JSON.stringify({
      schema_version: 1,
      last_attempt: "2026-08-13T23:35:00",
      last_success: "2026-08-13T23:35:00",
      next_due: "2026-08-14T23:30:00",
      status: "succeeded",
      error: null,
      failure_count: 0,
      trigger: "daily-2330"
    }), "utf8");
    await writeFile(path.join(vault, "raw", "codex", "ingest-status.json"), JSON.stringify({ ready_topics: 2 }), "utf8");
    let runs = 0;
    const result = await runBackgroundTick({
      install: { vaultRoot: vault, programRoot: path.join(root, "program") },
      now: "2026-08-14T00:10:00",
      syncDesktop: async () => ({ completed_turns: 0, last_event_at: "2026-08-13T22:00:00.000Z" }),
      discoverCodex: async () => ({ path: "C:\\Fixture\\codex.exe", version: "codex-cli 0.147.0" }),
      probeExecutor: async () => ({ supported: true, error: null }),
      runKnowledge: async () => { runs += 1; }
    });
    assert.equal(result.active, true);
    assert.equal(result.ran, true);
    assert.equal(result.reason, "missed-day-catchup");
    assert.equal(runs, 1);
    const heartbeat = JSON.parse(await readFile(path.join(vault, "raw", "codex", "automation", "background-state.json"), "utf8"));
    assert.equal(heartbeat.status, "ready");
    assert.equal(heartbeat.last_seen_at, new Date("2026-08-14T00:10:00").toISOString());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("同版本重复启动只保留一个后台宿主", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-background-singleton-"));
  const vault = path.join(root, "vault");
  const configRoot = path.join(root, "config");
  let releaseSync;
  const syncWaiting = new Promise((resolve) => { releaseSync = resolve; });
  let notifySync;
  const syncStarted = new Promise((resolve) => { notifySync = resolve; });
  const options = {
    configRoot,
    install: { vaultRoot: vault, programRoot: path.join(root, "program") },
    once: true,
    syncDesktop: async () => { notifySync(); await syncWaiting; return { completed_turns: 0, last_event_at: null }; },
    discoverCodex: async () => ({ path: "C:\\Fixture\\codex.exe", version: "codex-cli 0.147.0" }),
    probeExecutor: async () => ({ supported: true, error: null }),
    runKnowledge: async () => undefined
  };
  try {
    const first = runBackgroundLoop(options);
    await syncStarted;
    const duplicate = await runBackgroundLoop(options);
    assert.equal(duplicate.reason, "host-already-running");
    releaseSync();
    assert.equal((await first).active, true);
  } finally {
    releaseSync?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("后台 partial 保留明细并在 backoff 到期后恢复 last_success", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-background-retry-"));
  const vault = path.join(root, "vault");
  const cyclePath = path.join(vault, "raw", "codex", "automation", "last-cycle.json");
  let cycles = 0;
  const common = {
    install: { vaultRoot: vault, programRoot: path.join(root, "program") },
    syncDesktop: async () => ({ completed_turns: 1, last_event_at: "2026-08-13T08:00:00.000Z" }),
    discoverCodex: async () => ({ path: "C:\\Fixture\\codex.exe", version: "codex-cli 0.147.0" }),
    probeExecutor: async () => ({ supported: true, error: null }),
    cycleRunner: async () => {
      cycles += 1;
      const summary = cycles === 1
        ? { status: "partial", finished_at: "2026-08-13T08:00:30.000Z",
          batches: [{ batch_index: 2, status: "partial", failed: 1,
            error: "虚构主题：原始事件来源与主题证据不一致" }] }
        : { status: "succeeded", finished_at: "2026-08-13T08:06:00.000Z", batches: [] };
      await mkdir(path.dirname(cyclePath), { recursive: true });
      await writeFile(cyclePath, JSON.stringify(summary), "utf8");
      return summary;
    }
  };
  try {
    const first = await runBackgroundTick({ ...common, now: "2026-08-13T08:00:00.000Z" });
    assert.equal(first.ok, false);
    assert.equal(first.background.phase, "error");
    assert.match(first.state.error, /第 2 批.*原始事件来源与主题证据不一致/);
    assert.equal(JSON.parse(await readFile(cyclePath, "utf8")).status, "partial");
    const retried = await runBackgroundTick({ ...common, now: first.state.next_due });
    assert.equal(retried.ok, true);
    assert.equal(retried.ran, true);
    assert.equal(retried.state.status, "succeeded");
    assert.ok(retried.state.last_success);
    assert.equal(cycles, 2);
    assert.equal(JSON.parse(await readFile(cyclePath, "utf8")).status, "succeeded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("后台 tick 读取 Desktop fixture 后生成状态与成对增量事件", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-background-desktop-"));
  const vault = path.join(root, "vault");
  const codexHome = path.join(root, "codex-home");
  const session = path.join(codexHome, "sessions", "fixture.jsonl");
  const now = new Date();
  const at = (offset) => new Date(now.getTime() + offset).toISOString();
  try {
    await mkdir(path.dirname(session), { recursive: true });
    await writeFile(session, `${[
      { timestamp: at(-4000), type: "session_meta", payload: { id: "desktop-fixture", cwd: "C:\\FictionalProject",
        originator: "Codex Desktop", cli_version: "0.147.0", source: { subagent: null } } },
      { timestamp: at(-3000), type: "event_msg", payload: { type: "task_started", turn_id: "desktop-turn" } },
      { timestamp: at(-2000), type: "event_msg", payload: { type: "user_message", message: "验证桌面增量采集" } },
      { timestamp: at(-1000), type: "event_msg", payload: { type: "task_complete", turn_id: "desktop-turn",
        last_agent_message: "桌面增量采集完成" } }
    ].map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
    const result = await runBackgroundTick({
      install: { vaultRoot: vault, programRoot: path.join(root, "program") }, codexHome, now,
      discoverCodex: async () => ({ path: "C:\\Fixture\\codex.exe", version: "codex-cli 0.147.0" }),
      probeExecutor: async () => ({ supported: false, error: "fixture 不执行知识整理" })
    });
    assert.equal(result.capture.completed_turns, 1);
    const state = JSON.parse(await readFile(path.join(vault, "raw", "codex", "sources", "desktop-state.json"), "utf8"));
    assert.equal(state.supported, true);
    assert.equal(state.last_event_at, at(-1000));
    const daily = now.toISOString().slice(0, 10);
    const events = (await readFile(path.join(vault, "raw", "codex", "events", `${daily}.jsonl`), "utf8"))
      .trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.deepEqual(events.map((item) => item.event), ["UserPromptSubmit", "Stop"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
