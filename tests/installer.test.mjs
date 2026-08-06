import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  countOwnedHooks,
  installSuite,
  mergeOwnedHooks,
  removeOwnedHooks,
  uninstallSuite
} from "../scripts/install-core.mjs";

test("Hook 合并保留其他自动化并且自身保持单份", () => {
  const existing = {
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "other-tool --finish" }] }],
      Notification: [{ hooks: [{ type: "command", command: "notify-tool" }] }]
    },
    custom: { keep: true }
  };
  const once = mergeOwnedHooks(existing, '"node" "/program/runtime/capture-hook.mjs"');
  const twice = mergeOwnedHooks(once, '"node" "/program/runtime/capture-hook.mjs"');
  assert.equal(countOwnedHooks(twice), 2);
  assert.equal(twice.custom.keep, true);
  assert.match(JSON.stringify(twice), /other-tool|notify-tool/);
  const removed = removeOwnedHooks(twice);
  assert.equal(countOwnedHooks(removed), 0);
  assert.match(JSON.stringify(removed), /other-tool|notify-tool/);
});

test("安装与卸载只处理程序并保留 Vault 个人内容", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-install-"));
  const vault = path.join(root, "vault");
  const config = path.join(root, "config");
  const codexHome = path.join(root, "codex-home");
  const personal = path.join(vault, "wiki", "我的手写笔记.md");
  const agents = path.join(vault, "AGENTS.md");
  await mkdir(path.dirname(personal), { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await writeFile(personal, "这是一份不会被程序覆盖的个人内容。\n", "utf8");
  await writeFile(agents, "# 我自己的规则\n", "utf8");
  await writeFile(path.join(codexHome, "hooks.json"), JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: "command", command: "other-tool" }] }] }
  }), "utf8");
  const options = {
    sourceRoot: path.resolve("."),
    vault,
    codexHome,
    configOptions: { env: { ZHIXING_CONFIG: config }, platform: process.platform, home: root }
  };
  try {
    const installed = await installSuite(options);
    assert.equal(installed.ok, true);
    assert.equal(await readFile(agents, "utf8"), "# 我自己的规则\n");
    assert.match(await readFile(path.join(vault, "wiki", "示例", "把一次排查变成下次可复用的经验.md"), "utf8"), /zhixing_sample: true/);
    assert.match(await readFile(path.join(codexHome, "hooks.json"), "utf8"), /other-tool/);
    assert.equal(countOwnedHooks(JSON.parse(await readFile(path.join(codexHome, "hooks.json"), "utf8"))), 2);
    assert.equal((await stat(path.join(vault, "raw", "feishu", "events"))).isDirectory(), true);
    const feishuConfig = path.join(vault, ".zhixing", "feishu-connector.json");
    await writeFile(feishuConfig, JSON.stringify({ enabled: true, modules: { tasks: true } }), "utf8");
    const deviceBefore = await readFile(path.join(config, "device.json"), "utf8");
    await installSuite(options);
    assert.equal(await readFile(path.join(config, "device.json"), "utf8"), deviceBefore);
    const installedMain = path.join(vault, ".obsidian", "plugins", "zhixing-workbench", "main.js");
    await writeFile(installedMain, "stable-before-update\n", "utf8");
    await assert.rejects(() => installSuite({ ...options, faultStage: "after-plugin-replace" }), /测试注入/);
    assert.equal(await readFile(installedMain, "utf8"), "stable-before-update\n");
    const removed = await uninstallSuite({
      vault,
      codexHome,
      configOptions: options.configOptions
    });
    assert.equal(removed.status, "uninstalled");
    assert.equal(await readFile(personal, "utf8"), "这是一份不会被程序覆盖的个人内容。\n");
    assert.match(await readFile(feishuConfig, "utf8"), /"enabled":true/);
    assert.ok(await readFile(path.join(config, "device.json"), "utf8"));
    assert.match(await readFile(path.join(codexHome, "hooks.json"), "utf8"), /other-tool/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
