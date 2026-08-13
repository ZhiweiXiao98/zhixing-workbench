export interface FactualSourceHealth {
  source_type: string;
  configured: boolean;
  supported: boolean;
  last_seen_at: string | null;
  last_event_at: string | null;
  stale: boolean;
  error: string | null;
  producer_versions?: string[];
}

export interface CodexDesktopSyncResult extends FactualSourceHealth {
  accepted: number;
  duplicates: number;
  completed_turns: number;
}

export function syncCodexDesktop(options: {
  vault: string;
  codexHome?: string;
  now?: Date | string | number;
  staleAfterMs?: number;
  bootstrapLookbackMs?: number;
}): Promise<CodexDesktopSyncResult>;

export function readCodexDesktopHealth(options: {
  vault: string;
  codexHome?: string;
  now?: Date | string | number;
  staleAfterMs?: number;
}): Promise<FactualSourceHealth>;

export function readLastCodexEventAt(eventsRoot: string, captureSource?: string): Promise<string | null>;
