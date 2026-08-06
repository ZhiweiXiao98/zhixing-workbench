import { normalizePath, TFile, TFolder, type App } from "obsidian";
import {
  ARTIFACT_ROOT,
  addManagedAlias,
  artifactNotePath,
  dailyArtifactIndexPath,
  isValidLocalDate,
  markArtifactNoteStale,
  mergeGeneratedBlock,
  readableArtifactFileTitle,
  readManagedArtifactMetadata,
  renderArtifactNote,
  renderDailyArtifactIndex
} from "./core/artifact-markdown";
import type { ArtifactRecord } from "./core/types";

export interface ArtifactSyncResult {
  persistedIds: Set<string>;
  notes: number;
  writes: number;
  errors: string[];
}

interface ManagedFile {
  file: TFile;
  path: string;
  id: string;
  date: string;
  daily: boolean;
  stale: boolean;
  title?: string;
}

export class ArtifactWriter {
  constructor(private readonly app: App) {}

  async sync(artifacts: ArtifactRecord[]): Promise<ArtifactSyncResult> {
    const result: ArtifactSyncResult = {
      persistedIds: new Set<string>(),
      notes: 0,
      writes: 0,
      errors: []
    };
    const managed = await this.findManagedFiles(result.errors);
    if (artifacts.length === 0 && managed.length === 0) {
      return result;
    }

    try {
      await this.ensureFolder(ARTIFACT_ROOT);
    } catch (error) {
      result.errors.push(errorMessage(error));
      return result;
    }

    await this.migrateHistoricalFiles(new Set(artifacts.map((artifact) => artifact.id)), managed, result);
    const prepared = this.prepareArtifacts(artifacts, managed, result.errors);
    const managedDates = new Set(managed.map((entry) => entry.date));
    const migration = await this.migrateManagedFiles(prepared, managed, result);
    const blockedIds = migration.blockedIds;
    const byDate = groupByDate(prepared);
    const persistedByDate = new Map<string, ArtifactRecord[]>();
    for (const [date, dateArtifacts] of byDate) {
      try {
        await this.ensureFolder(`${ARTIFACT_ROOT}/${date}`);
      } catch (error) {
        result.errors.push(errorMessage(error));
        continue;
      }
      const persisted: ArtifactRecord[] = [];
      for (const artifact of dateArtifacts) {
        if (blockedIds.has(artifact.id)) {
          continue;
        }
        try {
          const write = await this.writeManagedFile(artifact.notePath, renderArtifactNote(artifact));
          result.writes += write ? 1 : 0;
          result.notes += 1;
          result.persistedIds.add(artifact.id);
          persisted.push(artifact);
        } catch (error) {
          result.errors.push(`${artifact.notePath}: ${errorMessage(error)}`);
        }
      }
      persistedByDate.set(date, persisted);
    }

    const currentPaths = new Set(prepared.map((artifact) => artifact.notePath));
    for (const entry of managed) {
      if (entry.daily || blockedIds.has(entry.id) || migration.protectedIds.has(entry.id) || currentPaths.has(entry.path)) {
        continue;
      }
      try {
        const write = await this.markStale(entry.file);
        result.writes += write ? 1 : 0;
      } catch (error) {
        result.errors.push(`${entry.path}: ${errorMessage(error)}`);
      }
    }

    const dates = new Set<string>([
      ...byDate.keys(),
      ...managedDates,
      ...managed.map((entry) => entry.date)
    ]);
    for (const date of [...dates].sort()) {
      const indexPath = dailyArtifactIndexPath(date);
      try {
        const write = await this.writeManagedFile(indexPath, renderDailyArtifactIndex(date, persistedByDate.get(date) ?? []));
        result.writes += write ? 1 : 0;
      } catch (error) {
        result.errors.push(`${indexPath}: ${errorMessage(error)}`);
      }
    }
    return result;
  }

