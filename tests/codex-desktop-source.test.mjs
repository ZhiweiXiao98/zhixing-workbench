import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { normalizeDesktopRecords, readCodexDesktopHealth, syncCodexDesktop } from "../packages/runtime/src/codex-desktop-source.mjs";

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

test("Codex Desktop 0.149 结构化事件可被采集", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-desktop-149-"));
  const vault = path.join(root, "vault");
  const codexHome = path.join(root, "codex-home");
  const session = path.join(codexHome, "sessions", "fixture-149.jsonl");
  try {
    await mkdir(path.dirname(session), { recursive: true });
    await writeFile(session, lines([
      meta("desktop-session-149", "0.149.0-alpha.4.3"),
      event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "turn-149" }),
      context("2026-08-13T09:00:00.100Z", "turn-149"),
      event("2026-08-13T09:00:01.000Z", "user_message", { message: "验证新版桌面采集" }),
      event("2026-08-13T09:00:02.000Z", "task_complete", { turn_id: "turn-149", last_agent_message: "新版采集完成" })
    ]), "utf8");
    const result = await syncCodexDesktop({ vault, codexHome, now: NOW });
    assert.equal(result.supported, true);
    assert.equal(result.accepted, 2);
    assert.equal(result.completed_turns, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const version of ["0.150.0", "0.151.0-alpha.7.2", "0.152.0", "0.152.1", "0.153.0-alpha.5", "0.153.0", "0.153.3", "0.153.4"]) {
  test(`Codex Desktop ${version} 结构化事件可被补采`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zhixing-desktop-current-"));
    const vault = path.join(root, "vault");
    const codexHome = path.join(root, "codex-home");
    const session = path.join(codexHome, "sessions", "fixture-current.jsonl");
    try {
      await mkdir(path.dirname(session), { recursive: true });
      await writeFile(session, lines([
        meta("desktop-session-current", version),
        event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "turn-current" }),
        context("2026-08-13T09:00:00.100Z", "turn-current"),
        Number(version.split(".")[1]) >= 152
          ? event("2026-08-13T09:00:01.000Z", "item_completed", {
            turn_id: "turn-current", item: { type: "UserMessage", content: [{ type: "text", text: "补采当前桌面版本" }] }
          })
          : event("2026-08-13T09:00:01.000Z", "user_message", { message: "补采当前桌面版本" }),
        event("2026-08-13T09:00:02.000Z", "task_complete", {
          turn_id: "turn-current",
          last_agent_message: "当前版本补采完成"
        })
      ]), "utf8");
      const result = await syncCodexDesktop({ vault, codexHome, now: NOW });
      assert.equal(result.supported, true);
      assert.equal(result.accepted, 2);
      assert.equal(result.completed_turns, 1);
      assert.equal((await syncCodexDesktop({ vault, codexHome, now: NOW })).accepted, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("新版 UserMessage 使用明确轮次，仅采集文本并忽略其他 item", () => {
  const result = normalizeDesktopRecords([
    meta("item-session", "0.153.4"),
    event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "active-turn" }),
    event("2026-08-13T09:00:01.000Z", "item_completed", {
      turn_id: "message-turn", item: { type: "UserMessage", content: [
        { type: "text", text: "第一段" }, { type: "Text", text: "第二段" },
        { type: "image", text: "不得采集附件数据" }
      ] }
    }),
    event("2026-08-13T09:00:02.000Z", "item_completed", {
      turn_id: "active-turn", item: { type: "Reasoning", content: [{ type: "text", text: "不采集内部推理" }] }
    })
  ]);
  assert.equal(result.error, null);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].turn_id, "message-turn");
  assert.equal(result.events[0].content, "第一段\n第二段");
});

