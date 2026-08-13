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
  const execute = options.execFile || execFileAsync;
  const checkAccess = options.access || access;
  const readDirectory = options.readdir || readdir;
  const candidates = [];
  const configured = name === "codex" ? env.CODEX_BIN : env.LARK_CLI_BIN;
  if (configured) candidates.push({ path: configured, source: "configured" });

  for (const candidate of await locateFromPath(name, platform, env, execute)) {
    candidates.push({ path: candidate, source: "path" });
  }

  if (platform === "win32") {
    candidates.push(...await windowsCandidates(name, home, env, readDirectory));
  } else {
    const common = [
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
    for (const directory of await nodeVersionBins(home, readDirectory)) common.push(path.join(directory, name));
    candidates.push(...common.map((candidate) => ({ path: candidate, source: "common-location" })));
  }

  for (const candidate of uniqueCandidates(candidates)) {
    const resolved = await normalizeCandidate(name, candidate.path, platform, checkAccess);
    if (!resolved) continue;
    const probe = await probeExecutable(name, resolved, env, execute);
    if (probe.supported) return { path: resolved, source: candidate.source, version: probe.version };
  }
  return null;
}

export async function probeCodexExecutor(executable, options = {}) {
  if (!executable) return { supported: false, error: "未找到 Codex CLI" };
  const execute = options.execFile || execFileAsync;
  try {
    const commandOptions = {
      env: options.env || process.env,
      timeout: options.timeout || 8_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    };
    await execute(executable, ["exec", "--help"], commandOptions);
    await execute(executable, ["login", "status"], commandOptions);
    return { supported: true, error: null };
  } catch (error) {
    return { supported: false, error: safeError(error, "Codex 整理执行器探活失败") };
  }
}

async function windowsCandidates(name, home, env, readDirectory) {
  const p = path.win32;
  const localAppData = env.LOCALAPPDATA || p.join(home, "AppData", "Local");
  const appData = env.APPDATA || p.join(home, "AppData", "Roaming");
  const candidates = [];
  if (name === "codex") {
    const runtimeRoot = p.join(localAppData, "OpenAI", "Codex", "bin");
    try {
      const versions = (await readDirectory(runtimeRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
      for (const version of versions) {
        candidates.push({ path: p.join(runtimeRoot, version, "codex.exe"), source: "desktop-runtime" });
      }
    } catch {}
    candidates.push({ path: p.join(localAppData, "OpenAI", "Codex", "codex.exe"), source: "desktop-runtime" });
    for (const [packageName, vendor] of [
      ["codex-win32-x64", "x86_64-pc-windows-msvc"],
      ["codex-win32-arm64", "aarch64-pc-windows-msvc"]
    ]) {
      candidates.push({ path: p.join(appData, "npm", "node_modules", "@openai", "codex", "node_modules", "@openai",
        packageName, "vendor", vendor, "bin", "codex.exe"), source: "common-location" });
    }
  }
  if (name === "lark-cli") {
    candidates.push({ path: p.join(appData, "npm", "node_modules", "@larksuite", "cli", "bin", "lark-cli.exe"), source: "common-location" });
  }
  return candidates;
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
  const p = platform === "win32" ? path.win32 : path;
  if (platform === "win32" && name === "lark-cli" && /lark-cli\.cmd$/i.test(candidate)) {
    const native = p.join(p.dirname(candidate), "node_modules", "@larksuite", "cli", "bin", "lark-cli.exe");
    return await isExecutable(native, checkAccess, false) ? native : null;
  }
  if (platform === "win32" && name === "codex" && /codex\.cmd$/i.test(candidate)) {
    const native = p.join(p.dirname(candidate), "node_modules", "@openai", "codex", "node_modules", "@openai",
      "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
    return await isExecutable(native, checkAccess, false) ? native : null;
  }
  if (platform === "win32" && /\.cmd$/i.test(candidate)) return null;
  return await isExecutable(candidate, checkAccess, platform !== "win32") ? candidate : null;
}

async function probeExecutable(name, candidate, env, execute) {
  try {
    const result = await execute(candidate, ["--version"], {
      env,
      timeout: 8_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    return { supported: true, version: output.split(/\r?\n/).find(Boolean)?.slice(0, 160) || null };
  } catch (error) {
    return { supported: false, version: null, error: safeError(error, `${name} --version 探活失败`) };
  }
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

function uniqueCandidates(values) {
  const seen = new Set();
  return values.filter((item) => {
    const key = String(item.path || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeError(error, fallback) {
  const value = error instanceof Error ? error.message : String(error || fallback);
  return value.replace(/[\r\n]+/g, " ").slice(0, 240) || fallback;
}
