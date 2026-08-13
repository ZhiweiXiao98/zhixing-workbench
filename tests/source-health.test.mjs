import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readCodexCliHookHealth } from "../packages/runtime/src/source-health.mjs";

test("CLI Hook 配置存在但没有真实事件时只报已配置和等待", async () => {
  const vault = await mkdtemp(path.join(tmpdir(), "zhixing-hook-health-"));
  try {
    const hooks = { hooks: {
      UserPromptSubmit: [{ hooks: [{ command: '"node" "C:\\Program\\runtime\\capture-hook.mjs"' }] }],
      Stop: [{ hooks: [{ command: '"node" "C:\\Program\\runtime\\capture-hook.mjs"' }] }]
    } };
    const health = await readCodexCliHookHealth({ vault, hooks, codexExecutable: "C:\\Program\\codex.exe",
      now: "2026-08-13T08:00:00.000Z" });
    assert.equal(health.configured, true);
    assert.equal(health.supported, true);
    assert.equal(health.last_event_at, null);
    assert.equal(health.stale, true);
    assert.equal(health.error, null);

    const events = path.join(vault, "raw", "codex", "events");
    await mkdir(events, { recursive: true });
    await writeFile(path.join(events, "2026-08-13.jsonl"), `${JSON.stringify({
      capture_source: "codex_cli_hook", captured_at: "2026-08-13T07:55:00.000Z"
    })}\n`, "utf8");
    const active = await readCodexCliHookHealth({ vault, hooks, codexExecutable: "C:\\Program\\codex.exe",
      now: "2026-08-13T08:00:00.000Z" });
    assert.equal(active.last_event_at, "2026-08-13T07:55:00.000Z");
    assert.equal(active.stale, false);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});
