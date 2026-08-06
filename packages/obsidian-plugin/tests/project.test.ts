import { describe, expect, it } from "vitest";
import { reconcileProjectLabels } from "../src/core/project";
import type { ActivityEvent, SourceType } from "../src/core/types";

describe("project identity", () => {
  it("uses the Codex workspace spelling for events sharing the same project key", () => {
    const events = reconcileProjectLabels([
      event("git", "demo-project"),
      event("codex", "Demo-Project")
    ]);

    expect(events.map((item) => item.projectLabel)).toEqual(["Demo-Project", "Demo-Project"]);
    expect(new Set(events.map((item) => item.projectKey))).toEqual(new Set(["demo-project"]));
  });

  it("keeps a Git label when no local workspace or Wiki spelling is available", () => {
    expect(reconcileProjectLabels([event("git", "demo-project")])[0]?.projectLabel).toBe("demo-project");
  });
});

function event(sourceType: SourceType, projectLabel: string): ActivityEvent {
  return {
    id: `${sourceType}:${projectLabel}`,
    kind: sourceType === "git" ? "output_created" : "task_started",
    occurredAt: "2026-07-17T10:00:00+08:00",
    observedAt: "2026-07-17T10:00:00+08:00",
    localDate: "2026-07-17",
    timeBasis: "source",
    title: "项目活动",
    summary: "项目活动",
    projectKey: projectLabel.toLocaleLowerCase(),
    projectLabel,
    confidence: sourceType === "git" ? "verified" : "observed",
    evidence: "测试证据",
    sourceRefs: [{ type: sourceType, label: "来源" }]
  };
}
