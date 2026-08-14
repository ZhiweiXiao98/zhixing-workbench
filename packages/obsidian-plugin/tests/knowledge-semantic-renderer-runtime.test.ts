import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error The renderer is a Node ESM automation module.
import { renderSemanticOutcome } from "../../runtime/src/knowledge-semantic-renderer.mjs";

describe("knowledge semantic renderer", () => {
  it("把纯语义结果渲染成可提交的双层中文知识文档", () => {
    const rendered = renderSemanticOutcome({
      topic: topic(),
      pairs: [pair("new")],
      outcome: succeeded(),
      now: new Date("2026-07-29T01:00:00.000Z")
    });

    expect(rendered).toMatchObject({
      id: "topic:receiver",
      status: "succeeded",
      source_event_ids: ["new:prompt", "new:stop"],
      digest: {
        about: expect.stringContaining("网页对话"),
        next_use: expect.stringContaining("健康端点")
      }
    });
    expect(rendered.wiki_updates[0]).toMatchObject({
      action: "created",
      path: "wiki/Obsidian/网页采集接收器的恢复与验证.md",
      expected_sha256: ""
    });
    expect(rendered.memory_update).toMatchObject({
      action: "created",
      path: "wiki/我的经历/Obsidian/网页对话为什么突然没有进入知识库.md",
      expected_sha256: ""
    });
    expect(rendered.wiki_updates[0].content).toContain("zhixing_document: evidence");
    expect(rendered.wiki_updates[0].content).toContain("raw/codex/daily/2026-07-29.md");
    expect(rendered.wiki_updates[0].content).toContain("[[我的经历/Obsidian/网页对话为什么突然没有进入知识库]]");
    expect(rendered.memory_update.content).toContain("> **发生时间**：2026-07-29");
    expect(rendered.memory_update.content).toContain("[[Obsidian/网页采集接收器的恢复与验证]]");
  });

  it("日期开头的完整经历段落不会被误判为编号列表", () => {
    const input = succeeded();
    input.memory_document.sections.action =
      "2026-08-13 的实时跟踪中，我先读取关键模块和最近上下文，再把问题、实现方式、用户结果与验证阶段写成一段完整说明，避免只报告文件数量。";
    expect(() => renderSemanticOutcome({
      topic: topic(),
      pairs: [pair("new")],
      outcome: input,
      now: "2026-08-14"
    })).not.toThrow();
  });

  it("增量更新复用路径和稳定 ID，并保留全部历史来源与用户补充", () => {
    const oldEvidence = [
      "---",
      "zhixing_wiki_id: stable-evidence",
      "zhixing_document: evidence",
      "projects: [Obsidian]",
      "last_verified: 2026-07-28",
      "trust: observed",
      "source_event_ids:",
      "  - old:prompt",
      "  - old:stop",
      "aliases:",
      "  - 接收器排障",
      "---",
      "# 旧标题",
      "",
      "这是我写在标题下面的判断备注，更新知识时也要继续保留。",
      "",
      "## 问题与现象",
      "旧内容",
      "",
      "## 用户补充",
      "我发现休眠恢复后也可能复现，排查时不要漏掉这一种情况。"
    ].join("\n");
    const oldMemory = [
      "---",
      "zhixing_memory_id: stable-memory",
      "zhixing_document: memory",
      "projects:",
      "  - Obsidian",
      "last_reviewed: 2026-07-28",
      "tags:",
      "  - 我的经验",
      "---",
      "# 旧经历",
      "",
      "这句话能让我立刻想起当时为什么开始做这件事。",
      "",
      "## 当时我想做什么",
      "旧内容",
      "",
      "## 我的备注",
      "下次要先确认是否刚刚唤醒电脑。"
    ].join("\n");
    const rendered = renderSemanticOutcome({
      topic: topic(),
      pairs: [pair("new")],
      existingDocuments: [
        document("evidence", "wiki/Obsidian/原来的证据页.md", oldEvidence, "stable-evidence"),
        document("memory", "wiki/我的经历/Obsidian/原来的经历.md", oldMemory, "stable-memory")
      ],
      outcome: succeeded(),
      now: "2026-07-29T12:00:00+08:00"
    });

    const evidence = rendered.wiki_updates[0];
    expect(evidence).toMatchObject({
      action: "updated",
      path: "wiki/Obsidian/原来的证据页.md",
      expected_sha256: hash(oldEvidence)
    });
    expect(evidence.content).toContain("zhixing_wiki_id: stable-evidence");
    expect(evidence.content).toContain('  - "old:prompt"');
    expect(evidence.content).toContain('  - "new:prompt"');
    expect(evidence.content).toContain("aliases:\n  - 接收器排障");
    expect(evidence.content).toContain("这是我写在标题下面的判断备注");
    expect(evidence.content).toContain("## 用户补充\n我发现休眠恢复后也可能复现");
    expect(rendered.memory_update).toMatchObject({
      action: "updated",
      path: "wiki/我的经历/Obsidian/原来的经历.md",
      expected_sha256: hash(oldMemory)
    });
    expect(rendered.memory_update.content).toContain("zhixing_memory_id: stable-memory");
    expect(rendered.memory_update.content).toContain("tags:\n  - 我的经验");
    expect(rendered.memory_update.content).toContain("这句话能让我立刻想起当时为什么开始做这件事");
    expect(rendered.memory_update.content).toContain("## 我的备注\n下次要先确认是否刚刚唤醒电脑。");
  });

  it("多张证据页分别合并自己的历史来源，不受未托管旧页污染", () => {
    const first = evidenceFixture("first-id", ["first:prompt", "first:stop"]);
    const second = evidenceFixture("second-id", ["second:prompt", "second:stop"]);
    const unmanagedCanonical =
      `legacy:turn:UserPromptSubmit:${"a".repeat(64)}`;
    const rendered = renderSemanticOutcome({
      topic: topic(),
      pairs: [pair("new")],
      existingDocuments: [
        document("evidence", "wiki/Obsidian/第一张证据.md", first, "first-id"),
        document("evidence", "wiki/Obsidian/第二张证据.md", second, "second-id"),
        {
          ...document(
            "evidence",
            "wiki/Obsidian/旧版只读页.md",
            `# 旧版\n\n${unmanagedCanonical}`,
            ""
          ),
          managed: false
        }
      ],
      outcome: succeeded()
    });

    const firstUpdate = rendered.wiki_updates[0].content;
    const secondUpdate = rendered.wiki_updates[1].content;
    expect(firstUpdate).toContain('"first:prompt"');
    expect(firstUpdate).toContain('"new:prompt"');
    expect(firstUpdate).not.toContain("second:prompt");
    expect(secondUpdate).toContain('"second:prompt"');
    expect(secondUpdate).toContain('"new:prompt"');
    expect(secondUpdate).not.toContain("first:prompt");
    expect(firstUpdate).not.toContain(unmanagedCanonical);
    expect(secondUpdate).not.toContain(unmanagedCanonical);
  });

  it("保留旧正文中的规范来源、引号稳定 ID和托管章节后的手写内容", () => {
    const canonicalPrompt =
      `legacy:turn:UserPromptSubmit:${"b".repeat(64)}`;
    const canonicalStop =
      `legacy:turn:Stop:${"c".repeat(64)}`;
    const legacy = [
      "---",
      'zhixing_wiki_id: "quoted-evidence"',
      "zhixing_document: evidence",
      "projects: [Obsidian]",
      "last_verified: 2026-07-28",
      "trust: observed",
      "---",
      "# 旧证据",
      "",
      "## 问题与现象",
      "这部分是旧版自动生成的首段说明，会在第一次迁移到可管理语义块时被新内容替代。",
      "",
      "这是我后来手写追加的判断，必须在自动更新证据页后继续保留。",
      "",
      "### 我的备注",
      "电脑休眠恢复后也要检查一次接收端口。",
      "",
      "## 来源与关联",
      "```text",
      canonicalPrompt,
      canonicalStop,
      "```"
    ].join("\n");
    const rendered = renderSemanticOutcome({
      topic: topic(),
      pairs: [pair("new")],
      existingDocuments: [
        document("evidence", "wiki/Obsidian/旧证据.md", legacy, '"quoted-evidence"')
      ],
      outcome: succeeded()
    });
    const content = rendered.wiki_updates[0].content;

    expect(content).toContain("zhixing_wiki_id: quoted-evidence");
    expect(content).not.toContain('\\"quoted-evidence\\"');
    expect(content).toContain(canonicalPrompt);
    expect(content).toContain(canonicalStop);
    expect(content).toContain("这是我后来手写追加的判断");
    expect(content).toContain("### 我的备注");
    expect(content).toContain("<!-- zhixing-semantic:start:problem -->");
  });

  it("项目目录和文件名保持自然中文并清理 Windows 非法字符", () => {
    const input = succeeded();
    input.memory_document.title = "我终于看懂了:采集为什么会停?";
    input.evidence_document.title = "网页采集:判断/恢复与验证";
    const rendered = renderSemanticOutcome({
      topic: { ...topic(), project: "", project_directory: "知识管理/采集经验" },
      pairs: [pair("new")],
      outcome: input,
      now: "2026-07-29"
    });

    expect(rendered.memory_update.path).toBe(
      "wiki/我的经历/知识管理/采集经验/我终于看懂了 采集为什么会停.md"
    );
    expect(rendered.wiki_updates[0].path).toBe(
      "wiki/知识管理/采集经验/网页采集 判断 恢复与验证.md"
    );

    const windowsProject = renderSemanticOutcome({
      topic: { ...topic(), project: "", project_directory: "C:\\工作\\知识管理" },
      pairs: [pair("new")],
      outcome: succeeded(),
      now: "2026-07-29"
    });
    expect(windowsProject.memory_update.path).toContain("wiki/我的经历/知识管理/");

    const reservedName = succeeded();
    reservedName.memory_document.title = "CON";
    reservedName.evidence_document.title = "Node.js..排障";
    const safeNames = renderSemanticOutcome({
      topic: { ...topic(), project: "", project_directory: "CON" },
      pairs: [pair("new")],
      outcome: reservedName
    });
    expect(safeNames.memory_update.path).not.toContain("/CON/");
    expect(safeNames.memory_update.path).toContain("CON-笔记.md");
    expect(safeNames.wiki_updates[0].path).not.toContain("..");
  });

  it.each([
    ["pending", "现有证据不足"],
    ["not-applicable", "这只是一次无内容心跳"]
  ])("兼容 %s，不伪造知识文档", (status, reason) => {
    expect(renderSemanticOutcome({
      topic: topic(),
      pairs: [pair("new")],
      outcome: { status, reason }
    })).toEqual({
      id: "topic:receiver",
      status,
      source_event_ids: ["new:prompt", "new:stop"],
      reason
    });
  });

  it("拒绝复用 wiki 之外或角色错误的路径", () => {
    expect(() => renderSemanticOutcome({
      topic: topic(),
      pairs: [pair("new")],
      existingDocuments: [
        document("evidence", "../secrets.md", "# 不应读取", "bad")
      ],
      outcome: succeeded()
    })).toThrow("路径无效");

    expect(() => renderSemanticOutcome({
      topic: topic(),
      pairs: [pair("new")],
      existingDocuments: [
        document("memory", "wiki/普通目录/经历.md", "# 不应覆盖", "bad")
      ],
      outcome: succeeded()
    })).toThrow("超出允许目录");
  });
});

