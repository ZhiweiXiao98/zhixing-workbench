export type ActivityKind =
  | "task_started"
  | "task_progress"
  | "task_completed"
  | "task_blocked"
  | "research_activity"
  | "output_created"
  | "knowledge_created"
  | "knowledge_updated"
  | "knowledge_reused";

export type ActivityDimension = "activity" | "output" | "knowledge" | "reuse" | "focus";
export type Confidence = "verified" | "observed" | "reported" | "inferred";
export type TimeBasis = "source" | "captured" | "file-time";
export type SourceType = "codex" | "chatgpt" | "feishu" | "wiki" | "git" | "file";

export type ArtifactKind = "git-commit" | "knowledge-note" | "file-deliverable" | "completion-report";
export type ArtifactProof = "independent" | "target-present" | "report-only";
export type ArtifactTargetType = "git-commit" | "vault-note" | "local-file" | "url";
export type SettlementStatus = "succeeded" | "pending" | "failed" | "not-applicable";

export interface SourceRef {
  type: SourceType;
  label: string;
  path?: string;
  url?: string;
  line?: number;
  excerpt?: string;
}

export interface ArtifactTarget {
  key: string;
  type: ArtifactTargetType;
  label: string;
  path?: string;
  url?: string;
  hash?: string;
  exists?: boolean;
  attribution: "independent" | "reported";
}

export interface ArtifactRecord {
  id: string;
  fingerprint: string;
  localDate: string;
  occurredAt: string;
  timeBasis: TimeBasis;
  projectKey: string;
  projectLabel: string;
  taskKey?: string;
  kind: ArtifactKind;
  title: string;
  problem?: string;
  result: string;
  validation: string[];
  limitations: string[];
  proof: ArtifactProof;
  curation: "auto";
  targets: ArtifactTarget[];
  sourceEventIds: string[];
  sourceRefs: SourceRef[];
  notePath: string;
}

export interface KnowledgeChange {
  action: "created" | "updated";
  path: string;
  title: string;
  role?: "memory" | "evidence";
}

export interface KnowledgeDigest {
  about: string;
  problem: string;
  result: string;
  nextUse: string;
}

export interface KnowledgeSettlement {
  id: string;
  status: SettlementStatus;
  sourceEventIds: string[];
  wikiPaths: string[];
  knowledgeChanges: KnowledgeChange[];
  updatedAt: string;
  lastError?: string;
  reason?: string;
  reusedByOutcomeIds?: string[];
  category?: "knowledge-topic" | "durable-output" | "no-op-automation" | "supporting-session" | string;
  title?: string;
  localDate?: string;
  occurredAt?: string;
  projectLabel?: string;
  dailyPaths?: string[];
  digest?: KnowledgeDigest;
  memoryPath?: string;
  evidencePaths?: string[];
}

export interface OutcomeAggregate {
  id: string;
  localDate: string;
  occurredAt: string;
  projectKey: string;
  projectLabel: string;
  title: string;
  problem?: string;
  summary: string;
  proof: ArtifactProof;
  taskKeys: string[];
  artifactIds: string[];
  eventIds: string[];
  sourceRefs: SourceRef[];
  wikiRefs: SourceRef[];
  memoryRef?: SourceRef;
  evidenceRefs?: SourceRef[];
  knowledgeChanges: KnowledgeChange[];
  digest?: KnowledgeDigest;
  settlement: {
    status: SettlementStatus;
    updatedAt?: string;
    error?: string;
    reason?: string;
    category?: string;
  };
  reuseCount: number;
}

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  occurredAt: string;
  observedAt: string;
  localDate: string;
  timeBasis: TimeBasis;
  title: string;
  summary: string;
  projectKey: string;
  projectLabel: string;
  taskKey?: string;
  objectKey?: string;
  sessionId?: string;
  turnId?: string;
  confidence: Confidence;
  evidence: string;
  sourceRefs: SourceRef[];
}

export interface TaskAggregate {
  taskKey: string;
  projectKey: string;
  projectLabel: string;
  title: string;
  status: "active" | "blocked" | "completed";
  statusConfidence: Confidence;
  firstObservedAt: string;
  lastActivityAt: string;
  activeDates: string[];
  eventIds: string[];
  sourceRefs: SourceRef[];
  turnCount: number;
}

