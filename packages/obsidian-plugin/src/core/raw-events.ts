import { projectFromChatTitle, projectFromCwd, projectKeyFromLabel } from "./project";
import { toLocalDate } from "./time";
import {
  classifyReportedStatus,
  conciseSummary,
  conciseTitle,
  extractMeaningfulPrompt,
  isAutomationPrompt
} from "./text";
import type { ActivityEvent, ActivityKind, CapturedRecord, SessionTitle, SourceRef } from "./types";
import { reconcileExplicitWorkIdentities, reconcileNumberedTaskCopies } from "./task-identity";

export interface JsonlParseResult {
  records: CapturedRecord[];
  malformedLines: number;
}

export interface RawBuildResult {
  events: ActivityEvent[];
  duplicateRecords: number;
  excludedAutomations: number;
  excludedSupportingSessions: number;
  codexSessions: number;
  chatgptConversations: number;
  feishuRecords: number;
}

export function parseJsonl(text: string, sourcePath: string): JsonlParseResult {
  const records: CapturedRecord[] = [];
  let malformedLines = 0;
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    try {
      const value = JSON.parse(line) as Partial<CapturedRecord>;
      if (
        typeof value.event_id !== "string" ||
        typeof value.captured_at !== "string" ||
        Number.isNaN(Date.parse(value.captured_at)) ||
        typeof value.session_id !== "string" ||
        typeof value.turn_id !== "string" ||
        typeof value.event !== "string" ||
        typeof value.content !== "string"
      ) {
        malformedLines += 1;
        continue;
      }
      records.push({
        schema_version: typeof value.schema_version === "number" ? value.schema_version : 1,
        event_id: value.event_id,
        captured_at: value.captured_at,
        date: typeof value.date === "string" && isCalendarDate(value.date) ? value.date : toLocalDate(value.captured_at),
        source: typeof value.source === "string" ? value.source : "codex",
        event: value.event,
        session_id: value.session_id,
        turn_id: value.turn_id,
        cwd: typeof value.cwd === "string" ? value.cwd : "",
        content: value.content,
        conversation_id: typeof value.conversation_id === "string" ? value.conversation_id : undefined,
        title: typeof value.title === "string" ? value.title : undefined,
        url: typeof value.url === "string" ? value.url : undefined,
        occurred_at: typeof value.occurred_at === "string" ? value.occurred_at : undefined,
        updated_at: typeof value.updated_at === "string" ? value.updated_at : undefined,
        resource_type: typeof value.resource_type === "string" ? value.resource_type : undefined,
        resource_id: typeof value.resource_id === "string" ? value.resource_id : undefined,
        resource_version: typeof value.resource_version === "string" ? value.resource_version : undefined,
        resource_status: typeof value.resource_status === "string" ? value.resource_status : undefined,
        resource_url: typeof value.resource_url === "string" ? value.resource_url : undefined,
        project_hint: typeof value.project_hint === "string" ? value.project_hint : undefined,
        access_status: typeof value.access_status === "string" ? value.access_status : undefined,
        activity_kind: isActivityKind(value.activity_kind) ? value.activity_kind : undefined,
        identity_scope: typeof value.identity_scope === "string" ? value.identity_scope : undefined,
        untrusted_source: value.untrusted_source === true,
        sourcePath,
        sourceLine: index + 1
      });
    } catch {
      malformedLines += 1;
    }
  }

  return { records, malformedLines };
}

