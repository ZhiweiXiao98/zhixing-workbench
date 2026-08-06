import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { extractedArchivePaths } from "../scripts/release-archive.mjs";

const execFileAsync = promisify(execFile);

test("Release 结构检查通过解包后的文件系统识别中文安装入口", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-chinese-entry-"));
  const stage = path.join(root, "stage", "zhixing-workbench");
  const archive = path.join(root, "candidate.tar.gz");
  try {
    await mkdir(stage, { recursive: true });
    await writeFile(path.join(stage, "安装知行台.cmd"), "@echo off\r\n", "utf8");
    await execFileAsync("tar", ["-czf", archive, "-C", path.dirname(stage), "zhixing-workbench"], {
      timeout: 30_000,
      windowsHide: true
    });
    const paths = await extractedArchivePaths(archive);
    assert.ok(paths.includes("zhixing-workbench/安装知行台.cmd"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
