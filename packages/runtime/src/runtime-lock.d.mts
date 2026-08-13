export interface RuntimeOwner {
  schema_version: number;
  owner_id: string;
  owner_kind: string;
  pid: number;
  process_identity?: string | null;
  acquired_at: string;
  heartbeat_at: string;
  lease_until: string;
}

export interface RuntimeLease {
  acquired: boolean;
  recovered: boolean;
  owner: RuntimeOwner | null;
  lock_path: string;
  heartbeat_ms?: number;
  heartbeat?: () => Promise<boolean>;
  release?: () => Promise<boolean>;
}

export function runtimeLockPath(options: Record<string, unknown>): string;
export function acquireVaultAutomationLock(options: Record<string, unknown>): Promise<RuntimeLease>;
export function acquireBackgroundHostLock(options: Record<string, unknown>): Promise<RuntimeLease>;
export function readVaultAutomationOwner(options: Record<string, unknown>): Promise<RuntimeOwner | null>;
export function acquireRuntimeLock(options: Record<string, unknown>): Promise<RuntimeLease>;
export function withLeaseHeartbeat<T>(lease: RuntimeLease, work: (lease: RuntimeLease) => Promise<T>,
  options?: Record<string, unknown>): Promise<T>;
