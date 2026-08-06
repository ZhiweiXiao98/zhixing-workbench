import { createHash } from "node:crypto";
import type { ArtifactKind, ArtifactRecord, ArtifactTarget, SourceRef } from "./types";

export const ARTIFACT_ROOT = "成果/知行台";
export const GENERATED_START = "<!-- zhixing-generated:start -->";
export const GENERATED_END = "<!-- zhixing-generated:end -->";
export const USER_START = "<!-- zhixing-user:start -->";
export const USER_END = "<!-- zhixing-user:end -->";

const LEGACY_GENERATED_START = "%% zhixing-generated:start %%";
const LEGACY_GENERATED_END = "%% zhixing-generated:end %%";
const LEGACY_USER_START = "%% zhixing-user:start %%";
const LEGACY_USER_END = "%% zhixing-user:end %%";
const STALE_NOTICE = "> [!warning] 历史成果\n> 此文件已不在当前成果索引中。自动内容按历史记录保留。";
const MAX_ARTIFACT_FILE_TITLE_CHARACTERS = 96;
const LONG_TITLE_SUFFIX = "（完整标题见正文）";

const PROOF_LABELS: Record<ArtifactRecord["proof"], string> = {
  independent: "独立验证",
  "target-present": "目标存在",
  "report-only": "仅完成报告"
};

const MANAGED_FRONTMATTER_KEYS = [
  "zhixing_schema",
  "zhixing_generated",
  "cssclasses",
  "aliases",
  "zhixing_id",
  "zhixing_fingerprint",
  "zhixing_stale",
  "date",
  "project",
  "kind",
  "proof",
  "curation",
  "source_event_ids",
  "target_keys"
] as const;

export interface MergeResult {
  ok: boolean;
  content: string;
  error?: string;
}

export interface ManagedArtifactMetadata {
  id: string;
  date: string;
  kind: string;
  stale: boolean;
  title?: string;
}

interface FrontmatterBlock {
  openEnd: number;
  closeStart: number;
  closeEnd: number;
  lines: string[];
  values: Map<string, string>;
}

interface MarkerBounds {
  start: number;
  end: number;
  userStart: number;
  userEnd: number;
}

interface ManagedDocument {
  frontmatter: FrontmatterBlock;
  markers: MarkerBounds;
  metadata: ManagedArtifactMetadata;
}

export function artifactNotePath(
  artifact: Pick<ArtifactRecord, "id" | "localDate" | "title">,
  copyNumber = 1
): string {
  assertLocalDate(artifact.localDate);
  if (!Number.isInteger(copyNumber) || copyNumber < 1) {
    throw new Error("成果文件序号必须为正整数");
  }
  const suffix = copyNumber === 1 ? "" : `（${copyNumber}）`;
  return `${ARTIFACT_ROOT}/${artifact.localDate}/${readableArtifactFileTitle(artifact.title)}${suffix}.md`;
}