export interface CapturedRecord {
  schema_version: number;
  event_id: string;
  captured_at: string;
  date: string;
  source: "codex" | "chatgpt_web" | string;
  event: "UserPromptSubmit" | "Stop" | string;
  session_id: string;
  turn_id: string;
  cwd: string;
  content: string;
  conversation_id?: string;
  title?: string;
  url?: string;
  occurred_at?: string;
  updated_at?: string;
  resource_type?: string;
  resource_id?: string;
  resource_version?: string;
  resource_status?: string;
  resource_url?: string;
  project_hint?: string;
  access_status?: string;
  activity_kind?: ActivityKind;
  identity_scope?: string;
  untrusted_source?: boolean;
  sourcePath: string;
  sourceLine: number;
}

export interface SessionTitle {
  id: string;
  title: string;
  updatedAt: string;
}

export interface BuildDiagnostics {
  rawFiles: number;
  malformedLines: number;
  duplicateRecords: number;
  excludedAutomations: number;
  excludedSupportingSessions: number;
  codexSessions: number;
  chatgptConversations: number;
  feishuRecords: number;
  wikiNotes: number;
  gitRepositories: number;
  gitErrors: string[];
  sessionIndexAvailable: boolean;
  artifactNotes: number;
  artifactWriteErrors: string[];
  settlementFileAvailable: boolean;
  settlementErrors: string[];
  ingestHistoryErrors: string[];
  knowledgeQueue?: KnowledgeQueueStatus;
}

export interface KnowledgeQueueStatus {
  rawPendingPairs: number;
  candidatePairs: number;
  candidateTopics: number;
  openTopics: number;
  readyTopics: number;
  retryTopics: number;
  coolingRetryTopics: number;
  backlogTopics: number;
  recentTopics: number;
  partialTopics: number;
  needsCompactionTopics: number;
  selectedTopics: number;
  selectedChars: number;
  deferredTopics: number;
  noOpAutomationPairs: number;
  substantiveAutomationPairs: number;
  supportingPairs: number;
  remainingPairs: number;
  remainingTopics: number;
}

export type KnowledgeIngestRunStatus = "running" | "idle" | "succeeded" | "partial" | "failed" | "unknown";

export interface KnowledgeIngestTopicResult {
  id: string;
  title: string;
  status: SettlementStatus;
  reason?: string;
  error?: string;
  wikiPaths: string[];
  wikiChanges: KnowledgeChange[];
  digest?: KnowledgeDigest;
  memoryPath?: string;
  evidencePaths: string[];
  dailyPaths: string[];
  sourceEventCount: number;
}

export interface KnowledgeIngestRun {
  id: string;
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: KnowledgeIngestRunStatus;
  trigger: "automatic" | "manual" | "legacy";
  selectedTopics: number;
  committedTopics: number;
  skippedTopics: number;
  pendingTopics: number;
  failedTopics: number;
  systemPairs: number;
  remainingTopics: number;
  remainingPairs: number;
  cycleId?: string;
  batchIndex?: number;
  tokensUsed: number;
  inputChars: number;
  durationMs: number;
  attemptCount: number;
  topicResults: KnowledgeIngestTopicResult[];
  error?: string;
  logPath?: string;
  source: "structured" | "current-status" | "legacy-log";
}

export interface ActivitySnapshot {
  events: ActivityEvent[];
  tasks: TaskAggregate[];
  artifacts: ArtifactRecord[];
  outcomes: OutcomeAggregate[];
  ingestRuns: KnowledgeIngestRun[];
  builtAt: string;
  diagnostics: BuildDiagnostics;
}

export interface DateRange {
  start: string;
  end: string;
}

export interface MetricResult {
  dimension: ActivityDimension;
  label: string;
  value: number;
  note: string;
  events: ActivityEvent[];
}

export interface CalendarDaySummary {
  date: string;
  tasks: number;
  outputs: number;
  knowledge: number;
  events: ActivityEvent[];
}

export interface ActivityFilters {
  projectKey: string;
  confidence: "all" | Confidence;
}
