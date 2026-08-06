import { describe, expect, it } from "vitest";
import {
  GENERATED_START,
  GENERATED_END,
  USER_START,
  USER_END,
  artifactNotePath,
  markArtifactNoteStale,
  mergeGeneratedBlock,
  readableArtifactFileTitle,
  readManagedArtifactMetadata,
  renderArtifactNote,
  renderDailyArtifactIndex
} from "../src/core/artifact-markdown";
import type { ArtifactRecord } from "../src/core/types";

describe("artifact Markdown projection", () => {
  it("is deterministic and keeps stable paths inside the managed folder", () => {
    const first = renderArtifactNote(artifact());
    const second = renderArtifactNote(artifact());
    expect(second).toBe(first);
    expect(artifactNotePath(artifact())).toBe("成果/知行台/2026-07-17/完成知行台成果视图.md");
    const changedKind = artifact();
    changedKind.kind = "completion-report";
    expect(artifactNotePath(changedKind)).toBe(artifactNotePath(artifact()));
    expect(first).not.toContain("generatedAt");
    expect(first).toMatch(/aliases: \["成果-[0-9a-f]{12}"\]/);
    expect(first.indexOf("# 完成知行台成果视图")).toBeGreaterThan(first.indexOf(GENERATED_START));
    expect(first).toContain("zhixing_stale: false");
  });

  it("builds a beginner-readable and Windows-safe filename", () => {
    expect(readableArtifactFileTitle('  修复 <Codex>: "重连"/失败？ [v2] #1  ')).toBe("修复 Codex 重连 失败？ v2 1");
    expect(readableArtifactFileTitle('<>:"/\\|?*[]#^`')).toBe("未命名成果");
    expect(readableArtifactFileTitle("很长".repeat(30))).toBe("很长".repeat(30));
    expect(readableArtifactFileTitle("很长".repeat(30))).not.toContain("…");
    const overlong = readableArtifactFileTitle("修复超长成果标题".repeat(30));
    expect(Array.from(overlong).length).toBeLessThanOrEqual(96);
    expect(overlong).toContain("完整标题见正文");
    expect(overlong).not.toContain("…");
  });

  it("preserves the user block while replacing only a valid generated block", () => {
    const original = renderArtifactNote(artifact())
      .replace("我的补充\n", "我的补充\n\n用户自己的判断。\n");
    const updated = renderArtifactNote({ ...artifact(), result: "新的自动整理结果" });
    const merged = mergeGeneratedBlock(original, updated);
    expect(merged.ok).toBe(true);
    expect(merged.content).toContain("新的自动整理结果");
    expect(merged.content).toContain("用户自己的判断。");
  });

  it("moves the former managed heading into the generated block on update", () => {
    const desired = renderArtifactNote(artifact());
    const heading = "# 完成知行台成果视图";
    const formerLayout = desired
      .replace(`${GENERATED_START}\n${heading}\n`, `${heading}\n\n${GENERATED_START}\n`);
    const merged = mergeGeneratedBlock(formerLayout, desired);
    expect(merged.ok).toBe(true);
    expect(merged.content.split(heading)).toHaveLength(2);
    expect(merged.content.indexOf(heading)).toBeGreaterThan(merged.content.indexOf(GENERATED_START));
  });

  it("refuses to overwrite an unowned or damaged file", () => {
    expect(mergeGeneratedBlock("# 我的手写成果", renderArtifactNote(artifact())).ok).toBe(false);
    const damaged = renderArtifactNote(artifact()).replace(GENERATED_END, "");
    expect(mergeGeneratedBlock(damaged, renderArtifactNote(artifact())).ok).toBe(false);
  });

  it("requires an exact managed id and one marker family", () => {
    const desired = renderArtifactNote(artifact());
    const wrongId = desired.replace(artifact().id, "different-id");
    expect(mergeGeneratedBlock(wrongId, desired)).toMatchObject({ ok: false, error: expect.stringContaining("ID") });

    const mixedMarkers = `${desired}\n%% zhixing-generated:start %%\n%% zhixing-generated:end %%`;
    expect(mergeGeneratedBlock(mixedMarkers, desired)).toMatchObject({ ok: false });
    expect(readManagedArtifactMetadata(mixedMarkers)).toBeNull();
  });

  it("marks an absent artifact stale without changing its user block", () => {
    const existing = renderArtifactNote(artifact()).replace("## 我的补充\n", "## 我的补充\n\n用户判断。\n");
    const first = markArtifactNoteStale(existing);
    expect(first.ok).toBe(true);
    expect(first.content).toContain("zhixing_stale: true");
    expect(first.content).toContain("此文件已不在当前成果索引中");
    expect(first.content).toContain("用户判断。");
    const second = markArtifactNoteStale(first.content);
    expect(second.content).toBe(first.content);
  });

  it("rejects invalid calendar dates before generating a path", () => {
    expect(() => artifactNotePath({ ...artifact(), localDate: "../../outside" })).toThrow("无效的本地日期");
    expect(() => artifactNotePath({ ...artifact(), localDate: "2026-02-30" })).toThrow("无效的本地日期");
  });

  it("renders a readable daily index linked to the artifact note", () => {
    const index = renderDailyArtifactIndex("2026-07-17", [artifact()]);
    expect(index).toContain("# 2026-07-17 成果");
    expect(index).toContain("zhixing_id: \"daily:2026-07-17\"");
    expect(index).toContain("[[成果/知行台/2026-07-17/完成知行台成果视图|");
    expect(index).toContain("独立验证");
    expect(renderDailyArtifactIndex("2026-07-17", [])).toContain("当天没有当前快照中的成果条目");
  });

  it("escapes special characters from daily-index wikilink aliases", () => {
    const item = { ...artifact(), title: "完成 [A]|#B^C" };
    item.notePath = artifactNotePath(item);
    const index = renderDailyArtifactIndex("2026-07-17", [item]);
    expect(index).toContain(`[[${item.notePath.replace(/\.md$/, "")}|完成 A B C]]`);
  });

  it("reads the human title from a managed artifact for filename migration", () => {
    expect(readManagedArtifactMetadata(renderArtifactNote(artifact()))).toMatchObject({
      id: artifact().id,
      title: "完成知行台成果视图"
    });
  });

  it("labels reported targets without implying independent attribution", () => {
    const reported = artifact();
    reported.targets = [{
      key: "file:C:/work/report.md",
      type: "local-file",
      label: "report.md",
      path: "C:\\work\\report.md",
      exists: true,
      attribution: "reported"
    }];

    expect(renderArtifactNote(reported)).toContain("report.md（Codex 报告）");
  });

  it("safely migrates a legacy daily index that predates managed ids", () => {
    const desired = renderDailyArtifactIndex("2026-07-17", [artifact()]);
    const legacy = desired.replace('zhixing_id: "daily:2026-07-17"\n', "");
    const merged = mergeGeneratedBlock(legacy, desired);
    expect(merged.ok).toBe(true);
    expect(merged.content).toContain('zhixing_id: "daily:2026-07-17"');
  });

  it("migrates legacy Obsidian comment markers without losing user content", () => {
    const desired = renderArtifactNote(artifact());
    const legacy = desired
      .replace(USER_START, "%% zhixing-user:start %%")
      .replace(USER_END, "%% zhixing-user:end %%")
      .replace("## 我的补充\n", "## 我的补充\n\n旧版本中的用户判断。\n");
    const merged = mergeGeneratedBlock(legacy, desired);

    expect(merged.ok).toBe(true);
    expect(merged.content).toContain("旧版本中的用户判断。");
    expect(merged.content).toContain(USER_START);
    expect(merged.content).not.toContain("%% zhixing-user:start %%");
  });
});

function artifact(): ArtifactRecord {
  const id = "git:repo:a1bb5a21234567890abcdef01234567890abcde";
  return {
    id,
    fingerprint: "fingerprint",
    localDate: "2026-07-17",
    occurredAt: "2026-07-17T10:00:00+08:00",
    timeBasis: "source",
    projectKey: "obsidian",
    projectLabel: "Obsidian",
    kind: "git-commit",
    title: "完成知行台成果视图",
    problem: "需要直接查看加工后的产物",
    result: "新增成果视图和持久化 Markdown。",
    validation: ["测试与构建通过。"],
    limitations: [],
    proof: "independent",
    curation: "auto",
    targets: [{
      key: id,
      type: "git-commit",
      label: "a1bb5a2",
      hash: "a1bb5a21234567890abcdef01234567890abcde",
      path: "C:\\work",
      attribution: "independent"
    }],
    sourceEventIds: ["git-event"],
    sourceRefs: [{ type: "git", label: "a1bb5a2", path: "C:\\work" }],
    notePath: ""
  };
}
