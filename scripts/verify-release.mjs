#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { archivePaths } from "./release-archive.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(root, "release");
const manifest = JSON.parse(await readFile(path.join(releaseRoot, "update-manifest.json"), "utf8"));
const packageVersion = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const expectedPlatforms = new Set(["windows-x64", "macos-arm64", "macos-x64", "ubuntu-x64"]);
if (manifest.version !== packageVersion) throw new Error(`更新清单版本异常：${manifest.version}`);
if (manifest.assets?.length !== expectedPlatforms.size) throw new Error("更新清单缺少平台资产");

for (const asset of manifest.assets) {
  if (!expectedPlatforms.delete(asset.platform)) throw new Error(`重复或未知平台：${asset.platform}`);
  const target = path.join(releaseRoot, asset.file);
  if (!(await stat(target)).isFile()) throw new Error(`资产不存在：${asset.file}`);
  const actual = createHash("sha256").update(await readFile(target)).digest("hex");
  if (actual !== asset.sha256) throw new Error(`资产校验不一致：${asset.file}`);
  const listing = await archivePaths(target);
  for (const required of [
    "zhixing-workbench/安装知行台.cmd",
    "zhixing-workbench/install-zhixing.sh",
    "zhixing-workbench/scripts/zhixing.mjs",
    "zhixing-workbench/packages/obsidian-plugin/main.js",
    "zhixing-workbench/packages/browser-extension/manifest.json",
    "zhixing-workbench/packages/runtime/src/background-registration.mjs",
    "zhixing-workbench/packages/runtime/src/background-scheduler.mjs",
    "zhixing-workbench/packages/runtime/src/automation-owner.mjs",
    "zhixing-workbench/packages/runtime/src/runtime-lock.mjs",
    "zhixing-workbench/packages/runtime/src/run-cycle.mjs",
    "zhixing-workbench/packages/runtime/src/feishu-cli.mjs",
    "zhixing-workbench/packages/runtime/src/feishu-sync.mjs",
    "zhixing-workbench/.codex-plugin/plugin.json"
  ]) {
    if (!listing.includes(required)) throw new Error(`${asset.file} 缺少 ${required}`);
  }
  if (listing.some((name) => /(?:^|\/)config\.js$/i.test(name)
    || /zhixing-workbench\/(?:raw|wiki)\//i.test(name)
    || /(?:device|install)\.json$/i.test(name))) {
    throw new Error(`${asset.file} 包含设备配置或真实数据路径`);
  }
}
if (expectedPlatforms.size > 0) throw new Error(`缺少平台：${[...expectedPlatforms].join(", ")}`);
process.stdout.write("Release 资产结构与 SHA256 验证通过。\n");
