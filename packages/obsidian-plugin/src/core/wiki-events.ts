import { projectFromWikiPath } from "./project";
import { toLocalDate } from "./time";
import { truncate } from "./text";
import type { ActivityEvent, CapturedRecord, SourceRef } from "./types";

export interface WikiDocument {
  path: string;
  content: string;
  ctime: number;
  mtime: number;
}

export interface WikiLink {
  sourcePath: string;
  targetPath: string;
  sourceMtime: number;
}

const SOURCE_MARKER = /<!--\s*(?:codex-source|chatgpt-qna):\s*prompt=([^;\s]+);stop=([^\s]+)\s*-->/g;
const DAILY_LINK = /\((?:\.\.\/)*raw\/(codex|chatgpt)\/daily\/(\d{4}-\d{2}-\d{2})\.md\)/g;

export function buildWikiEvents(
  documents: WikiDocument[],
  rawByEventId: ReadonlyMap<string, CapturedRecord>
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const document of documents) {
    const title = titleFromDocument(document);
    const project = projectFromWikiPath(document.path);
    const contributions = collectContributions(document, rawByEventId);
    const orderedDates = [...contributions.keys()].sort();

    if (orderedDates.length === 0) {
      const createdIso = new Date(document.ctime).toISOString();
      const modifiedIso = new Date(document.mtime).toISOString();
      const createdDate = toLocalDate(createdIso);
      events.push(wikiEvent(document, title, project, createdDate, createdIso, "knowledge_created", [], "file-time"));
      const modifiedDate = toLocalDate(modifiedIso);
      if (modifiedDate !== createdDate) {
        events.push(wikiEvent(document, title, project, modifiedDate, modifiedIso, "knowledge_updated", [], "file-time"));
      }
      continue;
    }

    orderedDates.forEach((date, index) => {
      const records = contributions.get(date) ?? [];
      const occurredAt = records
        .map((record) => record.captured_at)
        .sort()[0] ?? `${date}T12:00:00+08:00`;
      events.push(wikiEvent(
        document,
        title,
        project,
        date,
        occurredAt,
        index === 0 ? "knowledge_created" : "knowledge_updated",
        records,
        "source"
      ));
    });
  }

  return events;
}

export function buildWikiReuseEvents(links: WikiLink[], documentByPath: ReadonlyMap<string, WikiDocument>): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (!link.sourcePath.startsWith("wiki/") || !link.targetPath.startsWith("wiki/")) {
      continue;
    }
    const target = documentByPath.get(link.targetPath);
    const source = documentByPath.get(link.sourcePath);
    if (!target || !source) {
      continue;
    }
    const key = `${link.sourcePath}->${link.targetPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const occurredAt = new Date(link.sourceMtime).toISOString();
    const project = projectFromWikiPath(link.sourcePath);
    events.push({
      id: `wiki-reuse:${key}`,
      kind: "knowledge_reused",
      occurredAt,
      observedAt: occurredAt,
      localDate: toLocalDate(occurredAt),
      timeBasis: "file-time",
      title: `引用 ${titleFromDocument(target)}`,
      summary: `${titleFromDocument(source)} 显式链接到已有知识 ${titleFromDocument(target)}`,
      projectKey: project.key,
      projectLabel: project.label,
      objectKey: `wiki-link:${key}`,
      confidence: "inferred",
      evidence: "当前存在显式 Wiki 链接；发生日期按引用笔记修改时间估算",
      sourceRefs: [
        { type: "wiki", label: "引用笔记", path: link.sourcePath },
        { type: "wiki", label: "被引用知识", path: link.targetPath }
      ]
    });
  }
  return events;
}

function collectContributions(
  document: WikiDocument,
  rawByEventId: ReadonlyMap<string, CapturedRecord>
): Map<string, CapturedRecord[]> {
  const byDate = new Map<string, CapturedRecord[]>();
  for (const marker of document.content.matchAll(SOURCE_MARKER)) {
    const promptId = marker[1];
    const stopId = marker[2];
    for (const eventId of [promptId, stopId]) {
      if (!eventId) {
        continue;
      }
      const record = rawByEventId.get(eventId);
      if (!record) {
        continue;
      }
      const date = toLocalDate(record.captured_at);
      const records = byDate.get(date) ?? [];
      if (!records.some((item) => item.event_id === record.event_id)) {
        records.push(record);
      }
      byDate.set(date, records);
    }
  }

  if (byDate.size === 0) {
    for (const link of document.content.matchAll(DAILY_LINK)) {
      const date = link[2];
      if (date) {
        byDate.set(date, []);
      }
    }
  }
  return byDate;
}

function wikiEvent(
  document: WikiDocument,
  title: string,
  project: { key: string; label: string },
  date: string,
  occurredAt: string,
  kind: "knowledge_created" | "knowledge_updated",
  records: CapturedRecord[],
  timeBasis: ActivityEvent["timeBasis"]
): ActivityEvent {
  const sourceRefs: SourceRef[] = [{ type: "wiki", label: "知识笔记", path: document.path }];
  const dailyPaths = new Set<string>();
  for (const record of records) {
    const source = record.source === "chatgpt_web" ? "chatgpt" : "codex";
    dailyPaths.add(`raw/${source}/daily/${toLocalDate(record.captured_at)}.md`);
  }
  for (const path of dailyPaths) {
    sourceRefs.push({
      type: path.includes("/chatgpt/") ? "chatgpt" : "codex",
      label: "原始来源页",
      path
    });
  }
  return {
    id: `wiki:${kind}:${document.path}:${date}`,
    kind,
    occurredAt,
    observedAt: new Date(document.mtime).toISOString(),
    localDate: date,
    timeBasis,
    title,
    summary: kind === "knowledge_created" ? "形成知识笔记" : "补充或更新知识笔记",
    projectKey: project.key,
    projectLabel: project.label,
    objectKey: `wiki:${document.path}:${date}`,
    confidence: timeBasis === "source" ? "observed" : "inferred",
    evidence: timeBasis === "source" ? "Wiki 存在可回溯的来源标记" : "根据文件时间生成，知识发生时间仅供参考",
    sourceRefs
  };
}

function titleFromDocument(document: WikiDocument): string {
  const heading = document.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const fallback = document.path.split("/").at(-1)?.replace(/\.md$/i, "") ?? "未命名知识";
  return truncate(heading || fallback, 72);
}
