import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { diagnoseSuite } from "../scripts/install-core.mjs";

test("diagnose 分开报告配置、实际支持、事件时间与错误", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-diagnose-health-"));
  const vault = path.join(root, "vault");
  const codexHome = path.join(root, "codex-home");
  const config = path.join(root, "config");
  const program = path.join(config, "programs", "0.6.5");
  const codex = path.join(root, "bin", "codex.exe");
  try {
    await mkdir(path.join(vault, ".obsidian", "plugins", "zhixing-workbench"), { recursive: true });
    await mkdir(path.join(codexHome, "sessions"), { recursive: true });
    await mkdir(path.join(program, "runtime"), { recursive: true });
    await mkdir(path.dirname(codex), { recursive: true });
    await mkdir(config, { recursive: true });
    await writeFile(path.join(program, "runtime", "run-cycle.mjs"), "// fixture\n", "utf8");
    await writeFile(path.join(vault, ".obsidian", "plugins", "zhixing-workbench", "main.js"), "// fixture\n", "utf8");
    await writeFile(path.join(config, "install.json"), JSON.stringify({ version: "0.6.5", vault_root: vault, program_root: program }), "utf8");
    await writeFile(path.join(config, "device.json"), JSON.stringify({ receiver_port: 43123, receiver_token: "fictional-token-long-enough" }), "utf8");
    await writeFile(path.join(codexHome, "hooks.json"), JSON.stringify({ hooks: {
      UserPromptSubmit: [{ hooks: [{ command: `"node" "${path.join(program, "runtime", "capture-hook.mjs")}"` }] }],
      Stop: [{ hooks: [{ command: `"node" "${path.join(program, "runtime", "capture-hook.mjs")}"` }] }]
    } }), "utf8");
    await writeFile(path.join(codexHome, "sessions", "unsupported.jsonl"), `${JSON.stringify({
      timestamp: "2026-08-13T09:00:00.000Z", type: "session_meta",
      payload: { id: "unsupported", originator: "Codex Desktop", cli_version: "0.143.0" }
    })}\n`, "utf8");

    const diagnosis = await diagnoseSuite({
      vault,
      codexHome,
      configOptions: { env: { ZHIXING_CONFIG: config }, platform: process.platform, home: root },
      discoveryOptions: {
        platform: "win32",
        home: root,
        env: { PATH: "", CODEX_BIN: codex, LOCALAPPDATA: path.join(root, "empty") },
        readdir: async () => [],
        access: async (target) => { if (target !== codex) throw new Error("missing"); },
        execFile: async (executable, args) => {
          if (executable === "where.exe") throw new Error("PATH unavailable");
          if (executable === codex && args[0] === "--version") return { stdout: "codex-cli 0.147.0", stderr: "" };
          if (executable === codex && args[0] === "exec") return { stdout: "", stderr: "" };
          if (executable === codex && args[0] === "login") return { stdout: "Logged in", stderr: "" };
          throw new Error("unexpected command");
        }
      },
      fetch: async () => { throw new Error("connection refused"); }
    });
    assert.equal(diagnosis.codex_hooks, "configured");
    assert.equal(diagnosis.codex_cli_hook.configured, true);
    assert.equal(diagnosis.codex_cli_hook.last_event_at, null);
    assert.equal(diagnosis.codex_cli_hook.stale, true);
    assert.equal(diagnosis.knowledge_executor.supported, true);
    assert.equal(diagnosis.codex_desktop.supported, false);
    assert.equal(diagnosis.browser_receiver.configured, true);
    assert.equal(diagnosis.browser_receiver.supported, false);
    assert.match(diagnosis.browser_receiver.error, /未通过探活/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
