import type { KnowledgeChange, KnowledgeQueueStatus, KnowledgeSettlement, SettlementStatus } from "./types";
import { parseKnowledgeDigest } from "./knowledge-digest";

export interface KnowledgeLedgerParseResult {
  settlements: KnowledgeSettlement[];
  errors: string[];
}

const STATUSES = new Set<SettlementStatus>(["succeeded", "pending", "failed", "not-applicable"]);

export function parseKnowledgeLedger(text: string): KnowledgeLedgerParseResult {
  if (!text.trim()) {
    return { settlements: [], errors: [] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { settlements: [], errors: ["知识沉淀账本不是有效 JSON"] };
  }
  if (!isRecord(value) || !Array.isArray(value.outcomes)) {
    return { settlements: [], errors: ["知识沉淀账本缺少 outcomes 数组"] };
  }

  const settlements: KnowledgeSettlement[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.outcomes.entries()) {
    if (!isRecord(item)) {
      errors.push(`outcomes[${index}] 不是对象`);
      continue;
    }
    const id = stringValue(item.id);
    const status = stringValue(item.status) as SettlementStatus;
    const sourceEventIds = stringArray(item.source_event_ids);
    const wikiPaths = stringArray(item.wiki_paths);
    const updatedAt = stringValue(item.updated_at);
    if (!id || seen.has(id) || !STATUSES.has(status) || sourceEventIds.length === 0 || !updatedAt) {
      errors.push(`outcomes[${index}] 缺少有效的 id、status、source_event_ids 或 updated_at`);
      continue;
    }
    if (status === "succeeded" && wikiPaths.length === 0) {
      errors.push(`outcomes[${index}] 已沉淀但没有 wiki_paths`);
      continue;
    }
    seen.add(id);
    settlements.push({
      id,
      status,
      sourceEventIds,
      wikiPaths,
      knowledgeChanges: knowledgeChanges(item.knowledge_changes),
      updatedAt,
      lastError: optionalString(item.last_error),
      reason: optionalString(item.reason),
      reusedByOutcomeIds: stringArray(item.reused_by_outcome_ids),
      category: optionalString(item.category),
      title: optionalString(item.title),
      localDate: optionalString(item.local_date),
      occurredAt: optionalString(item.occurred_at),
      projectLabel: optionalString(item.project_label),
      dailyPaths: stringArray(item.daily_paths),
      digest: parseKnowledgeDigest(item.digest),
      memoryPath: optionalString(item.memory_path),
      evidencePaths: stringArray(item.evidence_paths)
    });
  }
  return { settlements, errors };
}

export function parseKnowledgeQueueStatus(text: string): KnowledgeQueueStatus | undefined {
  if (!text.trim()) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) {
      return undefined;
    }
    return {
      rawPendingPairs: numberValue(value.raw_pending_pairs),
      candidatePairs: numberValue(value.candidate_pairs),
      candidateTopics: numberValue(value.candidate_topics),
      openTopics: numberValue(value.open_topics),
      readyTopics: numberValue(value.ready_topics, numberValue(value.candidate_topics)),
      retryTopics: numberValue(value.retry_topics),
      coolingRetryTopics: numberValue(value.cooling_retry_topics),
      backlogTopics: numberValue(value.backlog_topics),
      recentTopics: numberValue(value.recent_topics),
      partialTopics: numberValue(value.partial_topics),
      needsCompactionTopics: numberValue(value.needs_compaction_topics),
      selectedTopics: numberValue(value.selected_topics),
      selectedChars: numberValue(value.selected_chars),
      deferredTopics: numberValue(value.deferred_topics),
      noOpAutomationPairs: numberValue(value.no_op_automation_pairs),
      substantiveAutomationPairs: numberValue(value.substantive_automation_pairs),
      supportingPairs: numberValue(value.supporting_pairs),
      remainingPairs: numberValue(value.remaining_pairs, numberValue(value.raw_pending_pairs)),
      remainingTopics: numberValue(value.remaining_topics, numberValue(value.candidate_topics))
    };
  } catch {
    return undefined;
  }
}

function knowledgeChanges(value: unknown): KnowledgeChange[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const action = stringValue(item.action);
    const path = stringValue(item.path);
    if ((action !== "created" && action !== "updated") || !path) {
      return [];
    }
    return [{
      action,
      path,
      title: stringValue(item.title) || fileTitle(path),
      role: item.role === "memory" || item.role === "evidence" ? item.role : undefined
    }];
  });
}

function fileTitle(path: string): string {
  return path.split(/[\\/]/).at(-1)?.replace(/\.md$/i, "") || "知识笔记";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())))]
    : [];
}

function optionalString(value: unknown): string | undefined {
  const result = stringValue(value);
  return result || undefined;
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
