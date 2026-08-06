import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function extractedArchivePaths(archive) {
  const temporary = await mkdtemp(path.join(tmpdir(), "zhixing-release-layout-"));
  try {
    await execFileAsync("tar", ["-xzf", archive, "-C", temporary], {
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    });
    return await listTree(temporary);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function listTree(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relative, entry.name);
    paths.push(child.replace(/\\/g, "/"));
    if (entry.isDirectory()) paths.push(...await listTree(root, child));
  }
  return paths;
}
