export interface BackgroundSchedulerState {
  schema_version: 1;
  installed: boolean;
  platform: string;
  kind: string;
  entry_path: string;
  content_sha256: string | null;
  conflict: boolean;
  error: string | null;
}

export function startupEntryDefinition(options: Record<string, unknown>): {
  platform: string; kind: string; entryPath: string; content: string;
};
export function registerBackgroundScheduler(options: Record<string, unknown>): Promise<{
  state: BackgroundSchedulerState; rollback(): Promise<void>; commit(): Promise<void>;
}>;
export function removeBackgroundScheduler(state?: Partial<BackgroundSchedulerState>): Promise<{
  removed: boolean; conflict: boolean; error: string | null;
}>;
export function inspectBackgroundSchedulerRegistration(state?: Partial<BackgroundSchedulerState>): Promise<{
  configured: boolean; error: string | null;
}>;
export function launchBackgroundScheduler(options: Record<string, unknown>): { started: boolean; pid: number | null };
