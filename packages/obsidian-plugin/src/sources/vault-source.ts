import { TFile, type App } from "obsidian";
import {
  mergeIngestRuns,
  parseCurrentIngestStatus,
  parseLegacyIngestLog,
  parseStructuredIngestHistory
} from "../core/ingest-history";
import { deriveKnowledgeDigest } from "../core/knowledge-digest";
import { parseJsonl } from "../core/raw-events";
import { parseKnowledgeLedger, parseKnowledgeQueueStatus } from "../core/knowledge-ledger";
import type {
  CapturedRecord,
  KnowledgeIngestRun,
  KnowledgeQueueStatus,
  KnowledgeSettlement
} from "../core/types";
import type { WikiDocument, WikiLink } from "../core/wiki-events";

interface RawCacheEntry {
  mtime: number;
  records: CapturedRecord[];
  malformedLines: number;
}

interface WikiCacheEntry {
  mtime: number;
  document: WikiDocument;
}

interface IngestHistoryCacheEntry {
  mtime: number;
  run?: KnowledgeIngestRun;
  errors: string[];
}

export interface VaultSourceSnapshot {
  records: CapturedRecord[];
  malformedLines: number;
  rawFiles: number;
  documents: WikiDocument[];
  wikiLinks: WikiLink[];
  settlements: KnowledgeSettlement[];
  settlementFileAvailable: boolean;
  settlementErrors: string[];
  ingestRuns: KnowledgeIngestRun[];
  ingestHistoryErrors: string[];
  knowledgeQueue?: KnowledgeQueueStatus;
}

export class VaultSource {
  private readonly rawCache = new Map<string, RawCacheEntry>();
  private readonly wikiCache = new Map<string, WikiCacheEntry>();
  private readonly ingestHistoryCache = new Map<string, IngestHistoryCacheEntry>();

  constructor(private readonly app: App) {}

  async load(): Promise<VaultSourceSnapshot> {
    const files = this.app.vault.getFiles();
    const rawFiles = files.filter((file) => /^raw\/(codex|chatgpt|feishu)\/events\/\d{4}-\d{2}-\d{2}\.jsonl$/i.test(file.path));
    const wikiFiles = files.filter((file) => file.path.startsWith("wiki/") && file.extension === "md" && !file.basename.startsWith("_tmp"));
    const settlementFile = files.find((file) => file.path === "raw/codex/knowledge-settlements.json");
    const statusFile = files.find((file) => file.path === "raw/codex/ingest-status.json");
    const historyFiles = files.filter((file) => /^raw\/codex\/ingest-history\/[^/]+\.json$/i.test(file.path));
    const legacyLogFiles = files
      .filter((file) => /^raw\/codex\/automation\/\d{4}-\d{2}-\d{2}-\d{6}.*\.log$/i.test(file.path))
      .sort((left, right) => right.path.localeCompare(left.path));
    this.evictRemoved(rawFiles, wikiFiles, [...historyFiles, ...legacyLogFiles]);

    const records: CapturedRecord[] = [];
    let malformedLines = 0;
    for (const file of rawFiles) {
      const cached = this.rawCache.get(file.path);
      if (cached?.mtime === file.stat.mtime) {
        records.push(...cached.records);
        malformedLines += cached.malformedLines;
        continue;
      }
      const parsed = parseJsonl(await this.app.vault.read(file), file.path);
      this.rawCache.set(file.path, { mtime: file.stat.mtime, ...parsed });
      records.push(...parsed.records);
      malformedLines += parsed.malformedLines;
    }

    const documents: WikiDocument[] = [];
    for (const file of wikiFiles) {
      const cached = this.wikiCache.get(file.path);
      if (cached?.mtime === file.stat.mtime) {
        documents.push(cached.document);
        continue;
      }
      const document: WikiDocument = {
        path: file.path,
        content: await this.app.vault.cachedRead(file),
        ctime: file.stat.ctime,
        mtime: file.stat.mtime
      };
      this.wikiCache.set(file.path, { mtime: file.stat.mtime, document });
      documents.push(document);
    }

    const parsedSettlements = settlementFile
      ? parseKnowledgeLedger(await this.app.vault.read(settlementFile))
      : { settlements: [], errors: [] };
    const wikiByPath = new Map(documents.map((document) => [document.path, document]));
    const settlements = parsedSettlements.settlements.map((settlement) => {
      if (settlement.digest) {
        return settlement;
      }
      const wiki = settlement.wikiPaths
        .map((wikiPath) => wikiByPath.get(wikiPath))
        .find(Boolean);
      const digest = wiki
        ? deriveKnowledgeDigest(wiki.content, settlement.title ?? wiki.path.split("/").at(-1)?.replace(/\.md$/i, "") ?? "长期知识", settlement.reason)
        : undefined;
      return digest ? { ...settlement, digest } : settlement;
    });
    const statusText = statusFile ? await this.app.vault.read(statusFile) : undefined;
    const historyResult = await this.loadIngestHistory(
      historyFiles,
      legacyLogFiles,
      statusText,
      wikiByPath
    );
    return {
      records,
      malformedLines,
      rawFiles: rawFiles.length,
      documents,
      wikiLinks: this.collectWikiLinks(wikiFiles),
      settlements,
      settlementFileAvailable: Boolean(settlementFile),
      settlementErrors: parsedSettlements.errors,
      ingestRuns: historyResult.runs,
      ingestHistoryErrors: historyResult.errors,
      knowledgeQueue: statusText ? parseKnowledgeQueueStatus(statusText) : undefined
    };
  }

