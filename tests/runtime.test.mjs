import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { configRoot, redactText } from "../packages/runtime/src/common.mjs";
import { createReceiver } from "../packages/runtime/src/receiver-server.mjs";
import { runCycle } from "../packages/runtime/src/run-cycle.mjs";

test("三端配置目录遵循各平台约定", () => {
  assert.equal(configRoot({ platform: "win32", home: "X:/home", env: { APPDATA: "X:/profile" } }), path.win32.resolve("X:/profile", "ZhixingWorkbench"));
  assert.equal(configRoot({ platform: "darwin", home: "/Users/demo", env: {} }), "/Users/demo/Library/Application Support/ZhixingWorkbench");
  assert.equal(configRoot({ platform: "linux", home: "/home/demo", env: {} }), "/home/demo/.config/zhixing-workbench");
  assert.equal(configRoot({ platform: "linux", home: "/home/demo", env: { XDG_CONFIG_HOME: "/config" } }), "/config/zhixing-workbench");
});

test("采集内容隐藏常见凭据", () => {
  const source = `password=hunter22 authorization: BearerValue12345 ${["github", "pat"].join("_")}_abcdefghijklmnopqrstuvwxyz`;
  const result = redactText(source);
  assert.doesNotMatch(result, /hunter22|BearerValue12345|github/);
  assert.match(result, /已隐藏/);
});

