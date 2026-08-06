import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function discoverExecutable(name, options = {}) {
  const platform = options.platform || process.platform;
  const home = options.home || homedir();
  const env = options.env || process.env;
  const executableName = platform === "win32" && name === "codex" ? "codex.exe"
    : platform === "win32" && name === "lark-cli" ? "lark-cli.cmd" : name;
  const located = await locateFromPath(executableName, platform, env, options.execFile || execFileAsync);
  for (const candidate of located) {
    const resolved = await normalizeCandidate(name, candidate, platform, options.access || access);
    if (resolved) return { path: resolved, source: "path" };
  }
  if (platform === "win32") return null;

  const candidates = [
    ...splitPath(env.PATH, platform).map((directory) => path.join(directory, name)),
    path.join(home, ".local", "bin", name),
    path.join(home, ".npm-global", "bin", name),
    path.join(home, ".volta", "bin", name),
    path.join(home, ".asdf", "shims", name),
    path.join(home, ".local", "share", "mise", "shims", name),
    path.join(home, ".bun", "bin", name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`
  ];
  for (const directory of await nodeVersionBins(home, options.readdir || readdir)) {
    candidates.push(path.join(directory, name));
  }
  for (const candidate of unique(candidates)) {
    if (await isExecutable(candidate, options.access || access)) return { path: candidate, source: "common-location" };
  }
  return null;
}

async function locateFromPath(name, platform, env, execute) {
  const locator = platform === "win32" ? "where.exe" : "/usr/bin/which";
  try {
    const result = await execute(locator, [name], { env, timeout: 5_000, windowsHide: true });
    return String(result.stdout || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function normalizeCandidate(name, candidate, platform, checkAccess) {
  if (platform === "win32" && name === "lark-cli" && /lark-cli\.cmd$/i.test(candidate)) {
    const native = path.join(path.dirname(candidate), "node_modules", "@larksuite", "cli", "bin", "lark-cli.exe");
    return await isExecutable(native, checkAccess, false) ? native : null;
  }
  return await isExecutable(candidate, checkAccess, platform !== "win32") ? candidate : null;
}

async function isExecutable(candidate, checkAccess, requireExecute = true) {
  try {
    await checkAccess(candidate, requireExecute ? constants.X_OK : constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function nodeVersionBins(home, readDirectory) {
  const root = path.join(home, ".nvm", "versions", "node");
  try {
    const versions = (await readDirectory(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
    return versions.map((version) => path.join(root, version, "bin"));
  } catch {
    return [];
  }
}

function splitPath(value, platform) {
  return String(value || "").split(platform === "win32" ? ";" : ":").map((item) => item.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
