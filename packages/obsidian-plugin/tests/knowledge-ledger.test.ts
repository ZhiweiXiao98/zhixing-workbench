import { describe, expect, it } from "vitest";
import { parseKnowledgeLedger, parseKnowledgeQueueStatus } from "../src/core/knowledge-ledger";

describe("parseKnowledgeLedger", () => {
  it("读取成功、失败和无需沉淀状态", () => {
    const parsed = parseKnowledgeLedger(JSON.stringify({
      schema_version: 2,
      outcomes: [{
        id: "outcome:one",
        status: "succeeded",
        source_event_ids: ["prompt", "stop"],
        wiki_paths: ["wiki/我的经历/Obsidian/网页采集恢复.md", "wiki/Obsidian/采集恢复.md"],
        memory_path: "wiki/我的经历/Obsidian/网页采集恢复.md",
        evidence_paths: ["wiki/Obsidian/采集恢复.md"],
        knowledge_changes: [
          { action: "created", path: "wiki/我的经历/Obsidian/网页采集恢复.md", title: "网页采集恢复", role: "memory" },
          { action: "updated", path: "wiki/Obsidian/采集恢复.md", title: "采集恢复", role: "evidence" }
        ],
        updated_at: "2026-07-24T08:00:00.000Z"
      }, {
        id: "outcome:two",
        status: "not-applicable",
        source_event_ids: ["p2", "s2"],
        wiki_paths: [],
        reason: "只包含例行版本号更新",
        updated_at: "2026-07-24T09:00:00.000Z"
      }]
    }));

    expect(parsed.errors).toEqual([]);
    expect(parsed.settlements).toHaveLength(2);
    expect(parsed.settlements[0]).toMatchObject({
      memoryPath: "wiki/我的经历/Obsidian/网页采集恢复.md",
      evidencePaths: ["wiki/Obsidian/采集恢复.md"],
      knowledgeChanges: [{ role: "memory" }, { role: "evidence" }]
    });
    expect(parsed.settlements[1]?.status).toBe("not-applicable");
  });

  it("拒绝没有 Wiki 路径的成功记录", () => {
    const parsed = parseKnowledgeLedger(JSON.stringify({
      outcomes: [{
        id: "outcome:bad",
        status: "succeeded",
        source_event_ids: ["prompt", "stop"],
        wiki_paths: [],
        updated_at: "2026-07-24T08:00:00.000Z"
      }]
    }));
    expect(parsed.settlements).toEqual([]);
    expect(parsed.errors[0]).toContain("没有 wiki_paths");
  });

  it("读取自动化真实产出元数据和主题级队列状态", () => {
    const parsed = parseKnowledgeLedger(JSON.stringify({
      schema_version: 3,
      outcomes: [{
        id: "topic:ai-daily",
        status: "not-applicable",
        category: "durable-output",
        title: "AI 日报 · 2026-07-24",
        source_event_ids: ["p", "s"],
        daily_paths: ["raw/codex/daily/2026-07-24.md"],
        local_date: "2026-07-24",
        occurred_at: "2026-07-24T09:00:00+08:00",
        project_label: "自动化",
        wiki_paths: [],
        reason: "真实产出已记录，当前只有送达凭据",
        updated_at: "2026-07-24T09:01:00.000Z"
      }]
    }));
    expect(parsed.settlements[0]).toMatchObject({
      category: "durable-output",
      title: "AI 日报 · 2026-07-24",
      dailyPaths: ["raw/codex/daily/2026-07-24.md"]
    });

    expect(parseKnowledgeQueueStatus(JSON.stringify({
      raw_pending_pairs: 384,
      candidate_pairs: 265,
      candidate_topics: 50,
      selected_topics: 6,
      deferred_topics: 44,
      no_op_automation_pairs: 95,
      substantive_automation_pairs: 24,
      supporting_pairs: 24,
      remaining_pairs: 360,
      remaining_topics: 46
    }))).toMatchObject({
      rawPendingPairs: 384,
      substantiveAutomationPairs: 24,
      remainingTopics: 46
    });
  });
});