  private prepareArtifacts(artifacts: ArtifactRecord[], managed: ManagedFile[], errors: string[]): ArtifactRecord[] {
    const prepared: ArtifactRecord[] = [];
    const reserved = new Map(
      managed.filter((entry) => !entry.daily).map((entry) => [entry.path, entry.id])
    );
    for (const artifact of artifacts) {
      try {
        if (!isValidLocalDate(artifact.localDate)) {
          throw new Error(`无效的本地日期：${artifact.localDate}`);
        }
        const allowedPaths = Array.from({ length: 99 }, (_, index) => artifactNotePath(artifact, index + 1));
        if (artifact.notePath && !allowedPaths.includes(normalizeAndValidatePath(artifact.notePath))) {
          throw new Error("成果路径不是该条目的规范托管路径");
        }
        const ownedPath = managed.find((entry) => entry.id === artifact.id && allowedPaths.includes(entry.path))?.path;
        const candidatePaths = ownedPath
          ? [ownedPath, ...allowedPaths.filter((candidate) => candidate !== ownedPath)]
          : allowedPaths;
        const canonicalPath = candidatePaths.find((candidate) => {
          const owner = reserved.get(candidate);
          const occupied = this.app.vault.getAbstractFileByPath(candidate);
          return (!owner || owner === artifact.id) && (!occupied || owner === artifact.id);
        });
        if (!canonicalPath) {
          throw new Error("成果的自然语言文件名及 98 个重名序号均已被占用");
        }
        reserved.set(canonicalPath, artifact.id);
        artifact.notePath = canonicalPath;
        prepared.push({ ...artifact, notePath: canonicalPath });
      } catch (error) {
        errors.push(`${artifact.id}: ${errorMessage(error)}`);
      }
    }
    return prepared;
  }

  private async findManagedFiles(errors: string[]): Promise<ManagedFile[]> {
    const entries: ManagedFile[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const path = normalizePath(file.path);
      const pathInfo = managedPathInfo(path);
      if (!pathInfo) {
        continue;
      }
      try {
        const content = await this.app.vault.cachedRead(file);
        const metadata = readManagedArtifactMetadata(content);
        if (!metadata || metadata.date !== pathInfo.date || metadata.id.startsWith("daily:") !== pathInfo.daily) {
          if (/^zhixing_generated:\s*true\s*$/m.test(content)) {
            errors.push(`${path}: 托管文件的 frontmatter、ID 或标记无效，已跳过`);
          }
          continue;
        }
        if (pathInfo.daily && metadata.id !== `daily:${pathInfo.date}`) {
          errors.push(`${path}: 日索引 ID 不匹配，已跳过`);
          continue;
        }
        entries.push({
          file,
          path,
          id: metadata.id,
          date: metadata.date,
          daily: pathInfo.daily,
          stale: metadata.stale,
          title: metadata.title
        });
      } catch (error) {
        errors.push(`${path}: ${errorMessage(error)}`);
      }
    }
    return entries;
  }

  private async migrateManagedFiles(
    artifacts: ArtifactRecord[],
    managed: ManagedFile[],
    result: ArtifactSyncResult
  ): Promise<{ blockedIds: Set<string>; protectedIds: Set<string> }> {
    const blockedIds = new Set<string>();
    const protectedIds = new Set<string>();
    const currentById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    const byId = new Map<string, ManagedFile[]>();
    for (const entry of managed) {
      if (entry.daily) {
        continue;
      }
      const entries = byId.get(entry.id) ?? [];
      entries.push(entry);
      byId.set(entry.id, entries);
    }

    for (const [id, entries] of byId) {
      const current = currentById.get(id);
      if (!current) {
        // Historical projections are intentionally left in place. Reassigning an
        // inactive note to a new natural-language name can steal the canonical
        // path from a current artifact and makes a refresh order-dependent.
        continue;
      }
      const title = current?.title ?? entries[0]?.title;
      const date = current?.localDate ?? entries[0]?.date;
      if (!title || !date) {
        continue;
      }
      const desiredPath = current?.notePath || artifactNotePath({ id, localDate: date, title });
      const canonical = entries.find((entry) => entry.path === desiredPath);
      if (entries.length !== 1) {
        const primary = canonical ?? [...entries].sort(compareManagedCopies)[0];
        if (!primary) {
          continue;
        }
        const secondaries = entries.filter((entry) => entry !== primary).sort((left, right) => left.path.localeCompare(right.path));
        const destinations = new Map<ManagedFile, string>([[primary, desiredPath]]);
        const claimedPaths = new Set([desiredPath]);
        secondaries.forEach((entry) => {
          if (/（历史记录\d*）\.md$/.test(entry.path) && !claimedPaths.has(entry.path)) {
            destinations.set(entry, entry.path);
            claimedPaths.add(entry.path);
            return;
          }
          const historyTitle = readableArtifactFileTitle(entry.title ?? title);
          const historyPath = this.availableHistoryPath(entry, historyTitle, claimedPaths);
          destinations.set(entry, historyPath);
          claimedPaths.add(historyPath);
        });
        try {
          await this.renameManagedCopies(destinations, result);
        } catch (error) {
          result.errors.push(`${id}: 无法整理同 ID 的历史副本：${errorMessage(error)}`);
          protectedIds.add(id);
          if (current) {
            blockedIds.add(id);
          }
        }
        continue;
      }
      if (canonical) {
        continue;
      }

      const entry = entries[0];
      if (!entry) {
        continue;
      }
      try {
        await this.renameManagedCopies(new Map([[entry, desiredPath]]), result);
        entry.date = date;
        entry.title = title;
      } catch (error) {
        result.errors.push(`${entry.path}: 无法迁移为 ${desiredPath}：${errorMessage(error)}`);
        if (current) {
          blockedIds.add(id);
        }
      }
    }
    return { blockedIds, protectedIds };
  }