test("Codex Hook 读取标准输入并写入 Vault", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-hook-"));
  const vault = path.join(root, "vault");
  const config = path.join(root, "config");
  await mkdir(vault, { recursive: true });
  await mkdir(config, { recursive: true });
  await writeFile(path.join(config, "install.json"), JSON.stringify({ vault_root: vault }), "utf8");
  const payload = JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    session_id: "session-1",
    turn_id: "turn-1",
    cwd: root,
    prompt: "记录这个排查，password=long-secret-value"
  });
  try {
    await runWithInput(process.execPath, [path.resolve("packages/runtime/src/capture-hook.mjs")], payload,
      { ...process.env, ZHIXING_CONFIG: config });
    const directory = path.join(vault, "raw", "codex", "events");
    const { readdir } = await import("node:fs/promises");
    const file = (await readdir(directory))[0];
    const record = JSON.parse((await readFile(path.join(directory, file), "utf8")).trim());
    assert.equal(record.event, "UserPromptSubmit");
    assert.doesNotMatch(record.content, /long-secret-value/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("本机接收器鉴权、写入并幂等确认", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-receiver-"));
  const token = "test-only-token-that-is-long-enough";
  const server = await createReceiver({ vault: root, token, port: 0 });
  const address = server.address();
  assert.equal(typeof address, "object");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const event = {
    event: "UserPromptSubmit",
    conversation_id: "fictional-conversation",
    turn_id: "turn-one",
    message_id: "message-one",
    title: "虚构演示",
    url: "https://chatgpt.com/c/fictional",
    content: "如何验证一条虚构记录"
  };
  try {
    const unauthorized = await fetch(`${endpoint}/health`);
    assert.equal(unauthorized.status, 401);
    const first = await postEvents(endpoint, token, [event]);
    assert.equal(first.accepted, 1);
    const second = await postEvents(endpoint, token, [event]);
    assert.equal(second.duplicates, 1);
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(path.join(root, "raw", "chatgpt", "events"));
    const lines = (await readFile(path.join(root, "raw", "chatgpt", "events", files[0]), "utf8")).trim().split(/\r?\n/);
    assert.equal(lines.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("空队列整理周期留下可见记录并释放锁", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-cycle-"));
  try {
    const first = await runCycle({ vault: root, batches: 3, trigger: "manual" });
    assert.equal(first.status, "succeeded");
    assert.equal(first.batches.length, 1);
    const status = JSON.parse(await readFile(path.join(root, "raw", "codex", "automation", "last-cycle.json"), "utf8"));
    assert.equal(status.status, "succeeded");
    const second = await runCycle({ vault: root, batches: 1, trigger: "automatic" });
    assert.equal(second.status, "succeeded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("语义整理以只读 Codex 运行并由外层提交回执", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-readonly-cycle-"));
  const events = path.join(root, "raw", "codex", "events");
  const fakeCodex = path.join(root, "fake-codex.mjs");
  await mkdir(events, { recursive: true });
  const common = {
    schema_version: 1,
    source: "codex",
    captured_at: "2026-01-01T08:00:00+08:00",
    date: "2026-01-01",
    session_id: "fictional-session",
    turn_id: "fictional-turn",
    cwd: path.join(root, "fictional-project")
  };
  await writeFile(path.join(events, "2026-01-01.jsonl"), [
    JSON.stringify({ ...common, event: "UserPromptSubmit", event_id: "prompt-event", content: "排查虚构接收器失败原因" }),
    JSON.stringify({ ...common, event: "Stop", event_id: "stop-event", content: "确认只是演示数据，不需要形成长期知识" })
  ].join("\n") + "\n", "utf8");
  await writeFile(fakeCodex, `import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2);
await writeFile(path.join(process.cwd(), "fake-codex-args.json"), JSON.stringify(args));
const output = args[args.indexOf("--output-last-message") + 1];
const contract = JSON.parse(await readFile(path.join(process.cwd(), "raw", "codex", "ingest-run-contract.json"), "utf8"));
await writeFile(output, JSON.stringify({ schema_version: 4, run_id: contract.run_id, outcomes: contract.topics.map((topic) => ({ id: topic.id, status: "not-applicable", reason: "虚构演示没有长期复用价值" })) }));
process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { total_tokens: 42 } }) + "\\n");
`, "utf8");
  try {
    const result = await runCycle({
      vault: root,
      batches: 1,
      codex: process.execPath,
      codexPrefixArgs: [fakeCodex],
      maxTopics: 1,
      maxPairs: 2
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.tokens_used, 42);
    const codexArgs = JSON.parse(await readFile(path.join(root, "fake-codex-args.json"), "utf8"));
    assert.deepEqual(codexArgs.slice(codexArgs.indexOf("--sandbox"), codexArgs.indexOf("--sandbox") + 2), ["--sandbox", "read-only"]);
    const state = JSON.parse(await readFile(path.join(root, "raw", "codex", "ingest-state.json"), "utf8"));
    assert.deepEqual(new Set(state.processed_event_ids), new Set(["prompt-event", "stop-event"]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("事务以 exit 2 返回部分失败时保留 stdout 回执与可读错误", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-partial-evidence-"));
  const fakeTransaction = path.join(root, "fake-transaction.mjs");
  const fakeCodex = path.join(root, "fake-codex.mjs");
  await writeFile(fakeTransaction, `import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2); const command = args[0];
const value = (name) => args[args.indexOf(name) + 1];
const vault = value("--vault"); const runId = value("--run-id");
if (command === "prepare") {
  const staging = path.join(vault, "raw", "codex", "staging"); await mkdir(staging, { recursive: true });
  const contract = { run_id: runId, pair_count: 1, topic_count: 1, system_pair_count: 0,
    result_path: path.join(staging, runId + ".json"), topics: [{ id: "topic:fictional" }] };
  await mkdir(path.join(vault, "raw", "codex"), { recursive: true });
  await writeFile(path.join(vault, "raw", "codex", "ingest-run-contract.json"), JSON.stringify(contract));
  process.stdout.write(JSON.stringify(contract) + "\\n");
} else if (command === "commit") {
  process.stdout.write(JSON.stringify({ committed: 1, failed: 1, final_status: "partial",
    failures: [{ id: "topic:fictional", title: "虚构接收器排查", error: "原始事件来源与主题证据不一致" }] }) + "\\n");
  process.exitCode = 2;
} else { process.stdout.write(JSON.stringify({ ok: true }) + "\\n"); }
`, "utf8");
  await writeFile(fakeCodex, `import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2); const output = args[args.indexOf("--output-last-message") + 1];
const contract = JSON.parse(await readFile(path.join(process.cwd(), "raw", "codex", "ingest-run-contract.json"), "utf8"));
await writeFile(output, JSON.stringify({ schema_version: 4, run_id: contract.run_id, outcomes: [] }));
process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { total_tokens: 7 } }) + "\\n");
`, "utf8");
  try {
    const result = await runCycle({ vault: root, batches: 1, transaction: fakeTransaction,
      codex: process.execPath, codexPrefixArgs: [fakeCodex], skipFeishu: true });
    assert.equal(result.status, "partial");
    assert.equal(result.batches[0].status, "partial");
    assert.match(result.batches[0].error, /虚构接收器排查.*原始事件来源与主题证据不一致/);
    assert.equal(result.batches[0].failures[0].id, "topic:fictional");
    const logs = await readdir(path.join(root, "raw", "codex", "automation", new Date().toISOString().slice(0, 10)));
    const log = await readFile(path.join(root, "raw", "codex", "automation", new Date().toISOString().slice(0, 10), logs[0]), "utf8");
    assert.match(log, /事务提交/);
    assert.match(log, /原始事件来源与主题证据不一致/);
    const persisted = JSON.parse(await readFile(path.join(root, "raw", "codex", "automation", "last-cycle.json"), "utf8"));
    assert.match(persisted.batches[0].error, /原始事件来源与主题证据不一致/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function postEvents(endpoint, token, events) {
  const response = await fetch(`${endpoint}/capture/v1/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Obsidian-Capture-Token": token },
    body: JSON.stringify({ events })
  });
  assert.equal(response.status, 200);
  return response.json();
}

function runWithInput(command, args, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `退出码 ${code}`)));
    child.stdin.end(input, "utf8");
  });
}
