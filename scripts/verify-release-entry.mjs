#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { extractArchive } from "./release-archive.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const releaseRoot = path.join(root, "release");
const release = JSON.parse(await readFile(path.join(releaseRoot, "update-manifest.json"), "utf8"));
const asset = release.assets.find((item) => item.platform === platformKey());
if (!asset) throw new Error(`当前 runner 没有对应资产：${process.platform}-${process.arch}`);

const temporary = await mkdtemp(path.join(tmpdir(), "zhixing-release-entry-"));
const extracted = path.join(temporary, "extracted");
const vault = path.join(temporary, "临时 Vault");
const appData = path.join(temporary, "appdata");
const xdgConfig = path.join(temporary, "xdg-config");
const config = expectedConfigRoot(temporary, appData, xdgConfig);
const codexHome = path.join(temporary, "codex-home");
const personal = path.join(vault, "wiki", "我自己的笔记.md");
const environment = {
  ...process.env,
  APPDATA: appData,
  CODEX_HOME: codexHome,
  HOME: temporary,
  USERPROFILE: temporary,
  XDG_CONFIG_HOME: xdgConfig
};
environment.ZHIXING_BACKGROUND_LAUNCH_DISABLED = "1";
delete environment.ZHIXING_CONFIG;

try {
  await mkdir(extracted, { recursive: true });
  await mkdir(path.join(vault, ".obsidian", "plugins"), { recursive: true });
  await mkdir(path.dirname(personal), { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await writeFile(personal, "这份个人内容必须保留。\n", "utf8");
  await extractArchive(path.join(releaseRoot, asset.file), extracted);

  const packageRoot = path.join(extracted, "zhixing-workbench");
  await runRootEntry(packageRoot, vault);

  const cli = path.join(packageRoot, "scripts", "zhixing.mjs");
  const diagnosis = await runJson(process.execPath, [cli, "diagnose", "--vault", vault]);
  assert.equal(diagnosis.version, release.version);
  assert.equal(diagnosis.vault, "ready");
  assert.equal(diagnosis.obsidian_plugin, "ready");
  assert.equal(diagnosis.browser_extension, "ready");
  assert.equal(path.resolve(diagnosis.browser_extension_path), path.resolve(config, "browser-extension"));
  assert.equal(path.resolve(diagnosis.browser_extension_path).startsWith(path.resolve(packageRoot)), false);

  const stableManifest = path.join(diagnosis.browser_extension_path, "manifest.json");
  const staleManifest = JSON.parse(await readFile(stableManifest, "utf8"));
  staleManifest.version = "0.6.0";
  await writeFile(stableManifest, `${JSON.stringify(staleManifest, null, 2)}\n`, "utf8");
  await runRootEntry(packageRoot, vault);
  assert.equal(JSON.parse(await readFile(stableManifest, "utf8")).version, release.version);

  const pluginMain = path.join(vault, ".obsidian", "plugins", "zhixing-workbench", "main.js");
  await writeFile(pluginMain, "rollback-sentinel\n", "utf8");
  const installer = await import(`${pathToFileURL(path.join(packageRoot, "scripts", "install-core.mjs")).href}?verify=${Date.now()}`);
  await assert.rejects(() => installer.installSuite({
    sourceRoot: packageRoot,
    vault,
    codexHome,
    configOptions: { env: { ZHIXING_CONFIG: config }, platform: process.platform, home: temporary },
    faultStage: "after-plugin-replace"
  }), /测试注入/);
  assert.equal(await readFile(pluginMain, "utf8"), "rollback-sentinel\n");

  const removed = await runJson(process.execPath, [cli, "uninstall", "--vault", vault, "--confirm"]);
  assert.equal(removed.status, "uninstalled");
  assert.equal(await readFile(personal, "utf8"), "这份个人内容必须保留。\n");
  if (process.platform === "win32") await verifyWindowsLegacyMigration(packageRoot, release.version);
  process.stdout.write(`真实 ${asset.platform} Release 入口安装、诊断、更新、回滚与卸载验证通过。\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function runRootEntry(packageRoot, targetVault) {
  if (process.platform === "win32") {
    const entry = path.join(packageRoot, "安装知行台.cmd");
    await execFileAsync("cmd.exe", ["/d", "/c", "call", entry, targetVault], processOptions());
    return;
  }
  await execFileAsync("sh", [path.join(packageRoot, "install-zhixing.sh"), targetVault], processOptions());
}

async function runJson(file, args) {
  const { stdout } = await execFileAsync(file, args, processOptions());
  return JSON.parse(stdout);
}

function processOptions() {
  return { env: environment, timeout: 10 * 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 };
}

async function verifyWindowsLegacyMigration(packageRoot, version) {
  const installer = await import(`${pathToFileURL(path.join(packageRoot, "scripts", "install-core.mjs")).href}?legacy=${Date.now()}`);
  const installPath = path.join(config, "install.json");
  const hooksPath = path.join(codexHome, "hooks.json");
  const taskNames = [
    "Codex - ChatGPT Web Capture Receiver",
    "Codex - ChatGPT Web Capture Watchdog",
    "Codex - Obsidian Daily Ingest"
  ];
  const legacyCommand = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${path.join(codexHome, "hooks", "obsidian-capture.ps1")}"`;
  const priorProgram = path.join(config, "programs", "0.6.1");
  const userHook = { type: "command", command: "powershell.exe -File \"bad-request-continue.ps1\"", timeout: 11 };
  let tasksEnabled = true;
  const disableCalls = [];
  const restoreCalls = [];
  const taskManager = {
    async disable(names) {
      disableCalls.push([...names]);
      const xml = tasksEnabled
        ? `<Task><Settings><StartWhenAvailable>true</StartWhenAvailable></Settings></Task>`
        : `<Task><Settings><Enabled>false</Enabled></Settings></Task>`;
      const states = names.map((name) => ({ name, was_enabled: installer.legacyTaskWasEnabledFromXml(xml) }));
      tasksEnabled = false;
      return states;
    },
    async restore(states) { restoreCalls.push(structuredClone(states)); }
  };
  const installOptions = {
    sourceRoot: packageRoot,
    vault,
    codexHome,
    configOptions: { env: environment, platform: "win32", home: temporary },
    legacyTaskManager: taskManager
  };

  await mkdir(path.dirname(installPath), { recursive: true });
  await mkdir(path.join(vault, ".obsidian", "plugins", "zhixing-workbench"), { recursive: true });
  await writeFile(path.join(vault, ".obsidian", "plugins", "zhixing-workbench", "manifest.json"), `${JSON.stringify({
    id: "zhixing-workbench", name: "知行台", version: "0.6.1"
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(vault, ".obsidian", "community-plugins.json"), `${JSON.stringify(["zhixing-workbench"])}\n`, "utf8");
  await writeFile(installPath, `${JSON.stringify({
    schema_version: 2,
    version: "0.6.1",
    vault_root: vault,
    program_root: priorProgram,
    legacy_migration: {
      migrated: true,
      migrated_at: "2026-08-06T00:00:00.000Z",
      plugin_version: "0.5.0",
      plugin_backup: path.join(config, "backups", "legacy", "activity-ledger-view"),
      legacy_was_enabled: true,
      legacy_tasks: taskNames.map((name) => ({ name, was_enabled: false }))
    }
  }, null, 2)}\n`, "utf8");
  await writeFile(hooksPath, `${JSON.stringify({ hooks: {
    UserPromptSubmit: [
      { hooks: [{ type: "command", command: legacyCommand, timeout: 7 }] },
      { hooks: [{ type: "command", command: `"${process.execPath}" "${path.join(priorProgram, "runtime", "capture-hook.mjs")}"`, timeout: 5 }] }
    ],
    Stop: [
      { hooks: [userHook] },
      { hooks: [{ type: "command", command: legacyCommand, timeout: 9 }] },
      { hooks: [{ type: "command", command: `"${process.execPath}" "${path.join(priorProgram, "runtime", "capture-hook.mjs")}"`, timeout: 5 }] }
    ]
  } }, null, 2)}\n`, "utf8");

  const first = await installer.installSuite(installOptions);
  assert.equal(first.previous_version, "0.6.1");
  assert.equal(first.version, version);
  assert.deepEqual(disableCalls, [taskNames]);
  await assertMigratedState(installer, version);

  await installer.installSuite(installOptions);
  assert.deepEqual(disableCalls, [taskNames, taskNames]);
  await assertMigratedState(installer, version);

  const diagnosis = await installer.diagnoseSuite({
    vault,
    codexHome,
    configOptions: installOptions.configOptions,
    discoveryOptions: { env: environment, platform: "win32", home: temporary }
  });
  assert.equal(diagnosis.version, version);
  assert.equal(diagnosis.vault, "ready");
  assert.equal(diagnosis.obsidian_plugin, "ready");
  assert.equal(diagnosis.codex_hooks, "configured");

  const removed = await installer.uninstallSuite(installOptions);
  assert.equal(removed.status, "uninstalled");
  assert.deepEqual(removed.legacy_hook_conflicts, []);
  assert.equal(restoreCalls.length, 1);
  assert.deepEqual(restoreCalls[0].map((item) => item.was_enabled), [true, true, true]);
  const restoredHooks = JSON.parse(await readFile(hooksPath, "utf8"));
  assert.equal(installer.countOwnedHooks(restoredHooks), 0);
  assert.equal(countLegacyHooks(installer, restoredHooks), 2);
  assert.match(JSON.stringify(restoredHooks), /bad-request-continue/);
  assert.equal(await readFile(personal, "utf8"), "这份个人内容必须保留。\n");

  async function assertMigratedState(module, expectedVersion) {
    const state = JSON.parse(await readFile(installPath, "utf8"));
    const hooks = JSON.parse(await readFile(hooksPath, "utf8"));
    assert.equal(state.version, expectedVersion);
    assert.deepEqual(state.legacy_migration.legacy_tasks.map((item) => item.was_enabled), [true, true, true]);
    assert.equal(state.legacy_migration.legacy_hooks.entries.length, 2);
    assert.equal(module.countOwnedHooks(hooks), 2);
    assert.equal(countLegacyHooks(module, hooks), 0);
    assert.match(JSON.stringify(hooks), /bad-request-continue/);
    assert.equal(await readFile(personal, "utf8"), "这份个人内容必须保留。\n");
  }

  function countLegacyHooks(module, hooks) {
    let count = 0;
    for (const entries of Object.values(hooks?.hooks || {})) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        for (const hook of entry?.hooks || []) if (module.isLegacyObsidianHook(hook, codexHome)) count += 1;
      }
    }
    return count;
  }
}

function expectedConfigRoot(home, windowsAppData, linuxConfig) {
  if (process.platform === "win32") return path.join(windowsAppData, "ZhixingWorkbench");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "ZhixingWorkbench");
  return path.join(linuxConfig, "zhixing-workbench");
}

function platformKey() {
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64";
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
  if (process.platform === "darwin" && process.arch === "x64") return "macos-x64";
  if (process.platform === "linux" && process.arch === "x64") return "ubuntu-x64";
  throw new Error(`当前平台暂不支持：${process.platform}-${process.arch}`);
}
