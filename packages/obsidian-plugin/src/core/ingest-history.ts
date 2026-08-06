import path from "node:path";
import { parseKnowledgeDigest } from "./knowledge-digest";
import type {
  KnowledgeIngestRun,
  KnowledgeIngestRunStatus,
  KnowledgeIngestTopicResult
} from "./types";

export interface IngestHistoryParseResult {
  run?: KnowledgeIngestRun;
  errors: string[];
}

const RUN_STATUSES = new Set<KnowledgeIngestRunStatus>([
  "running",
  "idle",
  "succeeded",
  "partial",
  "failed",
  "unknown"
]);

export function parseStructuredIngestHistory(text: string, sourcePath: string): IngestHistoryParseResult {
  const value = parseObject(text);
  if (!value) {
    return { errors: [`${sourcePath} 不是有效的整理记录 JSON`] };
  }
  const runId = stringValue(value.run_id);
  const startedAt = stringValue(value.started_at);
  const status = statusValue(value.status);
  if (!runId || !startedAt || !status) {
    return { errors: [`${sourcePath} 缺少 run_id、started_at 或有效 status`] };
  }
  return {
    run: {
      id: stringValue(value.attempt_id) || `history:${sourcePath}`,
      runId,
      startedAt,
      finishedAt: optionalString(value.finished_at),
      status,
      trigger: value.trigger === "automatic" ? "automatic" : "manual",
      selectedTopics: numberValue(value.selected_topics),
      committedTopics: numberValue(value.committed),
      skippedTopics: numberValue(value.skipped),
      pendingTopics: numberValue(value.pending),
      failedTopics: numberValue(value.failed),
      systemPairs: numberValue(value.system_committed_pairs),
      remainingTopics: numberValue(value.remaining_topics),
      remainingPairs: numberValue(value.remaining_pairs),
      cycleId: optionalString(value.cycle_id),
      batchIndex: numberValue(value.batch_index),
      tokensUsed: numberValue(value.tokens_used),
      inputChars: numberValue(value.input_chars),
      durationMs: numberValue(value.duration_ms),
      attemptCount: Array.isArray(value.attempts) ? value.attempts.length : status === "running" ? 0 : 1,
      topicResults: topicResults(value.topic_results),
      error: optionalString(value.error),
      logPath: optionalString(value.log_path),
      source: "structured"
    },
    errors: []
  };
}

export function parseLegacyIngestLog(text: string, sourcePath: string): IngestHistoryParseResult {
  const headerText = text.split(/\r?\n(?:\r?\n|\[(?:commit|codex_stdout|codex_stderr)\]\r?\n)/i)[0] ?? "";
  const header = new Map<string, string>();
  for (const line of headerText.split(/\r?\n/)) {
    const match = line.match(/^([a-z_]+)=(.*)$/i);
    if (match) {
      header.set(match[1] as string, (match[2] as string).trim());
    }
  }
  const startedAt = header.get("started_at") || timeFromLogName(sourcePath);
  if (!startedAt) {
    return { errors: [`${sourcePath} 无法识别开始时间`] };
  }
  const commit = commitCounts(text);
  const verified = header.get("verified_status");
  const status = verified && RUN_STATUSES.has(verified as KnowledgeIngestRunStatus)
    ? verified as KnowledgeIngestRunStatus
    : "unknown";
  const runId = header.get("run_id") || `legacy:${path.basename(sourcePath, ".log")}`;
  return {
    run: {
      id: `legacy:${sourcePath}`,
      runId,
      startedAt,
      finishedAt: header.get("finished_at"),
      status,
      trigger: header.get("trigger") === "automatic" || header.get("trigger") === "manual"
        ? header.get("trigger") as "automatic" | "manual"
        : "legacy",
      selectedTopics: numericHeader(header, "selected_topics", commit.selected_topics),
      committedTopics: numberValue(commit.committed),
      skippedTopics: numberValue(commit.skipped),
      pendingTopics: numberValue(commit.pending),
      failedTopics: numberValue(commit.failed),
      systemPairs: numberValue(commit.system_committed_pairs),
      remainingTopics: numberValue(commit.remaining_topics),
      remainingPairs: numberValue(commit.remaining_pairs),
      cycleId: header.get("cycle_id"),
      batchIndex: numericHeader(header, "batch_index", commit.batch_index),
      tokensUsed: numericHeader(header, "tokens_used", commit.tokens_used),
      inputChars: numericHeader(header, "input_chars", commit.input_chars),
      durationMs: numericHeader(header, "duration_ms", commit.duration_ms),
      attemptCount: 1,
      topicResults: [],
      logPath: sourcePath,
      source: "legacy-log"
    },
    errors: []
  };
}

