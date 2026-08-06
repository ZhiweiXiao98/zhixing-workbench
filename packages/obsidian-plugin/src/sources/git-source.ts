import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { projectKeyFromLabel } from "../core/project";
import { toLocalDate } from "../core/time";
import type { ActivityEvent } from "../core/types";

const execFileAsync = promisify(execFile);

interface GitRepository {
  root: string;
  discoveryKey: string;
  key: string;
  label: string;
  identity: string;
}

export interface GitScanCandidate {
  path: string;
  observedAt: string;
  kind: "reported" | "cwd";
}

interface RankedRepository {
  repository: GitRepository;
  rank: number;
}

export const MAX_GIT_CANDIDATES = 32;
export const MAX_GIT_DISCOVERY_ATTEMPTS = 64;
export const MAX_CHILD_REPOSITORIES_PER_CANDIDATE = 16;
export const MAX_GIT_REPOSITORIES = 12;

const IGNORED_CHILD_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage", ".cache", ".git"]);

export interface GitScanResult {
  events: ActivityEvent[];
  repositories: number;
  errors: string[];
}

export async function scanGitActivity(input: GitScanCandidate[], sinceDate: string): Promise<GitScanResult> {
  const repositories = new Map<string, RankedRepository>();
  const errors: string[] = [];

  const candidates = prioritizeGitCandidates(input);
  const direct = await resolveCandidates(candidates.map((candidate, index) => ({
    path: candidate.path,
    rank: index * 100
  })));
  direct.forEach((entry) => {
    if (entry) {
      keepBestRepository(repositories, entry);
    }
  });

  const children: Array<{ path: string; rank: number }> = [];
  const childSets: string[][] = [];
  for (const candidate of candidates) {
    childSets.push(await listChildRepositoryCandidates(candidate.path, MAX_CHILD_REPOSITORIES_PER_CANDIDATE));
  }
  const childLimits = allocateChildDiscoveryLimits(candidates.length, childSets.map((paths) => paths.length));
  childSets.forEach((childPaths, index) => {
    childPaths.slice(0, childLimits[index] ?? 0).forEach((childPath, childIndex) => children.push({
      path: childPath,
      rank: index * 100 + 20 + childIndex
    }));
  });
  for (const entry of await resolveCandidates(children)) {
    if (entry) {
      keepBestRepository(repositories, entry);
    }
  }

  const selectedRepositories = [...repositories.values()]
    .sort((left, right) => left.rank - right.rank || left.repository.root.localeCompare(right.repository.root))
    .slice(0, MAX_GIT_REPOSITORIES)
    .map((entry) => entry.repository);

  const eventsByObject = new Map<string, ActivityEvent>();
  const scans = await Promise.all(selectedRepositories.map(async (repository) => {
    try {
      return { repository, commits: await readCommits(repository, sinceDate) };
    } catch (error) {
      return { repository, commits: [], error };
    }
  }));
  for (const scan of scans) {
    if (scan.error) {
      errors.push(`${scan.repository.label}: ${scan.error instanceof Error ? scan.error.message : String(scan.error)}`);
    }
    for (const event of scan.commits) {
      const key = event.objectKey ?? event.id;
      const existing = eventsByObject.get(key);
      if (!existing) {
        eventsByObject.set(key, event);
        continue;
      }
      eventsByObject.set(key, {
        ...existing,
        sourceRefs: uniqueBy([...existing.sourceRefs, ...event.sourceRefs], (source) => source.type === "file"
          ? `git-file:${source.label.toLocaleLowerCase()}`
          : `${source.type}:${source.path ?? ""}:${source.url ?? ""}:${source.line ?? ""}`)
      });
    }
  }

  return {
    events: [...eventsByObject.values()].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    repositories: selectedRepositories.length,
    errors
  };
}

export function prioritizeGitCandidates(input: readonly GitScanCandidate[]): GitScanCandidate[] {
  const byPath = new Map<string, GitScanCandidate>();
  for (const candidate of input) {
    if (!candidate.path.trim()) {
      continue;
    }
    const normalized = path.resolve(candidate.path).replace(/[\\/]+$/, "").toLocaleLowerCase();
    const current = byPath.get(normalized);
    if (!current || compareGitCandidates(candidate, current) < 0) {
      byPath.set(normalized, { ...candidate, path: path.resolve(candidate.path) });
    }
  }
  return [...byPath.values()].sort(compareGitCandidates).slice(0, MAX_GIT_CANDIDATES);
}

export function allocateChildDiscoveryLimits(candidateCount: number, availableChildren: readonly number[]): number[] {
  let remaining = Math.max(0, MAX_GIT_DISCOVERY_ATTEMPTS - Math.min(candidateCount, MAX_GIT_CANDIDATES));
  return availableChildren.slice(0, Math.min(candidateCount, MAX_GIT_CANDIDATES)).map((count) => {
    const allocated = Math.min(MAX_CHILD_REPOSITORIES_PER_CANDIDATE, Math.max(0, count), remaining);
    remaining -= allocated;
    return allocated;
  });
}

async function resolveCandidates(candidates: Array<{ path: string; rank: number }>): Promise<Array<RankedRepository | null>> {
  const resolved: Array<RankedRepository | null> = [];
  for (let index = 0; index < candidates.length; index += 8) {
    const batch = await Promise.all(candidates.slice(index, index + 8).map(async (candidate) => {
      try {
        return { repository: await resolveRepository(candidate.path), rank: candidate.rank };
      } catch {
        return null;
      }
    }));
    resolved.push(...batch);
  }
  return resolved;
}

