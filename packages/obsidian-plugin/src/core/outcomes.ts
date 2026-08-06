import { createHash } from "node:crypto";
import path from "node:path";
import { toLocalDate } from "./time";
import type {
  ArtifactProof,
  ArtifactRecord,
  ActivityEvent,
  KnowledgeSettlement,
  OutcomeAggregate,
  SourceRef
} from "./types";

export function aggregateOutcomes(
  artifacts: readonly ArtifactRecord[],
  settlements: readonly KnowledgeSettlement[],
  events: readonly ActivityEvent[] = []
): OutcomeAggregate[] {
  const groups = connectedArtifactGroups(artifacts);
  const artifactEventIds = new Set(artifacts.flatMap((artifact) => artifact.sourceEventIds));
  const artifactOutcomes = groups.map((group) => buildOutcome(group, settlements, events));
  const settlementOutcomes = settlements
    .filter((settlement) =>
      settlement.status === "succeeded" ||
      settlement.status === "failed" ||
      settlement.category === "durable-output")
    .filter((settlement) => !settlement.sourceEventIds.some((eventId) => artifactEventIds.has(eventId)))
    .map((settlement) => buildSettlementOutcome(settlement, events));
  return [...artifactOutcomes, ...settlementOutcomes]
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
}

function connectedArtifactGroups(artifacts: readonly ArtifactRecord[]): ArtifactRecord[][] {
  const buckets = new Map<string, ArtifactRecord[]>();
  for (const artifact of artifacts) {
    const key = `${artifact.localDate}\u0000${artifact.projectKey}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(artifact);
    buckets.set(key, bucket);
  }

  const groups: ArtifactRecord[][] = [];
  for (const bucket of buckets.values()) {
    const remaining = new Set(bucket);
    while (remaining.size > 0) {
      const seed = remaining.values().next().value as ArtifactRecord;
      const group: ArtifactRecord[] = [];
      const queue = [seed];
      remaining.delete(seed);
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
          continue;
        }
        group.push(current);
        for (const candidate of remaining) {
          if (sameOutcome(current, candidate)) {
            remaining.delete(candidate);
            queue.push(candidate);
          }
        }
      }
      groups.push(group);
    }
  }
  return groups;
}

function sameOutcome(left: ArtifactRecord, right: ArtifactRecord): boolean {
  if (left.taskKey && right.taskKey && left.taskKey === right.taskKey) {
    return true;
  }
  if (intersects(left.sourceEventIds, right.sourceEventIds)) {
    return true;
  }
  const leftAnchor = strongestAnchor(left);
  const rightAnchor = strongestAnchor(right);
  if (leftAnchor && rightAnchor && leftAnchor === rightAnchor) {
    return true;
  }
  if (normalizedTitle(left.title) === normalizedTitle(right.title)) {
    return true;
  }
  const leftFiles = changedFiles(left);
  const rightFiles = changedFiles(right);
  if (leftFiles.size === 0 || rightFiles.size === 0) {
    return false;
  }
  const overlap = [...leftFiles].filter((file) => rightFiles.has(file)).length;
  const smaller = Math.min(leftFiles.size, rightFiles.size);
  if (overlap >= 2 || (smaller > 0 && overlap / smaller >= 0.6)) {
    return titleTokens(left.title).some((token) => titleTokens(right.title).includes(token));
  }
  return false;
}

function buildOutcome(
  artifacts: ArtifactRecord[],
  settlements: readonly KnowledgeSettlement[],
  events: readonly ActivityEvent[]
): OutcomeAggregate {
  artifacts.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
  const sourceEventIds = unique(artifacts.flatMap((artifact) => artifact.sourceEventIds));
  const matchedSettlements = settlements.filter((settlement) => intersects(sourceEventIds, settlement.sourceEventIds));
  const settlement = selectSettlement(matchedSettlements);
  const wikiPaths = unique(matchedSettlements.flatMap((item) => item.wikiPaths));
  const memoryPath = settlement?.memoryPath ?? matchedSettlements.find((item) => item.memoryPath)?.memoryPath;
  const evidencePaths = unique(matchedSettlements.flatMap((item) =>
    item.evidencePaths?.length ? item.evidencePaths : item.wikiPaths.filter((wikiPath) => wikiPath !== item.memoryPath)
  ));
  const wikiRefs = wikiPaths.map((wikiPath) => ({
    type: "wiki" as const,
    label: fileTitle(wikiPath),
    path: wikiPath
  }));
  const titleArtifact = preferredTitleArtifact(artifacts);
  const identity = stableGroupIdentity(artifacts);
  const generatedId = `outcome:${createHash("sha256")
    .update(`${titleArtifact.localDate}\u0000${titleArtifact.projectKey}\u0000${identity}`)
    .digest("hex")
    .slice(0, 20)}`;
  const id = settlement?.id || generatedId;
  const relatedTaskEvents = events.filter((event) =>
    event.localDate === titleArtifact.localDate &&
    event.projectKey === titleArtifact.projectKey &&
    Boolean(event.taskKey && artifacts.some((artifact) => artifact.taskKey === event.taskKey))
  );

  return {
    id,
    localDate: titleArtifact.localDate,
    occurredAt: artifacts.at(-1)?.occurredAt ?? titleArtifact.occurredAt,
    projectKey: titleArtifact.projectKey,
    projectLabel: titleArtifact.projectLabel,
    title: titleArtifact.title,
    problem: outcomeProblem(artifacts, relatedTaskEvents),
    summary: outcomeSummary(artifacts),
    proof: strongestProof(artifacts),
    taskKeys: unique(artifacts.map((artifact) => artifact.taskKey).filter((value): value is string => Boolean(value))),
    artifactIds: artifacts.map((artifact) => artifact.id),
    eventIds: sourceEventIds,
    sourceRefs: uniqueBy(artifacts.flatMap((artifact) => artifact.sourceRefs), sourceKey),
    wikiRefs,
    memoryRef: memoryPath ? wikiReference(memoryPath) : undefined,
    evidenceRefs: evidencePaths.map(wikiReference),
    knowledgeChanges: uniqueBy(matchedSettlements.flatMap((item) => item.knowledgeChanges), (item) => `${item.action}:${item.path}`),
    digest: settlement?.digest ?? matchedSettlements.find((item) => item.digest)?.digest,
    settlement: {
      status: settlement?.status ?? defaultSettlementStatus(artifacts),
      updatedAt: settlement?.updatedAt,
      error: settlement?.lastError,
      reason: settlement?.reason,
      category: settlement?.category
    },
    reuseCount: unique(matchedSettlements.flatMap((item) => item.reusedByOutcomeIds ?? [])).length
  };
}

function buildSettlementOutcome(
  settlement: KnowledgeSettlement,
  events: readonly ActivityEvent[]
): OutcomeAggregate {
  const relatedEvents = events
    .filter((event) => settlement.sourceEventIds.some((sourceId) => sourceIdMatchesEvent(sourceId, event)))
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const representative = relatedEvents.at(-1);
  const firstKnowledge = settlement.knowledgeChanges[0];
  const title = settlement.title ?? (settlement.status === "failed"
    ? `知识沉淀失败：${representative?.title ?? firstKnowledge?.title ?? "待重试任务"}`
    : settlement.knowledgeChanges.length > 1
      ? `沉淀 ${firstKnowledge?.title ?? "长期知识"}等 ${settlement.knowledgeChanges.length} 项经验`
      : firstKnowledge?.title ?? representative?.title ?? "长期知识沉淀");
  const wikiRefs = unique(settlement.wikiPaths).map((wikiPath) => ({
    type: "wiki" as const,
    label: fileTitle(wikiPath),
    path: wikiPath
  }));
  const occurredAt = representative?.observedAt ?? settlement.occurredAt ?? settlement.updatedAt;
  const projectLabel = representative?.projectLabel ?? settlement.projectLabel ?? "未归属";
  const dailyRefs = (settlement.dailyPaths ?? []).map((dailyPath) => ({
    type: "file" as const,
    label: fileTitle(dailyPath),
    path: dailyPath
  }));
  return {
    id: settlement.id,
    localDate: representative?.localDate ?? settlement.localDate ?? toLocalDate(settlement.updatedAt),
    occurredAt,
    projectKey: representative?.projectKey ?? normalizedProjectKey(projectLabel),
    projectLabel,
    title,
    problem: relatedEvents.find((event) => event.kind === "task_started" || event.kind === "task_progress")?.summary,
    summary: settlement.reason
      ?? (settlement.status === "failed"
        ? settlement.lastError || "知识写入失败，已保留待重试状态。"
        : settlement.knowledgeChanges.map((change) => `${change.action === "created" ? "新增" : "更新"}《${change.title}》`).join("；")),
    proof: settlement.status === "succeeded" ? "target-present" : "report-only",
    taskKeys: unique(relatedEvents.map((event) => event.taskKey)),
    artifactIds: [],
    eventIds: settlement.sourceEventIds,
    sourceRefs: uniqueBy([...relatedEvents.flatMap((event) => event.sourceRefs), ...dailyRefs], sourceKey),
    wikiRefs,
    memoryRef: settlement.memoryPath ? wikiReference(settlement.memoryPath) : undefined,
    evidenceRefs: unique(settlement.evidencePaths?.length
      ? settlement.evidencePaths
      : settlement.wikiPaths.filter((wikiPath) => wikiPath !== settlement.memoryPath)).map(wikiReference),
    knowledgeChanges: settlement.knowledgeChanges,
    digest: settlement.digest,
    settlement: {
      status: settlement.status,
      updatedAt: settlement.updatedAt,
      error: settlement.lastError,
      reason: settlement.reason,
      category: settlement.category
    },
    reuseCount: unique(settlement.reusedByOutcomeIds ?? []).length
  };
}

function wikiReference(wikiPath: string): SourceRef {
  return {
    type: "wiki",
    label: fileTitle(wikiPath),
    path: wikiPath
  };
}

function normalizedProjectKey(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, "-") || "unassigned";
}

function preferredTitleArtifact(artifacts: ArtifactRecord[]): ArtifactRecord {
  return [...artifacts].sort((left, right) => {
    const taskOrder = Number(Boolean(right.taskKey)) - Number(Boolean(left.taskKey));
    if (taskOrder !== 0) {
      return taskOrder;
    }
    const reportOrder = artifactTitlePriority(right) - artifactTitlePriority(left);
    return reportOrder || right.occurredAt.localeCompare(left.occurredAt);
  })[0] as ArtifactRecord;
}

function artifactTitlePriority(artifact: ArtifactRecord): number {
  if (artifact.kind === "completion-report" || artifact.kind === "file-deliverable") {
    return 3;
  }
  if (artifact.kind === "knowledge-note") {
    return 2;
  }
  return 1;
}

function outcomeSummary(artifacts: ArtifactRecord[]): string {
  const parts = unique(artifacts.flatMap((artifact) => {
    const problem = artifact.problem?.split(/\r?\n/).find(Boolean);
    const result = artifact.result.split(/\r?\n/).find(Boolean);
    return [problem, result].filter((value): value is string => Boolean(value));
  }));
  return parts.slice(0, 6).join("\n").slice(0, 1_600) || "已形成可追溯的工作成果。";
}

function strongestProof(artifacts: ArtifactRecord[]): ArtifactProof {
  if (artifacts.some((artifact) => artifact.proof === "independent")) {
    return "independent";
  }
  if (artifacts.some((artifact) => artifact.proof === "target-present")) {
    return "target-present";
  }
  return "report-only";
}

function selectSettlement(settlements: readonly KnowledgeSettlement[]): KnowledgeSettlement | undefined {
  return [...settlements].sort((left, right) => {
    const timeOrder = right.updatedAt.localeCompare(left.updatedAt);
    return timeOrder || settlementPriority(right.status) - settlementPriority(left.status);
  })[0];
}

function settlementPriority(status: KnowledgeSettlement["status"]): number {
  switch (status) {
    case "failed": return 4;
    case "pending": return 3;
    case "succeeded": return 2;
    case "not-applicable": return 1;
  }
}

function changedFiles(artifact: ArtifactRecord): Set<string> {
  return new Set(artifact.sourceRefs
    .filter((source) => source.type === "file")
    .map((source) => source.label.replace(/\\/g, "/").toLocaleLowerCase()));
}

function strongestAnchor(artifact: ArtifactRecord): string | undefined {
  if (artifact.taskKey) {
    return `task:${artifact.taskKey}`;
  }
  const searchable = [
    artifact.title,
    artifact.result,
    ...artifact.sourceRefs.flatMap((source) => [source.label, source.path, source.excerpt].filter(Boolean))
  ].join("\n").replace(/\\/g, "/");
  const taskFolder = searchable.match(/(?:^|\/)\.agent\/tasks\/([a-z0-9][a-z0-9._-]*)/i)?.[1];
  if (taskFolder) {
    return `agent-task:${taskFolder.toLocaleLowerCase()}`;
  }
  const issue = searchable.match(/\b(?:issue|议题|问题单)\s*#?(\d{1,8})\b/i)?.[1];
  return issue ? `issue:${issue}` : undefined;
}

function stableGroupIdentity(artifacts: readonly ArtifactRecord[]): string {
  const anchors = unique(artifacts.map(strongestAnchor)).sort();
  if (anchors[0]) {
    return anchors[0];
  }
  return normalizedTitle(preferredTitleArtifact([...artifacts]).title)
    || artifacts.map((artifact) => artifact.id).sort()[0]
    || "unknown";
}

function outcomeProblem(artifacts: readonly ArtifactRecord[], events: readonly ActivityEvent[]): string | undefined {
  const explicit = unique(artifacts.map((artifact) => artifact.problem).filter((value): value is string => Boolean(value)));
  if (explicit.length > 0) {
    return explicit.slice(0, 3).join("\n").slice(0, 1_200);
  }
  const taskSummary = events.find((event) => event.kind === "task_started" || event.kind === "task_progress")?.summary;
  return taskSummary?.trim() || undefined;
}

function defaultSettlementStatus(artifacts: readonly ArtifactRecord[]): KnowledgeSettlement["status"] {
  const hasTaskContext = artifacts.some((artifact) => Boolean(artifact.taskKey || artifact.problem));
  return artifacts.length > 1 || hasTaskContext ? "pending" : "not-applicable";
}

function titleTokens(value: string): string[] {
  return normalizedTitle(value)
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((token) => token.length >= 2)
    .filter((token) => !/^(?:修复|完成|新增|更新|优化|调整|验证|fix|feat|docs|test|chore)$/i.test(token));
}

function normalizedTitle(value: string): string {
  return value.normalize("NFKC")
    .replace(/^(?:fix|feat|docs|test|chore|refactor|style|perf)(?:\([^)]*\))?\s*[:：]\s*/i, "")
    .replace(/\s*\((?:[2-9]|\d{2,})\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function fileTitle(value: string): string {
  return path.basename(value).replace(/\.md$/i, "") || "知识笔记";
}

function sourceIdMatchesEvent(sourceId: string, event: ActivityEvent): boolean {
  return Boolean(event.sessionId && event.turnId && sourceId.startsWith(`${event.sessionId}:${event.turnId}:`));
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const values = new Set(left);
  return right.some((value) => values.has(value));
}

function sourceKey(source: SourceRef): string {
  return `${source.type}:${source.path ?? ""}:${source.url ?? ""}:${source.line ?? ""}`;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const itemKey = key(value);
    if (seen.has(itemKey)) {
      return false;
    }
    seen.add(itemKey);
    return true;
  });
}
