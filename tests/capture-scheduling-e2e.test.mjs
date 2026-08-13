import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { syncCodexDesktop } from "../packages/runtime/src/codex-desktop-source.mjs";
import { runDueKnowledgeCycle } from "../packages/runtime/src/knowledge-scheduler.mjs";

test("隔离 E2E：桌面对话进入队列后，无 last-cycle 也会自动补跑", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-capture-schedule-e2e-"));
  const vault = path.join(root, "vault");
  const codexHome = path.join(root, "codex-home");
  const session = path.join(codexHome, "sessions", "2026", "08", "13", "rollout-e2e.jsonl");
  const protectedFiles = [path.join(vault, "wiki", "我的经验.md"), path.join(vault, "成果", "我的成果.md"),
    path.join(vault, "AGENTS.md"), path.join(vault, "raw", "existing.md")];
  try {
    for (const [index, file] of protectedFiles.entries()) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `protected-${index}\n`, "utf8");
    }
    const before = await fileHashes(protectedFiles);
    await mkdir(path.dirname(session), { recursive: true });
    const fixture = [
      { timestamp: "2026-08-13T09:00:00.000Z", type: "session_meta", payload: { id: "e2e-session",
        cwd: "C:\\FictionalProject", originator: "Codex Desktop", cli_version: "0.147.0", source: { subagent: null } } },
      { timestamp: "2026-08-13T09:00:01.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "e2e-turn" } },
      { timestamp: "2026-08-13T09:00:02.000Z", type: "event_msg", payload: { type: "user_message", message: "完成虚构 E2E" } },
      { timestamp: "2026-08-13T09:00:03.000Z", type: "event_msg", payload: { type: "task_complete", turn_id: "e2e-turn",
        last_agent_message: "虚构 E2E 已完成" } }
    ];
    await writeFile(session, `${fixture.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
    const captured = await syncCodexDesktop({ vault, codexHome, now: "2026-08-13T10:00:00.000Z" });
    assert.equal(captured.completed_turns, 1);
    let runCount = 0;
    const scheduled = await runDueKnowledgeCycle({
      vault,
      now: "2026-08-13T10:00:10.000Z",
      finishedAt: "2026-08-13T10:01:00.000Z",
      newActivity: captured.completed_turns > 0,
      executorReady: true,
      run: async () => { runCount += 1; }
    });
    assert.equal(scheduled.reason, "first-activity-catchup");
    assert.equal(scheduled.ok, true);
    assert.equal(runCount, 1);
    assert.equal(scheduled.state.last_success, "2026-08-13T10:01:00.000Z");
    assert.deepEqual(await fileHashes(protectedFiles), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function fileHashes(files) {
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file,
    createHash("sha256").update(await readFile(file)).digest("hex")])));
}
