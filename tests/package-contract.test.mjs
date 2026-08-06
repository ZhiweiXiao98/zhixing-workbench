import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

test("所有公开组件使用统一版本和作者", async () => {
  const root = JSON.parse(await readFile("package.json", "utf8"));
  const plugin = JSON.parse(await readFile("packages/obsidian-plugin/manifest.json", "utf8"));
  const extension = JSON.parse(await readFile("packages/browser-extension/manifest.json", "utf8"));
  const codex = JSON.parse(await readFile(".codex-plugin/plugin.json", "utf8"));
  assert.equal(plugin.version, root.version);
  assert.equal(extension.version, root.version);
  assert.equal(codex.version, root.version);
  assert.equal(plugin.author, "肖志伟");
  assert.equal(codex.author.name, "肖志伟");
});

test("浏览器扩展不携带固定密钥文件", async () => {
  const manifest = await readFile("packages/browser-extension/manifest.json", "utf8");
  const worker = await readFile("packages/browser-extension/service-worker.js", "utf8");
  assert.doesNotMatch(manifest, /config\.js/);
  assert.doesNotMatch(worker, /importScripts\s*\(/);
  assert.match(worker, /chrome\.storage\.local/);
});

test("浏览器采集核心识别已保存对话并按问答配对", async () => {
  const context = vm.createContext({ URL });
  vm.runInContext(await readFile("packages/browser-extension/capture-core.js", "utf8"), context);
  const core = context.ChatGPTCaptureCore;
  assert.equal(core.conversationIdFromUrl("https://chatgpt.com/c/fictional-conversation"), "fictional-conversation");
  const pairs = core.pairMessages([
    { role: "user", messageId: "u1", content: "问题" },
    { role: "assistant", messageId: "a1", content: "回答" },
    { role: "user", messageId: "u2", content: "还没有回答" }
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].turnId, "u1--a1");
});
