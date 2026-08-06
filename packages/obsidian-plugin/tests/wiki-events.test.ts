import { describe, expect, it } from "vitest";
import type { CapturedRecord } from "../src/core/types";
import { buildWikiEvents, buildWikiReuseEvents, type WikiDocument } from "../src/core/wiki-events";

describe("wiki knowledge events", () => {
  it("counts multiple source markers from one note on one day as one knowledge contribution", () => {
    const first = record("prompt-a", "2026-07-16T09:00:00+08:00");
    const second = record("prompt-b", "2026-07-16T11:00:00+08:00");
    const document = wiki(`
# 日历设计
<!-- codex-source:prompt=prompt-a;stop=stop-a -->
<!-- codex-source:prompt=prompt-b;stop=stop-b -->
`);
    const events = buildWikiEvents([document], new Map([
      [first.event_id, first],
      [second.event_id, second]
    ]));
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("knowledge_created");
    expect(events[0]?.localDate).toBe("2026-07-16");
  });

  it("does not treat raw source links as knowledge reuse", () => {
    const source = wiki("# 来源", "wiki/来源.md");
    const target = wiki("# 目标", "wiki/目标.md");
    const docs = new Map([[source.path, source], [target.path, target]]);
    const events = buildWikiReuseEvents([
      { sourcePath: "wiki/来源.md", targetPath: "raw/codex/daily/2026-07-17.md", sourceMtime: source.mtime },
      { sourcePath: "wiki/来源.md", targetPath: "wiki/目标.md", sourceMtime: source.mtime }
    ], docs);
    expect(events).toHaveLength(1);
    expect(events[0]?.objectKey).toContain("wiki/来源.md->wiki/目标.md");
    expect(events[0]?.confidence).toBe("inferred");
    expect(events[0]?.evidence).toContain("修改时间估算");
  });
});

function wiki(content: string, path = "wiki/日历设计.md"): WikiDocument {
  return { path, content, ctime: Date.parse("2026-07-16T12:00:00+08:00"), mtime: Date.parse("2026-07-17T12:00:00+08:00") };
}

function record(id: string, capturedAt: string): CapturedRecord {
  return {
    schema_version: 1,
    event_id: id,
    captured_at: capturedAt,
    date: capturedAt.slice(0, 10),
    source: "codex",
    event: "UserPromptSubmit",
    session_id: "session",
    turn_id: id,
    cwd: "C:\\demo-project",
    content: "内容",
    sourcePath: `raw/codex/events/${capturedAt.slice(0, 10)}.jsonl`,
    sourceLine: 1
  };
}