function topic() {
  return {
    id: "topic:receiver",
    title: "恢复网页采集",
    project: "Obsidian",
    source_event_ids: ["new:prompt", "new:stop"],
    first_seen: "2026-07-29T08:00:00+08:00",
    last_seen: "2026-07-29T08:30:00+08:00"
  };
}

function pair(id: string) {
  return {
    id,
    date: "2026-07-29",
    captured_at: "2026-07-29T08:00:00+08:00",
    source_event_ids: [`${id}:prompt`, `${id}:stop`],
    daily_path: "raw/codex/daily/2026-07-29.md"
  };
}

function succeeded() {
  return {
    status: "succeeded",
    reason: "形成了可复用的网页采集恢复经验",
    evidence_document: {
      title: "网页采集接收器的恢复与验证",
      projects: ["Obsidian"],
      last_verified: "2026-07-29",
      trust: "verified",
      sections: {
        problem: "网页端看起来仍在运行，但新的对话没有继续写入本地知识库。",
        root_cause: "本地接收进程已经退出，浏览器仍然发送，因此问题发生在本地接收环节。",
        attempts: "只检查计划任务是否存在没有效果，因为任务存在不代表接收端口仍在监听。",
        solution: "先检查健康端点，再恢复接收进程，发送测试内容并确认原始记录和每日页同时新增。",
        boundaries: "适用于本机接收器停止的情况；若端口正常，应继续检查浏览器发送权限和文件写入。",
        verification: "恢复后端口重新监听，测试内容进入 JSONL 和当天 Markdown，链路验证通过。",
        signals: "界面显示已连接但当天文件没有新增，或健康端点无法访问，是最直接的识别信号。"
      }
    },
    memory_document: {
      title: "网页对话为什么突然没有进入知识库",
      projects: ["Obsidian"],
      last_reviewed: "2026-07-29",
      occurred_time: "2026-07-29",
      sections: {
        goal: "我希望网页对话可以自动进入 Obsidian，不需要每天手工复制和补录，也不用在第二天依靠模糊记忆重新整理。",
        obstacle: "网页端没有明显报错，可当天的知识库文件一直没有出现新的对话内容，直到检查本地文件才发现采集早已中断。",
        judgment: "我按发送、接收和落盘三段逐一检查，发现浏览器仍会发送，但本地端口已经没有程序监听，因此可以确定中断发生在接收环节。",
        action: "我恢复了接收服务，并增加健康检查，再发送一条真实测试内容检查从网页发送到本地文件的完整路径。",
        result: "接收端口恢复监听，测试内容同时进入原始记录和每日页面，也留下了以后可重复使用的检查顺序。",
        next: "下次先检查健康端点和计划任务；端口正常后，再检查浏览器发送与文件落盘，不要直接重装插件。"
      }
    }
  };
}

function document(role: string, path: string, content: string, stableId: string) {
  return {
    role,
    path,
    content,
    stable_id: stableId,
    managed: true,
    sha256: hash(content)
  };
}

function evidenceFixture(stableId: string, sourceIds: string[]): string {
  return [
    "---",
    `zhixing_wiki_id: ${stableId}`,
    "zhixing_document: evidence",
    "projects: [Obsidian]",
    "last_verified: 2026-07-28",
    "trust: observed",
    "source_event_ids:",
    ...sourceIds.map((id) => `  - ${JSON.stringify(id)}`),
    "---",
    "# 旧证据"
  ].join("\n");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
