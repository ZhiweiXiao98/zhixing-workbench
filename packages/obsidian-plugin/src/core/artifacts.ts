import { createHash } from "node:crypto";
import path from "node:path";
import { stat } from "node:fs/promises";
import { artifactNotePath } from "./artifact-markdown";
import { artifactDisplayTitle } from "./artifact-title";
import { hasDirectCompletionAssertion, isDirectCompletionLine } from "./text";
import type {
  ActivityEvent,
  ArtifactRecord,
  ArtifactTarget,
  CapturedRecord,
  SourceRef
} from "./types";
import type { WikiDocument } from "./wiki-events";

export interface ArtifactBuildInput {
  records: CapturedRecord[];
  events: ActivityEvent[];
  wikiDocuments: WikiDocument[];
}

type PathExists = (targetPath: string) => Promise<boolean>;

export async function buildArtifacts(input: ArtifactBuildInput, pathExists: PathExists = defaultPathExists): Promise<ArtifactRecord[]> {
  const gitArtifacts = mergeGitArtifacts(input.events
    .filter((event) => event.kind === "output_created" && event.sourceRefs.some((source) => source.type === "git"))
    .map(buildGitArtifact));
  const wikiByPath = new Map(input.wikiDocuments.map((document) => [document.path, document]));
  const wikiArtifacts = input.events
    .filter((event) => event.kind === "knowledge_created" || event.kind === "knowledge_updated")
    .map((event) => buildWikiArtifact(event, wikiByPath))
    .filter((artifact): artifact is ArtifactRecord => Boolean(artifact));
  const outcomeEvents = input.events.filter((event) => event.kind === "task_completed" && event.confidence === "reported");
  const reportArtifacts = (await Promise.all(outcomeEvents.map(async (event) => {
    const stopRecord = findStopRecord(input.records, event);
    if (!stopRecord) {
      return null;
    }
    return buildReportArtifact(event, stopRecord, input.events, pathExists);
  }))).filter((artifact): artifact is ArtifactRecord => Boolean(artifact));

  const merged = mergeReportsIntoGit(gitArtifacts, reportArtifacts);
  const artifacts = [...merged.git, ...merged.reports, ...wikiArtifacts]
    .map(finalizeArtifact)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
  return artifacts;
}

export function sanitizeSourceText(content: string): string {
  return content
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_match, pathText: string, label: string) => label || pathText)
    .replace(/^\s*::[a-z-]+\{.*\}\s*$/gim, "")
    .replace(/^\s*```[^\r\n]*$/gm, "")
    .replace(/^\s*---\s*$/gm, "")
    .replace(/^.*zhixing-(?:generated|user).*$/gim, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:#{1,6}|[-*+]\s+|\d+\.\s+)/, "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 12_000)
    .trim();
}

export function extractLocalPaths(content: string): string[] {
  const paths = new Set<string>();
  const candidates = [
    ...[...content.matchAll(/\[[^\]]*\]\((\/?[A-Za-z]:[\\/][^)#]+)(?:#[^)]*)?\)/g)].map((match) => match[1]),
    ...[...content.matchAll(/`(\/?[A-Za-z]:[\\/][^`\r\n]+)`/g)].map((match) => match[1])
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const normalized = candidate.replace(/^\/(?=[A-Za-z]:[\\/])/, "").replace(/:\d+(?::\d+)?$/, "").trim();
    if (/^[A-Za-z]:[\\/]/.test(normalized)) {
      paths.add(path.normalize(normalized));
    }
  }
  return [...paths];
}

export function isDirectCompletionReport(content: string): boolean {
  return hasDirectCompletionAssertion(content);
}

function buildGitArtifact(event: ActivityEvent): ArtifactRecord {
  const hash = commitHashFromEvent(event);
  const fileRefs = event.sourceRefs.filter((source) => source.type === "file" && source.path);
  const gitRefs = event.sourceRefs.filter((source) => source.type === "git");
  const targets: ArtifactTarget[] = [
    ...gitRefs.map((source) => ({
      key: `git:${hash ?? event.id}:${source.path?.toLocaleLowerCase() ?? source.label}`,
      type: "git-commit",
      label: `${source.label || "Git 提交"}`,
      hash,
      path: source.path,
      attribution: "independent"
    } satisfies ArtifactTarget))
  ];
  if (targets.length === 0) {
    targets.push({
      key: `git:${hash ?? event.id}`,
      type: "git-commit",
      label: hash ? hash.slice(0, 8) : "Git 提交",
      hash,
      attribution: "independent"
    });
  }
  const changedFiles = fileRefs.map((source) => source.label);
  const result = changedFiles.length > 0
    ? `${event.title}\nGit 提交记录列出 ${changedFiles.length} 个相关文件：${changedFiles.slice(0, 8).join("、")}${changedFiles.length > 8 ? "等" : ""}。`
    : event.title;
  return artifactBase({
    id: hash ? `artifact:git:${hash.toLowerCase()}` : `artifact:${event.objectKey ?? event.id}`,
    event,
    kind: "git-commit",
    result,
    validation: [hash ? `Git 历史中存在完整提交 ${hash}。` : "Git 历史中存在该提交。"],
    limitations: [],
    proof: "independent",
    targets,
    sourceEventIds: [event.id]
  });
}

