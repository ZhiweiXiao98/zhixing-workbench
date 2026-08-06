import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { ArtifactWriter } from "../src/artifact-writer";
import { artifactNotePath, renderArtifactNote } from "../src/core/artifact-markdown";
import type { ArtifactRecord } from "../src/core/types";

describe("ArtifactWriter", () => {
  it("writes a deterministic projection once and preserves the user block on updates", async () => {
    const fake = fakeApp();
    const writer = new ArtifactWriter(fake.app);
    const firstArtifact = artifact();
    firstArtifact.notePath = artifactNotePath(firstArtifact);

    const first = await writer.sync([firstArtifact]);
    const second = await writer.sync([firstArtifact]);
    expect(first.errors).toEqual([]);
    expect(first.writes).toBe(2);
    expect(second.writes).toBe(0);

    const oldContent = fake.contents.get(firstArtifact.notePath) ?? "";
    fake.contents.set(firstArtifact.notePath, oldContent.replace("## 我的补充\n", "## 我的补充\n\n这段由用户维护。\n"));
    const updated = { ...firstArtifact, fingerprint: "changed", result: "更新后的成果内容。" };
    const third = await writer.sync([updated]);
    expect(third.errors).toEqual([]);
    expect(fake.contents.get(firstArtifact.notePath)).toContain("更新后的成果内容。");
    expect(fake.contents.get(firstArtifact.notePath)).toContain("这段由用户维护。");
  });

  it("merges against the latest process content instead of overwriting a concurrent user edit", async () => {
    const fake = fakeApp();
    const writer = new ArtifactWriter(fake.app);
    const item = artifact();
    item.notePath = artifactNotePath(item);
    await writer.sync([item]);

    fake.beforeNextProcess(item.notePath, (content) => content.replace(
      "## 我的补充\n",
      "## 我的补充\n\n在 cachedRead 后新增的用户内容。\n"
    ));
    const result = await writer.sync([{ ...item, fingerprint: "new", result: "并发更新后的自动内容。" }]);

    expect(result.errors).toEqual([]);
    expect(fake.contents.get(item.notePath)).toContain("并发更新后的自动内容。");
    expect(fake.contents.get(item.notePath)).toContain("在 cachedRead 后新增的用户内容。");
  });

  it("renames a legacy hash filename to the readable canonical path without duplicating the note", async () => {
    const fake = fakeApp();
    const item = artifact();
    item.notePath = artifactNotePath(item);
    const legacyPath = legacyArtifactPath(item, "旧版成果标题");
    await fake.ensureParents(legacyPath);
    fake.addFile(legacyPath, renderArtifactNote(item).replace(
      "## 我的补充\n",
      "## 我的补充\n\n迁移前的用户判断。\n"
    ));

    const result = await new ArtifactWriter(fake.app).sync([item]);

    expect(result.errors).toEqual([]);
    expect(result.persistedIds).toContain(item.id);
    expect(fake.entries.has(legacyPath)).toBe(false);
    expect(fake.entries.has(item.notePath)).toBe(true);
    expect(fake.contents.get(item.notePath)).toContain("迁移前的用户判断。");
    expect(fake.contents.get(item.notePath)).toContain(`"${legacyPath.split("/").at(-1)?.replace(/\.md$/, "")}"`);
    expect([...fake.entries.keys()].filter((path) => path.endsWith(".md") && path.includes("/2026-07-17/"))).toEqual([item.notePath]);
    expect(fake.contents.get("成果/知行台/2026-07-17.md")).toContain(item.notePath.replace(/\.md$/, ""));
    const second = await new ArtifactWriter(fake.app).sync([item]);
    expect(second.errors).toEqual([]);
    expect(second.writes).toBe(0);
  });

  it("renames the note again when its readable title changes", async () => {
    const fake = fakeApp();
    const writer = new ArtifactWriter(fake.app);
    const item = artifact();
    item.notePath = artifactNotePath(item);
    await writer.sync([item]);
    fake.contents.set(item.notePath, (fake.contents.get(item.notePath) ?? "").replace(
      "## 我的补充\n",
      "## 我的补充\n\n标题变化前的补充。\n"
    ));
    const renamed = { ...item, title: "完成更易理解的成果文件名" };
    renamed.notePath = artifactNotePath(renamed);

    const result = await writer.sync([renamed]);

    expect(result.errors).toEqual([]);
    expect(fake.entries.has(item.notePath)).toBe(false);
    expect(fake.contents.get(renamed.notePath)).toContain("标题变化前的补充。");
  });

  it("moves an inactive artifact to a readable historical filename while marking it stale", async () => {
    const fake = fakeApp();
    const item = artifact();
    item.notePath = artifactNotePath(item);
    const legacyPath = legacyArtifactPath(item, "报告");
    await fake.ensureParents(legacyPath);
    fake.addFile(legacyPath, renderArtifactNote(item));

    const result = await new ArtifactWriter(fake.app).sync([]);

    expect(result.errors).toEqual([]);
    expect(fake.entries.has(legacyPath)).toBe(false);
    const historyPath = "成果/知行台/2026-07-17/完成成果视图（历史记录）.md";
    expect(fake.contents.get(historyPath)).toContain("zhixing_stale: true");
    expect(fake.contents.get(historyPath)).toContain('"报告-');
  });

  it("does not let inactive historical notes block a current artifact refresh", async () => {
    const fake = fakeApp();
    const historical = artifact();
    historical.id = "historical-id";
    historical.notePath = artifactNotePath(historical);
    await fake.ensureParents(historical.notePath);
    fake.addFile(historical.notePath, renderArtifactNote(historical));

    const current = { ...artifact(), id: "current-id" };
    const result = await new ArtifactWriter(fake.app).sync([current]);

    expect(result.errors).toEqual([]);
    expect(current.notePath).toBe(artifactNotePath(current));
    const historyPath = "成果/知行台/2026-07-17/完成成果视图（历史记录）.md";
    expect(fake.contents.get(historyPath)).toContain("zhixing_stale: true");
    expect(fake.contents.get(current.notePath)).toContain('zhixing_id: "current-id"');
  });

  it("uses a readable sequence when the preferred natural filename is occupied", async () => {
    const fake = fakeApp();
    const item = artifact();
    item.notePath = artifactNotePath(item);
    const legacyPath = legacyArtifactPath(item);
    const occupiedPath = item.notePath;
    await fake.ensureParents(legacyPath);
    fake.addFile(legacyPath, renderArtifactNote(item));
    fake.addFile(occupiedPath, "# 用户自己的同名文件");

    const result = await new ArtifactWriter(fake.app).sync([item]);

    expect(result.errors).toEqual([]);
    expect(result.persistedIds).toContain(item.id);
    expect(item.notePath).toBe(artifactNotePath(item, 2));
    expect(fake.entries.has(legacyPath)).toBe(false);
    expect(fake.contents.get(occupiedPath)).toBe("# 用户自己的同名文件");
    expect(fake.contents.get(item.notePath)).toContain("zhixing_stale: false");
  });

  it("uses the next readable sequence when two natural filenames are occupied", async () => {
    const fake = fakeApp();
    const item = artifact();
    item.notePath = artifactNotePath(item);
    const firstPath = artifactNotePath(item);
    const secondPath = artifactNotePath(item, 2);
    await fake.ensureParents(firstPath);
    fake.addFile(firstPath, "# 用户自己的同名文件");
    fake.addFile(secondPath, "# 用户自己的第二个同名文件");

    const result = await new ArtifactWriter(fake.app).sync([item]);

    expect(result.errors).toEqual([]);
    expect(result.persistedIds).toContain(item.id);
    expect(item.notePath).toBe(artifactNotePath(item, 3));
    expect(fake.contents.get(firstPath)).toBe("# 用户自己的同名文件");
    expect(fake.contents.get(secondPath)).toBe("# 用户自己的第二个同名文件");
  });

  it("gives same-day duplicate titles stable readable sequence numbers", async () => {
    const fake = fakeApp();
    const first = { ...artifact(), id: "collision-8515", title: "相同成果标题", sourceEventIds: ["first"] };
    const second = { ...artifact(), id: "collision-11163", title: "相同成果标题", sourceEventIds: ["second"] };
    first.notePath = artifactNotePath(first);
    second.notePath = artifactNotePath(second);
    expect(first.notePath).toBe(second.notePath);

    const result = await new ArtifactWriter(fake.app).sync([first, second]);

    expect(result.errors).toEqual([]);
    expect(result.persistedIds.size).toBe(2);
    expect(first.notePath).toBe("成果/知行台/2026-07-17/相同成果标题.md");
    expect(second.notePath).toBe("成果/知行台/2026-07-17/相同成果标题（2）.md");

    const firstPath = first.notePath;
    const secondPath = second.notePath;
    const repeated = await new ArtifactWriter(fake.app).sync([second, first]);
    expect(repeated.errors).toEqual([]);
    expect(first.notePath).toBe(firstPath);
    expect(second.notePath).toBe(secondPath);

    const oneRemaining = await new ArtifactWriter(fake.app).sync([second]);
    expect(oneRemaining.errors).toEqual([]);
    expect(second.notePath).toBe(secondPath);
    expect(fake.contents.get("成果/知行台/2026-07-17/相同成果标题（历史记录）.md")).toContain("zhixing_stale: true");
  });

  it("keeps duplicate managed ids as readable historical copies without losing user content", async () => {
    const fake = fakeApp();
    const item = artifact();
    item.notePath = artifactNotePath(item);
    const legacyPath = legacyArtifactPath(item);
    await fake.ensureParents(legacyPath);
    fake.addFile(legacyPath, renderArtifactNote(item).replace(
      "## 我的补充\n",
      "## 我的补充\n\n旧副本中的用户内容。\n"
    ));
    fake.addFile(item.notePath, renderArtifactNote(item));

    const result = await new ArtifactWriter(fake.app).sync([item]);

    expect(result.errors).toEqual([]);
    expect(result.persistedIds).toContain(item.id);
    expect(fake.entries.has(legacyPath)).toBe(false);
    const historyPath = [...fake.entries.keys()].find((path) => path.includes("（历史记录") && path.endsWith(".md"));
    expect(historyPath).toBeTruthy();
    expect(fake.contents.get(historyPath ?? "")).toContain("zhixing_stale: true");
    expect(fake.contents.get(historyPath ?? "")).toContain("旧副本中的用户内容。");

    const repeated = await new ArtifactWriter(fake.app).sync([item]);
    expect(repeated.errors).toEqual([]);
    expect(fake.entries.has(historyPath ?? "")).toBe(true);
  });

  it("rebuilds both daily indexes when a managed artifact moves across dates", async () => {
    const fake = fakeApp();
    const oldItem = artifact();
    oldItem.notePath = artifactNotePath(oldItem);
    await fake.ensureParents(oldItem.notePath);
    fake.addFile(oldItem.notePath, renderArtifactNote(oldItem));
    const current = { ...oldItem, localDate: "2026-07-18" };
    current.notePath = artifactNotePath(current);

    const result = await new ArtifactWriter(fake.app).sync([current]);

    expect(result.errors).toEqual([]);
    expect(fake.contents.get("成果/知行台/2026-07-17.md")).toContain("当天没有当前快照中的成果条目");
    expect(fake.contents.get("成果/知行台/2026-07-18.md")).toContain(current.notePath.replace(/\.md$/, ""));
  });

  it("does not overwrite an unowned file at the preferred readable path", async () => {
    const fake = fakeApp();
    const item = artifact();
    item.notePath = artifactNotePath(item);
    const occupiedPath = item.notePath;
    await fake.ensureParents(occupiedPath);
    fake.addFile(occupiedPath, "# 用户自己的文件");

    const result = await new ArtifactWriter(fake.app).sync([item]);
    expect(result.errors).toEqual([]);
    expect(result.persistedIds).toContain(item.id);
    expect(item.notePath).toBe(artifactNotePath(item, 2));
    expect(fake.contents.get(occupiedPath)).toBe("# 用户自己的文件");
  });

  it("archives a different managed id before assigning the natural filename", async () => {
    const fake = fakeApp();
    const item = artifact();
    item.notePath = artifactNotePath(item);
    const mismatchedPath = item.notePath;
    await fake.ensureParents(mismatchedPath);
    const mismatchedContent = renderArtifactNote(item).replace(item.id, "wrong-id");
    fake.addFile(mismatchedPath, mismatchedContent);

    const result = await new ArtifactWriter(fake.app).sync([item]);
    expect(result.persistedIds).toContain(item.id);
    expect(result.errors).toEqual([]);
    const historyPath = "成果/知行台/2026-07-17/完成成果视图（历史记录）.md";
    expect(fake.contents.get(historyPath)).toContain('zhixing_id: "wrong-id"');
    expect(fake.contents.get(historyPath)).toContain("zhixing_stale: true");
    expect(item.notePath).toBe(mismatchedPath);
  });

  it("rejects path traversal and invalid dates before any artifact write", async () => {
    const fake = fakeApp();
    const traversal = artifact();
    traversal.notePath = "成果/知行台/2026-07-17/../../../outside.md";
    const invalidDate = { ...artifact(), id: "invalid-date", localDate: "2026-02-30", notePath: "" };

    const result = await new ArtifactWriter(fake.app).sync([traversal, invalidDate]);
    expect(result.persistedIds.size).toBe(0);
    expect(result.errors).toHaveLength(2);
    expect([...fake.entries.keys()].some((path) => path.includes("outside"))).toBe(false);
  });

  it("marks missing managed artifacts stale and rebuilds the daily index from only the current snapshot", async () => {
    const fake = fakeApp();
    const writer = new ArtifactWriter(fake.app);
    const item = artifact();
    item.notePath = artifactNotePath(item);
    await writer.sync([item]);
    fake.contents.set(item.notePath, (fake.contents.get(item.notePath) ?? "").replace(
      "## 我的补充\n",
      "## 我的补充\n\n历史条目的用户补充。\n"
    ));

    const stale = await writer.sync([]);
    expect(stale.errors).toEqual([]);
    expect(stale.writes).toBe(4);
    const historyPath = "成果/知行台/2026-07-17/完成成果视图（历史记录）.md";
    expect(fake.contents.get(historyPath)).toContain("zhixing_stale: true");
    expect(fake.contents.get(historyPath)).toContain("此文件已不在当前成果索引中");
    expect(fake.contents.get(historyPath)).toContain("历史条目的用户补充。");
    const index = fake.contents.get("成果/知行台/2026-07-17.md") ?? "";
    expect(index).toContain("当天没有当前快照中的成果条目");
    expect(index).not.toContain("完成成果视图");

    const idempotent = await writer.sync([]);
    expect(idempotent.errors).toEqual([]);
    expect(idempotent.writes).toBe(0);

    const current = await writer.sync([item]);
    expect(current.errors).toEqual([]);
    expect(fake.contents.get(item.notePath)).toContain("zhixing_stale: false");
    expect(fake.contents.get(item.notePath)).not.toContain("此文件已不在当前成果索引中");
    expect(fake.contents.get(item.notePath)).toContain("历史条目的用户补充。");
  });
});

