import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Node ESM runtime module.
import { commitMaintenance, prepareMaintenance } from "../../runtime/src/knowledge-maintenance.mjs";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("knowledge maintenance", () => {
  it("把同项目零散证据综合为一篇总览，并只归档未被用户补充的页面", async () => {
    const vault = await createVault();
    const clean = "wiki/演示项目/接收器恢复.md";
    const annotated = "wiki/演示项目/授权排查.md";
    await writeNote(vault, clean, evidence("接收器恢复", "event:one"));
    await writeNote(vault, annotated, `${evidence("授权排查", "event:two")}\n## 我的补充\n这条结论需要继续保留原文。\n`);
    await writeNote(vault, "raw/codex/knowledge-settlements.json", JSON.stringify({
      schema_version: 3,
      outcomes: [{
        id: "topic-one",
        status: "succeeded",
        source_event_ids: ["event:one"],
        wiki_paths: [clean],
        evidence_paths: [clean],
        knowledge_changes: [{ action: "created", path: clean, title: "接收器恢复", role: "evidence" }],
        updated_at: "2026-08-01T00:00:00.000Z"
      }]
    }));

    const prepared = await prepareMaintenance(vault, { runId: "maintenance-one" });
    expect(prepared).toMatchObject({ project_count: 1, document_count: 2 });
    const contract = JSON.parse(await readFile(prepared.contract_path, "utf8"));
    expect(contract.projects[0].documents.find((item: { path: string }) => item.path === clean).managed_only).toBe(true);
    expect(contract.projects[0].documents.find((item: { path: string }) => item.path === annotated).managed_only).toBe(false);
    await writeFile(prepared.result_path, JSON.stringify(result("maintenance-one", contract.projects[0], "archive")), "utf8");

    const receipt = await commitMaintenance(vault, { runId: "maintenance-one" });
    expect(receipt).toMatchObject({ summarized: 1, archived: 1, kept_active: 1 });
    const summary = await readFile(path.join(vault, "wiki", "演示项目", "演示项目知识总览.md"), "utf8");
    expect(summary).toContain("## 冲突、演变与当前口径");
    expect(summary).toContain("[[归档/知行台/演示项目/接收器恢复]]");
    await expect(readFile(path.join(vault, ...clean.split("/")), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const archived = await readFile(path.join(vault, "归档", "知行台", "演示项目", "接收器恢复.md"), "utf8");
    expect(archived).toContain("zhixing_archived: true");
    expect(archived).toContain("[[wiki/演示项目/演示项目知识总览]]");
    expect(await readFile(path.join(vault, ...annotated.split("/")), "utf8")).toContain("我的补充");
    const ledger = JSON.parse(await readFile(path.join(vault, "raw", "codex", "knowledge-settlements.json"), "utf8"));
    expect(ledger.outcomes[0]).toMatchObject({
      wiki_paths: ["wiki/演示项目/演示项目知识总览.md"],
      evidence_paths: ["wiki/演示项目/演示项目知识总览.md"],
      archived_paths: ["归档/知行台/演示项目/接收器恢复.md"]
    });
  });

  it("归档中断时恢复综合页、原文、账本与状态", async () => {
    const vault = await createVault();
    await writeNote(vault, "wiki/演示项目/第一篇.md", evidence("第一篇", "event:first"));
    await writeNote(vault, "wiki/演示项目/第二篇.md", evidence("第二篇", "event:second"));
    const prepared = await prepareMaintenance(vault, { runId: "maintenance-fault" });
    const contract = JSON.parse(await readFile(prepared.contract_path, "utf8"));
    await writeFile(prepared.result_path, JSON.stringify(result("maintenance-fault", contract.projects[0], "archive")), "utf8");

    await expect(commitMaintenance(vault, { runId: "maintenance-fault", faultStage: "first-archive" }))
      .rejects.toThrow("首篇归档后中断");
    expect(await readFile(path.join(vault, "wiki", "演示项目", "第一篇.md"), "utf8")).toContain("zhixing_document: evidence");
    expect(await readFile(path.join(vault, "wiki", "演示项目", "第二篇.md"), "utf8")).toContain("zhixing_document: evidence");
    await expect(readFile(path.join(vault, "wiki", "演示项目", "演示项目知识总览.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(vault, "归档", "知行台", "演示项目", "第一篇.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("已审查且没有变化的项目不会反复调用综合模型", async () => {
    const vault = await createVault();
    await writeNote(vault, "wiki/演示项目/第一篇.md", evidence("第一篇", "event:first"));
    await writeNote(vault, "wiki/演示项目/第二篇.md", evidence("第二篇", "event:second"));
    const first = await prepareMaintenance(vault, { runId: "maintenance-idempotent" });
    const contract = JSON.parse(await readFile(first.contract_path, "utf8"));
    await writeFile(first.result_path, JSON.stringify(result("maintenance-idempotent", contract.projects[0], "keep-active")), "utf8");
    await commitMaintenance(vault, { runId: "maintenance-idempotent" });

    const second = await prepareMaintenance(vault, { runId: "maintenance-idempotent-2" });
    expect(second).toMatchObject({ project_count: 0, document_count: 0 });
  });

  it("不会接管用户手写的同名知识总览", async () => {
    const vault = await createVault();
    const manual = "# 演示项目知识总览\n\n这是我手写的项目入口，自动整理不能覆盖。\n";
    await writeNote(vault, "wiki/演示项目/演示项目知识总览.md", manual);
    await writeNote(vault, "wiki/演示项目/第一篇.md", evidence("第一篇", "event:first"));
    await writeNote(vault, "wiki/演示项目/第二篇.md", evidence("第二篇", "event:second"));

    const prepared = await prepareMaintenance(vault, { runId: "maintenance-manual-summary" });
    const contract = JSON.parse(await readFile(prepared.contract_path, "utf8"));
    expect(contract.projects[0].summary_path).toBe("wiki/演示项目/演示项目知识总览（知行台）.md");
    expect(await readFile(path.join(vault, "wiki", "演示项目", "演示项目知识总览.md"), "utf8")).toBe(manual);
  });
});

async function createVault(): Promise<string> {
  const vault = await mkdtemp(path.join(os.tmpdir(), "zhixing-maintenance-"));
  temporary.push(vault);
  await mkdir(path.join(vault, "wiki"), { recursive: true });
  return vault;
}

async function writeNote(vault: string, relative: string, content: string): Promise<void> {
  const target = path.join(vault, ...relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

function evidence(title: string, eventId: string): string {
  const sections = [
    ["问题与现象", "problem"], ["根因与判断依据", "root_cause"], ["尝试过的路径", "attempts"],
    ["可复用的解决路径", "solution"], ["适用条件与边界", "boundaries"],
    ["验证方式与结果", "verification"], ["下次快速识别", "signals"]
  ];
  return [
    "---", `zhixing_wiki_id: wiki-${eventId.replace(/\W/g, "-")}`, "zhixing_document: evidence",
    "projects:", "  - 演示项目", "last_verified: 2026-08-01", "trust: observed",
    "source_event_ids:", `  - ${eventId}`, "---", `# ${title}`, "", "## 一眼看懂", "这是可复用的项目证据。", "",
    ...sections.flatMap(([heading, key]) => [
      `## ${heading}`, `<!-- zhixing-semantic:start:${key} -->`, `${title}对应的具体事实、判断和验证内容。`,
      `<!-- zhixing-semantic:end:${key} -->`, ""
    ]),
    "## 来源与关联", `- 来源事件：${eventId}`, ""
  ].join("\n");
}

function result(runId: string, project: { project_id: string; documents: Array<{ path: string }> }, disposition: "archive" | "keep-active") {
  return {
    schema_version: 1,
    run_id: runId,
    outcomes: [{
      project_id: project.project_id,
      status: "succeeded",
      reason: "多篇证据已经形成可以独立查阅的稳定项目知识",
      summary: {
        overview: "本项目围绕知识采集、判断和恢复形成了可持续维护的共同方法。",
        themes: "核心主题是先确认真实状态，再根据证据决定恢复和验证顺序。",
        decisions: "已确认应以端到端结果作为完成依据，不能只看单个进程或提示。",
        pitfalls: "只观察表面状态会漏掉中间环节失败，这是后续排查需要避免的路径。",
        playbook: "先检查来源，再检查处理过程，最后回读目标文件并保留可追溯依据。",
        conflicts: "当前文档之间没有未解决冲突；后续出现不同结论时以新验证证据更新。",
        boundaries: "适用于本地知识整理链路，外部事实仍应回到独立来源进行确认。",
        open_questions: "仍需通过长期运行观察异常恢复是否覆盖所有设备和系统状态。"
      },
      reviews: project.documents.map((document) => ({
        path: document.path,
        disposition,
        reason: "可复用内容已经完整进入综合页，原文仅需用于追溯"
      }))
    }]
  };
}