function buildWikiArtifact(event: ActivityEvent, wikiByPath: ReadonlyMap<string, WikiDocument>): ArtifactRecord | null {
  const wikiPath = event.sourceRefs.find((source) => source.type === "wiki")?.path;
  if (!wikiPath) {
    return null;
  }
  const document = wikiByPath.get(wikiPath);
  if (!document) {
    return null;
  }
  return artifactBase({
    id: `artifact:${event.objectKey ?? event.id}`,
    event,
    kind: "knowledge-note",
    result: wikiResult(document.content),
    validation: ["知识笔记已存在于当前 Vault。"],
    limitations: event.confidence === "inferred" ? [event.evidence] : [],
    proof: "independent",
    targets: [{
      key: `wiki:${wikiPath}`,
      type: "vault-note",
      label: event.title,
      path: wikiPath,
      exists: true,
      attribution: "independent"
    }],
    sourceEventIds: [event.id]
  });
}

async function buildReportArtifact(
  event: ActivityEvent,
  stopRecord: CapturedRecord,
  allEvents: ActivityEvent[],
  pathExists: PathExists
): Promise<ArtifactRecord | null> {
  if (!isDirectCompletionReport(stopRecord.content)) {
    return null;
  }
  const body = sanitizeSourceText(stopRecord.content);
  const reportBody = directReportSection(stopRecord.content);
  const targets = await extractReportedTargets(stopRecord.content, pathExists);
  const problemEvent = allEvents.find((candidate) =>
    candidate.sessionId === event.sessionId && candidate.turnId === event.turnId &&
    (candidate.kind === "task_started" || candidate.kind === "task_progress")
  );
  const hasExistingTarget = targets.some((target) => target.type === "local-file" && target.exists);
  return artifactBase({
    id: `artifact:report:${event.sessionId ?? "unknown"}:${event.turnId ?? stopRecord.turn_id}`,
    event,
    kind: hasExistingTarget ? "file-deliverable" : "completion-report",
    problem: problemEvent ? sanitizeSourceText(problemEvent.summary) : undefined,
    result: extractResultSummary(stopRecord.content) || body || event.summary,
    validation: extractLines(reportBody, /(?:(?:测试|构建|验证|提交|commit|安装|SHA256|截图).*(?:通过|完成|成功|[0-9a-f]{7,})|HTTP\s*200)/i),
    limitations: extractLines(reportBody, /(?:尚未|未完成|仍需|限制|受限|失败|无法|不能|留待)/i),
    proof: hasExistingTarget ? "target-present" : "report-only",
    targets,
    sourceEventIds: [event.id, stopRecord.event_id]
  });
}

async function extractReportedTargets(content: string, pathExists: PathExists): Promise<ArtifactTarget[]> {
  const localTargets = await Promise.all(extractLocalPaths(content).slice(0, 24).map(async (targetPath) => {
    if (!await pathExists(targetPath)) {
      return null;
    }
    return {
      key: `file:${targetPath.toLocaleLowerCase()}`,
      type: "local-file" as const,
      label: path.basename(targetPath),
      path: targetPath,
      exists: true,
      attribution: "reported" as const
    };
  }));
  const targets: ArtifactTarget[] = localTargets.filter((target): target is NonNullable<typeof target> => Boolean(target));
  for (const url of extractHttpUrls(content).slice(0, 12)) {
    targets.push({
      key: `url:${url}`,
      type: "url",
      label: url,
      url,
      attribution: "reported"
    });
  }
  return targets;
}

