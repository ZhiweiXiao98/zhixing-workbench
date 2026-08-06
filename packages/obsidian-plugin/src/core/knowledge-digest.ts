import type { KnowledgeDigest } from "./types";

const DIGEST_LABELS = {
  about: "这是什么",
  problem: "解决了什么",
  result: "得到什么",
  nextUse: "以后怎么用"
} as const;

export function parseKnowledgeDigest(value: unknown): KnowledgeDigest | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const digest = {
    about: stringValue(value.about),
    problem: stringValue(value.problem),
    result: stringValue(value.result),
    nextUse: stringValue(value.next_use ?? value.nextUse)
  };
  return Object.values(digest).every(Boolean) ? digest : undefined;
}

export function deriveKnowledgeDigest(
  content: string,
  title: string,
  reason?: string
): KnowledgeDigest | undefined {
  const overview = sectionLines(content, "一眼看懂");
  const explicit = Object.fromEntries(Object.entries(DIGEST_LABELS).map(([key, label]) => [
    key,
    overview.map((line) => labelledValue(line, label)).find(Boolean) ?? ""
  ])) as unknown as KnowledgeDigest;
  if (Object.values(explicit).every(Boolean)) {
    return explicit;
  }

  const problems = sectionLines(content, "问题与现象");
  const results = sectionLines(content, "验证方式与结果");
  const nextSteps = sectionLines(content, "可复用的解决路径");
  if (problems.length === 0 || results.length === 0 || nextSteps.length === 0) {
    return undefined;
  }
  const problem = joinLines(problems, 2);
  return {
    about: `这是旧版知识记录，原文从这个问题开始：${concise(problems[0], 240)}`,
    problem,
    result: joinLines(results, 2),
    nextUse: joinLines(nextSteps, 2)
  };
}

function sectionLines(content: string, heading: string): string[] {
  const match = content.match(new RegExp(
    `^##\\s+${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`,
    "m"
  ));
  if (!match?.[1]) {
    return [];
  }
  return match[1]
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => Boolean(line) && !/^本次来源事件$/i.test(line))
    .slice(0, 8);
}

function cleanLine(value: string): string {
  return value
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^|\]]+)(?:\|[^\]]+)?]]/g, "$1")
    .trim();
}

function labelledValue(value: string, label: string): string {
  const match = value.match(new RegExp(`^${escapeRegExp(label)}\\s*[：:]\\s*(.+)$`));
  return match?.[1]?.trim() ?? "";
}

function joinLines(lines: string[], count: number): string {
  return concise(lines.slice(0, count).join("；"));
}

function concise(value: string | undefined, max = 320): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