export function parseCurrentIngestStatus(text: string): IngestHistoryParseResult {
  const value = parseObject(text);
  if (!value) {
    return { errors: ["最近整理状态不是有效 JSON"] };
  }
  const runId = stringValue(value.run_id);
  const updatedAt = stringValue(value.updated_at);
  const status = statusValue(value.status);
  if (!runId || !updatedAt || !status) {
    return { errors: ["最近整理状态缺少 run_id、updated_at 或有效 status"] };
  }
  return {
    run: {
      id: `current:${runId}:${updatedAt}`,
      runId,
      startedAt: updatedAt,
      status,
      trigger: automaticTime(updatedAt) ? "automatic" : "manual",
      selectedTopics: numberValue(value.selected_topics),
      committedTopics: numberValue(value.committed),
      skippedTopics: numberValue(value.skipped),
      pendingTopics: numberValue(value.pending),
      failedTopics: numberValue(value.failed),
      systemPairs: numberValue(value.system_committed_pairs),
      remainingTopics: numberValue(value.remaining_topics),
      remainingPairs: numberValue(value.remaining_pairs),
      cycleId: optionalString(value.cycle_id),
      batchIndex: numberValue(value.batch_index),
      tokensUsed: numberValue(value.tokens_used),
      inputChars: numberValue(value.input_chars),
      durationMs: numberValue(value.duration_ms),
      attemptCount: 1,
      topicResults: [],
      error: optionalString(value.error),
      source: "current-status"
    },
    errors: []
  };
}

export function mergeIngestRuns(
  structured: readonly KnowledgeIngestRun[],
  legacy: readonly KnowledgeIngestRun[],
  current?: KnowledgeIngestRun
): KnowledgeIngestRun[] {
  const structuredRunIds = new Set(structured.map((run) => run.runId));
  const merged = [
    ...structured,
    ...legacy.filter((run) => !structuredRunIds.has(run.runId))
  ];
  if (current && !structured.some((run) =>
    run.runId === current.runId &&
    run.status === current.status &&
    Math.abs(Date.parse(run.finishedAt || run.startedAt) - Date.parse(current.finishedAt || current.startedAt)) < 300_000
  )) {
    merged.push(current);
  }
  return merged
    .sort((left, right) =>
      (right.finishedAt || right.startedAt).localeCompare(left.finishedAt || left.startedAt) ||
      right.id.localeCompare(left.id))
    .slice(0, 80);
}

function topicResults(value: unknown): KnowledgeIngestTopicResult[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const id = stringValue(item.id);
    const status = stringValue(item.status);
    if (!id || !["succeeded", "pending", "failed", "not-applicable"].includes(status)) {
      return [];
    }
    return [{
      id,
      title: stringValue(item.title) || "未命名主题",
      status: status as KnowledgeIngestTopicResult["status"],
      reason: optionalString(item.reason),
      error: optionalString(item.error),
      wikiPaths: stringArray(item.wiki_paths),
      wikiChanges: wikiChanges(item.knowledge_changes),
      digest: parseKnowledgeDigest(item.digest),
      memoryPath: optionalString(item.memory_path),
      evidencePaths: stringArray(item.evidence_paths),
      dailyPaths: stringArray(item.daily_paths),
      sourceEventCount: numberValue(item.source_event_count)
    }];
  });
}

function wikiChanges(value: unknown): KnowledgeIngestTopicResult["wikiChanges"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item) || (item.action !== "created" && item.action !== "updated")) {
      return [];
    }
    const changePath = stringValue(item.path);
    if (!changePath) {
      return [];
    }
    return [{
      action: item.action,
      path: changePath,
      title: stringValue(item.title) || path.basename(changePath, ".md"),
      role: item.role === "memory" || item.role === "evidence" ? item.role : undefined
    }];
  });
}

function commitCounts(text: string): Record<string, unknown> {
  const match = text.match(/\r?\n\[commit\]\r?\n(\{[^\r\n]*\})/i);
  if (!match) {
    return {};
  }
  return parseObject(match[1] as string) ?? {};
}

function timeFromLogName(sourcePath: string): string | undefined {
  const match = path.basename(sourcePath).match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return match
    ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`
    : undefined;
}

function automaticTime(value: string): boolean {
  const time = value.match(/T(\d{2}):(\d{2})/)?.slice(1, 3).join(":");
  return Boolean(time && time >= "23:25" && time <= "23:35");
}

function numericHeader(header: Map<string, string>, key: string, fallback: unknown): number {
  const value = Number(header.get(key));
  return Number.isFinite(value) && value >= 0 ? value : numberValue(fallback);
}

function statusValue(value: unknown): KnowledgeIngestRunStatus | undefined {
  const status = stringValue(value) as KnowledgeIngestRunStatus;
  return RUN_STATUSES.has(status) ? status : undefined;
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())))]
    : [];
}

function optionalString(value: unknown): string | undefined {
  const valueString = stringValue(value);
  return valueString || undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
