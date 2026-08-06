import type { ActivityEvent } from "./types";

const TASK_KINDS = new Set<ActivityEvent["kind"]>([
  "task_started",
  "task_progress",
  "task_completed",
  "task_blocked"
]);
const MAX_TASK_COPY_GAP_MS = 14 * 24 * 60 * 60 * 1000;

interface SessionTask {
  taskKey: string;
  projectKey: string;
  title: string;
  normalizedTitle: string;
  numbered: boolean;
  firstAt: string;
  events: ActivityEvent[];
}

export function reconcileNumberedTaskCopies(events: readonly ActivityEvent[]): ActivityEvent[] {
  const sessions = sessionTasks(events);
  const identities = new Map<string, SessionTask[]>();
  for (const session of sessions) {
    const key = `${session.projectKey}\u0000${session.normalizedTitle}`;
    const group = identities.get(key) ?? [];
    group.push(session);
    identities.set(key, group);
  }

  const replacement = new Map<string, { taskKey: string; title: string; firstStartId?: string }>();
  for (const group of identities.values()) {
    group.sort((left, right) => left.firstAt.localeCompare(right.firstAt) || left.taskKey.localeCompare(right.taskKey));
    for (const cluster of contiguousTaskCopies(group)) {
      const sessionIds = new Set(cluster.flatMap((session) => session.events.map((event) => event.sessionId).filter(Boolean)));
      if (cluster.length < 2 || sessionIds.size < 2 || !cluster.some((session) => session.numbered)) {
        continue;
      }
      const canonical = cluster.find((session) => !session.numbered) ?? cluster[0];
      if (!canonical) {
        continue;
      }
      const mergedEvents = cluster.flatMap((session) => session.events)
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
      const firstStartId = mergedEvents.find((event) => event.kind === "task_started")?.id;
      const canonicalSession = canonical.events.find((event) => event.sessionId)?.sessionId ?? canonical.taskKey;
      const taskKey = `codex:${canonical.projectKey}:${encodeURIComponent(canonical.normalizedTitle)}:${canonicalSession}`;
      for (const session of cluster) {
        replacement.set(session.taskKey, { taskKey, title: canonical.title, firstStartId });
      }
    }
  }

  return events.map((event) => {
    if (!event.taskKey || !TASK_KINDS.has(event.kind)) {
      return event;
    }
    const merged = replacement.get(event.taskKey);
    if (!merged) {
      return event;
    }
    return {
      ...event,
      taskKey: merged.taskKey,
      title: merged.title,
      kind: event.kind === "task_started" && event.id !== merged.firstStartId ? "task_progress" : event.kind
    };
  });
}

export function reconcileExplicitWorkIdentities(events: readonly ActivityEvent[]): ActivityEvent[] {
  const groups = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    if (!event.taskKey || !TASK_KINDS.has(event.kind)) continue;
    const identifier = explicitWorkIdentifier(event);
    if (!identifier) continue;
    const key = `${event.projectKey}:${identifier}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const replacement = new Map<string, { taskKey: string; firstStartId?: string; title: string }>();
  for (const [identity, group] of groups) {
    const taskKeys = new Set(group.map((event) => event.taskKey).filter((value): value is string => Boolean(value)));
    const sourceTypes = new Set(group.flatMap((event) => event.sourceRefs.map((source) => source.type)));
    if (taskKeys.size < 2 || sourceTypes.size < 2) continue;
    group.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    const firstStartId = group.find((event) => event.kind === "task_started")?.id;
    const title = group.find((event) => event.sourceRefs.some((source) => source.type === "codex"))?.title ?? group[0]?.title ?? "未命名任务";
    for (const taskKey of taskKeys) replacement.set(taskKey, { taskKey: `work:${identity}`, firstStartId, title });
  }
  return events.map((event) => {
    const merged = event.taskKey ? replacement.get(event.taskKey) : undefined;
    if (!merged) return event;
    return {
      ...event,
      taskKey: merged.taskKey,
      title: merged.title,
      kind: event.kind === "task_started" && event.id !== merged.firstStartId ? "task_progress" : event.kind
    };
  });
}

function explicitWorkIdentifier(event: ActivityEvent): string | undefined {
  const text = [event.title, event.summary, ...event.sourceRefs.map((source) => `${source.url || ""} ${source.excerpt || ""}`)].join("\n");
  const issue = text.match(/(?:\bissue\s*#?|\/issues\/)(\d{1,8})\b/i)?.[1];
  if (issue) return `issue:${issue}`;
  const task = text.match(/(?:\b(?:task|任务|工单)\s*(?:id)?\s*[:：#]?|\/tasks\/)([a-z0-9][a-z0-9._-]{3,80})\b/i)?.[1];
  return task ? `task:${task.toLocaleLowerCase()}` : undefined;
}

function contiguousTaskCopies(group: SessionTask[]): SessionTask[][] {
  const clusters: SessionTask[][] = [];
  for (const session of group) {
    const current = clusters.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous || timeGap(previous.firstAt, session.firstAt) > MAX_TASK_COPY_GAP_MS) {
      clusters.push([session]);
    } else {
      current.push(session);
    }
  }
  return clusters;
}

function timeGap(left: string, right: string): number {
  const gap = Date.parse(right) - Date.parse(left);
  return Number.isFinite(gap) && gap >= 0 ? gap : Number.POSITIVE_INFINITY;
}

export function stripTaskCopySuffix(title: string): { title: string; numbered: boolean } {
  const normalized = title.normalize("NFKC").replace(/\s+/g, " ").trim();
  const stripped = normalized.replace(/\s*\((?:[2-9]|\d{2,})\)\s*$/, "").trim();
  return { title: stripped || normalized, numbered: stripped !== normalized };
}

function sessionTasks(events: readonly ActivityEvent[]): SessionTask[] {
  const grouped = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    if (!event.taskKey || !TASK_KINDS.has(event.kind)) {
      continue;
    }
    const group = grouped.get(event.taskKey) ?? [];
    group.push(event);
    grouped.set(event.taskKey, group);
  }
  const sessions: SessionTask[] = [];
  for (const [taskKey, taskEvents] of grouped) {
    taskEvents.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    const first = taskEvents[0];
    if (!first) {
      continue;
    }
    const parsed = stripTaskCopySuffix(first.title);
    sessions.push({
      taskKey,
      projectKey: first.projectKey,
      title: parsed.title,
      normalizedTitle: parsed.title.toLocaleLowerCase(),
      numbered: parsed.numbered,
      firstAt: first.occurredAt,
      events: taskEvents
    });
  }
  return sessions;
}
