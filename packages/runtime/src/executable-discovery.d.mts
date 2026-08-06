export interface ExecutableDiscovery {
  path: string;
  source: "path" | "common-location";
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