async function listChildRepositoryCandidates(parentPath: string, limit: number): Promise<string[]> {
  try {
    const parent = await stat(parentPath);
    if (!parent.isDirectory()) {
      return [];
    }
    const entries = (await readdir(parentPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".") && !IGNORED_CHILD_DIRECTORIES.has(entry.name.toLocaleLowerCase()));
    const dated = await Promise.all(entries.map(async (entry) => {
      const childPath = path.join(parentPath, entry.name);
      try {
        return { path: childPath, mtime: (await stat(childPath)).mtimeMs };
      } catch {
        return null;
      }
    }));
    return dated
      .filter((entry): entry is { path: string; mtime: number } => Boolean(entry))
      .sort((left, right) => right.mtime - left.mtime || left.path.localeCompare(right.path))
      .slice(0, limit)
      .map((entry) => entry.path);
  } catch {
    return [];
  }
}

function keepBestRepository(repositories: Map<string, RankedRepository>, candidate: RankedRepository): void {
  const current = repositories.get(candidate.repository.discoveryKey);
  if (!current || candidate.rank < current.rank) {
    repositories.set(candidate.repository.discoveryKey, candidate);
  }
}

function compareGitCandidates(left: GitScanCandidate, right: GitScanCandidate): number {
  const timeOrder = right.observedAt.localeCompare(left.observedAt);
  if (timeOrder !== 0) {
    return timeOrder;
  }
  const kindOrder = Number(right.kind === "reported") - Number(left.kind === "reported");
  if (kindOrder !== 0) {
    return kindOrder;
  }
  return left.path.localeCompare(right.path);
}

async function resolveRepository(cwd: string): Promise<GitRepository> {
  const entry = await stat(cwd);
  const startPath = entry.isFile() ? path.dirname(cwd) : cwd;
  const { stdout } = await runGit(startPath, ["rev-parse", "--show-toplevel", "--git-common-dir"]);
  const [rootLine, commonLine] = stdout.trim().split(/\r?\n/);
  if (!rootLine || !commonLine) {
    throw new Error("Not a Git repository");
  }
  const root = rootLine.trim();
  const remote = await optionalGit(root, ["remote", "get-url", "origin"]);
  const common = commonLine.trim();
  const key = repositoryIdentityKey(remote, startPath, common);
  const discoveryKey = `${key}:${path.resolve(startPath, common).toLocaleLowerCase()}`;
  const label = remote ? repositoryName(redactRemoteCredentials(remote)) : root.split(/[\\/]/).filter(Boolean).at(-1) ?? "Git 项目";
  const email = (await optionalGit(root, ["config", "user.email"])) || (await optionalGit(root, ["config", "user.name"]));
  return { root, discoveryKey, key, label, identity: email };
}

export function repositoryIdentityKey(remote: string, resolutionBase: string, commonDir: string): string {
  if (remote) {
    const redacted = redactRemoteCredentials(remote);
    return `remote:${createHash("sha256").update(redacted).digest("hex")}`;
  }
  return path.resolve(resolutionBase, commonDir).toLocaleLowerCase();
}

async function readCommits(repository: GitRepository, sinceDate: string): Promise<ActivityEvent[]> {
  if (!repository.identity) {
    return [];
  }
  const args = [
    "log",
    "--all",
    `--since=${sinceDate}T00:00:00+08:00`,
    `--author=${repository.identity}`,
    "--pretty=format:%x1e%H%x1f%cI%x1f%s%x1f%an%x1f%ae",
    "--name-only"
  ];
  const { stdout } = await runGit(repository.root, args, 10_000);
  const projectKey = projectKeyFromLabel(repository.label);
  return stdout
    .split("\x1e")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [header = "", ...fileLines] = chunk.split(/\r?\n/);
      const parts = header.split("\x1f");
      const [hash = "", occurredAt = "", subject = "", author = "", email = ""] = parts;
      const changedFiles = fileLines.map((line) => line.trim()).filter(Boolean);
      const sourceRefs = [
        {
          type: "git" as const,
          label: `${repository.label} ${hash.slice(0, 8)}`,
          path: repository.root,
          excerpt: subject
        },
        ...changedFiles.slice(0, 24).map((filePath) => ({
          type: "file" as const,
          label: filePath,
          path: path.join(repository.root, filePath),
          excerpt: `Git 提交 ${hash.slice(0, 8)} 中的变更文件`
        }))
      ];
      return {
        id: `git:${hash.toLowerCase()}`,
        kind: "output_created" as const,
        occurredAt,
        observedAt: occurredAt,
        localDate: toLocalDate(occurredAt),
        timeBasis: "source" as const,
        title: subject,
        summary: `${author} <${email}> · ${hash.slice(0, 8)}${changedFiles.length ? ` · ${changedFiles.length} 个文件` : ""}`,
        projectKey,
        projectLabel: repository.label,
        objectKey: `git:${hash.toLowerCase()}`,
        confidence: "verified" as const,
        evidence: "Git 历史中存在当前用户身份的 commit",
        sourceRefs
      } satisfies ActivityEvent;
    })
    .filter((event) => Boolean(event.id && event.occurredAt));
}

async function optionalGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await runGit(cwd, args);
    return stdout.trim();
  } catch {
    return "";
  }
}

async function runGit(cwd: string, args: string[], timeout = 4_000): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    windowsHide: true,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    encoding: "utf8"
  });
}

function repositoryName(remote: string): string {
  const withoutSuffix = remote.replace(/[\\/]$/, "").replace(/\.git$/i, "");
  return withoutSuffix.split(/[\\/:]/).filter(Boolean).at(-1) ?? "Git 项目";
}

function redactRemoteCredentials(remote: string): string {
  const trimmed = remote.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed.replace(/^[^@/\s]+@(?=[^:/\s]+[:/])/, "");
  }
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const itemKey = key(value);
    if (seen.has(itemKey)) {
      return false;
    }
    seen.add(itemKey);
    return true;
  });
}