  private async migrateHistoricalFiles(
    currentIds: ReadonlySet<string>,
    managed: ManagedFile[],
    result: ArtifactSyncResult
  ): Promise<void> {
    const historical = managed.filter((entry) => !entry.daily && !currentIds.has(entry.id));
    const claimedPaths = new Set<string>();
    const destinations = new Map<ManagedFile, string>();
    for (const entry of historical.sort((left, right) => left.path.localeCompare(right.path))) {
      if (/（历史记录\d*）\.md$/.test(entry.path) && !claimedPaths.has(entry.path)) {
        destinations.set(entry, entry.path);
        claimedPaths.add(entry.path);
        continue;
      }
      if (!entry.title) {
        continue;
      }
      const historyPath = this.availableHistoryPath(entry, readableArtifactFileTitle(entry.title), claimedPaths);
      destinations.set(entry, historyPath);
      claimedPaths.add(historyPath);
    }
    try {
      await this.renameManagedCopies(destinations, result);
    } catch (error) {
      result.errors.push(`无法整理历史成果：${errorMessage(error)}`);
    }
  }

  private availableHistoryPath(entry: ManagedFile, title: string, claimedPaths: Set<string>): string {
    for (let copyNumber = 1; copyNumber <= 999; copyNumber += 1) {
      const suffix = copyNumber === 1 ? "" : String(copyNumber);
      const candidate = `${ARTIFACT_ROOT}/${entry.date}/${title}（历史记录${suffix}）.md`;
      if (claimedPaths.has(candidate)) {
        continue;
      }
      const occupied = this.app.vault.getAbstractFileByPath(candidate);
      if (!occupied || occupied === entry.file) {
        return candidate;
      }
    }
    throw new Error(`${title} 的历史副本文件名已用尽`);
  }

  private async renameManagedCopies(destinations: Map<ManagedFile, string>, result: ArtifactSyncResult): Promise<void> {
    for (const [entry, desiredPath] of destinations) {
      if (entry.path === desiredPath) {
        continue;
      }
      await this.ensureFolder(desiredPath.slice(0, desiredPath.lastIndexOf("/")));
      const destination = this.app.vault.getAbstractFileByPath(desiredPath);
      if (destination && destination !== entry.file) {
        throw new Error(`${desiredPath} 已被其他文件占用`);
      }
    }
    for (const [entry, desiredPath] of destinations) {
      if (entry.path === desiredPath) {
        continue;
      }
      const alias = fileBaseName(entry.path);
      const existing = await this.app.vault.cachedRead(entry.file);
      const aliased = addManagedAlias(existing, alias);
      if (!aliased.ok) {
        throw new Error(aliased.error ?? "无法保留旧文件名别名");
      }
      if (aliased.content !== existing) {
        await this.app.vault.process(entry.file, (current) => {
          const updated = addManagedAlias(current, alias);
          return updated.ok ? updated.content : current;
        });
        result.writes += 1;
      }
      await this.app.vault.rename(entry.file, desiredPath);
      entry.path = desiredPath;
      result.writes += 1;
    }
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizeAndValidateFolderPath(folderPath);
    const parts = normalized.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) {
        continue;
      }
      if (existing) {
        throw new Error(`${current} 已存在且不是文件夹`);
      }
      try {
        await this.app.vault.createFolder(current);
      } catch {
        const raced = this.app.vault.getAbstractFileByPath(current);
        if (!(raced instanceof TFolder)) {
          throw new Error(`无法创建成果目录 ${current}`);
        }
      }
    }
  }

  private async writeManagedFile(filePath: string, desired: string): Promise<boolean> {
    const normalized = normalizeAndValidatePath(filePath);
    if (!managedPathInfo(normalized)) {
      throw new Error("成果文件路径不在允许的托管目录中");
    }
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (!existing) {
      try {
        await this.app.vault.create(normalized, desired);
        return true;
      } catch {
        const raced = this.app.vault.getAbstractFileByPath(normalized);
        if (!(raced instanceof TFile)) {
          throw new Error("创建失败且目标不是可处理的文件");
        }
        return this.processExisting(raced, desired);
      }
    }
    if (!(existing instanceof TFile)) {
      throw new Error("目标路径已被文件夹占用");
    }
    return this.processExisting(existing, desired);
  }

  private async processExisting(file: TFile, desired: string): Promise<boolean> {
    const existing = await this.app.vault.cachedRead(file);
    const preview = mergeGeneratedBlock(existing, desired);
    if (!preview.ok) {
      throw new Error(preview.error ?? "无法更新成果文件");
    }
    if (preview.content === existing) {
      return false;
    }
    let changed = false;
    let failure: string | undefined;
    await this.app.vault.process(file, (current) => {
      const merged = mergeGeneratedBlock(current, desired);
      if (!merged.ok) {
        failure = merged.error ?? "无法更新成果文件";
        return current;
      }
      changed = merged.content !== current;
      return merged.content;
    });
    if (failure) {
      throw new Error(failure);
    }
    return changed;
  }

  private async markStale(file: TFile): Promise<boolean> {
    const existing = await this.app.vault.cachedRead(file);
    const preview = markArtifactNoteStale(existing);
    if (!preview.ok) {
      throw new Error(preview.error ?? "无法标记历史成果");
    }
    if (preview.content === existing) {
      return false;
    }
    let changed = false;
    let failure: string | undefined;
    await this.app.vault.process(file, (current) => {
      const stale = markArtifactNoteStale(current);
      if (!stale.ok) {
        failure = stale.error ?? "无法标记历史成果";
        return current;
      }
      changed = stale.content !== current;
      return stale.content;
    });
    if (failure) {
      throw new Error(failure);
    }
    return changed;
  }
}

