import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  countOwnedHooks,
  diagnoseSuite,
  installSuite,
  mergeOwnedHooks,
  removeOwnedHooks,
  uninstallSuite
} from "../scripts/install-core.mjs";

const SKILLS = ["obsidian-knowledge", "investigate-work-history", "zhixing-manager"];

test("install 缺少 Vault 参数时明确失败且不使用当前目录", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zhixing-empty-vault-"));
  try {
    await assert.rejects(() => installSuite({ sourceRoot: path.join(root, "missing-source"), vault: "" }), /--vault/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
    assert.equal(installed.browser_extension, path.join(config, "browser-extension"));
    assert.equal(JSON.parse(await readFile(path.join(installed.browser_extension, "manifest.json"), "utf8")).version, installed.version);
    assert.equal(await readFile(agents, "utf8"), "# 我自己的规则\n");
    assert.match(await readFile(path.join(vault, "wiki", "示例", "把一次排查变成下次可复用的经验.md"), "utf8"), /zhixing_sample: true/);
    assert.match(await readFile(path.join(codexHome, "hooks.json"), "utf8"), /other-tool/);
    assert.equal(countOwnedHooks(JSON.parse(await readFile(path.join(codexHome, "hooks.json"), "utf8"))), 2);
    assert.equal((await stat(path.join(vault, "raw", "feishu", "events"))).isDirectory(), true);
    const feishuConfig = path.join(vault, ".zhixing", "feishu-connector.json");
    await writeFile(feishuConfig, JSON.stringify({ enabled: true, modules: { tasks: true } }), "utf8");
    const deviceBefore = await readFile(path.join(config, "device.json"), "utf8");
    const extensionManifest = path.join(installed.browser_extension, "manifest.json");
    const staleManifest = JSON.parse(await readFile(extensionManifest, "utf8"));
    staleManifest.version = "0.6.0";
    await writeFile(extensionManifest, `${JSON.stringify(staleManifest, null, 2)}\n`, "utf8");
    await installSuite(options);
    assert.equal(await readFile(path.join(config, "device.json"), "utf8"), deviceBefore);
    assert.equal(JSON.parse(await readFile(extensionManifest, "utf8")).version, "0.6.1");
    const installedMain = path.join(vault, ".obsidian", "plugins", "zhixing-workbench", "main.js");
    await writeFile(installedMain, "stable-before-update\n", "utf8");
    await writeFile(path.join(installed.browser_extension, "service-worker.js"), "stable-extension-before-update\n", "utf8");
    await assert.rejects(() => installSuite({ ...options, faultStage: "after-extension-replace" }), /测试注入/);
    assert.equal(await readFile(path.join(installed.browser_extension, "service-worker.js"), "utf8"), "stable-extension-before-update\n");
    await assert.rejects(() => installSuite({ ...options, faultStage: "after-plugin-replace" }), /测试注入/);
    assert.equal(await readFile(installedMain, "utf8"), "stable-before-update\n");
    const diagnosis = await diagnoseSuite({ vault, codexHome, configOptions: options.configOptions });
    assert.equal(diagnosis.browser_extension, "ready");
    assert.equal(diagnosis.browser_extension_path, installed.browser_extension);
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

test("Skill 首次安装先备份，卸载恢复原内容", async () => {
  const fixture = await installFixture("skill-backup");
  try {
    for (const skill of SKILLS) {
      const target = path.join(fixture.codexHome, "skills", skill);
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "SKILL.md"), `# 用户原有 ${skill}\n`, "utf8");
    }
    await assert.rejects(
      () => installSuite({ ...fixture.options, faultStage: "after-skills-replace" }),
      /测试注入/
    );
    assert.equal(await pathExists(path.join(fixture.config, "install.json")), false);
    for (const skill of SKILLS) {
      const target = path.join(fixture.codexHome, "skills", skill);
      assert.equal(await readFile(path.join(target, "SKILL.md"), "utf8"), `# 用户原有 ${skill}\n`);
      assert.equal(await pathExists(path.join(target, ".zhixing-owner.json")), false);
    }
    const installed = await installSuite(fixture.options);
    assert.deepEqual(installed.skill_conflicts, []);
    const state = JSON.parse(await readFile(path.join(fixture.config, "install.json"), "utf8"));
    for (const skill of SKILLS) {
      const ownership = state.skills.find((item) => item.name === skill);
      assert.ok(ownership.backup_path);
      assert.match(await readFile(path.join(ownership.backup_path, "SKILL.md"), "utf8"), /用户原有/);
      assert.equal(JSON.parse(await readFile(path.join(fixture.codexHome, "skills", skill, ".zhixing-owner.json"), "utf8")).owner, "zhixing-workbench");
    }
    const removed = await uninstallSuite(fixture.options);
    assert.deepEqual(removed.skill_conflicts, []);
    for (const skill of SKILLS) {
      assert.equal(await readFile(path.join(fixture.codexHome, "skills", skill, "SKILL.md"), "utf8"), `# 用户原有 ${skill}\n`);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("更新和卸载都保留用户后来修改的 Skill", async () => {
  const fixture = await installFixture("skill-conflict");
  try {
    await installSuite(fixture.options);
    const target = path.join(fixture.codexHome, "skills", "obsidian-knowledge");
    const customized = `${await readFile(path.join(target, "SKILL.md"), "utf8")}\n# 用户后续补充\n`;
    await writeFile(path.join(target, "SKILL.md"), customized, "utf8");
    const updated = await installSuite(fixture.options);
    assert.ok(updated.skill_conflicts.includes("obsidian-knowledge"));
    assert.equal(await readFile(path.join(target, "SKILL.md"), "utf8"), customized);
    const removed = await uninstallSuite(fixture.options);
    assert.ok(removed.skill_conflicts.includes("obsidian-knowledge"));
    assert.equal(await readFile(path.join(target, "SKILL.md"), "utf8"), customized);
  } finally {
    await fixture.cleanup();
  }
});

test("v0.6.0 未修改 Skill 与旧程序副本一致时可安全认领升级", async () => {
  const fixture = await installFixture("skill-v060-adopt");
  try {
    await prepareV060SkillInstall(fixture);
    const updated = await installSuite(fixture.options);
    assert.deepEqual(updated.skill_conflicts, []);
    for (const skill of SKILLS) {
      const marker = JSON.parse(await readFile(path.join(fixture.codexHome, "skills", skill, ".zhixing-owner.json"), "utf8"));
      assert.equal(marker.owner, "zhixing-workbench");
      assert.equal(marker.installed_version, "0.6.1");
    }
  } finally {
    await fixture.cleanup();
  }
});

test("v0.6.0 Skill 与旧程序副本不一致时保留用户修改并报告冲突", async () => {
  const fixture = await installFixture("skill-v060-conflict");
  try {
    await prepareV060SkillInstall(fixture);
    const target = path.join(fixture.codexHome, "skills", "obsidian-knowledge", "SKILL.md");
    const customized = `${await readFile(target, "utf8")}\n# 用户自己修改的规则\n`;
    await writeFile(target, customized, "utf8");
    const updated = await installSuite(fixture.options);
    assert.deepEqual(updated.skill_conflicts, ["obsidian-knowledge"]);
    assert.equal(await readFile(target, "utf8"), customized);
    assert.equal(await pathExists(path.join(path.dirname(target), ".zhixing-owner.json")), false);
  } finally {
    await fixture.cleanup();
  }
});

test("旧版 0.5.0 插件、接收密钥与任务状态可迁移并在卸载时恢复", async () => {
  const fixture = await installFixture("legacy");
  const legacy = path.join(fixture.vault, ".obsidian", "plugins", "activity-ledger-view");
  const community = path.join(fixture.vault, ".obsidian", "community-plugins.json");
  const token = ["fixture", "receiver", "token", "kept", "across", "migration"].join("-");
  const calls = [];
  const taskManager = {
    async disable() { calls.push("disable"); return [{ name: "Codex - ChatGPT Web Capture Receiver", was_enabled: true }]; },
    async restore(value) { calls.push(["restore", value]); }
  };
  try {
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, "manifest.json"), JSON.stringify({ id: "activity-ledger-view", name: "知行台", version: "0.5.0" }), "utf8");
    await writeFile(path.join(legacy, "data.json"), "{\"keep\":true}\n", "utf8");
    await writeFile(community, JSON.stringify(["other-plugin", "activity-ledger-view"]), "utf8");
    await mkdir(path.join(fixture.codexHome, "hooks"), { recursive: true });
    await writeFile(path.join(fixture.codexHome, "hooks", "chatgpt-web-receiver.json"), JSON.stringify({ port: 43123, token }), "utf8");
    const installed = await installSuite({ ...fixture.options, legacyTaskManager: taskManager });
    assert.equal(await pathExists(legacy), false);
    assert.ok(installed.legacy_migration.plugin_backup);
    assert.equal(await readFile(path.join(installed.legacy_migration.plugin_backup, "data.json"), "utf8"), "{\"keep\":true}\n");
    assert.deepEqual(JSON.parse(await readFile(community, "utf8")), ["other-plugin", "zhixing-workbench"]);
    assert.equal(JSON.parse(await readFile(path.join(fixture.config, "device.json"), "utf8")).receiver_token, token);
    assert.deepEqual(calls, ["disable"]);
    await uninstallSuite({ ...fixture.options, legacyTaskManager: taskManager });
    assert.equal(await pathExists(legacy), true);
    assert.deepEqual(JSON.parse(await readFile(community, "utf8")), ["other-plugin", "activity-ledger-view"]);
    assert.equal(await readFile(path.join(legacy, "data.json"), "utf8"), "{\"keep\":true}\n");
    assert.equal(calls[1][0], "restore");
  } finally {
    await fixture.cleanup();
  }
});

async function installFixture(label) {
  const root = await mkdtemp(path.join(tmpdir(), `zhixing-${label}-`));
  const vault = path.join(root, "vault");
  const config = path.join(root, "config");
  const codexHome = path.join(root, "codex-home");
  await mkdir(path.join(vault, ".obsidian", "plugins"), { recursive: true });
  await mkdir(codexHome, { recursive: true });
  return {
    root, vault, config, codexHome,
    options: { sourceRoot: path.resolve("."), vault, codexHome,
      configOptions: { env: { ZHIXING_CONFIG: config }, platform: process.platform, home: root } },
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

async function prepareV060SkillInstall(fixture) {
  const oldProgram = path.join(fixture.config, "programs", "0.6.0");
  for (const skill of SKILLS) {
    const authority = path.join(oldProgram, "skills", skill);
    const installed = path.join(fixture.codexHome, "skills", skill);
    await mkdir(path.dirname(authority), { recursive: true });
    await mkdir(path.dirname(installed), { recursive: true });
    await cp(path.resolve("skills", skill), authority, { recursive: true });
    await cp(authority, installed, { recursive: true });
  }
  await mkdir(fixture.config, { recursive: true });
  await writeFile(path.join(fixture.config, "install.json"), `${JSON.stringify({
    schema_version: 1,
    version: "0.6.0",
    vault_root: fixture.vault,
    program_root: oldProgram
  }, null, 2)}\n`, "utf8");
}

async function pathExists(target) {
  try { await stat(target); return true; } catch { return false; }
}
