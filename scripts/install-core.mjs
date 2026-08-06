import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { configRoot, readJson } from "../packages/runtime/src/common.mjs";

const execFileAsync = promisify(execFile);
export const VERSION = "0.6.0";
export const OWNED_SKILLS = ["obsidian-knowledge", "investigate-work-history", "zhixing-manager"];

export async function installSuite(options) {
  const sourceRoot = path.resolve(options.sourceRoot);
  const vault = path.resolve(options.vault || "");
  if (!vault) throw new Error("请使用 --vault 指定 Obsidian Vault");
  await assertDirectory(vault, "Vault 路径不存在");
  const pluginBuild = path.join(sourceRoot, "packages", "obsidian-plugin", "main.js");
  await assertFile(pluginBuild, "插件尚未构建，请先运行 npm run build");

  const root = configRoot(options.configOptions);
  const programsRoot = path.join(root, "programs");
  const programRoot = path.join(programsRoot, VERSION);
  const staging = path.join(programsRoot, `.staging-${VERSION}-${randomUUID()}`);
  const previousInstall = await readJson(path.join(root, "install.json"), null);
  await mkdir(programsRoot, { recursive: true });
  await assembleProgram(sourceRoot, staging);

  const programBackup = await replaceDirectory(staging, programRoot);
  const pluginTarget = path.join(vault, ".obsidian", "plugins", "zhixing-workbench");
  const pluginStage = `${pluginTarget}.staging-${randomUUID()}`;
  const pluginBackup = `${pluginTarget}.backup-${Date.now()}`;
  try {
    await mkdir(path.dirname(pluginTarget), { recursive: true });
    await copyPlugin(sourceRoot, pluginStage);
    if (await exists(pluginTarget)) await rename(pluginTarget, pluginBackup);
    await rename(pluginStage, pluginTarget);
    if (options.faultStage === "after-plugin-replace") throw new Error("测试注入：插件替换后失败");
    await initializeVault(vault, sourceRoot);
    const device = await ensureDeviceConfig(root);
    const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(homedir(), ".codex"));
    await installSkills(sourceRoot, codexHome);
    if (!options.skipHooks) await installHooks(codexHome, programRoot);
    const install = {
      schema_version: 1,
      version: VERSION,
      installed_at: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      vault_root: vault,
      program_root: programRoot,
      receiver_port: device.receiver_port,
      components: ["obsidian-plugin", "codex-skills", "codex-hooks", "browser-extension", "knowledge-runtime", "feishu-connector"]
    };
    await atomicJson(path.join(root, "install.json"), install);
    await rm(pluginBackup, { recursive: true, force: true });
    if (programBackup) await rm(programBackup, { recursive: true, force: true });
    return {
      ok: true,
      version: VERSION,
      vault,
      plugin: pluginTarget,
      program: programRoot,
      hooks: options.skipHooks ? "skipped" : "installed",
      previous_version: previousInstall?.version || null
    };
  } catch (error) {
    await rm(pluginStage, { recursive: true, force: true });
    if (await exists(pluginTarget)) await rm(pluginTarget, { recursive: true, force: true });
    if (await exists(pluginBackup)) await rename(pluginBackup, pluginTarget);
    if (programBackup) {
      await rm(programRoot, { recursive: true, force: true });
      await rename(programBackup, programRoot);
    } else {
      await rm(programRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function diagnoseSuite(options = {}) {
  const root = configRoot(options.configOptions);
  const install = await readJson(path.join(root, "install.json"), null);
  const vault = path.resolve(options.vault || process.env.ZHIXING_VAULT || install?.vault_root || "");
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(homedir(), ".codex"));
  const hooks = await readJson(path.join(codexHome, "hooks.json"), {});
  const feishuConfig = vault ? await readJson(path.join(vault, ".zhixing", "feishu-connector.json"), null) : null;
  const feishuState = vault ? await readJson(path.join(vault, "raw", "feishu", "sync-state.json"), null) : null;
  const result = {
    version: install?.version || null,
    platform: `${process.platform}-${process.arch}`,
    node: Number(process.versions.node.split(".")[0]) >= 22 ? "ready" : "upgrade-required",
    vault: vault && await exists(vault) ? "ready" : "missing",
    obsidian_plugin: vault && await exists(path.join(vault, ".obsidian", "plugins", "zhixing-workbench", "main.js")) ? "ready" : "missing",
    knowledge_runtime: install?.program_root && await exists(path.join(install.program_root, "runtime", "run-cycle.mjs")) ? "ready" : "missing",
    browser_extension: install?.program_root && await exists(path.join(install.program_root, "browser-extension", "manifest.json")) ? "ready" : "missing",
    codex_hooks: countOwnedHooks(hooks) >= 2 ? "ready" : "missing",
    codex_cli: await commandAvailable(process.platform === "win32" ? "codex.exe" : "codex") ? "ready" : "missing",
    lark_cli: await commandAvailable(process.platform === "win32" ? "lark-cli.cmd" : "lark-cli") ? "ready" : "missing",
    feishu_connector: !feishuConfig?.enabled ? "disabled" : feishuState?.status || "waiting-first-sync",
    feishu_last_sync: feishuState?.last_success || null,
    feishu_failed_modules: Number(feishuState?.failed_modules || 0)
  };
  return result;
}

export async function uninstallSuite(options = {}) {
  const root = configRoot(options.configOptions);
  const installPath = path.join(root, "install.json");
  const install = await readJson(installPath, null);
  if (!install) return { ok: true, status: "not-installed" };
  const vault = path.resolve(options.vault || install.vault_root);
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(homedir(), ".codex"));
  await rm(path.join(vault, ".obsidian", "plugins", "zhixing-workbench"), { recursive: true, force: true });
  await removeHooks(codexHome);
  for (const skill of OWNED_SKILLS) {
    await rm(path.join(codexHome, "skills", skill), { recursive: true, force: true });
  }
  await rm(path.join(root, "programs"), { recursive: true, force: true });
  await rm(installPath, { force: true });
  return { ok: true, status: "uninstalled", data_preserved: ["raw", "wiki", "成果", ".zhixing/feishu-connector.json", "device.json"] };
}

export async function installHooks(codexHome, programRoot) {
  const target = path.join(codexHome, "hooks.json");
  const current = await readJson(target, {});
  const node = process.execPath;
  const command = `${quoteCommand(node)} ${quoteCommand(path.join(programRoot, "runtime", "capture-hook.mjs"))}`;
  const merged = mergeOwnedHooks(current, command);
  await atomicJson(target, merged);
  return merged;
}

export async function removeHooks(codexHome) {
  const target = path.join(codexHome, "hooks.json");
  const current = await readJson(target, {});
  await atomicJson(target, removeOwnedHooks(current));
}

export function mergeOwnedHooks(config, command) {
  const result = structuredClone(config && typeof config === "object" ? config : {});
  result.hooks = result.hooks && typeof result.hooks === "object" ? result.hooks : {};
  for (const eventName of ["UserPromptSubmit", "Stop"]) {
    const entries = Array.isArray(result.hooks[eventName]) ? result.hooks[eventName] : [];
    const cleaned = entries.map((entry) => cleanOwnedCommands(entry)).filter((entry) => entry !== null);
    cleaned.push({ hooks: [{
      type: "command",
      command,
      timeout: 5,
      statusMessage: eventName === "UserPromptSubmit" ? "正在记录到知行台" : "正在记录知行台结果"
    }] });
    result.hooks[eventName] = cleaned;
  }
  return result;
}

export function removeOwnedHooks(config) {
  const result = structuredClone(config && typeof config === "object" ? config : {});
  if (!result.hooks || typeof result.hooks !== "object") return result;
  for (const [eventName, entries] of Object.entries(result.hooks)) {
    if (!Array.isArray(entries)) continue;
    result.hooks[eventName] = entries.map((entry) => cleanOwnedCommands(entry)).filter((entry) => entry !== null);
  }
  return result;
}

export function countOwnedHooks(config) {
  let count = 0;
  for (const entries of Object.values(config?.hooks || {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) for (const hook of entry?.hooks || []) if (isOwnedHook(hook)) count += 1;
  }
  return count;
}

async function assembleProgram(sourceRoot, target) {
  await mkdir(target, { recursive: true });
  await cp(path.join(sourceRoot, "packages", "runtime", "src"), path.join(target, "runtime"), { recursive: true });
  await cp(path.join(sourceRoot, "packages", "runtime", "src"), path.join(target, "packages", "runtime", "src"), { recursive: true });
  await cp(path.join(sourceRoot, "packages", "browser-extension"), path.join(target, "browser-extension"), { recursive: true });
  await cp(path.join(sourceRoot, "skills"), path.join(target, "skills"), { recursive: true });
  await cp(path.join(sourceRoot, "hooks"), path.join(target, "hooks"), { recursive: true });
  await cp(path.join(sourceRoot, "templates"), path.join(target, "templates"), { recursive: true });
  await mkdir(path.join(target, "scripts"), { recursive: true });
  await cp(path.join(sourceRoot, "scripts", "zhixing.mjs"), path.join(target, "scripts", "zhixing.mjs"), { recursive: false });
  await cp(path.join(sourceRoot, "scripts", "install-core.mjs"), path.join(target, "scripts", "install-core.mjs"), { recursive: false });
  await cp(path.join(sourceRoot, "LICENSE"), path.join(target, "LICENSE"));
  await cp(path.join(sourceRoot, "README.md"), path.join(target, "README.md"));
  await copyPlugin(sourceRoot, path.join(target, "obsidian-plugin"));
}

async function copyPlugin(sourceRoot, target) {
  await mkdir(target, { recursive: true });
  for (const name of ["main.js", "manifest.json", "styles.css"]) {
    await cp(path.join(sourceRoot, "packages", "obsidian-plugin", name), path.join(target, name));
  }
}

async function initializeVault(vault, sourceRoot) {
  const directories = [
    ".obsidian/plugins", ".zhixing", "raw/codex/events", "raw/codex/automation",
    "raw/chatgpt/events", "raw/feishu/events", "raw/feishu/daily", "成果/知行台", "wiki/我的经历", "wiki/示例"
  ];
  for (const directory of directories) await mkdir(path.join(vault, directory), { recursive: true });
  await writeIfMissing(path.join(vault, ".zhixing", "README.md"),
    "# 知行台本地配置\n\n这里保存知行台的 Vault 级状态。程序更新不会删除个人笔记、raw、wiki 或成果。\n");
  await writeIfMissing(path.join(vault, "AGENTS.md"),
    await readFile(path.join(sourceRoot, "templates", "vault", "AGENTS.md"), "utf8"));
  await writeIfMissing(path.join(vault, "wiki", "示例", "把一次排查变成下次可复用的经验.md"),
    await readFile(path.join(sourceRoot, "templates", "vault", "wiki", "示例", "把一次排查变成下次可复用的经验.md"), "utf8"));
}

async function ensureDeviceConfig(root) {
  const target = path.join(root, "device.json");
  const existing = await readJson(target, null);
  if (existing?.receiver_token && String(existing.receiver_token).length >= 24) return existing;
  const device = {
    schema_version: 1,
    device_id: randomBytes(16).toString("hex"),
    receiver_port: 43123,
    receiver_token: randomBytes(32).toString("base64url"),
    created_at: new Date().toISOString()
  };
  await atomicJson(target, device);
  return device;
}

async function installSkills(sourceRoot, codexHome) {
  await mkdir(path.join(codexHome, "skills"), { recursive: true });
  for (const skill of OWNED_SKILLS) {
    const source = path.join(sourceRoot, "skills", skill);
    const target = path.join(codexHome, "skills", skill);
    const staging = `${target}.staging-${randomUUID()}`;
    await cp(source, staging, { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  }
}

function cleanOwnedCommands(entry) {
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) return entry;
  const hooks = entry.hooks.filter((hook) => !isOwnedHook(hook));
  return hooks.length > 0 ? { ...entry, hooks } : null;
}

function isOwnedHook(hook) {
  return typeof hook?.command === "string" && /runtime[\\/]capture-hook\.mjs(?:"|\s|$)/i.test(hook.command);
}

function quoteCommand(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

async function replaceDirectory(staging, target) {
  const backup = await exists(target) ? `${target}.backup-${Date.now()}` : null;
  if (backup) await rename(target, backup);
  try { await rename(staging, target); return backup; }
  catch (error) { if (backup) await rename(backup, target); throw error; }
}

async function atomicJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function writeIfMissing(target, content) {
  if (!await exists(target)) await writeFile(target, content, "utf8");
}

async function assertDirectory(target, message) {
  try { if ((await stat(target)).isDirectory()) return; } catch {}
  throw new Error(message);
}

async function assertFile(target, message) {
  try { if ((await stat(target)).isFile()) return; } catch {}
  throw new Error(message);
}

async function exists(target) {
  try { await stat(target); return true; } catch { return false; }
}

async function commandAvailable(command) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  try { await execFileAsync(locator, [command], { timeout: 5_000, windowsHide: true }); return true; } catch { return false; }
}

export async function sha256File(target) {
  return createHash("sha256").update(await readFile(target)).digest("hex");
}