function groupByDate(artifacts: ArtifactRecord[]): Map<string, ArtifactRecord[]> {
  const byDate = new Map<string, ArtifactRecord[]>();
  for (const artifact of artifacts) {
    const dateArtifacts = byDate.get(artifact.localDate) ?? [];
    dateArtifacts.push(artifact);
    byDate.set(artifact.localDate, dateArtifacts);
  }
  return byDate;
}

function compareManagedCopies(left: ManagedFile, right: ManagedFile): number {
  const staleOrder = Number(left.stale) - Number(right.stale);
  if (staleOrder !== 0) {
    return staleOrder;
  }
  const leftPrimary = /\/成果-[0-9a-f]{12}\.md$/.test(left.path) ? 0 : 1;
  const rightPrimary = /\/成果-[0-9a-f]{12}\.md$/.test(right.path) ? 0 : 1;
  return leftPrimary - rightPrimary || left.path.localeCompare(right.path);
}

function managedPathInfo(path: string): { date: string; daily: boolean } | null {
  const daily = path.match(/^成果\/知行台\/(\d{4}-\d{2}-\d{2})\.md$/);
  if (daily?.[1] && isValidLocalDate(daily[1])) {
    return { date: daily[1], daily: true };
  }
  const readable = path.match(/^成果\/知行台\/(\d{4}-\d{2}-\d{2})\/[^/]+\.md$/);
  if (readable?.[1] && isValidLocalDate(readable[1])) {
    return { date: readable[1], daily: false };
  }
  return null;
}

function normalizeAndValidatePath(filePath: string): string {
  const slashPath = filePath.replace(/\\/g, "/");
  if (slashPath.startsWith("/") || /^[A-Za-z]:/.test(slashPath) || slashPath.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("成果路径包含绝对路径或目录穿越");
  }
  const normalized = normalizePath(slashPath);
  if (!normalized.startsWith(`${ARTIFACT_ROOT}/`) || normalized === ARTIFACT_ROOT) {
    throw new Error("成果路径超出知行台托管目录");
  }
  return normalized;
}

function fileBaseName(filePath: string): string {
  const name = filePath.split("/").at(-1) ?? filePath;
  return name.replace(/\.md$/i, "");
}

function normalizeAndValidateFolderPath(folderPath: string): string {
  const slashPath = folderPath.replace(/\\/g, "/");
  if (slashPath.startsWith("/") || /^[A-Za-z]:/.test(slashPath) || slashPath.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("成果目录包含绝对路径或目录穿越");
  }
  const normalized = normalizePath(slashPath);
  if (normalized !== ARTIFACT_ROOT && !normalized.startsWith(`${ARTIFACT_ROOT}/`)) {
    throw new Error("成果目录超出知行台托管目录");
  }
  return normalized;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
