import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_GIT_CANDIDATES,
  MAX_GIT_REPOSITORIES,
  allocateChildDiscoveryLimits,
  prioritizeGitCandidates,
  repositoryIdentityKey,
  scanGitActivity
} from "../src/sources/git-source";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Git repository identity", () => {
  it("keeps unrelated local repositories with relative .git dirs separate", () => {
    const workRoot = path.join(path.parse(process.cwd()).root, "work");
    const firstPath = path.join(workRoot, "one");
    const secondPath = path.join(workRoot, "two");
    const first = repositoryIdentityKey("", firstPath, ".git");
    const second = repositoryIdentityKey("", secondPath, ".git");
    expect(first).toBe(path.resolve(firstPath, ".git").toLocaleLowerCase());
    expect(second).not.toBe(first);
  });

  it("uses a shared remote to deduplicate worktrees", () => {
    expect(repositoryIdentityKey("git@example.invalid:team/repo.git", "C:\\one", ".git"))
      .toBe(repositoryIdentityKey("git@example.invalid:team/repo.git", "D:\\two", ".git"));
  });

  it("hashes a credential-free remote identity without persisting the remote or token", () => {
    const privateRemote = "https://user:fixture-token@example.invalid/team/repo.git?access_token=another-fixture";
    const privateKey = repositoryIdentityKey(privateRemote, "C:\\one", ".git");
    const publicKey = repositoryIdentityKey("https://example.invalid/team/repo.git", "D:\\two", ".git");

    expect(privateKey).toBe(publicKey);
    expect(privateKey).toMatch(/^remote:[0-9a-f]{64}$/);
    expect(privateKey).not.toContain("user");
    expect(privateKey).not.toContain("secret");
    expect(privateKey).not.toContain("example.invalid");
  });

  it("removes the SSH user before hashing an scp-style remote", () => {
    expect(repositoryIdentityKey("git@example.invalid:team/repo.git", "C:\\one", ".git"))
      .toBe(repositoryIdentityKey("example.invalid:team/repo.git", "D:\\two", ".git"));
  });

  it("resolves a relative common dir from the Git command working directory", () => {
    const repository = path.join(path.parse(process.cwd()).root, "work", "repo");
    const root = repositoryIdentityKey("", repository, ".git");
    const nested = repositoryIdentityKey("", path.join(repository, "docs"), path.join("..", ".git"));
    expect(nested).toBe(root);
  });

  it("discovers a real repository one level below a non-repository Codex cwd", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "zhixing-git-parent-"));
    temporaryDirectories.push(parent);
    await mkdir(path.join(parent, ".git"));
    const repository = path.join(parent, "fictional-product-site");
    await mkdir(repository);
    git(repository, ["init"]);
    git(repository, ["config", "user.name", "肖志伟"]);
    git(repository, ["config", "user.email", "developer@example.invalid"]);
    await writeFile(path.join(repository, "home.css"), ".case { gap: 48px; }\n", "utf8");
    git(repository, ["add", "home.css"]);
    git(repository, ["commit", "-m", "fix: 拉开产品与客户案例间距"], {
      GIT_AUTHOR_DATE: "2026-07-18T23:00:34+08:00",
      GIT_COMMITTER_DATE: "2026-07-18T23:00:34+08:00"
    });

    const result = await scanGitActivity([{
      path: parent,
      observedAt: "2026-07-18T23:01:00+08:00",
      kind: "cwd"
    }], "2026-07-18");

    expect(result.repositories).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      kind: "output_created",
      title: "fix: 拉开产品与客户案例间距"
    });
  });

  it("discovers an independent child repository when the Codex cwd is also a repository", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "zhixing-git-umbrella-"));
    temporaryDirectories.push(parent);
    await initializeRepository(parent, "docs.txt", "docs", "docs: 更新父项目说明");
    const child = path.join(parent, "independent-app");
    await mkdir(child);
    await initializeRepository(child, "app.ts", "export const ready = true;\n", "feat: 新增独立应用");

    const result = await scanGitActivity([{
      path: parent,
      observedAt: "2026-07-20T09:00:00+08:00",
      kind: "cwd"
    }], "2026-07-18");

    expect(result.repositories).toBe(2);
    expect(result.events.map((event) => event.title)).toEqual(expect.arrayContaining([
      "docs: 更新父项目说明",
      "feat: 新增独立应用"
    ]));
  });

  it("keeps the newest paths inside the bounded candidate scan even when they arrive last", () => {
    const driveRoot = path.join(path.parse(process.cwd()).root, "candidates");
    const candidates: Array<{ path: string; observedAt: string; kind: "cwd" | "reported" }> = Array.from({ length: MAX_GIT_CANDIDATES + 5 }, (_, index) => ({
      path: path.join(driveRoot, `old-${index}`),
      observedAt: `2026-07-17T${String(index % 20).padStart(2, "0")}:00:00+08:00`,
      kind: "cwd" as const
    }));
    const latest = path.join(driveRoot, "latest");
    candidates.push({ path: latest, observedAt: "2026-07-20T09:00:00+08:00", kind: "reported" });

    const selected = prioritizeGitCandidates(candidates);

    expect(selected).toHaveLength(MAX_GIT_CANDIDATES);
    expect(selected[0]?.path).toBe(path.resolve(latest));
    expect(selected.some((candidate) => candidate.path === path.resolve(driveRoot, "old-0"))).toBe(false);
  });

  it("enforces the child and global discovery attempt budgets", () => {
    expect(allocateChildDiscoveryLimits(1, [99])).toEqual([16]);
    expect(allocateChildDiscoveryLimits(MAX_GIT_CANDIDATES, [16, 16, 16, 16])).toEqual([16, 16, 0, 0]);
  });

  it("keeps only the newest repositories inside the repository cap", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "zhixing-git-cap-"));
    temporaryDirectories.push(parent);
    const repositories: string[] = [];
    for (let index = 0; index < MAX_GIT_REPOSITORIES + 1; index += 1) {
      const repository = path.join(parent, `repo-${String(index).padStart(2, "0")}`);
      await mkdir(repository);
      await initializeRepository(repository, "index.txt", String(index), `feat: 仓库 ${index}`);
      const timestamp = new Date(Date.UTC(2026, 6, 18, 0, 0, index));
      await utimes(repository, timestamp, timestamp);
      repositories.push(repository);
    }

    const result = await scanGitActivity([{
      path: parent,
      observedAt: "2026-07-20T09:00:00+08:00",
      kind: "cwd"
    }], "2026-07-18");

    expect(result.repositories).toBe(MAX_GIT_REPOSITORIES);
    expect(result.events).toHaveLength(MAX_GIT_REPOSITORIES);
    expect(result.events.some((event) => event.title === "feat: 仓库 0")).toBe(false);
    expect(result.events.some((event) => event.title === `feat: 仓库 ${MAX_GIT_REPOSITORIES}`)).toBe(true);
  }, 15_000);
});

async function initializeRepository(cwd: string, fileName: string, content: string, message: string): Promise<void> {
  git(cwd, ["init"]);
  git(cwd, ["config", "user.name", "肖志伟"]);
  git(cwd, ["config", "user.email", "developer@example.invalid"]);
  await writeFile(path.join(cwd, fileName), content, "utf8");
  git(cwd, ["add", fileName]);
  git(cwd, ["commit", "-m", message], {
    GIT_AUTHOR_DATE: "2026-07-18T12:00:00+08:00",
    GIT_COMMITTER_DATE: "2026-07-18T12:00:00+08:00"
  });
}

function git(cwd: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync("git", ["-C", cwd, ...args], {
    stdio: "ignore",
    env: { ...process.env, ...env }
  });
}
