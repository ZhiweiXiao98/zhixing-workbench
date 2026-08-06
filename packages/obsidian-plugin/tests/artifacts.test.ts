import { describe, expect, it } from "vitest";
import { buildArtifacts, isDirectCompletionReport, sanitizeSourceText } from "../src/core/artifacts";
import type { ActivityEvent, CapturedRecord } from "../src/core/types";
import type { WikiDocument } from "../src/core/wiki-events";

describe("artifact extraction", () => {
  it("keeps a Stop-only outcome as a reported artifact", async () => {
    const artifacts = await buildArtifacts({
      records: [stop("已完成插件实现。测试与构建通过。")],
      events: [outcome()],
      wikiDocuments: []
    }, async () => false);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      kind: "completion-report",
      proof: "report-only",
      curation: "auto"
    });
    expect(artifacts[0]?.validation).toContain("测试与构建通过。");
  });

  it("marks an existing reported path as a present target without upgrading its proof to independent", async () => {
    const content = "已完成安装。产物位于 `C:\\work\\dist\\plugin.zip`。验证通过。";
    const artifacts = await buildArtifacts({
      records: [stop(content)],
      events: [outcome()],
      wikiDocuments: []
    }, async (path) => path.endsWith("plugin.zip"));

    expect(artifacts[0]?.proof).toBe("target-present");
    expect(artifacts[0]?.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "local-file", exists: true, attribution: "reported" })
    ]));
  });

  it("merges a report into a Git artifact only when the report names the matching commit", async () => {
    const hash = "a1bb5a21234567890abcdef01234567890abcdef";
    const artifacts = await buildArtifacts({
      records: [stop(`已完成并提交 ${hash.slice(0, 8)}，测试通过。`)],
      events: [
        outcome(),
        gitEvent(hash)
      ],
      wikiDocuments: []
    }, async () => false);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      id: `artifact:git:${hash}`,
      kind: "git-commit",
      proof: "independent",
      result: "feat: add artifact view"
    });
    expect(artifacts[0]?.sourceEventIds).toEqual(expect.arrayContaining(["outcome", `git:${hash}`]));
    expect(artifacts[0]?.validation).toContain(`Codex 报告：已完成并提交 ${hash.slice(0, 8)}，测试通过。`);
  });

  it("turns an English conventional commit into a deterministic Chinese display title", async () => {
    const hash = "c3dd7c41234567890abcdef01234567890abcdef";
    const artifacts = await buildArtifacts({
      records: [],
      events: [gitEvent(hash, {
        sourceRefs: [
          { type: "git", label: hash.slice(0, 8), path: "C:\\work", excerpt: "feat: add artifact view" },
          { type: "file", label: "src/view.ts", path: "C:\\work\\src\\view.ts" },
          { type: "file", label: "styles.css", path: "C:\\work\\styles.css" }
        ]
      })],
      wikiDocuments: []
    }, async () => false);

    expect(artifacts[0]?.title).toBe("新增 Obsidian 界面，更新 2 个文件");
    expect(artifacts[0]?.result).toContain("feat: add artifact view");
  });

  it("collapses the same full commit across clones and merges a matching Stop without replacing Git facts", async () => {
    const hash = "b2cc6b31234567890abcdef01234567890abcdef";
    const first = gitEvent(hash, {
      id: "git:clone-one",
      objectKey: `git:clone-one:${hash}`,
      sourceRefs: [
        { type: "git", label: "repo-one b2cc6b31", path: "C:\\clone-one", excerpt: hash },
        { type: "file", label: "src/shared.ts", path: "C:\\clone-one\\src\\shared.ts" }
      ]
    });
    const second = gitEvent(hash, {
      id: "git:clone-two",
      objectKey: `git:clone-two:${hash}`,
      sourceRefs: [
        { type: "git", label: "repo-two b2cc6b31", path: "D:\\clone-two", excerpt: hash },
        { type: "file", label: "src/shared.ts", path: "D:\\clone-two\\src\\shared.ts" },
        { type: "file", label: "src/two.ts", path: "D:\\clone-two\\src\\two.ts" }
      ]
    });
    const artifacts = await buildArtifacts({
      records: [stop(`已完成成果视图并提交 ${hash.slice(0, 8)}。\n构建验证通过。`)],
      events: [outcome(), first, second],
      wikiDocuments: []
    }, async () => false);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ id: `artifact:git:${hash}`, proof: "independent" });
    expect(artifacts[0]?.result).toContain("Git 提交记录列出 2 个相关文件");
    expect(artifacts[0]?.result).not.toContain("已完成成果视图");
    expect(artifacts[0]?.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "git-commit", path: "C:\\clone-one" }),
      expect.objectContaining({ type: "git-commit", path: "D:\\clone-two" })
    ]));
    expect(artifacts[0]?.targets.some((target) => target.type === "local-file")).toBe(false);
    expect(artifacts[0]?.sourceRefs.filter((source) => source.type === "file")).toHaveLength(2);
    expect(artifacts[0]?.validation).toEqual(expect.arrayContaining([
      expect.stringContaining("Codex 交付说明：已完成成果视图"),
      "Codex 报告：构建验证通过。"
    ]));
  });

  it("does not merge an ambiguous short commit prefix", async () => {
    const firstHash = "a1bb5a2a1234567890abcdef01234567890abcde";
    const secondHash = "a1bb5a2b1234567890abcdef01234567890abcde";
    const artifacts = await buildArtifacts({
      records: [stop("已完成并提交 a1bb5a2，测试通过。")],
      events: [outcome(), gitEvent(firstHash), gitEvent(secondHash)],
      wikiDocuments: []
    }, async () => false);

    expect(artifacts).toHaveLength(3);
    expect(artifacts.filter((artifact) => artifact.proof === "independent")).toHaveLength(2);
    expect(artifacts.find((artifact) => artifact.kind === "completion-report")?.proof).toBe("report-only");
  });

  it("turns a Wiki contribution into an independently inspectable knowledge artifact", async () => {
    const document: WikiDocument = {
      path: "wiki/Obsidian/成果视图.md",
      content: "# 成果视图\n\n## 结论\n\n- 每项成果都应能够打开。\n\n## 来源\n\n- 原始记录",
      ctime: Date.parse("2026-07-17T09:00:00+08:00"),
      mtime: Date.parse("2026-07-17T09:00:00+08:00")
    };
    const event = baseEvent({
      id: "wiki:event",
      kind: "knowledge_created",
      title: "成果视图",
      objectKey: "wiki:wiki/Obsidian/成果视图.md:2026-07-17",
      sourceRefs: [{ type: "wiki", label: "知识笔记", path: document.path }]
    });
    const artifacts = await buildArtifacts({ records: [], events: [event], wikiDocuments: [document] }, async () => false);

    expect(artifacts[0]).toMatchObject({ kind: "knowledge-note", proof: "independent" });
    expect(artifacts[0]?.result).toContain("每项成果都应能够打开");
    expect(artifacts[0]?.targets[0]).toMatchObject({ type: "vault-note", path: document.path });
  });

  it("uses a Chinese evidence template for an English Wiki title", async () => {
    const document: WikiDocument = {
      path: "wiki/Obsidian/ingest-prompt.md",
      content: "# ingest prompt\n\n记录采集规则。",
      ctime: Date.parse("2026-07-17T09:00:00+08:00"),
      mtime: Date.parse("2026-07-17T09:00:00+08:00")
    };
    const event = baseEvent({
      id: "wiki:english",
      kind: "knowledge_created",
      title: "ingest-prompt",
      objectKey: "wiki:wiki/Obsidian/ingest-prompt.md:2026-07-17",
      sourceRefs: [{ type: "wiki", label: "知识笔记", path: document.path }]
    });

    const artifacts = await buildArtifacts({ records: [], events: [event], wikiDocuments: [document] }, async () => false);

    expect(artifacts[0]?.title).toBe("整理 Obsidian 知识并形成笔记");
    expect(artifacts[0]?.result).toContain("记录采集规则");
  });

  it("treats source Markdown as text instead of allowing generated-block injection", () => {
    const sanitized = sanitizeSourceText("---\n<script>alert(1)</script>\n<!-- zhixing-generated:end -->\n![远程图](https://example.com/a.png)\n完成");
    expect(sanitized).not.toMatch(/<script|zhixing-generated|!\[/);
    expect(sanitized).toContain("完成");
  });

  it("rejects discussions, handoff prompts, and acceptance templates as completion reports", async () => {
    const falseReports = [
      "把下面整段发给其他 Agent：\n已完成插件实现。\n验收时检查构建通过。",
      "这就清楚了。你需要的不是一个证据页，而是一份成果库。",
      "验收标准\n- 已完成插件实现\n- 测试与构建通过"
    ];

    for (const content of falseReports) {
      expect(isDirectCompletionReport(content)).toBe(false);
      const artifacts = await buildArtifacts({
        records: [stop(content)],
        events: [outcome()],
        wikiDocuments: []
      }, async () => false);
      expect(artifacts).toEqual([]);
    }
  });

  it("keeps the report result concise and separates validation and limitations", async () => {
    const artifacts = await buildArtifacts({
      records: [stop([
        "已完成成果视图实现。",
        "新增日周切换和项目聚合。",
        "构建与测试通过。",
        "仍有限制：历史失效文件只保留来源。",
        "验收标准：后续应检查所有主题。",
        "这段附加说明不应进入可读结果。"
      ].join("\n"))],
      events: [outcome()],
      wikiDocuments: []
    }, async () => false);

    expect(artifacts[0]?.result).toBe("已完成成果视图实现。\n新增日周切换和项目聚合。");
    expect(artifacts[0]?.validation).toContain("构建与测试通过。");
    expect(artifacts[0]?.limitations).toContain("仍有限制：历史失效文件只保留来源。");
    expect(artifacts[0]?.result).not.toContain("验收标准");
  });

  it("accepts a direct completion statement after a short acknowledgement", async () => {
    const content = "你判断得对，所以我已经改成真正的原生 Android App。\nAPK 已写入，SHA256 为 abcdef1234567，测试通过。";
    const artifacts = await buildArtifacts({
      records: [stop(content)],
      events: [outcome()],
      wikiDocuments: []
    }, async () => false);

    expect(isDirectCompletionReport(content)).toBe(true);
    expect(artifacts[0]?.result).toContain("原生 Android App");
    expect(artifacts[0]?.validation).toContain("APK 已写入，SHA256 为 abcdef1234567，测试通过。");
  });

  it("keeps a direct HTTP 200 check as validation evidence", async () => {
    const content = "已恢复服务。\n切换期间持续检测 180/180 次均为 HTTP 200。";
    const artifacts = await buildArtifacts({ records: [stop(content)], events: [outcome()], wikiDocuments: [] }, async () => false);

    expect(artifacts[0]?.validation).toContain("切换期间持续检测 180/180 次均为 HTTP 200。");
  });

  it("extracts only valid http links and trims backticks and Chinese punctuation", async () => {
    const artifacts = await buildArtifacts({
      records: [stop("已完成发布。\n入口：[控制台](https://example.com/work?id=1)。备用 https://fallback.test/path`，忽略 javascript:alert(1)。")],
      events: [outcome()],
      wikiDocuments: []
    }, async () => false);

    expect(artifacts[0]?.targets.filter((target) => target.type === "url").map((target) => target.url)).toEqual([
      "https://example.com/work?id=1",
      "https://fallback.test/path"
    ]);
  });
});