function fakeApp(): {
  app: App;
  entries: Map<string, TFile | TFolder>;
  contents: Map<string, string>;
  ensureParents(path: string): Promise<void>;
  addFile(path: string, content: string): TFile;
  beforeNextProcess(path: string, callback: (content: string) => string): void;
} {
  const entries = new Map<string, TFile | TFolder>();
  const contents = new Map<string, string>();
  const processHooks = new Map<string, (content: string) => string>();
  const addFile = (path: string, content: string): TFile => {
    const file = Object.assign(new TFile(), { path });
    entries.set(path, file);
    contents.set(path, content);
    return file;
  };
  const vault = {
    getAbstractFileByPath(path: string) {
      return entries.get(path) ?? null;
    },
    getMarkdownFiles() {
      return [...entries.entries()]
        .filter(([path, value]) => path.endsWith(".md") && value instanceof TFile)
        .map(([, value]) => value as TFile);
    },
    async createFolder(path: string) {
      const folder = Object.assign(new TFolder(), { path });
      entries.set(path, folder);
      return folder;
    },
    async create(path: string, content: string) {
      return addFile(path, content);
    },
    async cachedRead(file: TFile) {
      const path = [...entries].find(([, value]) => value === file)?.[0] ?? "";
      return contents.get(path) ?? "";
    },
    async process(file: TFile, callback: (content: string) => string) {
      const path = [...entries].find(([, value]) => value === file)?.[0] ?? "";
      const hook = processHooks.get(path);
      const latest = hook ? hook(contents.get(path) ?? "") : contents.get(path) ?? "";
      processHooks.delete(path);
      const content = callback(latest);
      contents.set(path, content);
      return content;
    },
    async rename(file: TFile, newPath: string) {
      const oldPath = [...entries].find(([, value]) => value === file)?.[0];
      if (!oldPath) {
        throw new Error("找不到待重命名文件");
      }
      if (entries.has(newPath)) {
        throw new Error("目标已存在");
      }
      const content = contents.get(oldPath) ?? "";
      entries.delete(oldPath);
      contents.delete(oldPath);
      Object.assign(file, { path: newPath });
      entries.set(newPath, file);
      contents.set(newPath, content);
    }
  };
  const ensureParents = async (filePath: string) => {
    const parts = filePath.split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!entries.has(current)) {
        await vault.createFolder(current);
      }
    }
  };
  return {
    app: { vault } as unknown as App,
    entries,
    contents,
    ensureParents,
    addFile,
    beforeNextProcess(path, callback) {
      processHooks.set(path, callback);
    }
  };
}

function artifact(): ArtifactRecord {
  return {
    id: "git:repo:a1bb5a21234567890abcdef01234567890abcdef",
    fingerprint: "fingerprint",
    localDate: "2026-07-17",
    occurredAt: "2026-07-17T10:00:00+08:00",
    timeBasis: "source",
    projectKey: "obsidian",
    projectLabel: "Obsidian",
    kind: "git-commit",
    title: "完成成果视图",
    result: "已经形成可读成果。",
    validation: ["测试通过。"],
    limitations: [],
    proof: "independent",
    curation: "auto",
    targets: [],
    sourceEventIds: ["git-event"],
    sourceRefs: [{ type: "git", label: "Git", path: "C:\\work" }],
    notePath: ""
  };
}

function legacyArtifactPath(item: ArtifactRecord, prefix = "成果"): string {
  const code = createHash("sha256").update(item.id).digest("hex").slice(0, 12);
  return `成果/知行台/${item.localDate}/${prefix}-${code}.md`;
}
