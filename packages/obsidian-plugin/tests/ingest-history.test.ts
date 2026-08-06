import { describe, expect, it } from "vitest";
import {
  mergeIngestRuns,
  parseCurrentIngestStatus,
  parseLegacyIngestLog,
  parseStructuredIngestHistory
} from "../src/core/ingest-history";

describe("整理历史", () => {
  it("读取结构化运行记录、尝试次数和主题去向", () => {
    const parsed = parseStructuredIngestHistory(JSON.stringify({
      schema_version: 1,
      run_id: "night-1",
      started_at: "2026-07-24T23:30:00+08:00",
      finished_at: "2026-07-24T23:33:00+08:00",
      status: "partial",
      trigger: "automatic",
      selected_topics: 2,
      committed: 1,
      pending: 1,
      failed: 0,
      remaining_topics: 4,
      remaining_pairs: 9,
      attempts: [{ id: "a" }, { id: "b" }],
      topic_results: [{
        id: "receiver",
        title: "恢复网页接收器",
        status: "succeeded",
        wiki_paths: ["wiki/我的经历/Obsidian/网页采集恢复.md", "wiki/Obsidian/接收器恢复.md"],
        memory_path: "wiki/我的经历/Obsidian/网页采集恢复.md",
        evidence_paths: ["wiki/Obsidian/接收器恢复.md"],
        knowledge_changes: [{
          action: "created",
          path: "wiki/我的经历/Obsidian/网页采集恢复.md",
          title: "网页采集恢复",
          role: "memory"
        }, {
          action: "updated",
          path: "wiki/Obsidian/接收器恢复.md",
          title: "接收器恢复",
          role: "evidence"
        }],
        daily_paths: ["raw/codex/daily/2026-07-24.md"],
        source_event_count: 4
      }]
    }), "raw/codex/ingest-history/night-1.json");

    expect(parsed.errors).toEqual([]);
    expect(parsed.run).toMatchObject({
      runId: "night-1",
      status: "partial",
      trigger: "automatic",
      committedTopics: 1,
      pendingTopics: 1,
      attemptCount: 2
    });
    expect(parsed.run?.topicResults[0]).toMatchObject({
      memoryPath: "wiki/我的经历/Obsidian/网页采集恢复.md",
      evidencePaths: ["wiki/Obsidian/接收器恢复.md"],
      wikiChanges: [{ role: "memory" }, { role: "evidence" }]
    });
  });

  it("旧日志不会把进程退出码或正文中的状态冒充已验证成功", () => {
    const parsed = parseLegacyIngestLog([
      "started_at=2026-07-23T23:30:00+08:00",
      "exit_code=0",
      "",
      "[codex_stderr]",
      "verified_status=succeeded",
      "Wiki 写入失败"
    ].join("\n"), "raw/codex/automation/2026-07-23-233000.log");

    expect(parsed.run).toMatchObject({
      status: "unknown",
      trigger: "legacy",
      startedAt: "2026-07-23T23:30:00+08:00"
    });
  });

  it("最近状态只作为无主题明细的确认摘要", () => {
    const parsed = parseCurrentIngestStatus(JSON.stringify({
      run_id: "manual-retry",
      status: "succeeded",
      updated_at: "2026-07-24T18:08:00+08:00",
      committed: 1,
      remaining_topics: 3,
      remaining_pairs: 6
    }));

    expect(parsed.run?.source).toBe("current-status");
    expect(parsed.run?.finishedAt).toBeUndefined();
    expect(parsed.run?.topicResults).toEqual([]);
  });

  it("旧日志在首个空行停止读头，正文状态不能污染结果", () => {
    const parsed = parseLegacyIngestLog([
      "started_at=2026-07-22T23:30:00+08:00",
      "exit_code=0",
      "",
      "verified_status=succeeded",
      "Wiki 写入失败"
    ].join("\n"), "raw/codex/automation/2026-07-22-233000.log");

    expect(parsed.run?.status).toBe("unknown");
  });

  it("结构化记录优先于同一运行的旧日志", () => {
    const structured = parseStructuredIngestHistory(JSON.stringify({
      run_id: "same-run",
      started_at: "2026-07-24T23:30:00+08:00",
      finished_at: "2026-07-24T23:31:00+08:00",
      status: "succeeded",
      trigger: "automatic"
    }), "raw/codex/ingest-history/same-run.json").run!;
    const legacy = {
      ...structured,
      id: "legacy",
      status: "unknown" as const,
      source: "legacy-log" as const
    };

    expect(mergeIngestRuns([structured], [legacy])).toEqual([structured]);
  });
});
