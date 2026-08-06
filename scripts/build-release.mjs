#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const releaseRoot = path.join(root, "release");
const stageRoot = path.join(releaseRoot, ".stage");
const bundle = path.join(stageRoot, "zhixing-workbench");
await rm(releaseRoot, { recursive: true, force: true });
await mkdir(bundle, { recursive: true });

for (const directory of [".codex-plugin", ".agents", "assets", "skills", "hooks", "templates", "docs"]) {
  await cp(path.join(root, directory), path.join(bundle, directory), { recursive: true });
}
for (const file of ["LICENSE", "README.md", "package.json"]) await cp(path.join(root, file), path.join(bundle, file));
await copyFiles("scripts", ["zhixing.mjs", "install-core.mjs"]);
await copyFiles("packages/runtime", ["package.json"]);
await cp(path.join(root, "packages", "runtime", "src"), path.join(bundle, "packages", "runtime", "src"), { recursive: true });
await cp(path.join(root, "packages", "browser-extension"), path.join(bundle, "packages", "browser-extension"), { recursive: true });
await copyFiles("packages/obsidian-plugin", ["main.js", "manifest.json", "styles.css", "package.json", "versions.json"]);
const windowsEntry = await readFile(path.join(root, "templates", "install", "安装知行台.cmd"), "utf8");
await writeFile(path.join(bundle, "安装知行台.cmd"), windowsEntry.replace(/\r?\n/g, "\r\n"), "utf8");
await cp(path.join(root, "templates", "install", "install-zhixing.sh"), path.join(bundle, "install-zhixing.sh"));

const platforms = ["windows-x64", "macos-arm64", "macos-x64", "ubuntu-x64"];
const assets = [];
for (const platform of platforms) {
  const file = `zhixing-workbench-v${version}-${platform}.tar.gz`;
  const target = path.join(releaseRoot, file);
  await execFileAsync("tar", ["-czf", target, "-C", stageRoot, "zhixing-workbench"], { cwd: root, timeout: 120_000 });
  const sha256 = createHash("sha256").update(await readFile(target)).digest("hex");
  assets.push({
    platform,
    file,
    sha256,
    url: `https://github.com/ZhiweiXiao98/zhixing-workbench/releases/download/v${version}/${file}`
  });
}
const manifest = {
  schema_version: 1,
  version,
  repository: "ZhiweiXiao98/zhixing-workbench",
  assets
};
await writeFile(path.join(releaseRoot, "update-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(path.join(releaseRoot, "SHA256SUMS"), `${assets.map((asset) => `${asset.sha256}  ${asset.file}`).join("\n")}\n`, "utf8");
await rm(stageRoot, { recursive: true, force: true });
process.stdout.write(`已生成 ${assets.length} 个 v${version} 发布资产。\n`);

async function copyFiles(relativeDirectory, files) {
  const destination = path.join(bundle, relativeDirectory);
  await mkdir(destination, { recursive: true });
  for (const file of files) await cp(path.join(root, relativeDirectory, file), path.join(destination, file));
}