  private async loadIngestHistory(
    historyFiles: TFile[],
    legacyLogFiles: TFile[],
    statusText: string | undefined,
    wikiByPath: ReadonlyMap<string, WikiDocument>
  ): Promise<{ runs: KnowledgeIngestRun[]; errors: string[] }> {
    const structured: KnowledgeIngestRun[] = [];
    const legacy: KnowledgeIngestRun[] = [];
    const errors: string[] = [];
    const retainedHistoryFiles = [...historyFiles]
      .sort((left, right) => right.stat.mtime - left.stat.mtime)
      .slice(0, 120);
    for (const file of retainedHistoryFiles) {
      const parsed = await this.cachedIngestHistory(file, "structured");
      if (parsed.run) {
        structured.push(parsed.run);
      }
      errors.push(...parsed.errors);
    }

    const earliestStructured = structured
      .map((run) => run.startedAt)
      .sort()[0];
    const legacyCandidates = (historyFiles.length > retainedHistoryFiles.length ? [] : legacyLogFiles)
      .filter((file) => !earliestStructured ||
        Date.parse(legacyTimeFromPath(file.path)) < Date.parse(earliestStructured))
      .slice(0, 30);
    for (const file of legacyCandidates) {
      const parsed = await this.cachedIngestHistory(file, "legacy");
      if (parsed.run) {
        legacy.push(parsed.run);
      }
      errors.push(...parsed.errors);
    }

    const currentResult = statusText
      ? parseCurrentIngestStatus(statusText)
      : { errors: [] };
    errors.push(...currentResult.errors);
    return {
      runs: mergeIngestRuns(structured, legacy, currentResult.run).map((run) => ({
        ...run,
        topicResults: run.topicResults.map((topic) => {
          if (topic.digest) {
            return topic;
          }
          const wiki = topic.wikiPaths.map((wikiPath) => wikiByPath.get(wikiPath)).find(Boolean);
          const digest = wiki
            ? deriveKnowledgeDigest(wiki.content, topic.title, topic.reason)
            : undefined;
          return digest ? { ...topic, digest } : topic;
        })
      })),
      errors
    };
  }

  private async cachedIngestHistory(
    file: TFile,
    kind: "structured" | "legacy"
  ): Promise<IngestHistoryCacheEntry> {
    const cached = this.ingestHistoryCache.get(file.path);
    if (cached?.mtime === file.stat.mtime) {
      return cached;
    }
    const text = kind === "legacy" && file.stat.size > 128 * 1024
      ? ""
      : await this.app.vault.read(file);
    const parsed = kind === "structured"
      ? parseStructuredIngestHistory(text, file.path)
      : parseLegacyIngestLog(text, file.path);
    const entry = { mtime: file.stat.mtime, ...parsed };
    this.ingestHistoryCache.set(file.path, entry);
    return entry;
  }

  private collectWikiLinks(wikiFiles: TFile[]): WikiLink[] {
    const wikiPaths = new Set(wikiFiles.map((file) => file.path));
    const links: WikiLink[] = [];
    for (const [sourcePath, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      if (!wikiPaths.has(sourcePath)) {
        continue;
      }
      const source = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(source instanceof TFile)) {
        continue;
      }
      for (const targetPath of Object.keys(targets)) {
        if (wikiPaths.has(targetPath)) {
          links.push({ sourcePath, targetPath, sourceMtime: source.stat.mtime });
        }
      }
    }
    return links;
  }

  private evictRemoved(rawFiles: TFile[], wikiFiles: TFile[], ingestHistoryFiles: TFile[]): void {
    const rawPaths = new Set(rawFiles.map((file) => file.path));
    const wikiPaths = new Set(wikiFiles.map((file) => file.path));
    const ingestHistoryPaths = new Set(ingestHistoryFiles.map((file) => file.path));
    for (const path of this.rawCache.keys()) {
      if (!rawPaths.has(path)) {
        this.rawCache.delete(path);
      }
    }
    for (const path of this.wikiCache.keys()) {
      if (!wikiPaths.has(path)) {
        this.wikiCache.delete(path);
      }
    }
    for (const path of this.ingestHistoryCache.keys()) {
      if (!ingestHistoryPaths.has(path)) {
        this.ingestHistoryCache.delete(path);
      }
    }
  }
}

function legacyTimeFromPath(value: string): string {
  const match = value.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return match
    ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`
    : "";
}
