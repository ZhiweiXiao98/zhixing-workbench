import type { App } from "obsidian";
import { ArtifactWriter } from "./artifact-writer";
import { aggregateTasks } from "./core/aggregate";
import { buildArtifacts, extractLocalPaths, isDirectCompletionReport } from "./core/artifacts";
import { aggregateOutcomes } from "./core/outcomes";
import { buildRawActivityEvents } from "./core/raw-events";
import { classifyReportedStatus, extractMeaningfulPrompt, isAutomationPrompt } from "./core/text";
import type { ActivitySnapshot, BuildDiagnostics, CapturedRecord } from "./core/types";
import { buildWikiEvents, buildWikiReuseEvents } from "./core/wiki-events";
import { reconcileProjectLabels } from "./core/project";
import { scanGitActivity, type GitScanCandidate } from "./sources/git-source";
import { loadSessionTitles } from "./sources/session-index";
import { VaultSource } from "./sources/vault-source";

type Listener = (snapshot: ActivitySnapshot) => void;

export class ActivityService {
  private readonly vaultSource: VaultSource;
  private readonly artifactWriter: ArtifactWriter;
  private readonly listeners = new Set<Listener>();
  private refreshPromise?: Promise<ActivitySnapshot>;
  private debounceTimer?: number;
  private current?: ActivitySnapshot;
  private refreshQueued = false;
  private destroyed = false;

  constructor(private readonly app: App) {
    this.vaultSource = new VaultSource(app);
    this.artifactWriter = new ArtifactWriter(app);
  }

  get snapshot(): ActivitySnapshot | undefined {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.current) {
      listener(this.current);
    }
    return () => this.listeners.delete(listener);
  }

  scheduleRefresh(): void {
    if (this.destroyed) {
      return;
    }
    window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = undefined;
      void this.refresh().catch((error: unknown) => {
        console.error("Activity Ledger background refresh failed", error);
      });
    }, 450);
  }

  async refresh(): Promise<ActivitySnapshot> {
    if (this.destroyed) {
      throw new Error("Activity Ledger service is closed");
    }
    if (this.refreshPromise) {
      this.refreshQueued = true;
      return this.refreshPromise;
    }
    this.refreshPromise = this.refreshUntilCurrent();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  destroy(): void {
    this.destroyed = true;
    window.clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    this.refreshQueued = false;
    this.listeners.clear();
  }

  private async refreshUntilCurrent(): Promise<ActivitySnapshot> {
    let snapshot: ActivitySnapshot;
    do {
      this.refreshQueued = false;
      snapshot = await this.buildSnapshot();
      if (!this.destroyed) {
        this.current = snapshot;
        for (const listener of this.listeners) {
          listener(snapshot);
        }
      }
    } while (this.refreshQueued && !this.destroyed);
    return snapshot;
  }

  private async buildSnapshot(): Promise<ActivitySnapshot> {
    const [vault, sessionIndex] = await Promise.all([
      this.vaultSource.load(),
      loadSessionTitles()
    ]);
    const sessionTitles = sessionIndex.titles;
    const raw = buildRawActivityEvents(vault.records, sessionTitles);
    const rawById = new Map(vault.records.map((record) => [record.event_id, record]));
    const wikiEvents = buildWikiEvents(vault.documents, rawById);
    const wikiByPath = new Map(vault.documents.map((document) => [document.path, document]));
    const reuseEvents = buildWikiReuseEvents(vault.wikiLinks, wikiByPath);

    const eligibleCodexRecords = vault.records.filter((record) =>
      record.source === "codex" &&
      record.event === "UserPromptSubmit" &&
      sessionTitles.has(record.session_id) &&
      !isAutomationPrompt(record.content) &&
      Boolean(extractMeaningfulPrompt(record.content))
    );
    const eligibleTurnKeys = new Set(eligibleCodexRecords.map(recordTurnKey));
    const eligibleStops = selectEligibleCodexStops(vault.records, eligibleTurnKeys);
    const gitCandidates: GitScanCandidate[] = [
      ...eligibleStops.flatMap((record) => extractLocalPaths(record.content).map((targetPath) => ({
        path: targetPath,
        observedAt: record.captured_at,
        kind: "reported" as const
      }))),
      ...eligibleCodexRecords.filter((record) => Boolean(record.cwd)).map((record) => ({
        path: record.cwd,
        observedAt: record.captured_at,
        kind: "cwd" as const
      }))
    ];
    const sinceDate = vault.records.map((record) => record.date).filter(Boolean).sort()[0] ?? "1970-01-01";
    const git = await scanGitActivity(gitCandidates, sinceDate);

    const events = reconcileProjectLabels([...raw.events, ...wikiEvents, ...reuseEvents, ...git.events])
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    const artifactCandidates = await buildArtifacts({
      records: eligibleStops,
      events,
      wikiDocuments: vault.documents
    });
    const artifactSync = await this.artifactWriter.sync(artifactCandidates);
    const artifacts = artifactCandidates.filter((artifact) => artifactSync.persistedIds.has(artifact.id));
    const outcomes = aggregateOutcomes(artifacts, vault.settlements, events);
    const diagnostics: BuildDiagnostics = {
      rawFiles: vault.rawFiles,
      malformedLines: vault.malformedLines,
      duplicateRecords: raw.duplicateRecords,
      excludedAutomations: raw.excludedAutomations,
      excludedSupportingSessions: raw.excludedSupportingSessions,
      codexSessions: raw.codexSessions,
      chatgptConversations: raw.chatgptConversations,
      feishuRecords: raw.feishuRecords,
      wikiNotes: vault.documents.length,
      gitRepositories: git.repositories,
      gitErrors: git.errors,
      sessionIndexAvailable: sessionIndex.available,
      artifactNotes: artifacts.length,
      artifactWriteErrors: artifactSync.errors,
      settlementFileAvailable: vault.settlementFileAvailable,
      settlementErrors: vault.settlementErrors,
      ingestHistoryErrors: vault.ingestHistoryErrors,
      knowledgeQueue: vault.knowledgeQueue
    };
    return {
      events,
      tasks: aggregateTasks(events),
      artifacts,
      outcomes,
      ingestRuns: vault.ingestRuns,
      builtAt: new Date().toISOString(),
      diagnostics
    };
  }
}

export function selectEligibleCodexStops(
  records: readonly CapturedRecord[],
  eligibleTurnKeys: ReadonlySet<string>
): CapturedRecord[] {
  return records.filter((record) =>
    record.source === "codex" &&
    record.event === "Stop" &&
    eligibleTurnKeys.has(recordTurnKey(record)) &&
    isDirectCompletionReport(record.content) &&
    classifyReportedStatus(record.content) === "completed"
  );
}

function recordTurnKey(record: Pick<CapturedRecord, "session_id" | "turn_id">): string {
  return `${record.session_id}:${record.turn_id}`;
}

export function isActivityPath(path: string): boolean {
  return /^raw\/(codex|chatgpt|feishu)\/(events|daily)\//i.test(path) ||
    /^raw\/codex\/(ingest-history\/|automation\/.*\.log$|ingest-status\.json$|knowledge-settlements\.json$)/i.test(path) ||
    path.startsWith("wiki/");
}
