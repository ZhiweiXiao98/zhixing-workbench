import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverExecutable, probeCodexExecutor } from "../packages/runtime/src/executable-discovery.mjs";

test("桌面进程 PATH 为空时仍发现用户目录中的 Codex 与 lark-cli", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "zhixing-cli-home-"));
  try {
    const localBin = path.join(home, ".local", "bin");
    const npmBin = path.join(home, ".npm-global", "bin");
    await mkdir(localBin, { recursive: true });
    await mkdir(npmBin, { recursive: true });
    const codex = path.join(localBin, "codex");
    const lark = path.join(npmBin, "lark-cli");
    await writeFile(codex, "#!/bin/sh\necho codex-cli 0.147.0\n", "utf8");
    await writeFile(lark, "#!/bin/sh\necho lark-cli 1.3.0\n", "utf8");
    await chmod(codex, 0o755);
    await chmod(lark, 0o755);
    const options = {
      platform: "linux",
      home,
      env: { PATH: "" },
      execFile: async (executable) => {
        if (executable === "/usr/bin/which") throw new Error("PATH unavailable");
        return { stdout: `${path.basename(executable)} 1.0.0`, stderr: "" };
      }
    };
    assert.equal((await discoverExecutable("codex", options))?.path, codex);
    assert.equal((await discoverExecutable("lark-cli", options))?.path, lark);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Windows 不依赖 where.exe，实际探活 Codex Desktop 稳定运行目录", async () => {
  const home = "C:\\Users\\Example";
  const localAppData = `${home}\\AppData\\Local`;
  const runtimeRoot = `${localAppData}\\OpenAI\\Codex\\bin`;
  const candidate = `${runtimeRoot}\\stable-build\\codex.exe`;
  const calls = [];
  const result = await discoverExecutable("codex", {
    platform: "win32",
    home,
    env: { PATH: "", LOCALAPPDATA: localAppData },
    readdir: async (target) => {
      assert.equal(target, runtimeRoot);
      return [{ name: "stable-build", isDirectory: () => true }];
    },
    access: async (target) => {
      if (target !== candidate) throw new Error("missing");
    },
    execFile: async (executable, args) => {
      calls.push([executable, ...args]);
      if (executable === "where.exe") throw new Error("PATH unavailable");
      if (executable === candidate && args[0] === "--version") return { stdout: "codex-cli 0.147.0", stderr: "" };
      throw new Error("unexpected command");
    }
  });
  assert.deepEqual(result, { path: candidate, source: "desktop-runtime", version: "codex-cli 0.147.0" });
  assert.ok(calls.some((call) => call[0] === candidate && call[1] === "--version"));
});

test("候选文件存在但 --version 失败时不误报可用", async () => {
  const result = await discoverExecutable("codex", {
    platform: "win32",
    home: "C:\\Users\\Example",
    env: { PATH: "", CODEX_BIN: "C:\\broken\\codex.exe", LOCALAPPDATA: "C:\\empty" },
    readdir: async () => [],
    access: async (target) => {
      if (target !== "C:\\broken\\codex.exe") throw new Error("missing");
    },
    execFile: async () => { throw new Error("bad image"); }
  });
  assert.equal(result, null);
});

test("Windows 仅安装 npm Codex 时发现包内原生可执行文件", async () => {
  const home = "C:\\Users\\Example";
  const appData = `${home}\\AppData\\Roaming`;
  const native = `${appData}\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`;
  const result = await discoverExecutable("codex", {
    platform: "win32",
    home,
    env: { PATH: "", APPDATA: appData, LOCALAPPDATA: `${home}\\Empty` },
    readdir: async () => [],
    access: async (target) => { if (target !== native) throw new Error("missing"); },
    execFile: async (executable, args) => {
      if (executable === "where.exe") throw new Error("PATH unavailable");
      if (executable === native && args[0] === "--version") return { stdout: "codex-cli 0.147.0", stderr: "" };
      throw new Error("unexpected command");
    }
  });
  assert.deepEqual(result, { path: native, source: "common-location", version: "codex-cli 0.147.0" });
});

test("知识整理执行器使用 exec 能力与登录状态独立探活", async () => {
  const calls = [];
  assert.deepEqual(await probeCodexExecutor("/opt/codex", {
    execFile: async (executable, args) => { calls.push([executable, ...args]); return { stdout: "", stderr: "" }; }
  }), { supported: true, error: null });
  assert.deepEqual(calls, [["/opt/codex", "exec", "--help"], ["/opt/codex", "login", "status"]]);
});
