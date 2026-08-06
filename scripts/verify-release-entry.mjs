#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const releaseRoot = path.join(root, "release");
const release = JSON.parse(await readFile(path.join(releaseRoot, "update-manifest.json"), "utf8"));
const asset = release.assets.find((item) => item.platform === platformKey());
if (!asset) throw new Error(`当前 runner 没有对应资产：${process.platform}-${process.arch}`);

const temporary = await mkdtemp(path.join(tmpdir(), "zhixing-release-entry-"));
const extracted = path.join(temporary, "extracted");
const vault = path.join(temporary, "临时 Vault");
const config = path.join(temporary, "config");
const codexHome = path.join(temporary, "codex-home");
const personal = path.join(vault, "wiki", "我自己的笔记.md");
const environment = {
  ...process.env,
  ZHIXING_CONFIG: config,
  CODEX_HOME: codexHome,
  HOME: temporary,
  USERPROFILE: temporary
};

try {
  await mkdir(extracted, { recursive: true });
  await mkdir(path.join(vault, ".obsidian", "plugins"), { recursive: true });
  await mkdir(path.dirname(personal), { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await writeFile(personal, "这份个人内容必须保留。\n", "utf8");
  await execFileAsync("tar", ["-xzf", path.join(releaseRoot, asset.file), "-C", extracted], processOptions());

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

function platformKey() {
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64";
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
  if (process.platform === "darwin" && process.arch === "x64") return "macos-x64";
  if (process.platform === "linux" && process.arch === "x64") return "ubuntu-x64";
  throw new Error(`当前平台暂不支持：${process.platform}-${process.arch}`);
}
