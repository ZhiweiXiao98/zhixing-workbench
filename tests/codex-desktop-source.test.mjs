import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { readCodexDesktopHealth, syncCodexDesktop } from "../packages/runtime/src/codex-desktop-source.mjs";

const NOW = "2026-08-13T10:00:00.000Z";

test("Codex Desktop 结构化事件成对采集、重启补采且幂等", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-desktop-source-"));
  const vault = path.join(root, "vault");
  const codexHome = path.join(root, "codex-home");
  const session = path.join(codexHome, "sessions", "2026", "08", "13", "rollout-fixture.jsonl");
  try {
    await mkdir(path.dirname(session), { recursive: true });
    await writeFile(session, lines([
      meta("desktop-session", "0.147.0"),
      event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "turn-1" }),
      context("2026-08-13T09:00:00.100Z", "turn-1"),
      event("2026-08-13T09:00:01.000Z", "user_message", { message: "整理一份虚构项目记录" }),
      event("2026-08-13T09:01:00.000Z", "task_complete", { turn_id: "turn-1", last_agent_message: "虚构项目记录已完成" })
    ]), "utf8");

    const first = await syncCodexDesktop({ vault, codexHome, now: NOW });
    assert.equal(first.configured, true);
    assert.equal(first.supported, true);
    assert.equal(first.accepted, 2);
    assert.equal(first.completed_turns, 1);
    const rawPath = path.join(vault, "raw", "codex", "events", "2026-08-13.jsonl");
    let records = parseLines(await readFile(rawPath, "utf8"));
    assert.deepEqual(records.map((item) => item.event), ["UserPromptSubmit", "Stop"]);
    assert.ok(records.every((item) => item.capture_source === "codex_desktop" && item.session_id === "desktop-session"));

    const second = await syncCodexDesktop({ vault, codexHome, now: "2026-08-13T10:01:00.000Z" });
    assert.equal(second.accepted, 0);
    await appendFile(session, lines([
      event("2026-08-13T10:02:00.000Z", "task_started", { turn_id: "turn-2" }),
      context("2026-08-13T10:02:00.100Z", "turn-2"),
      event("2026-08-13T10:02:01.000Z", "user_message", { message: "继续虚构验收" })
    ]), "utf8");
    const promptOnly = await syncCodexDesktop({ vault, codexHome, now: "2026-08-13T10:03:00.000Z" });
    assert.equal(promptOnly.accepted, 1);
    assert.equal(promptOnly.completed_turns, 0);

    await appendFile(session, lines([
      event("2026-08-13T10:04:00.000Z", "task_complete", { turn_id: "turn-2", last_agent_message: "虚构验收完成" })
    ]), "utf8");
    const afterRestart = await syncCodexDesktop({ vault, codexHome, now: "2026-08-13T10:05:00.000Z" });
    assert.equal(afterRestart.accepted, 1);
    assert.equal(afterRestart.completed_turns, 1);
    records = parseLines(await readFile(rawPath, "utf8"));
    assert.deepEqual(records.map((item) => `${item.turn_id}:${item.event}`), [
      "turn-1:UserPromptSubmit", "turn-1:Stop", "turn-2:UserPromptSubmit", "turn-2:Stop"
    ]);
    assert.equal((await readCodexDesktopHealth({ vault, codexHome, now: "2026-08-13T10:06:00.000Z" })).last_event_at,
      "2026-08-13T10:04:00.000Z");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("不兼容的生产者版本明确报错且不写事件", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-desktop-unsupported-"));
  const vault = path.join(root, "vault");
  const codexHome = path.join(root, "codex-home");
  const session = path.join(codexHome, "sessions", "fixture.jsonl");
  try {
    await mkdir(path.dirname(session), { recursive: true });
    await writeFile(session, lines([
      meta("old-session", "0.143.0"),
      event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "turn-old" }),
      event("2026-08-13T09:00:01.000Z", "user_message", { message: "不得采集" })
    ]), "utf8");
    const result = await syncCodexDesktop({ vault, codexHome, now: NOW });
    assert.equal(result.supported, false);
    assert.match(result.error, /不支持的 Codex Desktop 数据版本/);
    const state = JSON.parse(await readFile(path.join(vault, "raw", "codex", "sources", "desktop-state.json"), "utf8"));
    assert.equal(Object.keys(state.checkpoints).length, 0);
    await assert.rejects(readFile(path.join(vault, "raw", "codex", "events", "2026-08-13.jsonl"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("未知未来版本 fail-closed 且不得推进文件游标", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-desktop-future-"));
  const vault = path.join(root, "vault");
  const codexHome = path.join(root, "codex-home");
  const session = path.join(codexHome, "sessions", "future.jsonl");
  try {
    await mkdir(path.dirname(session), { recursive: true });
    await writeFile(session, lines([
      meta("future-session", "0.148.0"),
      event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "future-turn" }),
      event("2026-08-13T09:00:01.000Z", "user_message", { message: "未来格式不得误采" }),
      event("2026-08-13T09:00:02.000Z", "task_complete", { turn_id: "future-turn", last_agent_message: "不得写入" })
    ]), "utf8");
    const result = await syncCodexDesktop({ vault, codexHome, now: NOW });
    assert.equal(result.supported, false);
    assert.equal(result.accepted, 0);
    assert.match(result.error, /不支持的 Codex Desktop 数据版本 0\.148\.0/);
    const state = JSON.parse(await readFile(path.join(vault, "raw", "codex", "sources", "desktop-state.json"), "utf8"));
    assert.deepEqual(state.checkpoints, {});
    await assert.rejects(readFile(path.join(vault, "raw", "codex", "events", "2026-08-13.jsonl"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("完整结构化行损坏时不推进游标，修复后可以重试", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-desktop-malformed-"));
  const vault = path.join(root, "vault");
  const codexHome = path.join(root, "codex-home");
  const session = path.join(codexHome, "sessions", "malformed.jsonl");
  try {
    await mkdir(path.dirname(session), { recursive: true });
    await writeFile(session, `${JSON.stringify(meta("retry-session", "0.147.0"))}\n{broken-json}\n`, "utf8");
    const failed = await syncCodexDesktop({ vault, codexHome, now: NOW });
    assert.match(failed.error, /游标未推进/);
    const state = JSON.parse(await readFile(path.join(vault, "raw", "codex", "sources", "desktop-state.json"), "utf8"));
    assert.equal(Object.keys(state.checkpoints).length, 0);

    await writeFile(session, lines([
      meta("retry-session", "0.147.0"),
      event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "retry-turn" }),
      event("2026-08-13T09:00:01.000Z", "user_message", { message: "修复后重试" }),
      event("2026-08-13T09:00:02.000Z", "task_complete", { turn_id: "retry-turn", last_agent_message: "重试成功" })
    ]), "utf8");
    const retried = await syncCodexDesktop({ vault, codexHome, now: "2026-08-13T10:01:00.000Z" });
    assert.equal(retried.accepted, 2);
    assert.equal(retried.error, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("增量采集只新增事件文件，不改已有 raw、Wiki、成果与 AGENTS", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-desktop-preserve-"));
  const vault = path.join(root, "vault");
  const codexHome = path.join(root, "codex-home");
  const session = path.join(codexHome, "sessions", "fixture.jsonl");
  const sentinels = [
    path.join(vault, "raw", "manual-note.md"),
    path.join(vault, "raw", "codex", "events", "2026-08-12.jsonl"),
    path.join(vault, "wiki", "虚构经验.md"),
    path.join(vault, "成果", "虚构成果.md"),
    path.join(vault, "AGENTS.md")
  ];
  try {
    for (const [index, file] of sentinels.entries()) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `sentinel-${index}\n`, "utf8");
    }
    const before = await hashes(sentinels);
    await mkdir(path.dirname(session), { recursive: true });
    await writeFile(session, lines([
      meta("preserve-session", "0.147.0"),
      event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "turn-preserve" }),
      event("2026-08-13T09:00:01.000Z", "user_message", { message: "只写新增事件" }),
      event("2026-08-13T09:00:02.000Z", "task_complete", { turn_id: "turn-preserve", last_agent_message: "完成" })
    ]), "utf8");
    await syncCodexDesktop({ vault, codexHome, now: NOW });
    assert.deepEqual(await hashes(sentinels), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function meta(id, version) {
  return { timestamp: "2026-08-13T08:59:59.000Z", type: "session_meta",
    payload: { id, cwd: "C:\\FictionalProject", originator: "Codex Desktop", cli_version: version, source: { subagent: null } } };
}

function event(timestamp, type, value) {
  return { timestamp, type: "event_msg", payload: { type, ...value } };
}

function context(timestamp, turnId) {
  return { timestamp, type: "turn_context", payload: { turn_id: turnId, cwd: "C:\\FictionalProject" } };
}

function lines(items) { return `${items.map((item) => JSON.stringify(item)).join("\n")}\n`; }
function parseLines(value) { return value.trim().split(/\r?\n/).map((line) => JSON.parse(line)); }
async function hashes(files) {
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
}