function extractResultSummary(content: string): string {
  const section = directReportUnits(content);
  const selected = section.filter((line, index) => {
    if (index === 0 || /(?:提交|commit)(?:为|是|：|:|\s)*[`']?[0-9a-f]{7,40}/i.test(line)) {
      return true;
    }
    if (/^(?:验证|测试|限制|已知限制|来源|证据|下一步|后续)(?:结果)?\s*[：:]?$/i.test(line)) {
      return false;
    }
    return !/(?:尚未|未完成|仍需|限制|受限|失败|无法|不能|留待)/i.test(line) &&
      !/(?:测试|构建|验证|SHA256|HTTP|截图).*(?:通过|完成|成功|[0-9a-f]{7,})/i.test(line);
  });
  return selected.slice(0, 6).join("\n").slice(0, 1_200).trim();
}

function directReportSection(content: string): string {
  return directReportUnits(content).join("\n");
}

function directReportUnits(content: string): string[] {
  const units = reportUnits(content);
  const completionIndex = units.findIndex((line) => isDirectCompletionLine(line));
  if (completionIndex < 0) {
    return [];
  }
  const section: string[] = [];
  for (const line of units.slice(completionIndex, completionIndex + 20)) {
    if (section.length > 0 && isPromptOrDiscussionLine(line)) {
      break;
    }
    const boundaryIndex = line.search(/(?:验收标准|提示词|下一步|后续(?:建议|计划)?|模板)\s*[：:]/i);
    if (boundaryIndex === 0) {
      break;
    }
    section.push(boundaryIndex > 0 ? line.slice(0, boundaryIndex).trim() : line);
    if (boundaryIndex > 0) {
      break;
    }
  }
  return section;
}

function reportUnits(content: string): string[] {
  return sanitizeSourceText(content.slice(0, 4_000))
    .split(/\r?\n|(?<=[。！？])\s*/)
    .map((line) => line.trim().replace(/^(?:\*\*|__)(?=\S)/, "").replace(/(?:\*\*|__)$/, ""))
    .filter(Boolean);
}

function isPromptOrDiscussionLine(line: string): boolean {
  return /^(?:把下面.*发给|(?:以下|这是)?.*提示词|验收标准|请(?:你|将|按|完成|实现|开发|修复)|建议(?:你|先|改为|采用)?|(?:这就清楚了[。！]?\s*)?你需要的(?:不是|是)|目标(?:是|：|:)|如果|可以(?:用|把|让)|下一步|后续(?:建议|计划)?|模板(?:是|：|:))/i.test(line);
}

function extractHttpUrls(content: string): string[] {
  const candidates = [
    ...[...content.matchAll(/\]\(\s*(https?:\/\/[^\s)]+)(?:\s+["'][^)]*)?\)/gi)].map((match) => match[1]),
    ...(content.match(/https?:\/\/[^\s<>()\[\]{}"'`，。；：！？、」』【】）》（）]+/gi) ?? [])
  ];
  const urls = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const trimmed = candidate.replace(/^[<(`]+/, "").replace(/[`，。；：！？、」』】）》）.,;!?]+$/g, "");
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        urls.add(parsed.toString());
      }
    } catch {
      // Ignore malformed targets rather than persisting a clickable false entry.
    }
  }
  return [...urls];
}

function mergeReportsIntoGit(gitArtifacts: ArtifactRecord[], reports: ArtifactRecord[]): { git: ArtifactRecord[]; reports: ArtifactRecord[] } {
  const remainingReports: ArtifactRecord[] = [];
  for (const report of reports) {
    const prefixes = commitPrefixes(report.result);
    const matches = gitArtifacts.filter((artifact) => {
      const hash = artifact.targets.find((target) => target.type === "git-commit")?.hash;
      return Boolean(hash && prefixes.some((prefix) => hash.toLowerCase().startsWith(prefix.toLowerCase())));
    });
    if (matches.length !== 1) {
      remainingReports.push(report);
      continue;
    }
    const target = matches[0];
    if (!target) {
      remainingReports.push(report);
      continue;
    }
    target.problem = report.problem ? `Codex 报告：${report.problem}` : target.problem;
    target.validation = unique([
      ...target.validation,
      `Codex 交付说明：${report.result}`,
      ...report.validation.map((line) => `Codex 报告：${line}`)
    ]);
    target.limitations = unique([...target.limitations, ...report.limitations.map((line) => `Codex 报告：${line}`)]);
    target.targets = uniqueBy([...target.targets, ...report.targets], (item) => item.key);
    target.sourceEventIds = unique([...target.sourceEventIds, ...report.sourceEventIds]);
    target.sourceRefs = uniqueBy([...target.sourceRefs, ...report.sourceRefs], sourceKey);
  }
  return { git: gitArtifacts, reports: remainingReports };
}

