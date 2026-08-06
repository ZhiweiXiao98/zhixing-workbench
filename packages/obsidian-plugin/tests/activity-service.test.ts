import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { ActivityService, selectEligibleCodexStops } from "../src/activity-service";
import type { ActivitySnapshot, CapturedRecord } from "../src/core/types";

describe("ActivityService refresh coordination", () => {
  it("runs a follow-up build when a refresh arrives during an active build", async () => {
    const service = new ActivityService({} as App);
    let resolveFirst!: (snapshot: ActivitySnapshot) => void;
    const firstBuild = new Promise<ActivitySnapshot>((resolve) => {
      resolveFirst = resolve;
    });
    const builder = vi.fn()
      .mockReturnValueOnce(firstBuild)
      .mockResolvedValueOnce(snapshot("second"));
    Object.defineProperty(service, "buildSnapshot", { value: builder });

    const observed: string[] = [];
    service.subscribe((value) => observed.push(value.builtAt));
    const firstRefresh = service.refresh();
    await Promise.resolve();
    const queuedRefresh = service.refresh();
    resolveFirst(snapshot("first"));

    await expect(firstRefresh).resolves.toMatchObject({ builtAt: "second" });
    await expect(queuedRefresh).resolves.toMatchObject({ builtAt: "second" });
    expect(builder).toHaveBeenCalledTimes(2);
    expect(observed).toEqual(["first", "second"]);
  });
});

describe("ActivityService artifact source eligibility", () => {
  it("keeps only Stop records from eligible main Codex sessions", () => {
    const records = [
      record("main", "Stop", "codex"),
      record("support", "Stop", "codex"),
      record("main", "UserPromptSubmit", "codex"),
      record("main", "Stop", "chatgpt_web")
    ];

    expect(selectEligibleCodexStops(records, new Set(["main:turn-1"])).map((item) => item.event_id))
      .toEqual(["main-Stop-codex"]);
  });

  it("does not use discussion or handoff Stops to discover artifact targets", () => {
    const records = [
      record("main", "Stop", "codex", "这就清楚了。你需要的是一个方案，建议完成后测试通过。"),
      record("main", "Stop", "codex", "把下面整段发给其他 Agent：请完成开发并确保测试通过。", "turn-2"),
      record("main", "Stop", "codex", "已完成修复，测试通过。", "turn-3")
    ];

    expect(selectEligibleCodexStops(records, new Set(["main:turn-1", "main:turn-2", "main:turn-3"]))
      .map((item) => item.turn_id)).toEqual(["turn-3"]);
  });
});

function snapshot(builtAt: string): ActivitySnapshot {
  return {
    events: [],
    tasks: [],
    artifacts: [],
    outcomes: [],
    ingestRuns: [],
    builtAt,
    diagnostics: {
      rawFiles: 0,
      malformedLines: 0,
      duplicateRecords: 0,
      excludedAutomations: 0,
      excludedSupportingSessions: 0,
      codexSessions: 0,
      chatgptConversations: 0,
      feishuRecords: 0,
      wikiNotes: 0,
      gitRepositories: 0,
      gitErrors: [],
      sessionIndexAvailable: true,
      artifactNotes: 0,
      artifactWriteErrors: [],
      settlementFileAvailable: false,
      settlementErrors: [],
      ingestHistoryErrors: []
    }
  };
}

function record(sessionId: string, event: string, source: string, content = "已完成，测试通过", turnId = "turn-1"): CapturedRecord {
  return {
    schema_version: 1,
    event_id: `${sessionId}-${event}-${source}`,
    captured_at: "2026-07-17T10:00:00+08:00",
    date: "2026-07-17",
    source,
    event,
    session_id: sessionId,
    turn_id: turnId,
    cwd: "C:\\work",
    content,
    sourcePath: "raw/codex/events/2026-07-17.jsonl",
    sourceLine: 1
  };
}