export function readableArtifactFileTitle(title: string): string {
  const cleaned = title
    .replace(/<!--|-->/g, " ")
    .replace(/[<>:"/\\|?*\u0000-\u001f\[\]#^`]/g, " ")
    .replace(/[*_~]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .trim();
  const readable = cleaned || "未命名成果";
  const characters = Array.from(readable);
  if (characters.length <= MAX_ARTIFACT_FILE_TITLE_CHARACTERS) {
    return readable;
  }
  const suffixLength = Array.from(LONG_TITLE_SUFFIX).length;
  return `${characters.slice(0, MAX_ARTIFACT_FILE_TITLE_CHARACTERS - suffixLength).join("")}${LONG_TITLE_SUFFIX}`;
}

export function dailyArtifactIndexPath(date: string): string {
  assertLocalDate(date);
  return `${ARTIFACT_ROOT}/${date}.md`;
}

export function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function renderArtifactNote(artifact: ArtifactRecord): string {
  assertLocalDate(artifact.localDate);
  const generated = renderArtifactGeneratedBlock(artifact);
  return [
    "---",
    "zhixing_schema: 1",
    "zhixing_generated: true",
    "cssclasses: [zhixing-artifact-note]",
    `aliases: ${yamlArray([legacyArtifactAlias(artifact.id)])}`,
    `zhixing_id: ${yamlString(artifact.id)}`,
    `zhixing_fingerprint: ${yamlString(artifact.fingerprint)}`,
    "zhixing_stale: false",
    `date: ${artifact.localDate}`,
    `project: ${yamlString(artifact.projectLabel)}`,
    `kind: ${artifact.kind}`,
    `proof: ${artifact.proof}`,
    "curation: auto",
    `source_event_ids: ${yamlArray(artifact.sourceEventIds)}`,
    `target_keys: ${yamlArray(frontmatterTargetKeys(artifact.targets))}`,
    "---",
    "",
    GENERATED_START,
    `# ${markdownText(artifact.title)}`,
    "",
    generated,
    GENERATED_END,
    "",
    USER_START,
    "## 我的补充",
    "",
    USER_END,
    ""
  ].join("\n");
}

export function renderDailyArtifactIndex(date: string, artifacts: ArtifactRecord[]): string {
  assertLocalDate(date);
  const lines = [
    "---",
    "zhixing_schema: 1",
    "zhixing_generated: true",
    "cssclasses: [zhixing-artifact-note]",
    `zhixing_id: ${yamlString(`daily:${date}`)}`,
    "zhixing_stale: false",
    `date: ${date}`,
    "kind: daily-artifact-index",
    "---",
    "",
    GENERATED_START,
    `# ${date} 成果`,
    "",
    "> 由知行台自动整理。独立验证、目标存在和完成报告采用不同可信口径。",
    ""
  ];

  const byProject = new Map<string, ArtifactRecord[]>();
  for (const artifact of [...artifacts].sort(compareArtifacts)) {
    const group = byProject.get(artifact.projectLabel) ?? [];
    group.push(artifact);
    byProject.set(artifact.projectLabel, group);
  }
  if (byProject.size === 0) {
    lines.push("当天没有当前快照中的成果条目。", "");
  }
  for (const [project, projectArtifacts] of byProject) {
    lines.push(`## ${markdownText(project)}`, "");
    for (const artifact of projectArtifacts) {
      const pathWithoutExtension = (artifact.notePath || artifactNotePath(artifact)).replace(/\.md$/i, "");
      lines.push(
        `- [[${pathWithoutExtension}|${wikilinkText(artifact.title)}]] · ${PROOF_LABELS[artifact.proof]}`,
        `  - ${inlineText(firstReadableLine(artifact.result))}`
      );
    }
    lines.push("");
  }
  lines.push(GENERATED_END, "", USER_START, "## 我的补充", "", USER_END, "");
  return lines.join("\n");
}

export function readManagedArtifactMetadata(content: string): ManagedArtifactMetadata | null {
  const parsed = parseManagedDocument(content);
  return parsed?.metadata ?? null;
}

export function mergeGeneratedBlock(existing: string, desired: string): MergeResult {
  const existingDocument = parseManagedDocument(existing);
  const desiredDocument = parseManagedDocument(desired);
  if (!existingDocument) {
    return { ok: false, content: existing, error: "目标文件不属于知行台或结构已损坏，已拒绝覆盖" };
  }
  if (!desiredDocument) {
    return { ok: false, content: existing, error: "待写入成果文件结构无效" };
  }
  if (existingDocument.metadata.id !== desiredDocument.metadata.id) {
    return { ok: false, content: existing, error: "目标文件的知行台 ID 不匹配，已拒绝覆盖" };
  }

  const desiredBlock = desired.slice(desiredDocument.markers.start, desiredDocument.markers.end);
  const withGeneratedBlock = `${existing.slice(0, existingDocument.markers.start)}${desiredBlock}${existing.slice(existingDocument.markers.end)}`;
  const withFrontmatter = mergeManagedFrontmatter(withGeneratedBlock, desired);
  return { ok: true, content: normalizeLegacyMarkers(removeLegacyManagedHeading(withFrontmatter)) };
}

export function markArtifactNoteStale(existing: string): MergeResult {
  const document = parseManagedDocument(existing);
  if (!document || document.metadata.id.startsWith("daily:")) {
    return { ok: false, content: existing, error: "目标文件不是有效的知行台成果笔记" };
  }
  const generated = existing.slice(document.markers.start, document.markers.end);
  const staleGenerated = generated.includes(STALE_NOTICE)
    ? generated
    : generated.replace(/^(%% zhixing-generated:start %%|<!-- zhixing-generated:start -->)\r?\n?/, `$1\n${STALE_NOTICE}\n\n`);
  const withNotice = `${existing.slice(0, document.markers.start)}${staleGenerated}${existing.slice(document.markers.end)}`;
  return {
    ok: true,
    content: normalizeLegacyMarkers(updateFrontmatterValues(withNotice, new Map([["zhixing_stale", "true"]])))
  };
}

export function addManagedAlias(existing: string, alias: string): MergeResult {
  const document = parseManagedDocument(existing);
  const cleaned = inlineText(alias);
  if (!document || document.metadata.id.startsWith("daily:") || !cleaned) {
    return { ok: false, content: existing, error: "目标文件不是可添加别名的知行台成果" };
  }
  const aliases = parseYamlStringArray(document.frontmatter.values.get("aliases") ?? "");
  if (aliases.includes(cleaned)) {
    return { ok: true, content: existing };
  }
  return {
    ok: true,
    content: updateFrontmatterValues(existing, new Map([["aliases", yamlArray([...aliases, cleaned])]]))
  };
}

function renderArtifactGeneratedBlock(artifact: ArtifactRecord): string {
  const lines = [
    `> ${PROOF_LABELS[artifact.proof]} · ${kindDescription(artifact.kind)} · 自动整理`,
    "",
    "## 解决的问题",
    "",
    artifact.problem ? paragraphText(artifact.problem) : "未从来源中提取到明确问题描述。",
    "",
    "## 形成的成果",
    "",
    paragraphText(artifact.result),
    "",
    "## 验证结果",
    ""
  ];
  lines.push(...listOrFallback(artifact.validation, "来源未提供明确验证结果。"));
  lines.push("", "## 实际入口", "");
  lines.push(...targetsOrFallback(artifact.targets));
  lines.push("", "## 来源证据", "");
  lines.push(...sourcesOrFallback(artifact.sourceRefs));
  lines.push("", "## 已知限制", "");
  lines.push(...listOrFallback(artifact.limitations, artifact.proof === "independent"
    ? "未发现额外限制说明。"
    : "该条目来自完成报告，仍需结合实际入口和来源证据判断。"));
  return lines.join("\n");
}

function targetsOrFallback(targets: ArtifactTarget[]): string[] {
  if (targets.length === 0) {
    return ["- 暂无可直接打开的实际入口。"];
  }
  return targets.map((target) => {
    const attribution = target.attribution === "reported" ? "（Codex 报告）" : "";
    if (target.type === "vault-note" && target.path) {
      return `- [[${target.path.replace(/\.md$/i, "")}|${wikilinkText(target.label)}]]${attribution}`;
    }
    if (target.type === "url" && target.url) {
      return `- [${inlineText(target.label)}](${safeUrl(target.url)})${attribution}`;
    }
    const location = target.hash ?? target.path ?? target.url ?? target.key;
    return `- ${inlineText(target.label)}${attribution}：\`${inlineCode(location)}\``;
  });
}

function sourcesOrFallback(sources: SourceRef[]): string[] {
  if (sources.length === 0) {
    return ["- 暂无来源。"];
  }
  return sources.map((source) => {
    if (
      (source.type === "wiki" || source.type === "codex" || source.type === "chatgpt" || source.type === "feishu") &&
      source.path?.endsWith(".md") &&
      !/^[A-Za-z]:[\\/]/.test(source.path)
    ) {
      return `- [[${source.path.replace(/\.md$/i, "")}|${wikilinkText(source.label)}]]`;
    }
    if (source.url) {
      return `- [${inlineText(source.label)}](${safeUrl(source.url)})`;
    }
    const location = `${source.path ?? ""}${source.line ? `:${source.line}` : ""}`;
    return `- ${inlineText(source.label)}${location ? `：\`${inlineCode(location)}\`` : ""}`;
  });
}

function listOrFallback(items: string[], fallback: string): string[] {
  return items.length > 0 ? items.map((item) => `- ${inlineText(item)}`) : [`- ${fallback}`];
}

function parseManagedDocument(content: string): ManagedDocument | null {
  const frontmatter = parseFrontmatter(content);
  const markers = markerBounds(content);
  if (!frontmatter || !markers || markers.start <= frontmatter.closeEnd) {
    return null;
  }
  if (frontmatter.values.get("zhixing_schema") !== "1" || frontmatter.values.get("zhixing_generated") !== "true") {
    return null;
  }
  const date = parseYamlScalar(frontmatter.values.get("date") ?? "");
  const kind = parseYamlScalar(frontmatter.values.get("kind") ?? "");
  const explicitId = parseYamlScalar(frontmatter.values.get("zhixing_id") ?? "");
  const id = explicitId || (kind === "daily-artifact-index" && isValidLocalDate(date) ? `daily:${date}` : "");
  if (!id || !isValidLocalDate(date) || !kind) {
    return null;
  }
  const generatedBlock = content.slice(markers.start, markers.end);
  const title = kind === "daily-artifact-index"
    ? undefined
    : (generatedBlock.match(/^#\s+(.+)\s*$/m) ?? content.slice(frontmatter.closeEnd, markers.end).match(/^#\s+(.+)\s*$/m))?.[1]?.trim();
  return {
    frontmatter,
    markers,
    metadata: {
      id,
      date,
      kind,
      stale: frontmatter.values.get("zhixing_stale") === "true",
      title
    }
  };
}

function parseFrontmatter(content: string): FrontmatterBlock | null {
  const opening = content.match(/^---\r?\n/);
  if (!opening) {
    return null;
  }
  const openEnd = opening[0].length;
  const closingPattern = /^---[ \t]*\r?$/gm;
  closingPattern.lastIndex = openEnd;
  const closing = closingPattern.exec(content);
  if (!closing) {
    return null;
  }
  const body = content.slice(openEnd, closing.index);
  const lines = body.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const values = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1] ?? "";
    if (values.has(key)) {
      return null;
    }
    values.set(key, (match[2] ?? "").trim());
  }
  return {
    openEnd,
    closeStart: closing.index,
    closeEnd: closing.index + closing[0].length,
    lines,
    values
  };
}

function markerBounds(content: string): MarkerBounds | null {
  const currentCounts = [count(content, GENERATED_START), count(content, GENERATED_END)];
  const legacyCounts = [count(content, LEGACY_GENERATED_START), count(content, LEGACY_GENERATED_END)];
  const currentValid = currentCounts[0] === 1 && currentCounts[1] === 1 && legacyCounts[0] === 0 && legacyCounts[1] === 0;
  const legacyValid = legacyCounts[0] === 1 && legacyCounts[1] === 1 && currentCounts[0] === 0 && currentCounts[1] === 0;
  const currentUserCounts = [count(content, USER_START), count(content, USER_END)];
  const legacyUserCounts = [count(content, LEGACY_USER_START), count(content, LEGACY_USER_END)];
  const currentUserValid = currentUserCounts[0] === 1 && currentUserCounts[1] === 1 && legacyUserCounts[0] === 0 && legacyUserCounts[1] === 0;
  const legacyUserValid = legacyUserCounts[0] === 1 && legacyUserCounts[1] === 1 && currentUserCounts[0] === 0 && currentUserCounts[1] === 0;
  if ((!currentValid && !legacyValid) || (!currentUserValid && !legacyUserValid)) {
    return null;
  }
  const startMarker = currentValid ? GENERATED_START : LEGACY_GENERATED_START;
  const endMarker = currentValid ? GENERATED_END : LEGACY_GENERATED_END;
  const userStartMarker = currentUserValid ? USER_START : LEGACY_USER_START;
  const userEndMarker = currentUserValid ? USER_END : LEGACY_USER_END;
  const start = content.indexOf(startMarker);
  const generatedEnd = content.indexOf(endMarker);
  const userStart = content.indexOf(userStartMarker);
  const userEnd = content.indexOf(userEndMarker);
  if (start < 0 || generatedEnd <= start || userStart <= generatedEnd || userEnd <= userStart) {
    return null;
  }
  if (!isStandaloneMarker(content, start, startMarker)
    || !isStandaloneMarker(content, generatedEnd, endMarker)
    || !isStandaloneMarker(content, userStart, userStartMarker)
    || !isStandaloneMarker(content, userEnd, userEndMarker)) {
    return null;
  }
  return {
    start,
    end: generatedEnd + endMarker.length,
    userStart,
    userEnd: userEnd + userEndMarker.length
  };
}

function normalizeLegacyMarkers(content: string): string {
  return content
    .replace(LEGACY_GENERATED_START, GENERATED_START)
    .replace(LEGACY_GENERATED_END, GENERATED_END)
    .replace(LEGACY_USER_START, USER_START)
    .replace(LEGACY_USER_END, USER_END);
}

function mergeManagedFrontmatter(existing: string, desired: string): string {
  const existingFrontmatter = parseFrontmatter(existing);
  const desiredFrontmatter = parseFrontmatter(desired);
  if (!existingFrontmatter || !desiredFrontmatter) {
    return existing;
  }
  const values = new Map<string, string>();
  for (const key of MANAGED_FRONTMATTER_KEYS) {
    if (key === "aliases") {
      continue;
    }
    const value = desiredFrontmatter.values.get(key);
    if (value !== undefined) {
      values.set(key, value);
    }
  }
  const aliases = [...new Set([
    ...parseYamlStringArray(existingFrontmatter.values.get("aliases") ?? ""),
    ...parseYamlStringArray(desiredFrontmatter.values.get("aliases") ?? "")
  ])];
  if (aliases.length > 0) {
    values.set("aliases", yamlArray(aliases));
  }
  return updateFrontmatterValues(existing, values);
}

function updateFrontmatterValues(content: string, updates: Map<string, string>): string {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    return content;
  }
  const remaining = new Map(updates);
  const lines = frontmatter.lines.map((line) => {
    const match = line.match(/^([A-Za-z0-9_-]+):/);
    const key = match?.[1];
    if (!key || !remaining.has(key)) {
      return line;
    }
    const replacement = `${key}: ${remaining.get(key) ?? ""}`;
    remaining.delete(key);
    return replacement;
  });
  for (const [key, value] of remaining) {
    lines.push(`${key}: ${value}`);
  }
  const body = `${lines.join("\n")}\n`;
  return `${content.slice(0, frontmatter.openEnd)}${body}${content.slice(frontmatter.closeStart)}`;
}

function removeLegacyManagedHeading(content: string): string {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    return content;
  }
  const generatedStart = content.indexOf(GENERATED_START, frontmatter.closeEnd);
  if (generatedStart < 0) {
    return content;
  }
  const prelude = content.slice(frontmatter.closeEnd, generatedStart);
  if (!/^\s*# [^\r\n]+\s*$/.test(prelude)) {
    return content;
  }
  return `${content.slice(0, frontmatter.closeEnd)}\n\n${content.slice(generatedStart)}`;
}

function compareArtifacts(left: ArtifactRecord, right: ArtifactRecord): number {
  return right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id);
}

function kindDescription(kind: ArtifactKind): string {
  switch (kind) {
    case "git-commit": return "Git 提交";
    case "knowledge-note": return "知识笔记";
    case "file-deliverable": return "关联文件";
    case "completion-report": return "完成报告";
  }
}

function firstReadableLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "暂无摘要";
}

function paragraphText(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(markdownText).join("\n\n");
}

function markdownText(value: string): string {
  return value.replace(/[<>]/g, "").replace(/<!--|-->/g, "").trim();
}

function inlineText(value: string): string {
  return markdownText(value).replace(/[\r\n|]/g, " ").replace(/\s+/g, " ").trim();
}

function wikilinkText(value: string): string {
  return inlineText(value).replace(/[\[\]#^]/g, " ").replace(/\s+/g, " ").trim();
}

function inlineCode(value: string): string {
  return value.replace(/`/g, "'").replace(/[\r\n]/g, " ").trim();
}

function safeUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value.replace(/[<>\s]/g, "") : "";
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/[\r\n]/g, " "));
}

function yamlArray(values: string[]): string {
  return `[${values.map(yamlString).join(", ")}]`;
}

function parseYamlScalar(value: string): string {
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string" ? parsed : "";
    } catch {
      return "";
    }
  }
  return value.trim();
}

function parseYamlStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function frontmatterTargetKeys(targets: ArtifactTarget[]): string[] {
  const primary = targets.filter((target) => target.type === "git-commit" || target.type === "vault-note");
  return (primary.length > 0 ? primary : targets).slice(0, 6).map((target) => target.key);
}

function legacyArtifactAlias(id: string): string {
  const code = createHash("sha256").update(id).digest("hex").slice(0, 12);
  return `成果-${code}`;
}

function assertLocalDate(value: string): void {
  if (!isValidLocalDate(value)) {
    throw new Error(`无效的本地日期：${value}`);
  }
}

function count(content: string, marker: string): number {
  return content.split(marker).length - 1;
}

function isStandaloneMarker(content: string, position: number, marker: string): boolean {
  const before = position === 0 || content[position - 1] === "\n";
  const afterPosition = position + marker.length;
  const after = afterPosition === content.length || content[afterPosition] === "\n" || content.slice(afterPosition, afterPosition + 2) === "\r\n";
  return before && after;
}
