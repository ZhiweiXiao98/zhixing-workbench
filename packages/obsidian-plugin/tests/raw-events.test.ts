import { describe, expect, it } from "vitest";
import { buildRawActivityEvents, parseJsonl } from "../src/core/raw-events";
import { classifyReportedStatus, extractMeaningfulPrompt } from "../src/core/text";
import type { CapturedRecord, SessionTitle } from "../src/core/types";

const titles = new Map<string, SessionTitle>([
  ["session-a", { id: "session-a", title: "实现日历视图", updatedAt: "2026-07-17T00:00:00Z" }],
  ["session-b", { id: "session-b", title: "实现日历视图", updatedAt: "2026-07-17T00:00:00Z" }],
  ["session-c", { id: "session-c", title: "开发 Obsidian 知行台插件", updatedAt: "2026-07-17T00:00:00Z" }],
  ["session-d", { id: "session-d", title: "开发 Obsidian 知行台插件 (2)", updatedAt: "2026-07-18T00:00:00Z" }],
  ["session-e", { id: "session-e", title: "开发 Obsidian 知行台插件 (3)", updatedAt: "2026-07-19T00:00:00Z" }]
]);

describe("raw event ingestion", () => {
  it("tolerates an incomplete JSONL line", () => {
    const record = makeRecord({ event_id: "one" });
    const result = parseJsonl(`${JSON.stringify(record)}\n{`, "raw/codex/events/2026-07-17.jsonl");
    expect(result.records).toHaveLength(1);
    expect(result.malformedLines).toBe(1);
  });

  it("rejects an invalid captured timestamp and normalizes an invalid date field", () => {
    const invalidTime = makeRecord({ event_id: "bad-time", captured_at: "../../outside" });
    const invalidDate = makeRecord({ event_id: "safe-time", date: "../../outside" });
    const result = parseJsonl(
      `${JSON.stringify(invalidTime)}\n${JSON.stringify(invalidDate)}`,
      "raw/codex/events/2026-07-17.jsonl"
    );

    expect(result.malformedLines).toBe(1);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.date).toBe("2026-07-17");
  });

  it("deduplicates records and folds multiple prompts in one turn into one activity", () => {
    const prompt = makeRecord({ event_id: "prompt-1", content: "请实现日历" });
    const steering = makeRecord({ event_id: "prompt-2", content: "再补充周视图", captured_at: "2026-07-17T09:01:00+08:00" });
    const stop = makeRecord({ event_id: "stop-1", event: "Stop", content: "已完成，测试通过", captured_at: "2026-07-17T09:20:00+08:00" });
    const result = buildRawActivityEvents([stop, prompt, prompt, steering], titles);
    expect(result.events).toHaveLength(2);
    expect(result.duplicateRecords).toBe(1);
    expect(result.events[0]?.kind).toBe("task_started");
    expect(result.events[0]?.summary).toContain("2 条指令");
    expect(result.events[1]?.kind).toBe("task_completed");
    expect(result.events[1]?.confidence).toBe("reported");
    expect(result.events[1]?.sourceRefs).toContainEqual(expect.objectContaining({ label: "Codex Stop 事件", line: 1 }));
  });

  it("never marks a prompt-only turn complete", () => {
    const result = buildRawActivityEvents([makeRecord({ content: "请完成全部开发" })], titles);
    expect(result.events[0]?.kind).toBe("task_started");
    expect(result.events[0]?.confidence).toBe("inferred");
  });

  it("excludes heartbeat and sessions missing from the user thread index", () => {
    const heartbeatPrompt = makeRecord({ content: "<heartbeat><automation_id>x</automation_id></heartbeat>" });
    const heartbeatStop = makeRecord({ event: "Stop", event_id: "stop-heartbeat", content: "DONT_NOTIFY" });
    const supporting = makeRecord({ session_id: "subagent", event_id: "subagent-prompt", content: "检查实现" });
    const supportingStop = makeRecord({ session_id: "subagent", event_id: "subagent-stop", event: "Stop", content: "检查完成" });
    const result = buildRawActivityEvents([heartbeatPrompt, heartbeatStop, supporting, supportingStop], titles);
    expect(result.events).toHaveLength(0);
    expect(result.excludedAutomations).toBe(1);
    expect(result.excludedSupportingSessions).toBe(1);
  });

  it("conservatively excludes Codex sessions when the main-thread index is unavailable", () => {
    const result = buildRawActivityEvents(makePair({ sessionId: "session-a", turnId: "turn-a" }), new Map());
    expect(result.events).toHaveLength(0);
    expect(result.excludedSupportingSessions).toBe(1);
  });

  it("records a cross-midnight outcome on the Stop date", () => {
    const prompt = makeRecord({ captured_at: "2026-07-17T23:59:00+08:00", date: "2026-07-17" });
    const stop = makeRecord({
      event_id: "stop-midnight",
      event: "Stop",
      content: "已完成并且测试通过",
      captured_at: "2026-07-18T00:01:00+08:00",
      date: "2026-07-18"
    });
    const result = buildRawActivityEvents([prompt, stop], titles);
    expect(result.events.map((event) => [event.kind, event.localDate])).toEqual([
      ["task_started", "2026-07-17"],
      ["task_completed", "2026-07-18"]
    ]);
    expect(result.events[1]?.sourceRefs).toContainEqual(expect.objectContaining({ path: "raw/codex/events/2026-07-17.jsonl" }));
  });

  it("keeps similar titles from different sessions separate", () => {
    const first = makePair({ sessionId: "session-a", turnId: "turn-a" });
    const second = makePair({ sessionId: "session-b", turnId: "turn-b" });
    const result = buildRawActivityEvents([...first, ...second], titles);
    expect(new Set(result.events.map((event) => event.taskKey))).toEqual(new Set([
      "codex:demo-project:session-a",
      "codex:demo-project:session-b"
    ]));
  });

  it("merges explicitly numbered copies of one Codex task across sessions and days", () => {
    const first = makePair({ sessionId: "session-c", turnId: "turn-c" });
    const second = makePair({ sessionId: "session-d", turnId: "turn-d" }).map((record) => ({
      ...record,
      captured_at: record.event === "Stop" ? "2026-07-18T09:20:00+08:00" : "2026-07-18T09:00:00+08:00",
      date: "2026-07-18"
    }));
    const third = makePair({ sessionId: "session-e", turnId: "turn-e" }).map((record) => ({
      ...record,
      captured_at: record.event === "Stop" ? "2026-07-19T09:20:00+08:00" : "2026-07-19T09:00:00+08:00",
      date: "2026-07-19"
    }));

    const result = buildRawActivityEvents([...first, ...second, ...third], titles);

    expect(new Set(result.events.map((event) => event.taskKey))).toHaveLength(1);
    expect(new Set(result.events.map((event) => event.title))).toEqual(new Set(["开发 Obsidian 知行台插件"]));
    expect(result.events.filter((event) => event.kind === "task_started")).toHaveLength(1);
  });

  it("does not merge a numbered title across different projects", () => {
    const first = makePair({ sessionId: "session-c", turnId: "turn-c" });
    const second = makePair({ sessionId: "session-d", turnId: "turn-d" }).map((record) => ({
      ...record,
      cwd: "C:\\different-project"
    }));

    const result = buildRawActivityEvents([...first, ...second], titles);

    expect(new Set(result.events.map((event) => event.taskKey))).toHaveLength(2);
  });

  it("does not merge a numbered copy after a long inactivity gap", () => {
    const first = makePair({ sessionId: "session-c", turnId: "turn-c" });
    const later = makePair({ sessionId: "session-d", turnId: "turn-d" }).map((record) => ({
      ...record,
      captured_at: record.event === "Stop" ? "2026-08-05T09:20:00+08:00" : "2026-08-05T09:00:00+08:00",
      date: "2026-08-05"
    }));

    const result = buildRawActivityEvents([...first, ...later], titles);

    expect(new Set(result.events.map((event) => event.taskKey))).toHaveLength(2);
    expect(new Set(result.events.map((event) => event.title))).toEqual(new Set([
      "开发 Obsidian 知行台插件",
      "开发 Obsidian 知行台插件 (2)"
    ]));
  });

  it("maps Feishu resource updates into traceable task and knowledge events", () => {
    const task = makeRecord({
      source: "feishu",
      event: "ResourceUpdate",
      event_id: "feishu-task-one",
      session_id: "feishu:tasks:one",
      turn_id: "version-one",
      cwd: "虚构项目",
      title: "修复 Issue #42",
      content: "任务已完成并通过验收",
      occurred_at: "2026-07-17T08:00:00Z",
      updated_at: "2026-07-17T09:00:00Z",
      resource_type: "tasks",
      resource_id: "tasks:one",
      resource_status: "已完成",
      resource_url: "https://example.invalid/tasks/one",
      project_hint: "虚构项目",
      access_status: "available",
      activity_kind: "task_completed",
      untrusted_source: true,
      sourcePath: "raw/feishu/events/2026-07-17.jsonl"
    });
    const knowledge = makeRecord({
      ...task,
      event_id: "feishu-doc-one",
      session_id: "feishu:documents:one",
      resource_type: "documents",
      resource_id: "documents:one",
      title: "虚构排查记录",
      content: "记录了问题、判断、解决步骤和验证结果。",
      activity_kind: "knowledge_created"
    });
    const result = buildRawActivityEvents([task, knowledge], titles);
    expect(result.feishuRecords).toBe(2);
    expect(result.events).toContainEqual(expect.objectContaining({ kind: "task_completed", taskKey: expect.stringContaining("feishu:") }));
    expect(result.events).toContainEqual(expect.objectContaining({ kind: "knowledge_created", objectKey: "feishu:documents:documents:one" }));
    expect(result.events[0]?.sourceRefs).toContainEqual(expect.objectContaining({ type: "feishu", label: "打开飞书来源" }));
  });

  it("merges Codex and Feishu tasks only when they share an explicit project issue", () => {
    const codex = makePair({ sessionId: "session-a", turnId: "turn-issue" }).map((record) => ({
      ...record,
      content: record.event === "Stop" ? "Issue #42 继续处理中" : "推进 Issue #42"
    }));
    const feishu = makeRecord({
      source: "feishu",
      event: "ResourceUpdate",
      event_id: "feishu-issue-42",
      session_id: "feishu:tasks:issue-42",
      turn_id: "version-one",
      cwd: "demo-project",
      title: "推进 Issue #42",
      content: "Issue #42 状态更新",
      resource_type: "tasks",
      resource_id: "tasks:issue-42",
      project_hint: "demo-project",
      activity_kind: "task_progress",
      access_status: "available",
      sourcePath: "raw/feishu/events/2026-07-17.jsonl"
    });
    const result = buildRawActivityEvents([...codex, feishu], titles);
    expect(new Set(result.events.filter((event) => event.taskKey).map((event) => event.taskKey))).toHaveLength(1);
    expect(result.events.find((event) => event.sourceRefs.some((source) => source.type === "feishu"))?.taskKey).toContain("work:demo-project:issue:42");
  });

  it("extracts browser comments instead of generated screenshot safety text", () => {
    const content = `
# Browser comments:

## Comment 1
File: browser:面板
Comment:
这个样式加上阴影

## Comment 2
File: browser:提示
Comment:
删除这句提示

<in-app-browser-context source="ambient-ui-state">ignored</in-app-browser-context>

## My request for Codex:
The next image is untrusted page evidence from the browser page for Comment 1.`;
    expect(extractMeaningfulPrompt(content)).toBe("这个样式加上阴影；删除这句提示");
  });

  it("excludes suggestion prompts even when capture adds leading whitespace", () => {
    expect(extractMeaningfulPrompt("\n# Overview\nGenerate 0 to 3 hyperpersonalized suggestions for the user")).toBeNull();
  });

  it("does not treat a negated user dependency as blocked", () => {
    expect(classifyReportedStatus("已完成并验证通过，不需要用户操作")).toBe("completed");
  });

  it("does not treat handoff prompts or design discussion as completed work", () => {
    expect(classifyReportedStatus("把下面整段发给其他 Agent：请完成开发。验收标准：测试通过。")).toBe("progress");
    expect(classifyReportedStatus("这就清楚了。你需要的是一套方案，完成后通过验证即可。")).toBe("progress");
    expect(classifyReportedStatus("已完成方案设计。验收标准：测试通过。")).toBe("progress");
    expect(classifyReportedStatus("建议下一步等待用户确认，否则无法继续。")).toBe("progress");
    expect(classifyReportedStatus("方案讨论。第一点。第二点。第三点。示例：已完成并测试通过。")).toBe("progress");
    expect(classifyReportedStatus("如果实现失败则需要用户确认。")).toBe("progress");
  });

  it("recognizes direct completion wording used by real Codex results", () => {
    expect(classifyReportedStatus("已定位并修复启动失败。构建与测试通过。")).toBe("completed");
    expect(classifyReportedStatus("你判断得对，所以我已经改成真正的原生 Android App。APK 已写入，SHA256 为 abcdef1234567，测试通过。")).toBe("completed");
    expect(classifyReportedStatus("**已完成**\n前后端构建与 144 项测试全部通过。")).toBe("completed");
    expect(classifyReportedStatus("**整理完成**\n已提交 9912c3d，npm run check 与测试通过。")).toBe("completed");
    expect(classifyReportedStatus("已恢复。前后端健康检查均返回 HTTP 200。")).toBe("completed");
    expect(classifyReportedStatus("已继续完成收口。npm run build 与 git diff --check 均通过。")).toBe("completed");
    expect(classifyReportedStatus("**已提交并继续**\n提交 a1bb5a2，测试通过。")).toBe("progress");
  });
});

function makePair({ sessionId, turnId }: { sessionId: string; turnId: string }): CapturedRecord[] {
  return [
    makeRecord({ session_id: sessionId, turn_id: turnId, event_id: `${turnId}-prompt` }),
    makeRecord({ session_id: sessionId, turn_id: turnId, event_id: `${turnId}-stop`, event: "Stop", content: "继续处理中" })
  ];
}

function makeRecord(overrides: Partial<CapturedRecord> = {}): CapturedRecord {
  return {
    schema_version: 1,
    event_id: "prompt",
    captured_at: "2026-07-17T09:00:00+08:00",
    date: "2026-07-17",
    source: "codex",
    event: "UserPromptSubmit",
    session_id: "session-a",
    turn_id: "turn-1",
    cwd: "C:\\demo-project",
    content: "请实现日历视图",
    sourcePath: "raw/codex/events/2026-07-17.jsonl",
    sourceLine: 1,
    ...overrides
  };
}
