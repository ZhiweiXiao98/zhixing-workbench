import { inRange } from "./time";
import type {
  ActivityEvent,
  ActivityFilters,
  CalendarDaySummary,
  DateRange,
  MetricResult,
  OutcomeAggregate,
  SourceRef,
  TaskAggregate
} from "./types";

const TASK_KINDS = new Set<ActivityEvent["kind"]>([
  "task_started",
  "task_progress",
  "task_completed",
  "task_blocked"
]);

export function aggregateTasks(events: ActivityEvent[]): TaskAggregate[] {
  const grouped = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    if (!event.taskKey || !TASK_KINDS.has(event.kind)) {
      continue;
    }
    const items = grouped.get(event.taskKey) ?? [];
    items.push(event);
    grouped.set(event.taskKey, items);
  }

  const tasks: TaskAggregate[] = [];
  for (const [taskKey, taskEvents] of grouped) {
    taskEvents.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const first = taskEvents[0];
    const latest = taskEvents.at(-1);
    if (!first || !latest) {
      continue;
    }
    const status = latest.kind === "task_completed"
      ? "completed"
      : latest.kind === "task_blocked"
        ? "blocked"
        : "active";
    tasks.push({
      taskKey,
      projectKey: latest.projectKey,
      projectLabel: latest.projectLabel,
      title: first.title,
      status,
      statusConfidence: latest.confidence,
      firstObservedAt: first.occurredAt,
      lastActivityAt: latest.observedAt,
      activeDates: [...new Set(taskEvents.map((event) => event.localDate))].sort(),
      eventIds: taskEvents.map((event) => event.id),
      sourceRefs: dedupeSourceRefs(taskEvents.flatMap((event) => event.sourceRefs)),
      turnCount: new Set(taskEvents.map((event) => `${event.sessionId ?? "unknown"}:${event.turnId ?? event.id}`)).size
    });
  }
  return tasks.sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
}

export function filterEvents(events: ActivityEvent[], range: DateRange, filters: ActivityFilters): ActivityEvent[] {
  return events.filter((event) => {
    if (!inRange(event.localDate, range)) {
      return false;
    }
    if (filters.projectKey !== "all" && event.projectKey !== filters.projectKey) {
      return false;
    }
    return filters.confidence === "all" || event.confidence === filters.confidence;
  });
}

export function summarizeCalendarDay(date: string, events: ActivityEvent[]): CalendarDaySummary {
  const dayEvents = events.filter((event) => event.localDate === date);
  const tasks = new Set(dayEvents.filter((event) => event.taskKey && TASK_KINDS.has(event.kind)).map((event) => event.taskKey)).size;
  const outputs = uniqueByIdentity(dayEvents.filter((event) => event.kind === "output_created")).length;
  const knowledge = uniqueKnowledgeByNote(dayEvents.filter((event) => event.kind === "knowledge_created" || event.kind === "knowledge_updated")).length;
  return { date, tasks, outputs, knowledge, events: dayEvents };
}

export function metricsForRange(
  events: ActivityEvent[],
  range: DateRange,
  filters: ActivityFilters,
  outcomes: readonly OutcomeAggregate[] = []
): MetricResult[] {
  const scoped = filterEvents(events, range, filters);
  const activity = activityUnits(scoped);
  const activityEvents = activity.map((unit) => unit.representative);
  const outputs = outcomes.length > 0
    ? outcomes
      .filter((outcome) => inRange(outcome.localDate, range))
      .filter((outcome) => filters.projectKey === "all" || outcome.projectKey === filters.projectKey)
      .map(outcomeMetricEvent)
      .filter((event) => filters.confidence === "all" || event.confidence === filters.confidence)
    : uniqueByIdentity(scoped.filter((event) => event.kind === "output_created"));
  const knowledge = uniqueKnowledgeByDate(scoped.filter((event) => event.kind === "knowledge_created" || event.kind === "knowledge_updated"));
  const reuse = uniqueByIdentity(scoped.filter((event) => event.kind === "knowledge_reused"));
  const switches = focusSwitchEvents(activity);
  const tasks = new Set(activity.map((unit) => unit.identity)).size;
  const projects = new Set(activityEvents.filter((event) => event.projectKey !== "unassigned").map((event) => event.projectKey)).size;
  const knowledgeNotes = new Map<string, ActivityEvent[]>();
  for (const event of knowledge) {
    const notePath = wikiNotePath(event) ?? event.objectKey ?? event.id;
    const items = knowledgeNotes.get(notePath) ?? [];
    items.push(event);
    knowledgeNotes.set(notePath, items);
  }
  const sourcedNotes = [...knowledgeNotes.values()].filter((items) => items.some((event) => event.sourceRefs.some((ref) => ref.type === "codex" || ref.type === "chatgpt" || ref.type === "feishu"))).length;
  const coverage = knowledgeNotes.size === 0 ? "暂无知识数据" : `来源覆盖 ${sourcedNotes}/${knowledgeNotes.size}`;
  const activeDays = new Set(activity.map((unit) => unit.anchor.localDate)).size;

  return [
    {
      dimension: "activity",
      label: "任务推进",
      value: activityEvents.length,
      note: `${tasks} 项任务或对话 · ${projects} 个已归属项目 · 每项每日计 1 次`,
      events: activityEvents
    },
    {
      dimension: "output",
      label: "产出",
      value: outputs.length,
      note: outputs.length === 0
        ? "暂无真实成果"
        : outcomes.length > 0
          ? "按同一真实任务合并 · 可展开底层证据"
          : "以 Git commit 等可核对事实计数",
      events: outputs
    },
    {
      dimension: "knowledge",
      label: "知识",
      value: knowledge.length,
      note: coverage,
      events: knowledge
    },
    {
      dimension: "reuse",
      label: "积累",
      value: reuse.length,
      note: reuse.length === 0 ? "暂无显式知识复用证据" : "显式 Wiki 引用 · 日期按修改时间估算",
      events: reuse
    },
    {
      dimension: "focus",
      label: "项目切换",
      value: switches.length,
      note: `按任务首次活动估算 · ${activeDays} 个活跃日 · 90 分钟内`,
      events: switches
    }
  ];
}