export function buildRawActivityEvents(
  input: CapturedRecord[],
  sessionTitles: ReadonlyMap<string, SessionTitle>
): RawBuildResult {
  const deduped = new Map<string, CapturedRecord>();
  for (const record of input) {
    deduped.set(record.event_id, record);
  }
  const duplicateRecords = input.length - deduped.size;

  const groups = new Map<string, CapturedRecord[]>();
  for (const record of deduped.values()) {
    if (record.source === "feishu") {
      continue;
    }
    const key = `${record.source}:${record.session_id}:${record.turn_id}`;
    const records = groups.get(key) ?? [];
    records.push(record);
    groups.set(key, records);
  }

  const events: ActivityEvent[] = [];
  const codexSessions = new Set<string>();
  const chatgptConversations = new Set<string>();
  let excludedAutomations = 0;
  let excludedSupportingSessions = 0;
  const feishuRecords = [...deduped.values()].filter((record) => record.source === "feishu");

  for (const record of feishuRecords) {
    const event = feishuActivityEvent(record);
    if (event) events.push(event);
  }

  const orderedGroups = [...groups.values()].sort((left, right) => firstTime(left).localeCompare(firstTime(right)));
  const seenTaskKeys = new Set<string>();

  for (const group of orderedGroups) {
    group.sort((left, right) => left.captured_at.localeCompare(right.captured_at));
    const prompts = group.filter((record) => record.event === "UserPromptSubmit");
    const stops = group.filter((record) => record.event === "Stop");
    const lastStop = stops.at(-1);
    const isChatgpt = group[0]?.source === "chatgpt_web";

    if (prompts.some((record) => isAutomationPrompt(record.content))) {
      excludedAutomations += 1;
      continue;
    }

    const meaningful = prompts
      .map((record) => ({ record, content: extractMeaningfulPrompt(record.content) }))
      .filter((entry): entry is { record: CapturedRecord; content: string } => Boolean(entry.content));
    if (meaningful.length === 0) {
      continue;
    }

    const firstPrompt = meaningful[0];
    if (!firstPrompt) {
      continue;
    }

    if (!isChatgpt && !sessionTitles.has(firstPrompt.record.session_id)) {
      excludedSupportingSessions += 1;
      continue;
    }

    const paired = Boolean(lastStop);
    const sourceType = isChatgpt ? "chatgpt" : "codex";
    const sessionId = isChatgpt
      ? firstPrompt.record.conversation_id ?? firstPrompt.record.session_id
      : firstPrompt.record.session_id;
    const sessionTitle = sessionTitles.get(firstPrompt.record.session_id)?.title;
    const title = sessionTitle ?? firstPrompt.record.title ?? conciseTitle(firstPrompt.content, sourceType === "codex" ? "Codex 任务" : "ChatGPT 对话");
    const project = isChatgpt
      ? projectFromChatTitle(firstPrompt.record.title)
      : projectFromCwd(firstPrompt.record.cwd) ?? { key: "unassigned", label: "未归属", inferred: true };
    const taskKey = `${sourceType}:${project.key}:${sessionId}`;
    const dailyPath = dailySourcePath(sourceType, firstPrompt.record.date);
    const sourceRefs: SourceRef[] = [
      {
        type: sourceType,
        label: sourceType === "codex" ? "Codex 来源页" : "ChatGPT 来源页",
        path: dailyPath,
        excerpt: conciseSummary(firstPrompt.content)
      },
      {
        type: sourceType,
        label: "原始事件",
        path: firstPrompt.record.sourcePath,
        line: firstPrompt.record.sourceLine,
        excerpt: conciseSummary(firstPrompt.content)
      }
    ];
    if (isChatgpt && firstPrompt.record.url) {
      sourceRefs.unshift({ type: "chatgpt", label: "打开 ChatGPT 对话", url: firstPrompt.record.url });
    }
    if (lastStop) {
      if (lastStop.date !== firstPrompt.record.date) {
        sourceRefs.push({
          type: sourceType,
          label: sourceType === "codex" ? "Codex 终态来源页" : "ChatGPT 回答来源页",
          path: dailySourcePath(sourceType, lastStop.date),
          excerpt: conciseSummary(lastStop.content)
        });
      }
      sourceRefs.push({
        type: sourceType,
        label: sourceType === "codex" ? "Codex Stop 事件" : "ChatGPT 回答事件",
        path: lastStop.sourcePath,
        line: lastStop.sourceLine,
        excerpt: conciseSummary(lastStop.content)
      });
    }

    const reportedStatus = classifyReportedStatus(lastStop?.content);
    const firstTaskTurn = !seenTaskKeys.has(taskKey);
    seenTaskKeys.add(taskKey);

    const occurredAt = firstPrompt.record.captured_at;
    const observedAt = lastStop?.captured_at ?? occurredAt;
    const promptSummary = meaningful.length > 1
      ? `${conciseSummary(firstPrompt.content)}（同一 turn 共 ${meaningful.length} 条指令）`
      : conciseSummary(firstPrompt.content);
    events.push({
      id: `turn:${sourceType}:${firstPrompt.record.session_id}:${firstPrompt.record.turn_id}`,
      kind: isChatgpt ? "research_activity" : firstTaskTurn ? "task_started" : "task_progress",
      occurredAt,
      observedAt,
      localDate: toLocalDate(occurredAt),
      timeBasis: "captured",
      title: conciseTitle(title, "未命名活动"),
      summary: promptSummary,
      projectKey: project.key,
      projectLabel: project.label,
      taskKey: isChatgpt ? undefined : taskKey,
      sessionId,
      turnId: firstPrompt.record.turn_id,
      confidence: paired ? "observed" : "inferred",
      evidence: isChatgpt
        ? paired ? "已捕获完整 ChatGPT 问答" : "仅捕获到用户消息"
        : paired ? "已捕获完整 Codex turn" : "仅捕获到任务指令，未发现 Stop 事件",
      sourceRefs
    });
    if (!isChatgpt && lastStop && (reportedStatus === "blocked" || reportedStatus === "completed")) {
      events.push({
        id: `turn-outcome:${sourceType}:${firstPrompt.record.session_id}:${firstPrompt.record.turn_id}`,
        kind: reportedStatus === "blocked" ? "task_blocked" : "task_completed",
        occurredAt: lastStop.captured_at,
        observedAt: lastStop.captured_at,
        localDate: toLocalDate(lastStop.captured_at),
        timeBasis: "captured",
        title: conciseTitle(title, "未命名活动"),
        summary: conciseSummary(lastStop.content),
        projectKey: project.key,
        projectLabel: project.label,
        taskKey,
        sessionId,
        turnId: firstPrompt.record.turn_id,
        confidence: "reported",
        evidence: reportedStatus === "blocked"
          ? "Codex 最终回答报告任务受阻"
          : "最终回答报告完成并包含验证描述，尚未与独立产出绑定",
        sourceRefs
      });
    }
    if (isChatgpt) {
      chatgptConversations.add(sessionId);
    } else {
      codexSessions.add(sessionId);
    }
  }

  return {
    events: reconcileExplicitWorkIdentities(reconcileNumberedTaskCopies(events)),
    duplicateRecords,
    excludedAutomations,
    excludedSupportingSessions,
    codexSessions: codexSessions.size,
    chatgptConversations: chatgptConversations.size,
    feishuRecords: feishuRecords.length
  };
}

