import { describe, expect, it } from "vitest";
import { aggregateTasks, metricsForRange, summarizeCalendarDay } from "../src/core/aggregate";
import type { ActivityEvent, OutcomeAggregate } from "../src/core/types";

describe("task and metric aggregation", () => {
  it("merges a stable session across days without filling inactive days", () => {
    const events = [
      event({ id: "a", localDate: "2026-07-15", occurredAt: "2026-07-15T10:00:00+08:00", kind: "task_started" }),
      event({ id: "b", localDate: "2026-07-17", occurredAt: "2026-07-17T10:00:00+08:00", kind: "task_progress" })
    ];
    const tasks = aggregateTasks(events);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.activeDates).toEqual(["2026-07-15", "2026-07-17"]);
    expect(tasks[0]?.status).toBe("active");
  });

  it("reopens a task when progress occurs after a reported completion", () => {
    const events = [
      event({ id: "done", kind: "task_completed", occurredAt: "2026-07-16T10:00:00+08:00" }),
      event({ id: "again", kind: "task_progress", occurredAt: "2026-07-16T11:00:00+08:00" })
    ];
    expect(aggregateTasks(events)[0]?.status).toBe("active");
  });

  it("deduplicates one output fact seen twice and keeps drilldown equal to the metric", () => {
    const outputs = [
      event({ id: "git-1", kind: "output_created", objectKey: "repo:abc" }),
      event({ id: "adapter-2", kind: "output_created", objectKey: "repo:abc" })
    ];
    const metrics = metricsForRange(outputs, { start: "2026-07-16", end: "2026-07-16" }, { projectKey: "all", confidence: "all" });
    const output = metrics.find((metric) => metric.dimension === "output");
    expect(output?.value).toBe(1);
    expect(output?.events).toHaveLength(output?.value ?? -1);
  });

  it("uses real outcomes instead of counting the underlying commits as separate outputs", () => {
    const outputs = [
      event({ id: "git-1", kind: "output_created", objectKey: "repo:a" }),
      event({ id: "git-2", kind: "output_created", objectKey: "repo:b" })
    ];
    const metrics = metricsForRange(
      outputs,
      { start: "2026-07-16", end: "2026-07-16" },
      { projectKey: "all", confidence: "all" },
      [outcome()]
    );
    const output = metrics.find((metric) => metric.dimension === "output");

    expect(output?.value).toBe(1);
    expect(output?.events).toHaveLength(1);
    expect(output?.events[0]?.id).toBe("outcome:one");
    expect(output?.events[0]?.evidence).toContain("2 条底层证据");
    expect(output?.note).toContain("同一真实任务");
  });

  it("counts A,A,B,B as one short-interval project switch", () => {
    const events = [
      event({ id: "a1", occurredAt: "2026-07-16T09:00:00+08:00", projectKey: "a", projectLabel: "A", taskKey: "task-a" }),
      event({ id: "a2", occurredAt: "2026-07-16T09:10:00+08:00", projectKey: "a", projectLabel: "A", taskKey: "task-a", kind: "task_completed" }),
      event({ id: "b1", occurredAt: "2026-07-16T09:20:00+08:00", projectKey: "b", projectLabel: "B", taskKey: "task-b", sessionId: "session-b" }),
      event({ id: "b2", occurredAt: "2026-07-16T09:30:00+08:00", projectKey: "b", projectLabel: "B", taskKey: "task-b", sessionId: "session-b", kind: "task_completed" })
    ];
    const focus = metricsForRange(events, { start: "2026-07-16", end: "2026-07-16" }, { projectKey: "all", confidence: "all" })
      .find((metric) => metric.dimension === "focus");
    expect(focus?.value).toBe(1);
    expect(focus?.events).toHaveLength(1);
  });

  it("counts one task at most once per active day and keeps every drilldown equal to its metric", () => {
    const events = [
      event({ id: "prompt", kind: "task_started", occurredAt: "2026-07-16T09:00:00+08:00" }),
      event({ id: "outcome", kind: "task_completed", occurredAt: "2026-07-16T09:40:00+08:00" }),
      event({ id: "next-day", kind: "task_progress", localDate: "2026-07-17", occurredAt: "2026-07-17T09:00:00+08:00" })
    ];
    const metrics = metricsForRange(events, { start: "2026-07-16", end: "2026-07-17" }, { projectKey: "all", confidence: "all" });
    const activity = metrics.find((metric) => metric.dimension === "activity");

    expect(activity?.label).toBe("任务推进");
    expect(activity?.value).toBe(2);
    expect(activity?.events.map((item) => item.id)).toEqual(["outcome", "next-day"]);
    expect(metrics.every((metric) => metric.value === metric.events.length)).toBe(true);
  });

  it("does not manufacture switches from interleaved outcomes of concurrent tasks", () => {
    const events = [
      event({ id: "a-start", occurredAt: "2026-07-16T09:00:00+08:00", projectKey: "a", projectLabel: "A", taskKey: "task-a" }),
      event({ id: "b-start", occurredAt: "2026-07-16T09:10:00+08:00", projectKey: "b", projectLabel: "B", taskKey: "task-b", sessionId: "session-b" }),
      event({ id: "a-end", occurredAt: "2026-07-16T09:20:00+08:00", projectKey: "a", projectLabel: "A", taskKey: "task-a", kind: "task_completed" }),
      event({ id: "b-end", occurredAt: "2026-07-16T09:30:00+08:00", projectKey: "b", projectLabel: "B", taskKey: "task-b", sessionId: "session-b", kind: "task_completed" })
    ];
    const metrics = metricsForRange(events, { start: "2026-07-16", end: "2026-07-16" }, { projectKey: "all", confidence: "all" });

    expect(metrics.find((metric) => metric.dimension === "activity")?.value).toBe(2);
    expect(metrics.find((metric) => metric.dimension === "focus")?.value).toBe(1);
  });

  it("shows no knowledge coverage claim when the denominator is zero", () => {
    const knowledge = metricsForRange([], { start: "2026-07-16", end: "2026-07-16" }, { projectKey: "all", confidence: "all" })
      .find((metric) => metric.dimension === "knowledge");
    expect(knowledge?.note).toBe("暂无知识数据");
    expect(knowledge?.note).not.toMatch(/NaN|100%|0%/);
  });

  it("calendar counts a task once per day despite multiple turns", () => {
    const summary = summarizeCalendarDay("2026-07-16", [event({ id: "one" }), event({ id: "two" })]);
    expect(summary.tasks).toBe(1);
  });

  it("counts prompt and outcome events from one turn as one task turn", () => {
    const task = aggregateTasks([
      event({ id: "prompt", turnId: "turn-1", kind: "task_started" }),
      event({ id: "outcome", turnId: "turn-1", kind: "task_completed", occurredAt: "2026-07-16T09:10:00+08:00" })
    ])[0];
    expect(task?.turnCount).toBe(1);
    expect(task?.status).toBe("completed");
  });

  it("counts equal turn ids from different sessions as separate task turns", () => {
    const task = aggregateTasks([
      event({ id: "first", sessionId: "session-a", turnId: "turn-1" }),
      event({ id: "second", sessionId: "session-b", turnId: "turn-1" })
    ])[0];
    expect(task?.turnCount).toBe(2);
  });
});

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  const occurredAt = overrides.occurredAt ?? "2026-07-16T09:00:00+08:00";
  return {
    id: "event",
    kind: "task_progress",
    occurredAt,
    observedAt: occurredAt,
    localDate: overrides.localDate ?? "2026-07-16",
    timeBasis: "captured",
    title: "任务",
    summary: "任务推进",
    projectKey: "project",
    projectLabel: "Project",
    taskKey: "codex:session",
    sessionId: "session",
    confidence: "observed",
    evidence: "完整 turn",
    sourceRefs: [{ type: "codex", label: "来源", path: "raw/codex/daily/2026-07-16.md" }],
    ...overrides
  };
}

function outcome(overrides: Partial<OutcomeAggregate> = {}): OutcomeAggregate {
  return {
    id: "outcome:one",
    localDate: "2026-07-16",
    occurredAt: "2026-07-16T10:00:00+08:00",
    projectKey: "project",
    projectLabel: "Project",
    title: "完成知识沉淀闭环",
    problem: "同一任务的多个提交被重复计数。",
    summary: "已按真实任务合并。",
    proof: "independent",
    taskKeys: ["codex:session"],
    artifactIds: ["artifact:a", "artifact:b"],
    eventIds: ["event:a", "event:b"],
    sourceRefs: [{ type: "git", label: "提交证据" }],
    wikiRefs: [{ type: "wiki", label: "知识沉淀闭环", path: "wiki/知识沉淀闭环.md" }],
    knowledgeChanges: [{ action: "created", path: "wiki/知识沉淀闭环.md", title: "知识沉淀闭环" }],
    settlement: { status: "succeeded" },
    reuseCount: 0,
    ...overrides
  };
}