test("按日期补采可恢复已跳过文件，不受更晚 raw 时间影响且可幂等重放", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-desktop-replay-"));
  const vault = path.join(root, "vault");
  const codexHome = path.join(root, "codex-home");
  const session = path.join(codexHome, "sessions", "missed.jsonl");
  const statePath = path.join(vault, "raw", "codex", "sources", "desktop-state.json");
  const rawPath = path.join(vault, "raw", "codex", "events", "2026-08-13.jsonl");
  try {
    await mkdir(path.dirname(session), { recursive: true });
    const content = lines([
      meta("missed-session", "0.153.4"),
      event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "missed-turn" }),
      event("2026-08-13T09:00:01.000Z", "item_completed", {
        turn_id: "missed-turn", item: { type: "UserMessage", content: [{ type: "text", text: "遗漏问题" }] }
      }),
      event("2026-08-13T09:01:00.000Z", "task_complete", { turn_id: "missed-turn", last_agent_message: "遗漏回答" })
    ]);
    await writeFile(session, content, "utf8");
    await mkdir(path.dirname(rawPath), { recursive: true });
    await writeFile(rawPath, lines([{ event_id: "existing-event", captured_at: NOW }]), "utf8");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({ checkpoints: { "missed.jsonl": { offset: Buffer.byteLength(content) } } }), "utf8");
    assert.equal((await syncCodexDesktop({ vault, codexHome, now: NOW })).accepted, 0);
    const options = { vault, codexHome, now: NOW, replaySince: "2026-08-13T08:00:00.000Z" };
    const replay = await syncCodexDesktop(options);
    assert.equal(replay.accepted, 2);
    assert.equal(replay.completed_turns, 1);
    assert.equal(replay.error, null);
    const again = await syncCodexDesktop(options);
    assert.equal(again.accepted, 0);
    assert.equal(again.duplicates, 2);
    assert.equal(parseLines(await readFile(rawPath, "utf8")).length, 3);
    await assert.rejects(syncCodexDesktop({ ...options, replaySince: "invalid" }), /补采起始时间无效/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("缺少 UI 消息的轮次从持久化用户输入补齐，跨增量保留且不推断空输入", () => {
  const input = { timestamp: "2026-08-13T09:00:01.000Z", type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "自动唤醒任务" }] } };
  const first = normalizeDesktopRecords([
    meta("fallback-session", "0.153.4"),
    event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "wake-turn" }), input
  ]);
  assert.equal(first.events.length, 0);
  const completed = normalizeDesktopRecords([
    event("2026-08-13T09:01:00.000Z", "task_complete", { turn_id: "wake-turn", last_agent_message: "唤醒结果" }),
    event("2026-08-13T09:02:00.000Z", "task_started", { turn_id: "empty-turn" }),
    event("2026-08-13T09:03:00.000Z", "task_complete", { turn_id: "empty-turn", last_agent_message: "无输入的继续结果" })
  ], first.checkpoint);
  assert.deepEqual(completed.events.map(e => [e.event, e.turn_id]), [
    ["UserPromptSubmit", "wake-turn"], ["Stop", "wake-turn"], ["Stop", "empty-turn"]
  ]);
  assert.equal(completed.events[0].content, "自动唤醒任务");
  assert.equal(completed.checkpoint.pending_user_content, "");
});

test("明确用户消息存在时不重复采集响应输入或开发者消息", () => {
  const records = [
    meta("preferred-session", "0.153.4"),
    event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "preferred-turn" }),
    { timestamp: "2026-08-13T09:00:01.000Z", type: "response_item",
      payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "不得采集" }] } },
    { timestamp: "2026-08-13T09:00:02.000Z", type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "附带上下文的输入" }] } },
    event("2026-08-13T09:00:03.000Z", "user_message", { message: "真实用户问题" }),
    event("2026-08-13T09:01:00.000Z", "task_complete", { turn_id: "preferred-turn", last_agent_message: "最终回答" })
  ];
  const result = normalizeDesktopRecords(records);
  assert.deepEqual(result.events.map(e => e.content), ["真实用户问题", "最终回答"]);
});

test("其他轮次的迟到消息不覆盖当前轮次的输入去重状态", () => {
  const result = normalizeDesktopRecords([
    meta("late-session", "0.153.4"),
    event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "current-turn" }),
    event("2026-08-13T09:00:01.000Z", "user_message", { message: "当前问题" }),
    { timestamp: "2026-08-13T09:00:02.000Z", type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "当前问题及附带上下文" }] } },
    event("2026-08-13T09:00:03.000Z", "item_completed", {
      turn_id: "previous-turn", item: { type: "UserMessage", content: [{ type: "text", text: "迟到问题" }] }
    }),
    event("2026-08-13T09:01:00.000Z", "task_complete", { turn_id: "current-turn", last_agent_message: "当前回答" })
  ]);
  assert.deepEqual(result.events.map(e => e.content), ["当前问题", "迟到问题", "当前回答"]);
});

test("Codex Desktop 0.148 结构化事件可被补采", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-desktop-148-"));
  const vault = path.join(root, "vault");
  const codexHome = path.join(root, "codex-home");
  const session = path.join(codexHome, "sessions", "fixture-148.jsonl");
  try {
    await mkdir(path.dirname(session), { recursive: true });
    await writeFile(session, lines([
      meta("desktop-session-148", "0.148.0-alpha.15"),
      event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "turn-148" }),
      context("2026-08-13T09:00:00.100Z", "turn-148"),
      event("2026-08-13T09:00:01.000Z", "user_message", { message: "补采旧版桌面记录" }),
      event("2026-08-13T09:00:02.000Z", "task_complete", { turn_id: "turn-148", last_agent_message: "旧版补采完成" })
    ]), "utf8");
    const result = await syncCodexDesktop({ vault, codexHome, now: NOW });
    assert.equal(result.supported, true);
    assert.equal(result.accepted, 2);
    assert.equal(result.completed_turns, 1);
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
      meta("future-session", "0.154.0"),
      event("2026-08-13T09:00:00.000Z", "task_started", { turn_id: "future-turn" }),
      event("2026-08-13T09:00:01.000Z", "user_message", { message: "未来格式不得误采" }),
      event("2026-08-13T09:00:02.000Z", "task_complete", { turn_id: "future-turn", last_agent_message: "不得写入" })
    ]), "utf8");
    const result = await syncCodexDesktop({ vault, codexHome, now: NOW });
    assert.equal(result.supported, false);
    assert.equal(result.accepted, 0);
    assert.match(result.error, /不支持的 Codex Desktop 数据版本 0\.154\.0/);
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
