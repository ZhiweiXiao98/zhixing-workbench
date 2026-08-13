export interface KnowledgeScheduleState {
  schema_version: 1;
  last_attempt: string | null;
  last_success: string | null;
  next_due: string | null;
  status: "idle" | "running" | "succeeded" | "backoff";
  error: string | null;
  failure_count: number;
  trigger: string | null;
  owner_pid: number | null;
}

export function readScheduleState(options: { vault: string; now?: Date | string | number; recoverInterrupted?: boolean;
  recoverStale?: boolean }): Promise<KnowledgeScheduleState>;
export function runDueKnowledgeCycle(options: {
  vault: string;
  now?: Date | string | number;
  finishedAt?: Date | string | number;
  newActivity?: boolean;
  executorReady?: boolean;
  recoverInterrupted?: boolean;
  run: (reason: string) => Promise<void>;
}): Promise<{ ran: boolean; ok: boolean; reason: string; state: KnowledgeScheduleState; error?: string }>;
export function evaluateSchedule(options: {
  now?: Date | string | number;
  state?: Partial<KnowledgeScheduleState>;
  lastCycle?: { finished_at?: string } | null;
  queue?: { ready_topics?: number; candidate_topics?: number } | null;
  newActivity?: boolean;
  executorReady?: boolean;
}): { due: boolean; reason: string; next_due: string | null };
export function markScheduleIdle(options: { vault: string; state?: Partial<KnowledgeScheduleState>; now?: Date | string | number; nextDue?: string | null }): Promise<KnowledgeScheduleState>;
export function beginScheduleAttempt(options: { vault: string; state?: Partial<KnowledgeScheduleState>; now?: Date | string | number; trigger?: string }): Promise<KnowledgeScheduleState>;
export function finishScheduleAttempt(options: { vault: string; state?: Partial<KnowledgeScheduleState>; now?: Date | string | number; ok: boolean; error?: unknown }): Promise<KnowledgeScheduleState>;
export function normalizeScheduleState(value: unknown, now?: Date | string | number): KnowledgeScheduleState;