function mergeGitArtifacts(artifacts: ArtifactRecord[]): ArtifactRecord[] {
  const merged = new Map<string, ArtifactRecord>();
  for (const artifact of artifacts) {
    const hash = artifact.targets.find((target) => target.type === "git-commit")?.hash?.toLowerCase();
    const key = hash ?? artifact.id;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, artifact);
      continue;
    }
    existing.targets = uniqueBy([...existing.targets, ...artifact.targets], (item) => item.key);
    existing.sourceEventIds = unique([...existing.sourceEventIds, ...artifact.sourceEventIds]);
    existing.sourceRefs = uniqueBy([...existing.sourceRefs, ...artifact.sourceRefs], gitSourceKey);
    const fileLabels = existing.sourceRefs.filter((source) => source.type === "file").map((source) => source.label);
    existing.result = fileLabels.length > 0
      ? `${existing.title}\nGit 提交记录列出 ${fileLabels.length} 个相关文件：${fileLabels.slice(0, 8).join("、")}${fileLabels.length > 8 ? "等" : ""}。`
      : existing.title;
  }
  return [...merged.values()];
}

function artifactBase(input: {
  id: string;
  event: ActivityEvent;
  kind: ArtifactRecord["kind"];
  problem?: string;
  result: string;
  validation: string[];
  limitations: string[];
  proof: ArtifactRecord["proof"];
  targets: ArtifactTarget[];
  sourceEventIds: string[];
}): ArtifactRecord {
  return {
    id: input.id,
    fingerprint: "",
    localDate: input.event.localDate,
    occurredAt: input.event.occurredAt,
    timeBasis: input.event.timeBasis,
    projectKey: input.event.projectKey,
    projectLabel: input.event.projectLabel,
    taskKey: input.event.taskKey,
    kind: input.kind,
    title: artifactDisplayTitle(input.event, input.kind),
    problem: input.problem,
    result: input.result,
    validation: unique(input.validation),
    limitations: unique(input.limitations),
    proof: input.proof,
    curation: "auto",
    targets: input.targets,
    sourceEventIds: unique(input.sourceEventIds),
    sourceRefs: input.event.sourceRefs,
    notePath: ""
  };
}

function finalizeArtifact(artifact: ArtifactRecord): ArtifactRecord {
  const canonical = {
    id: artifact.id,
    localDate: artifact.localDate,
    occurredAt: artifact.occurredAt,
    timeBasis: artifact.timeBasis,
    projectKey: artifact.projectKey,
    projectLabel: artifact.projectLabel,
    taskKey: artifact.taskKey,
    kind: artifact.kind,
    title: artifact.title,
    problem: artifact.problem,
    result: artifact.result,
    validation: artifact.validation,
    limitations: artifact.limitations,
    proof: artifact.proof,
    curation: artifact.curation,
    targets: artifact.targets,
    sourceEventIds: artifact.sourceEventIds,
    sourceRefs: artifact.sourceRefs
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  const finalized = { ...artifact, fingerprint };
  finalized.notePath = artifactNotePath(finalized);
  return finalized;
}

function findStopRecord(records: CapturedRecord[], event: ActivityEvent): CapturedRecord | undefined {
  return records
    .filter((record) => record.event === "Stop" && record.session_id === event.sessionId && record.turn_id === event.turnId)
    .sort((left, right) => left.captured_at.localeCompare(right.captured_at))
    .at(-1);
}

function wikiResult(content: string): string {
  const match = /^##\s+结论\s*$/m.exec(content);
  const afterHeading = match ? content.slice(match.index + match[0].length) : "";
  const nextHeading = afterHeading.search(/^##\s+/m);
  const conclusion = match ? afterHeading.slice(0, nextHeading >= 0 ? nextHeading : undefined) : "";
  return sanitizeSourceText(conclusion || content) || "知识笔记已形成。";
}

function extractLines(content: string, pattern: RegExp): string[] {
  return unique(content.split(/\r?\n|(?<=[。！？])/).map((line) => line.trim()).filter((line) => line && pattern.test(line))).slice(0, 8);
}

function commitPrefixes(content: string): string[] {
  return unique([...content.matchAll(/(?:提交|commit)(?:为|是|：|:|\s)*[`']?([0-9a-f]{7,40})/gi)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value)));
}

function commitHashFromEvent(event: ActivityEvent): string | undefined {
  return (event.objectKey ?? event.id).match(/([0-9a-f]{40})$/i)?.[1];
}

function sourceKey(source: SourceRef): string {
  return `${source.type}:${source.path ?? ""}:${source.url ?? ""}:${source.line ?? ""}`;
}

function gitSourceKey(source: SourceRef): string {
  return source.type === "file" ? `git-file:${source.label.toLocaleLowerCase()}` : sourceKey(source);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const itemKey = key(value);
    if (seen.has(itemKey)) {
      return false;
    }
    seen.add(itemKey);
    return true;
  });
}

async function defaultPathExists(targetPath: string): Promise<boolean> {
  try {
    const entry = await stat(targetPath);
    return entry.isFile();
  } catch {
    return false;
  }
}
