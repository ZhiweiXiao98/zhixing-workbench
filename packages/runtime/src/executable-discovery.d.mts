export interface ExecutableDiscovery {
  path: string;
  source: "configured" | "path" | "common-location" | "desktop-runtime";
  version: string | null;
}

export interface ExecutableDiscoveryOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

export function discoverExecutable(
  name: "codex" | "lark-cli",
  options?: ExecutableDiscoveryOptions
): Promise<ExecutableDiscovery | null>;

export function probeCodexExecutor(
  executable: string | undefined,
  options?: Record<string, unknown>
): Promise<{ supported: boolean; error: string | null }>;