function feishuActivityEvent(record: CapturedRecord): ActivityEvent | undefined {
  if (!record.resource_type || !record.resource_id) return undefined;
  const occurredAt = validTime(record.occurred_at) ? record.occurred_at! : record.captured_at;
  const observedAt = validTime(record.updated_at) ? record.updated_at! : record.captured_at;
  const label = record.project_hint?.trim() || record.cwd.trim() || "飞书";
  const projectKey = projectKeyFromLabel(label);
  const kind = record.activity_kind ?? inferFeishuKind(record.resource_type, record.resource_status);
  const isTask = kind === "task_started" || kind === "task_progress" || kind === "task_completed" || kind === "task_blocked";
  const dailyPath = `raw/feishu/daily/${record.date}.md`;
  const sourceRefs: SourceRef[] = [
    { type: "feishu", label: "飞书每日来源", path: dailyPath, excerpt: conciseSummary(record.content) },
    { type: "feishu", label: "飞书原始事件", path: record.sourcePath, line: record.sourceLine, excerpt: conciseSummary(record.content) }
  ];
  if (record.resource_url) sourceRefs.unshift({ type: "feishu", label: "打开飞书来源", url: record.resource_url });
  return {
    id: `feishu:${record.event_id}`,
    kind,
    occurredAt,
    observedAt,
    localDate: toLocalDate(occurredAt),
    timeBasis: "source",
    title: conciseTitle(record.title || record.content, "飞书活动"),
    summary: conciseSummary(record.content),
    projectKey,
    projectLabel: label,
    taskKey: isTask ? `feishu:${projectKey}:${record.resource_type}:${record.resource_id}` : undefined,
    objectKey: `feishu:${record.resource_type}:${record.resource_id}`,
    sessionId: record.session_id,
    turnId: record.turn_id,
    confidence: record.access_status === "available" ? "observed" : "reported",
    evidence: record.access_status === "available"
      ? `飞书只读同步已捕获${feishuSourceLabel(record.resource_type)}及来源版本`
      : "飞书来源已删除或访问权限被撤回，历史证据仅供追溯",
    sourceRefs
  };
}

function inferFeishuKind(resourceType: string, status?: string): ActivityKind {
  const value = String(status || "");
  if (resourceType === "tasks" || resourceType === "base") {
    if (/完成|done|completed|closed/i.test(value)) return "task_completed";
    if (/阻塞|blocked|暂停/i.test(value)) return "task_blocked";
    return "task_progress";
  }
  if (resourceType === "minutes" || resourceType === "documents") return "knowledge_updated";
  if (resourceType === "approvals") return "output_created";
  return "research_activity";
}

function isActivityKind(value: unknown): value is ActivityKind {
  return typeof value === "string" && [
    "task_started", "task_progress", "task_completed", "task_blocked", "research_activity",
    "output_created", "knowledge_created", "knowledge_updated", "knowledge_reused"
  ].includes(value);
}

function validTime(value?: string): boolean {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function feishuSourceLabel(value: string): string {
  return ({ tasks: "任务", calendar: "日程", meetings: "会议", minutes: "会议纪要", documents: "文档或 Wiki",
    base: "Base 记录", approvals: "审批结果", messages: "项目群消息" } as Record<string, string>)[value] || "活动";
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function firstTime(records: CapturedRecord[]): string {
  return records.reduce((earliest, record) => record.captured_at < earliest ? record.captured_at : earliest, records[0]?.captured_at ?? "");
}

function dailySourcePath(source: "codex" | "chatgpt", date: string): string {
  return `raw/${source}/daily/${date}.md`;
}