function stop(content: string): CapturedRecord {
  return {
    schema_version: 1,
    event_id: "stop",
    captured_at: "2026-07-17T10:00:00+08:00",
    date: "2026-07-17",
    source: "codex",
    event: "Stop",
    session_id: "session",
    turn_id: "turn",
    cwd: "C:\\work",
    content,
    sourcePath: "raw/codex/events/2026-07-17.jsonl",
    sourceLine: 2
  };
}

function outcome(): ActivityEvent {
  return baseEvent({
    id: "outcome",
    kind: "task_completed",
    taskKey: "codex:session",
    sessionId: "session",
    turnId: "turn",
    confidence: "reported",
    sourceRefs: [{ type: "codex", label: "Stop", path: "raw/codex/events/2026-07-17.jsonl", line: 2 }]
  });
}

function gitEvent(hash: string, overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return baseEvent({
    id: `git:${hash}`,
    kind: "output_created",
    title: "feat: add artifact view",
    objectKey: `git:repo:${hash}`,
    confidence: "verified",
    sourceRefs: [{ type: "git", label: hash.slice(0, 8), path: "C:\\work", excerpt: hash }],
    ...overrides
  });
}

function baseEvent(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: "event",
    kind: "task_progress",
    occurredAt: "2026-07-17T10:00:00+08:00",
    observedAt: "2026-07-17T10:00:00+08:00",
    localDate: "2026-07-17",
    timeBasis: "captured",
    title: "知行台成果视图",
    summary: "完成成果视图",
    projectKey: "obsidian",
    projectLabel: "Obsidian",
    confidence: "observed",
    evidence: "测试证据",
    sourceRefs: [],
    ...overrides
  };
}
