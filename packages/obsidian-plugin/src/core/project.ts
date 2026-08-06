import type { ActivityEvent, SourceType } from "./types";

export interface ProjectIdentity {
  key: string;
  label: string;
  inferred: boolean;
}

const SYSTEM_PATH_PATTERNS = [
  /\\Program Files\\WindowsApps\\OpenAI\.Codex_/i,
  /\\Program Files\\Obsidian/i,
  /\\AppData\\Local\\Temp\\zhixing-workbench-fixture/i
];

export function projectFromCwd(cwd: string): ProjectIdentity | null {
  const normalized = cwd.replace(/\//g, "\\").replace(/\\+$/, "");
  if (!normalized || normalized === "chatgpt.com" || SYSTEM_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }

  const codexWorktree = normalized.match(/\\\.codex\\worktrees\\[^\\]+\\([^\\]+)/i);
  if (codexWorktree?.[1]) {
    return identity(codexWorktree[1], true);
  }

  const nestedWorktree = normalized.match(/^(.+?)\\\.worktrees(?:\\|$)/i);
  if (nestedWorktree?.[1]) {
    const base = basename(nestedWorktree[1]);
    return identity(base, true);
  }

  const label = basename(normalized);
  if (!label || label === ".codex") {
    return null;
  }
  return identity(label, false);
}

export function projectFromWikiPath(path: string): ProjectIdentity {
  const segments = path.replace(/\\/g, "/").split("/");
  const folder = segments.length >= 3 ? segments[1] : "通用";
  const label = folder === "补充" || folder?.startsWith("_") ? "知识库" : folder ?? "知识库";
  return identity(label, true);
}

export function projectFromChatTitle(title?: string): ProjectIdentity {
  void title;
  return identity("未归属", true);
}

export function projectKeyFromLabel(label: string): string {
  return identity(label, false).key;
}

export function reconcileProjectLabels(events: readonly ActivityEvent[]): ActivityEvent[] {
  const preferred = new Map<string, { label: string; priority: number }>();
  for (const event of events) {
    const candidate = {
      label: event.projectLabel,
      priority: projectLabelPriority(event.sourceRefs.map((source) => source.type))
    };
    const current = preferred.get(event.projectKey);
    if (!current || candidate.priority > current.priority) {
      preferred.set(event.projectKey, candidate);
    }
  }
  return events.map((event) => {
    const label = preferred.get(event.projectKey)?.label ?? event.projectLabel;
    return label === event.projectLabel ? event : { ...event, projectLabel: label };
  });
}

function identity(label: string, inferred: boolean): ProjectIdentity {
  return {
    key: label.toLocaleLowerCase().replace(/\s+/g, "-"),
    label,
    inferred
  };
}

function projectLabelPriority(sourceTypes: readonly SourceType[]): number {
  if (sourceTypes.includes("codex")) {
    return 3;
  }
  if (sourceTypes.includes("feishu")) {
    return 2.5;
  }
  if (sourceTypes.includes("wiki")) {
    return 2;
  }
  if (sourceTypes.includes("git")) {
    return 1;
  }
  return 0;
}

function basename(path: string): string {
  const parts = path.split("\\").filter(Boolean);
  return parts.at(-1) ?? path;
}
