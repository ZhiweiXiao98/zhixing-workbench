import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { runOwnedAutomationTick, runOwnedManualKnowledge } from "../packages/runtime/src/automation-owner.mjs";
import { acquireVaultAutomationLock, runtimeLockPath } from "../packages/runtime/src/runtime-lock.mjs";

test("后台与 Obsidian 并发 tick 只采集一组事件并整理一次", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-owner-concurrent-"));
  const vault = path.join(root, "vault");
  const codexHome = path.join(root, "codex-home");
  const session = path.join(codexHome, "sessions", "fixture.jsonl");
  let releaseKnowledge;
  const knowledgeEntered = new Promise((resolve) => { releaseKnowledge = resolve; });
  let notifyKnowledgeEntered;
  const knowledgeStarted = new Promise((resolve) => { notifyKnowledgeEntered = resolve; });
  let runs = 0;
  try {
    await mkdir(path.dirname(session), { recursive: true });
    await writeFile(session, `${[
      { timestamp: "2026-08-13T09:00:00.000Z", type: "session_meta", payload: { id: "owner-session",
        cwd: "C:\\FictionalProject", originator: "Codex Desktop", cli_version: "0.147.0", source: { subagent: null } } },
      { timestamp: "2026-08-13T09:00:01.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "owner-turn" } },
      { timestamp: "2026-08-13T09:00:02.000Z", type: "event_msg", payload: { type: "user_message", message: "并发采集验证" } },
      { timestamp: "2026-08-13T09:00:03.000Z", type: "event_msg", payload: { type: "task_complete", turn_id: "owner-turn",
        last_agent_message: "并发采集验证完成" } }
    ].map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
    const background = runOwnedAutomationTick({
      vault, codexHome, ownerKind: "background", now: "2026-08-13T10:00:00.000Z", executorReady: true,
      runKnowledge: async () => { runs += 1; notifyKnowledgeEntered(); await knowledgeEntered; }
    });
    await knowledgeStarted;
    const obsidian = await runOwnedAutomationTick({
      vault, codexHome, ownerKind: "obsidian", now: "2026-08-13T10:00:01.000Z", executorReady: true,
      runKnowledge: async () => { runs += 1; }
    });
    assert.equal(obsidian.reason, "owner-busy");
    releaseKnowledge();
    const completed = await background;
    assert.equal(completed.ran, true);
    assert.equal(runs, 1);
    const events = (await readFile(path.join(vault, "raw", "codex", "events", "2026-08-13.jsonl"), "utf8"))
      .trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.deepEqual(events.map((item) => item.event), ["UserPromptSubmit", "Stop"]);
  } finally {
    releaseKnowledge?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("崩溃遗留锁可恢复且 PID 复用不会永久阻塞或改写个人文件", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-owner-recovery-"));
  const vault = path.join(root, "vault");
  const sentinels = [path.join(vault, "raw", "manual.md"), path.join(vault, "wiki", "经验.md"),
    path.join(vault, "成果", "成果.md"), path.join(vault, "AGENTS.md")];
  try {
    for (const [index, file] of sentinels.entries()) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `sentinel-${index}\n`, "utf8");
    }
    const before = await hashes(sentinels);
    const lockDir = runtimeLockPath({ vault, name: "automation" });
    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, "owner.json"), JSON.stringify({
      schema_version: 1,
      owner_id: randomUUID(),
      owner_kind: "background",
      pid: process.pid,
      acquired_at: "2026-08-13T09:00:00.000Z",
      heartbeat_at: "2026-08-13T09:00:00.000Z",
      lease_until: "2026-08-13T09:00:30.000Z"
    }), "utf8");
    const recovered = await acquireVaultAutomationLock({ vault, ownerKind: "obsidian",
      now: () => new Date("2026-08-13T09:20:00.000Z") });
    assert.equal(recovered.acquired, true);
    assert.equal(recovered.recovered, true);
    await recovered.release();
    assert.deepEqual(await hashes(sentinels), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("手动整理遇到自动宿主时不重复执行并返回可理解提示", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-owner-manual-"));
  const vault = path.join(root, "vault");
  const automatic = await acquireVaultAutomationLock({ vault, ownerKind: "background" });
  let runs = 0;
  try {
    const manual = await runOwnedManualKnowledge({ vault, ownerKind: "manual",
      runKnowledge: async () => { runs += 1; } });
    assert.equal(manual.reason, "owner-busy");
    assert.equal(manual.ok, false);
    assert.match(manual.error, /后台正在处理/);
    assert.equal(runs, 0);
  } finally {
    await automatic.release();
    await rm(root, { recursive: true, force: true });
  }
});

test("租约接管后旧所有者不能续约或释放新所有者的锁", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-owner-token-"));
  const vault = path.join(root, "vault");
  try {
    const first = await acquireVaultAutomationLock({ vault, ownerKind: "background", leaseMs: 100,
      processIdentity: async () => "process-a", now: () => new Date("2026-08-13T09:00:00.000Z") });
    const second = await acquireVaultAutomationLock({ vault, ownerKind: "obsidian", leaseMs: 100,
      processIdentity: async () => "process-b",
      now: () => new Date("2026-08-13T09:00:01.000Z") });
    assert.equal(second.acquired, true);
    assert.equal(second.recovered, true);
    assert.equal(await first.heartbeat(), false);
    assert.equal(await first.release(), false);
    const blocked = await acquireVaultAutomationLock({ vault, ownerKind: "manual", leaseMs: 100,
      now: () => new Date("2026-08-13T09:00:01.050Z") });
    assert.equal(blocked.acquired, false);
    assert.equal(blocked.owner.owner_id, second.owner.owner_id);
    await second.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("系统睡眠导致租约过期时仍识别原进程，避免恢复后双宿主", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-owner-sleep-"));
  const vault = path.join(root, "vault");
  try {
    const first = await acquireVaultAutomationLock({ vault, ownerKind: "background", leaseMs: 100,
      processIdentity: async () => "same-process", now: () => new Date("2026-08-13T09:00:00.000Z") });
    const afterResume = await acquireVaultAutomationLock({ vault, ownerKind: "obsidian", leaseMs: 100,
      processIdentity: async () => "same-process", now: () => new Date("2026-08-13T09:30:00.000Z") });
    assert.equal(afterResume.acquired, false);
    assert.equal(afterResume.owner.owner_id, first.owner.owner_id);
    await first.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("不同 Node 进程不能同时取得同一 Vault 自动化锁", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-owner-process-"));
  const vault = path.join(root, "vault");
  const moduleUrl = pathToFileURL(path.resolve("packages/runtime/src/runtime-lock.mjs")).href;
  const childCode = `import { acquireVaultAutomationLock } from ${JSON.stringify(moduleUrl)};
const lease = await acquireVaultAutomationLock({ vault: ${JSON.stringify(vault)}, ownerKind: "background" });
process.stdout.write("locked\\n");
await new Promise((resolve) => setTimeout(resolve, 800));
await lease.release();`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", childCode], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await once(child.stdout, "data");
    const blocked = await acquireVaultAutomationLock({ vault, ownerKind: "obsidian" });
    assert.equal(blocked.acquired, false);
    assert.equal(blocked.owner.owner_kind, "background");
    const [exitCode] = await once(child, "exit");
    assert.equal(exitCode, 0);
  } finally {
    if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  }
});

async function hashes(files) {
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file,
    createHash("sha256").update(await readFile(file)).digest("hex")])));
}
