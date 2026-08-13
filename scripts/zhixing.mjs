#!/usr/bin/env node
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { diagnoseSuite, installSuite, sha256File, uninstallSuite, VERSION } from "./install-core.mjs";

const execFileAsync = promisify(execFile);
const REPOSITORY = "ZhiweiXiao98/zhixing-workbench";
const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  ensureNode();
  let result;
  if (command === "install") {
    result = await installSuite({ sourceRoot, vault: args.vault, skipHooks: args["skip-hooks"],
      launchBackground: process.env.ZHIXING_BACKGROUND_LAUNCH_DISABLED !== "1" });
  } else if (command === "diagnose") {
    result = await diagnoseSuite({ vault: args.vault });
  } else if (command === "uninstall") {
    requireConfirmation(args, "卸载");
    result = await uninstallSuite({ vault: args.vault });
  } else if (command === "update") {
    result = await updateSuite(args);
  } else {
    throw new Error("用法: node scripts/zhixing.mjs <install|diagnose|update|uninstall> [--vault 路径]");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`知行台：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

async function updateSuite(options) {
  const release = await fetchJson(`https://api.github.com/repos/${REPOSITORY}/releases/latest`);
  const latest = String(release.tag_name || "").replace(/^v/, "");
  if (!latest) throw new Error("更新源没有返回有效版本");
  if (!options.confirm) return { current: VERSION, latest, update_available: compareVersions(latest, VERSION) > 0 };
  if (compareVersions(latest, VERSION) <= 0) return { current: VERSION, latest, updated: false };

  const manifestAsset = release.assets?.find((asset) => asset.name === "update-manifest.json");
  if (!manifestAsset) throw new Error("Release 缺少更新清单");
  const manifest = await fetchJson(manifestAsset.browser_download_url);
  const platform = platformKey();
  const asset = manifest.assets?.find((item) => item.platform === platform);
  if (!asset?.url || !asset?.sha256) throw new Error(`Release 不支持当前平台 ${platform}`);
  const temporary = path.join(tmpdir(), `zhixing-update-${Date.now()}`);
  const archive = path.join(temporary, asset.file);
  const extracted = path.join(temporary, "extracted");
  await mkdir(extracted, { recursive: true });
  try {
    await download(asset.url, archive);
    if (await sha256File(archive) !== asset.sha256) throw new Error("更新包 SHA256 校验失败，未修改现有安装");
    await execFileAsync("tar", ["-xzf", archive, "-C", extracted], { timeout: 120_000, windowsHide: true });
    const installState = await installedState();
    if (!installState?.vault_root) throw new Error("找不到现有 Vault，请重新运行 install");
    const installer = path.join(extracted, "zhixing-workbench", "scripts", "zhixing.mjs");
    const result = await execFileAsync(process.execPath, [installer, "install", "--vault", installState.vault_root], {
      timeout: 10 * 60_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    });
    return { current: VERSION, latest, updated: true, installer: JSON.parse(result.stdout) };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function installedState() {
  const { configRoot, readJson } = await import("../packages/runtime/src/common.mjs");
  return readJson(path.join(configRoot(), "install.json"), null);
}

async function download(url, target) {
  const response = await fetch(url, { headers: { "User-Agent": "zhixing-workbench-updater" }, redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`下载更新包失败：HTTP ${response.status}`);
  await pipeline(response.body, createWriteStream(target));
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "Accept": "application/vnd.github+json", "User-Agent": "zhixing-workbench-updater" } });
  if (!response.ok) throw new Error(`更新源不可用：HTTP ${response.status}`);
  return response.json();
}

function platformKey() {
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64";
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
  if (process.platform === "darwin" && process.arch === "x64") return "macos-x64";
  if (process.platform === "linux" && process.arch === "x64") return "ubuntu-x64";
  throw new Error(`当前平台暂不支持：${process.platform}-${process.arch}`);
}

function ensureNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) throw new Error(`需要 Node.js 22 或更高版本，当前为 ${process.versions.node}`);
}

function requireConfirmation(options, action) {
  if (!options.confirm) throw new Error(`${action}会移除程序但保留个人数据；确认后请加 --confirm`);
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function parseArgs(values) {
  const result = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) { result._.push(value); continue; }
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) { result[key] = next; index += 1; }
    else result[key] = true;
  }
  return result;
}