function outcomeMetricEvent(outcome: OutcomeAggregate): ActivityEvent {
  const confidence = outcome.proof === "independent"
    ? "verified"
    : outcome.proof === "target-present"
      ? "observed"
      : "reported";
  return {
    id: outcome.id,
    kind: "output_created",
    occurredAt: outcome.occurredAt,
    observedAt: outcome.occurredAt,
    localDate: outcome.localDate,
    timeBasis: "captured",
    title: outcome.title,
    summary: outcome.problem ? `${outcome.problem}\n${outcome.summary}` : outcome.summary,
    projectKey: outcome.projectKey,
    projectLabel: outcome.projectLabel,
    taskKey: outcome.taskKeys[0],
    objectKey: outcome.id,
    confidence,
    evidence: `${outcome.artifactIds.length} 条底层证据 · ${settlementEvidence(outcome)}`,
    sourceRefs: dedupeSourceRefs([...outcome.wikiRefs, ...outcome.sourceRefs])
  };
}

function settlementEvidence(outcome: OutcomeAggregate): string {
  switch (outcome.settlement.status) {
    case "succeeded": return "已沉淀为长期知识";
    case "pending": return "待沉淀";
    case "failed": return "沉淀失败，等待重试";
    case "not-applicable": return "无需单独沉淀";
  }
}

export function projectOptions(events: ActivityEvent[]): Array<{ key: string; label: string }> {
  const labels = new Map<string, string>();
  for (const event of events) {
    labels.set(event.projectKey, event.projectLabel);
  }
  return [...labels].map(([key, label]) => ({ key, label })).sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

export function eventDimension(event: ActivityEvent): "task" | "output" | "knowledge" | "reuse" | "research" {
  if (TASK_KINDS.has(event.kind)) {
    return "task";
  }
  if (event.kind === "output_created") {
    return "output";
  }
  if (event.kind === "knowledge_reused") {
    return "reuse";
  }
  if (event.kind === "research_activity") {
    return "research";
  }
  return "knowledge";
}

interface ActivityUnit {
  identity: string;
  anchor: ActivityEvent;
  representative: ActivityEvent;
}

function activityUnits(events: ActivityEvent[]): ActivityUnit[] {
  const grouped = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    if (!TASK_KINDS.has(event.kind) && event.kind !== "research_activity") {
      continue;
    }
    const identity = event.taskKey ?? `research:${event.sessionId ?? event.id}`;
    const key = `${event.localDate}:${identity}`;
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }
  return [...grouped.values()].map((group) => {
    group.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    const anchor = group[0] as ActivityEvent;
    const representative = [...group].sort((left, right) => {
      const priority = activityRepresentativePriority(right) - activityRepresentativePriority(left);
      return priority || right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id);
    })[0] as ActivityEvent;
    return {
      identity: anchor.taskKey ?? `research:${anchor.sessionId ?? anchor.id}`,
      anchor,
      representative
    };
  }).sort((left, right) => left.anchor.occurredAt.localeCompare(right.anchor.occurredAt) || left.identity.localeCompare(right.identity));
}

function activityRepresentativePriority(event: ActivityEvent): number {
  switch (event.kind) {
    case "task_blocked": return 4;
    case "task_completed": return 3;
    case "task_progress": return 2;
    case "task_started": return 1;
    default: return 0;
  }
}

function focusSwitchEvents(units: ActivityUnit[]): ActivityEvent[] {
  const candidates = units
    .map((unit) => unit.anchor)
    .filter((event) => event.projectKey !== "unassigned")
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
  const switches: ActivityEvent[] = [];
  let previous: ActivityEvent | undefined;
  for (const event of candidates) {
    if (!previous) {
      previous = event;
      continue;
    }
    const gapMinutes = (Date.parse(event.occurredAt) - Date.parse(previous.occurredAt)) / 60_000;
    if (event.localDate === previous.localDate && gapMinutes >= 0 && gapMinutes <= 90 && event.projectKey !== previous.projectKey) {
      switches.push(event);
    }
    previous = event;
  }
  return switches;
}

function uniqueKnowledgeByDate(events: ActivityEvent[]): ActivityEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.localDate}:${wikiNotePath(event) ?? event.objectKey ?? event.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueKnowledgeByNote(events: ActivityEvent[]): ActivityEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = wikiNotePath(event) ?? event.objectKey ?? event.id;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function wikiNotePath(event: ActivityEvent): string | undefined {
  return event.sourceRefs.find((ref) => ref.type === "wiki")?.path;
}

function uniqueByIdentity(events: ActivityEvent[]): ActivityEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = event.objectKey ?? event.id;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeSourceRefs(refs: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.type}:${ref.path ?? ref.url ?? ref.label}:${ref.line ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
