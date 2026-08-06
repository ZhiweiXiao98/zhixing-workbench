import { describe, expect, it } from "vitest";
import { aggregateOutcomes } from "../src/core/outcomes";
import type { ActivityEvent, ArtifactRecord, KnowledgeSettlement } from "../src/core/types";

describe("aggregateOutcomes", () => {
  it("按任务锚点合并同一天的提交、修复和验证", () => {
    const outcomes = aggregateOutcomes([
      artifact("one", "暂存异步控制", [".agent/tasks/156-async-agent-run-control/task.md", "src/run.ts"]),
      artifact("two", "修复异步停止竞态", [".agent/tasks/156-async-agent-run-control/evidence.md", "src/stop.ts"]),
      artifact("three", "验证异步控制", [".agent/tasks/156-async-agent-run-control/validation.md", "tests/run.test.ts"])
    ], []);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.artifactIds).toHaveLength(3);
    expect(outcomes[0]?.settlement.status).toBe("pending");
  });

  it("同日同项目的完全相同标题合并，不跨项目或跨日期误合并", () => {
    const first = artifact("one", "修复接收器恢复", ["src/a.ts"]);
    const second = artifact("two", "修复接收器恢复", ["src/b.ts"]);
    const otherProject = { ...artifact("three", "修复接收器恢复", ["src/a.ts"]), projectKey: "other", projectLabel: "其他" };
    const otherDate = { ...artifact("four", "修复接收器恢复", ["src/a.ts"]), localDate: "2026-07-25" };
    expect(aggregateOutcomes([first, second, otherProject, otherDate], [])).toHaveLength(3);
  });

  it("以后来的成功重试覆盖旧失败并保持账本中的稳定 ID", () => {
    const evidence = artifact("one", "建立知识沉淀事务", ["src/transaction.ts"]);
    evidence.sourceEventIds = ["prompt", "stop"];
    const settlements: KnowledgeSettlement[] = [{
      id: "failed:one",
      status: "failed",
      sourceEventIds: ["prompt", "stop"],
      wikiPaths: [],
      knowledgeChanges: [],
      updatedAt: "2026-07-24T08:00:00.000Z",
      lastError: "写入失败"
    }, {
      id: "outcome:stable",
      status: "succeeded",
      sourceEventIds: ["prompt", "stop"],
      wikiPaths: ["wiki/Obsidian/知识沉淀事务.md"],
      knowledgeChanges: [{
        action: "created",
        path: "wiki/Obsidian/知识沉淀事务.md",
        title: "知识沉淀事务"
      }],
      updatedAt: "2026-07-24T09:00:00.000Z"
    }];
    const outcome = aggregateOutcomes([evidence], settlements)[0];
    expect(outcome?.id).toBe("outcome:stable");
    expect(outcome?.settlement.status).toBe("succeeded");
  });

  it("即使没有成果卡，也显示已经写入 Wiki 的知识沉淀结果", () => {
    const settlement: KnowledgeSettlement = {
      id: "outcome:knowledge-only",
      status: "succeeded",
      sourceEventIds: ["session:turn:UserPromptSubmit:hash", "session:turn:Stop:hash"],
      wikiPaths: ["wiki/Obsidian/知识沉淀事务.md"],
      knowledgeChanges: [{
        action: "created",
        path: "wiki/Obsidian/知识沉淀事务.md",
        title: "知识沉淀事务"
      }],
      updatedAt: "2026-07-24T09:00:00.000Z",
      reason: "形成了可重试的知识写入路径"
    };
    const outcome = aggregateOutcomes([], [settlement], [taskEvent()])[0];

    expect(outcome?.id).toBe("outcome:knowledge-only");
    expect(outcome?.settlement.status).toBe("succeeded");
    expect(outcome?.wikiRefs[0]?.path).toBe("wiki/Obsidian/知识沉淀事务.md");
    expect(outcome?.problem).toContain("Wiki 写入失败");
  });

  it("把有实际内容的自动化记录作为真实成果展示", () => {
    const settlement: KnowledgeSettlement = {
      id: "topic:ai-daily",
      status: "not-applicable",
      category: "durable-output",
      title: "AI 日报 · 2026-07-24",
      sourceEventIds: ["daily:prompt", "daily:stop"],
      wikiPaths: [],
      knowledgeChanges: [],
      dailyPaths: ["raw/codex/daily/2026-07-24.md"],
      localDate: "2026-07-24",
      occurredAt: "2026-07-24T09:00:00+08:00",
      projectLabel: "自动化",
      updatedAt: "2026-07-24T09:01:00.000Z",
      reason: "AI 日报已送达；当前只有 message_id，不编造正文。"
    };
    const outcome = aggregateOutcomes([], [settlement])[0];

    expect(outcome?.title).toBe("AI 日报 · 2026-07-24");
    expect(outcome?.settlement.category).toBe("durable-output");
    expect(outcome?.sourceRefs[0]?.path).toBe("raw/codex/daily/2026-07-24.md");
  });
});

function artifact(id: string, title: string, files: string[]): ArtifactRecord {
  return {
    id: `artifact:${id}`,
    fingerprint: id,
    localDate: "2026-07-24",
    occurredAt: `2026-07-24T0${id.length}:00:00+08:00`,
    timeBasis: "source",
    projectKey: "project",
    projectLabel: "项目",
    kind: "git-commit",
    title,
    result: title,
    validation: ["Git 提交存在"],
    limitations: [],
    proof: "independent",
    curation: "auto",
    targets: [],
    sourceEventIds: [`git:${id}`],
    sourceRefs: files.map((file) => ({ type: "file", label: file, path: `C:\\repo\\${file}` })),
    notePath: `成果/知行台/2026-07-24/${id}.md`
  };
}

function taskEvent(): ActivityEvent {
  return {
    id: "turn:codex:session:turn",
    kind: "task_progress",
    occurredAt: "2026-07-24T08:00:00.000Z",
    observedAt: "2026-07-24T08:30:00.000Z",
    localDate: "2026-07-24",
    timeBasis: "captured",
    title: "修复知识沉淀链路",
    summary: "Wiki 写入失败后仍被登记为已处理。",
    projectKey: "zhixing",
    projectLabel: "知行台",
    taskKey: "codex:zhixing:session",
    sessionId: "session",
    turnId: "turn",
    confidence: "observed",
    evidence: "完整 Codex turn",
    sourceRefs: [{ type: "codex", label: "来源", path: "raw/codex/daily/2026-07-24.md" }]
  };
}
