import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverExecutable } from "../packages/runtime/src/executable-discovery.mjs";

test("桌面进程 PATH 为空时仍发现用户目录中的 Codex 与 lark-cli", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "zhixing-cli-home-"));
  try {
    const localBin = path.join(home, ".local", "bin");
    const npmBin = path.join(home, ".npm-global", "bin");
    await mkdir(localBin, { recursive: true });
    await mkdir(npmBin, { recursive: true });
    const codex = path.join(localBin, "codex");
    const lark = path.join(npmBin, "lark-cli");
    await writeFile(codex, "#!/bin/sh\n", "utf8");
    await writeFile(lark, "#!/bin/sh\n", "utf8");
    await chmod(codex, 0o755);
    await chmod(lark, 0o755);
    const options = { platform: "linux", home, env: { PATH: "" } };
    assert.equal((await discoverExecutable("codex", options))?.path, codex);
    assert.equal((await discoverExecutable("lark-cli", options))?.path, lark);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
