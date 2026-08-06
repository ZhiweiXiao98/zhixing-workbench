#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumentsSet = new Set(process.argv.slice(2));
const violations = [];
const deniedLiterals = [
  ["C:", "\\", "Users", "\\"].join(""),
  ["C:", "\\", "ziweir"].join(""),
  ["1", "3507"].join(""),
  ["AI", "-Native"].join(""),
  ["official", "-website-source"].join("")
];
const secretPatterns = [
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /"receiver_token"\s*:\s*"[A-Za-z0-9_-]{24,}"/g,
  /\bcli_[A-Za-z0-9]{16,}\b/g,
  /\b(?:ou|oc|bas|bascn|tbl|viw|rec)_[A-Za-z0-9]{16,}\b/g,
  /\b(?:app[_ -]?secret|tenant[_ -]?key)\s*[:=]\s*["']?[A-Za-z0-9_-]{12,}/gi
];

if (argumentsSet.has("--worktree") || argumentsSet.size === 0) {
  for (const file of await listFiles(root)) await inspect(file, await readFile(file));
}
if (argumentsSet.has("--history")) await inspectHistory();

if (violations.length > 0) {
  process.stderr.write(`隐私门禁未通过：\n${violations.map((item) => `- ${item}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("隐私门禁通过：未发现私人路径、凭据或真实数据文件。\n");
}

async function listFiles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", ".venv", "node_modules", "coverage", ".test-vault"].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await listFiles(target));
    else if (entry.isFile() && (await stat(target)).size <= 8 * 1024 * 1024) results.push(target);
  }
  return results;
}

async function inspect(file, buffer, label = path.relative(root, file).replace(/\\/g, "/")) {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  if ((relative.startsWith("raw/") || relative.startsWith("wiki/")) && !relative.startsWith("templates/vault/wiki/示例/")) {
    violations.push(`${label}: 不允许提交真实 Vault 数据目录`);
  }
  if (buffer.includes(0)) return;
  const text = buffer.toString("utf8");
  for (const literal of deniedLiterals) {
    if (text.includes(literal)) violations.push(`${label}: 包含私人路径或项目标识`);
  }
  for (const pattern of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) violations.push(`${label}: 包含疑似真实凭据`);
  }
  for (const email of text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || []) {
    if (!email.toLowerCase().endsWith("@example.invalid")) violations.push(`${label}: 包含非匿名邮箱`);
  }
  for (const address of text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []) {
    if (address !== "127.0.0.1") violations.push(`${label}: 包含非本机 IP 地址`);
  }
}

async function inspectHistory() {
  let commits = [];
  try {
    const result = await execFileAsync("git", ["rev-list", "--all"], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    commits = result.stdout.split(/\r?\n/).filter(Boolean);
  } catch { return; }
  for (const commit of commits) {
    const names = await execFileAsync("git", ["ls-tree", "-r", "--name-only", commit], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    for (const name of names.stdout.split(/\r?\n/).filter(Boolean)) {
      if (/^(?:raw|wiki)\//.test(name) && !name.startsWith("templates/vault/wiki/示例/")) {
        violations.push(`${commit.slice(0, 8)}:${name}: 历史包含真实 Vault 数据目录`);
        continue;
      }
      try {
        const blob = await execFileAsync("git", ["show", `${commit}:${name}`], { cwd: root, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
        await inspect(path.join(root, name), blob.stdout, `${commit.slice(0, 8)}:${name}`);
      } catch {}
    }
  }
}
