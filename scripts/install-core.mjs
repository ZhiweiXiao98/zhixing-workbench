import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { configRoot, readJson } from "../packages/runtime/src/common.mjs";
import { discoverExecutable, probeCodexExecutor } from "../packages/runtime/src/executable-discovery.mjs";
import { readCodexDesktopHealth, readLastCodexEventAt } from "../packages/runtime/src/codex-desktop-source.mjs";
import { readScheduleState } from "../packages/runtime/src/knowledge-scheduler.mjs";
import { readCodexCliHookHealth } from "../packages/runtime/src/source-health.mjs";
import { inspectBackgroundSchedulerRegistration, launchBackgroundScheduler, registerBackgroundScheduler,
  removeBackgroundScheduler } from "../packages/runtime/src/background-registration.mjs";

const execFileAsync = promisify(execFile);
const SKILL_MARKER = ".zhixing-owner.json";
const LEGACY_PLUGIN_ID = "activity-ledger-view";
const PLUGIN_ID = "zhixing-workbench";
const LEGACY_TASK_NAMES = [
  "Codex - ChatGPT Web Capture Receiver",
  "Codex - ChatGPT Web Capture Watchdog",
  "Codex - Obsidian Daily Ingest"
];

export const VERSION = "0.6.11";
export const OWNED_SKILLS = ["obsidian-knowledge", "investigate-work-history", "zhixing-manager"];

export async function installSuite(options = {}) {
  const suppliedVault = typeof options.vault === "string" ? options.vault.trim() : "";
  if (!suppliedVault) throw new Error("请使用 --vault 指定 Obsidian Vault，路径不能为空");
  const sourceRoot = path.resolve(options.sourceRoot || "");
  const vault = path.resolve(suppliedVault);
  await assertDirectory(vault, "Vault 路径不存在");
  await assertFile(path.join(sourceRoot, "packages", "obsidian-plugin", "main.js"), "插件尚未构建，请先运行 npm run build");

  const root = configRoot(options.configOptions);
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(homedir(), ".codex"));
  const programsRoot = path.join(root, "programs");
  const programRoot = path.join(programsRoot, VERSION);
  const staging = path.join(programsRoot, `.staging-${VERSION}-${randomUUID()}`);
  const previousInstall = await readJson(path.join(root, "install.json"), null);
  await mkdir(programsRoot, { recursive: true });
  await assembleProgram(sourceRoot, staging);

  const programBackup = await replaceDirectory(staging, programRoot);
  const pluginTarget = path.join(vault, ".obsidian", "plugins", PLUGIN_ID);
  const pluginStage = `${pluginTarget}.staging-${randomUUID()}`;
  const pluginBackup = `${pluginTarget}.backup-${Date.now()}`;
  let pluginReplaced = false;
  let browserChange;
  let skillChange;
  let legacyChange;
  let backgroundChange;
  try {
    legacyChange = await migrateLegacyInstallation({
      vault, root, codexHome, previousInstall,
      taskManager: options.legacyTaskManager || createLegacyTaskManager(process.platform)
    });
    await mkdir(path.dirname(pluginTarget), { recursive: true });
    await copyPlugin(sourceRoot, pluginStage);
    if (await exists(pluginTarget)) await rename(pluginTarget, pluginBackup);
    await rename(pluginStage, pluginTarget);
    pluginReplaced = true;
    if (options.faultStage === "after-plugin-replace") throw new Error("测试注入：插件替换后失败");

    browserChange = await replaceManagedDirectory(
      path.join(sourceRoot, "packages", "browser-extension"),
      path.join(root, "browser-extension")
    );
    if (options.faultStage === "after-extension-replace") throw new Error("测试注入：扩展替换后失败");

    await initializeVault(vault, sourceRoot);
    const device = await ensureDeviceConfig(root, legacyChange.state?.receiver_config_path, vault);
    skillChange = await installSkills(sourceRoot, codexHome, root, previousInstall);
    if (options.faultStage === "after-skills-replace") throw new Error("测试注入：Skill 替换后失败");
    if (!options.skipHooks) await installHooks(codexHome, programRoot);
    backgroundChange = await registerBackgroundScheduler({
      platform: options.configOptions?.platform || process.platform,
      home: options.configOptions?.home || homedir(),
      env: options.configOptions?.env || process.env,
      nodePath: process.execPath,
      programRoot,
      configRoot: root,
      previousState: previousInstall?.background_scheduler
    });
    const install = {
      schema_version: 2,
      version: VERSION,
      installed_at: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      vault_root: vault,
      program_root: programRoot,
      browser_extension_root: browserChange.target,
      browser_extension_sha256: await hashDirectory(browserChange.target),
      receiver_port: device.receiver_port,
      components: ["obsidian-plugin", "codex-skills", "codex-hooks", "browser-extension", "knowledge-runtime", "background-scheduler", "feishu-connector"],
      skills: skillChange.skills,
      legacy_migration: legacyChange.state,
      background_scheduler: backgroundChange.state
    };
    await atomicJson(path.join(root, "install.json"), install);
    let backgroundLaunch = null;
    if (options.launchBackground && backgroundChange.state.installed) {
      try {
        backgroundLaunch = (options.backgroundLauncher || launchBackgroundScheduler)({
          nodePath: process.execPath, programRoot, configRoot: root
        });
      } catch (error) {
        backgroundLaunch = { started: false, error: safeCommandError(error) };
      }
    }
    await skillChange.commit().catch(() => undefined);
    await browserChange.commit().catch(() => undefined);
    await backgroundChange.commit().catch(() => undefined);
    await rm(pluginBackup, { recursive: true, force: true }).catch(() => undefined);
    if (programBackup) await rm(programBackup, { recursive: true, force: true }).catch(() => undefined);
    return {
      ok: true,
      version: VERSION,
      vault,
      plugin: pluginTarget,
      program: programRoot,
      browser_extension: browserChange.target,
      hooks: options.skipHooks ? "skipped" : "installed",
      background_scheduler: backgroundChange.state,
      background_launch: backgroundLaunch,
      previous_version: previousInstall?.version || null,
      skill_conflicts: skillChange.conflicts,
      legacy_migration: legacyChange.state || { migrated: false }
    };
  } catch (error) {
    await skillChange?.rollback().catch(() => undefined);
    await browserChange?.rollback().catch(() => undefined);
    await backgroundChange?.rollback().catch(() => undefined);
    await rm(pluginStage, { recursive: true, force: true });
    if (pluginReplaced) {
      await rm(pluginTarget, { recursive: true, force: true });
      if (await exists(pluginBackup)) await rename(pluginBackup, pluginTarget);
    }
    await legacyChange?.rollback().catch(() => undefined);
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
  const suppliedVault = options.vault || process.env.ZHIXING_VAULT || install?.vault_root;
  const vault = suppliedVault ? path.resolve(suppliedVault) : "";
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(homedir(), ".codex"));
  const hooks = await readJson(path.join(codexHome, "hooks.json"), {});
  const feishuConfig = vault ? await readJson(path.join(vault, ".zhixing", "feishu-connector.json"), null) : null;
  const feishuState = vault ? await readJson(path.join(vault, "raw", "feishu", "sync-state.json"), null) : null;
  const browserRoot = install?.browser_extension_root || path.join(root, "browser-extension");
  const browserManifest = await readJson(path.join(browserRoot, "manifest.json"), null);
  const codex = await discoverExecutable("codex", options.discoveryOptions);
  const lark = await discoverExecutable("lark-cli", options.discoveryOptions);
  const runtimeReady = Boolean(install?.program_root && await exists(path.join(install.program_root, "runtime", "run-cycle.mjs")));
  const [executor, desktop, cliHook, schedule, webLastEvent, receiver] = await Promise.all([
    probeCodexExecutor(codex?.path, options.discoveryOptions),
    vault ? readCodexDesktopHealth({ vault, codexHome }) : null,
    readCodexCliHookHealth({ vault, hooks, codexExecutable: codex?.path }),
    vault ? readScheduleState({ vault, recoverStale: false }) : null,
    vault ? readLastCodexEventAt(path.join(vault, "raw", "chatgpt", "events")) : null,
    probeBrowserReceiver(root, options.fetch)
  ]);
  const backgroundRegistration = await inspectBackgroundSchedulerRegistration(install?.background_scheduler);
  const backgroundState = vault ? await readJson(path.join(vault, "raw", "codex", "automation", "background-state.json"), null) : null;
  const backgroundRecent = Boolean(backgroundState?.last_seen_at && Date.now() - Date.parse(backgroundState.last_seen_at) <= 3 * 60_000);
  const now = new Date().toISOString();
  const feishuEnabled = Boolean(feishuConfig?.enabled);
  const feishuSupported = feishuEnabled && Boolean(lark && runtimeReady);
  return {
    version: install?.version || null,
    platform: `${process.platform}-${process.arch}`,
    node: Number(process.versions.node.split(".")[0]) >= 22 ? "ready" : "upgrade-required",
    vault: vault && await exists(vault) ? "ready" : "missing",
    obsidian_plugin: vault && await exists(path.join(vault, ".obsidian", "plugins", PLUGIN_ID, "main.js")) ? "ready" : "missing",
    legacy_plugin: vault && await exists(path.join(vault, ".obsidian", "plugins", LEGACY_PLUGIN_ID)) ? "active" : "inactive",
    knowledge_runtime: runtimeReady ? "ready" : "missing",
    knowledge_runtime_health: {
      configured: runtimeReady,
      supported: runtimeReady,
      last_seen_at: runtimeReady ? now : null,
      last_event_at: schedule?.last_success || null,
      stale: false,
      error: runtimeReady ? null : "知识运行时缺失"
    },
    knowledge_executor: {
      configured: Boolean(codex),
      supported: Boolean(codex && executor.supported),
      last_seen_at: codex && executor.supported ? now : null,
      last_event_at: schedule?.last_success || null,
      stale: false,
      error: executor.error
    },
    browser_extension: browserManifest?.version === install?.version ? "ready" : browserManifest ? "version-mismatch" : "missing",
    browser_extension_path: browserRoot,
    browser_extension_version: browserManifest?.version || null,
    codex_hooks: cliHook.configured ? "configured" : "missing",
    codex_cli_hook: cliHook,
    codex_desktop: desktop,
    codex_cli: codex ? "ready" : "missing",
    codex_cli_path: codex?.path || null,
    codex_cli_source: codex?.source || null,
    codex_cli_version: codex?.version || null,
    lark_cli: lark ? "ready" : "missing",
    lark_cli_path: lark?.path || null,
    lark_cli_source: lark?.source || null,
    browser_receiver: {
      configured: receiver.configured,
      supported: receiver.supported,
      last_seen_at: receiver.supported ? now : null,
      last_event_at: webLastEvent,
      stale: staleSince(webLastEvent),
      error: receiver.error
    },
    knowledge_schedule: schedule,
    background_scheduler: {
      configured: backgroundRegistration.configured,
      supported: backgroundRegistration.configured && backgroundRecent && backgroundState?.supported === true,
      last_seen_at: backgroundState?.last_seen_at || null,
      last_event_at: backgroundState?.last_event_at || null,
      stale: !backgroundRecent,
      error: backgroundRegistration.error || backgroundState?.error ||
        (backgroundRegistration.configured && !backgroundRecent ? "后台调度尚未运行或心跳已中断" : null)
    },
    feishu_connector: !feishuEnabled ? "disabled" : feishuState?.status || "waiting-first-sync",
    feishu_health: {
      configured: feishuEnabled,
      supported: feishuSupported,
      last_seen_at: feishuState?.last_attempt || null,
      last_event_at: feishuState?.last_success || null,
      stale: feishuEnabled ? staleSince(feishuState?.last_success || null) : false,
      error: !feishuEnabled ? null : !lark ? "lark-cli 未通过版本探活" : !runtimeReady ? "知识运行时缺失" : feishuState?.error || null
    },
    feishu_last_sync: feishuState?.last_success || null,
    feishu_failed_modules: Number(feishuState?.failed_modules || 0)
  };
}

export async function uninstallSuite(options = {}) {
  const root = configRoot(options.configOptions);
  const installPath = path.join(root, "install.json");
  const install = await readJson(installPath, null);
  if (!install) return { ok: true, status: "not-installed", skill_conflicts: [] };
  const vault = path.resolve(options.vault || install.vault_root);
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(homedir(), ".codex"));
  const background = await removeBackgroundScheduler(install.background_scheduler);
  await rm(path.join(vault, ".obsidian", "plugins", PLUGIN_ID), { recursive: true, force: true });
  await removeHooks(codexHome);
  const skillResult = await uninstallSkills(codexHome, install.skills || []);
  const legacy = await restoreLegacyInstallation({
    vault,
    codexHome,
    state: install.legacy_migration,
    taskManager: options.legacyTaskManager || createLegacyTaskManager(process.platform)
  });
  await rm(path.join(root, "programs"), { recursive: true, force: true });
  await rm(install.browser_extension_root || path.join(root, "browser-extension"), { recursive: true, force: true });
  await rm(installPath, { force: true });
  return {
    ok: true,
    status: "uninstalled",
    skill_conflicts: skillResult.conflicts,
    legacy_hook_conflicts: legacy.hook_conflicts,
    background_scheduler_removed: background.removed,
    background_scheduler_conflict: background.conflict,
    legacy_restored: legacy.restored,
    data_preserved: ["raw", "wiki", "成果", "AGENTS.md", ".zhixing/feishu-connector.json", "device.json"]
  };
}

export async function installHooks(codexHome, programRoot) {
  const target = path.join(codexHome, "hooks.json");
  const current = await readJson(target, {});
  const command = `${quoteCommand(process.execPath)} ${quoteCommand(path.join(programRoot, "runtime", "capture-hook.mjs"))}`;
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
  await cp(path.join(sourceRoot, "skills"), path.join(target, "skills"), { recursive: true });
  await cp(path.join(sourceRoot, "hooks"), path.join(target, "hooks"), { recursive: true });
  await cp(path.join(sourceRoot, "templates"), path.join(target, "templates"), { recursive: true });
  await mkdir(path.join(target, "scripts"), { recursive: true });
  await cp(path.join(sourceRoot, "scripts", "zhixing.mjs"), path.join(target, "scripts", "zhixing.mjs"));
  await cp(path.join(sourceRoot, "scripts", "install-core.mjs"), path.join(target, "scripts", "install-core.mjs"));
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
  await writeIfMissing(path.join(vault, "AGENTS.md"), await readFile(path.join(sourceRoot, "templates", "vault", "AGENTS.md"), "utf8"));
  await writeIfMissing(path.join(vault, "wiki", "示例", "把一次排查变成下次可复用的经验.md"),
    await readFile(path.join(sourceRoot, "templates", "vault", "wiki", "示例", "把一次排查变成下次可复用的经验.md"), "utf8"));
}

async function ensureDeviceConfig(root, legacyConfigPath, vault) {
  const target = path.join(root, "device.json");
  const existing = await readJson(target, null);
  if (existing?.receiver_token && String(existing.receiver_token).length >= 24) return existing;
  const legacy = legacyConfigPath ? await readJson(legacyConfigPath, null) : null;
  const sameVault = !legacy?.vault_root || equalPath(legacy.vault_root, vault);
  const receiverToken = sameVault && typeof legacy?.token === "string" && legacy.token.length >= 24
    ? legacy.token : randomBytes(32).toString("base64url");
  const receiverPort = sameVault && Number.isInteger(Number(legacy?.port)) ? Number(legacy.port) : 43123;
  const device = {
    schema_version: 1,
    device_id: randomBytes(16).toString("hex"),
    receiver_port: receiverPort,
    receiver_token: receiverToken,
    created_at: new Date().toISOString(),
    migrated_from_legacy: receiverToken === legacy?.token
  };
  await atomicJson(target, device);
  return device;
}

async function installSkills(sourceRoot, codexHome, root, previousInstall = null) {
  const previousSkills = Array.isArray(previousInstall?.skills) ? previousInstall.skills : [];
  const isUpdate = Boolean(previousInstall);
  const transactionRoot = path.join(root, ".transactions", `skills-${randomUUID()}`);
  const snapshots = [];
  const createdBackups = [];
  const skills = [];
  const conflicts = [];
  await mkdir(path.join(codexHome, "skills"), { recursive: true });
  try {
    for (const name of OWNED_SKILLS) {
      const source = path.join(sourceRoot, "skills", name);
      const target = path.join(codexHome, "skills", name);
      const previous = previousSkills.find((item) => item?.name === name) || null;
      const targetExists = await exists(target);
      const marker = targetExists ? await readJson(path.join(target, SKILL_MARKER), null) : null;
      const owned = marker?.owner === PLUGIN_ID && marker?.skill === name && typeof marker?.content_sha256 === "string";
      const unmodified = owned && await hashDirectory(target, new Set([SKILL_MARKER])) === marker.content_sha256;
      const matchesPreviousProgram = targetExists && !owned && isUpdate
        ? await matchesPreviousProgramSkill(target, previousInstall?.program_root, name) : false;
      if (targetExists && ((owned && !unmodified) || (!owned && isUpdate && !matchesPreviousProgram))) {
        conflicts.push(name);
        skills.push({ ...(previous || {}), name, status: "conflict", backup_path: previous?.backup_path || null,
          content_sha256: marker?.content_sha256 || previous?.content_sha256 || null,
          installed_version: marker?.installed_version || previous?.installed_version || null });
        continue;
      }

      let backupPath = previous?.backup_path || null;
      if (targetExists && !owned && !matchesPreviousProgram && !backupPath) {
        backupPath = path.join(root, "backups", "skills", name, `${Date.now()}-${randomUUID()}`);
        await mkdir(path.dirname(backupPath), { recursive: true });
        await cp(target, backupPath, { recursive: true });
        createdBackups.push(backupPath);
      }
      const snapshot = path.join(transactionRoot, "current", name);
      if (targetExists) {
        await mkdir(path.dirname(snapshot), { recursive: true });
        await cp(target, snapshot, { recursive: true });
      }
      snapshots.push({ target, snapshot: targetExists ? snapshot : null });
      const staging = `${target}.staging-${randomUUID()}`;
      await cp(source, staging, { recursive: true });
      const contentSha256 = await hashDirectory(staging, new Set([SKILL_MARKER]));
      await writeFile(path.join(staging, SKILL_MARKER), `${JSON.stringify({
        schema_version: 1,
        owner: PLUGIN_ID,
        skill: name,
        installed_version: VERSION,
        content_sha256: contentSha256
      }, null, 2)}\n`, "utf8");
      await rm(target, { recursive: true, force: true });
      await rename(staging, target);
      skills.push({ name, status: "installed", backup_path: backupPath, content_sha256: contentSha256, installed_version: VERSION });
    }
    return {
      skills,
      conflicts,
      async rollback() {
        for (const item of snapshots.reverse()) {
          await rm(item.target, { recursive: true, force: true });
          if (item.snapshot) await cp(item.snapshot, item.target, { recursive: true });
        }
        for (const backup of createdBackups) await rm(backup, { recursive: true, force: true });
        await rm(transactionRoot, { recursive: true, force: true });
      },
      async commit() { await rm(transactionRoot, { recursive: true, force: true }); }
    };
  } catch (error) {
    for (const item of snapshots.reverse()) {
      await rm(item.target, { recursive: true, force: true });
      if (item.snapshot) await cp(item.snapshot, item.target, { recursive: true });
    }
    for (const backup of createdBackups) await rm(backup, { recursive: true, force: true });
    await rm(transactionRoot, { recursive: true, force: true });
    throw error;
  }
}

async function matchesPreviousProgramSkill(target, previousProgramRoot, name) {
  if (typeof previousProgramRoot !== "string" || !previousProgramRoot.trim()) return false;
  const authority = path.join(previousProgramRoot, "skills", name);
  if (!await exists(authority)) return false;
  const ignored = new Set([SKILL_MARKER]);
  return await hashDirectory(target, ignored) === await hashDirectory(authority, ignored);
}

async function uninstallSkills(codexHome, ownership) {
  const conflicts = [];
  for (const item of ownership) {
    if (!OWNED_SKILLS.includes(item?.name)) continue;
    const target = path.join(codexHome, "skills", item.name);
    const marker = await readJson(path.join(target, SKILL_MARKER), null);
    const owned = marker?.owner === PLUGIN_ID && marker?.skill === item.name && typeof marker?.content_sha256 === "string";
    const unmodified = owned && await hashDirectory(target, new Set([SKILL_MARKER])) === marker.content_sha256;
    if (await exists(target) && !unmodified) {
      conflicts.push(item.name);
      continue;
    }
    await rm(target, { recursive: true, force: true });
    if (item.backup_path && await exists(item.backup_path)) {
      await cp(item.backup_path, target, { recursive: true });
      await rm(item.backup_path, { recursive: true, force: true });
    }
  }
  return { conflicts };
}

async function migrateLegacyInstallation({ vault, root, codexHome, previousInstall, taskManager }) {
  const previousState = previousInstall?.legacy_migration?.migrated ? previousInstall.legacy_migration : null;
  const legacyTarget = path.join(vault, ".obsidian", "plugins", LEGACY_PLUGIN_ID);
  const manifest = await readJson(path.join(legacyTarget, "manifest.json"), null);
  if (!previousState && manifest?.id !== LEGACY_PLUGIN_ID) {
    return { state: previousInstall?.legacy_migration || null, rollback: async () => {} };
  }

  const backup = previousState?.plugin_backup || path.join(root, "backups", "legacy", `${Date.now()}-${randomUUID()}`, LEGACY_PLUGIN_ID);
  const communityPath = path.join(vault, ".obsidian", "community-plugins.json");
  const communityBefore = await readJson(communityPath, null);
  const hooksChange = await migrateLegacyHooks(codexHome, previousState?.legacy_hooks);
  let observedTasks = [];
  let pluginMoved = false;
  try {
    if (manifest?.id === LEGACY_PLUGIN_ID) {
      await mkdir(path.dirname(backup), { recursive: true });
      if (!await exists(backup)) await cp(legacyTarget, backup, { recursive: true });
      await rm(legacyTarget, { recursive: true, force: true });
      pluginMoved = true;
    }
    if (Array.isArray(communityBefore)) await atomicJson(communityPath, replacePluginId(communityBefore, LEGACY_PLUGIN_ID, PLUGIN_ID));
    observedTasks = await taskManager.disable(LEGACY_TASK_NAMES);
    const tasks = mergeLegacyTaskStates(previousState?.legacy_tasks, observedTasks);
    const receiverConfig = path.join(codexHome, "hooks", "chatgpt-web-receiver.json");
    const state = {
      ...(previousState || {}),
      migrated: true,
      migrated_at: previousState?.migrated_at || new Date().toISOString(),
      plugin_version: previousState?.plugin_version || String(manifest?.version || "unknown"),
      plugin_backup: backup,
      legacy_was_enabled: previousState?.legacy_was_enabled ?? (Array.isArray(communityBefore) && communityBefore.includes(LEGACY_PLUGIN_ID)),
      legacy_tasks: tasks,
      legacy_hooks: hooksChange.state,
      receiver_config_path: previousState?.receiver_config_path || (await exists(receiverConfig) ? receiverConfig : null)
    };
    return {
      state,
      async rollback() {
        if (pluginMoved) {
          await rm(legacyTarget, { recursive: true, force: true });
          if (await exists(backup)) await cp(backup, legacyTarget, { recursive: true });
        }
        if (Array.isArray(communityBefore)) await atomicJson(communityPath, communityBefore);
        await taskManager.restore(observedTasks);
        await hooksChange.rollback();
      }
    };
  } catch (error) {
    if (pluginMoved) {
      await rm(legacyTarget, { recursive: true, force: true });
      if (await exists(backup)) await cp(backup, legacyTarget, { recursive: true });
    }
    if (Array.isArray(communityBefore)) await atomicJson(communityPath, communityBefore);
    await taskManager.restore(observedTasks).catch(() => undefined);
    await hooksChange.rollback().catch(() => undefined);
    throw error;
  }
}

async function restoreLegacyInstallation({ vault, codexHome, state, taskManager }) {
  if (!state?.migrated) return { restored: false, hook_conflicts: [] };
  const target = path.join(vault, ".obsidian", "plugins", LEGACY_PLUGIN_ID);
  let restored = false;
  if (!await exists(target) && state.plugin_backup && await exists(state.plugin_backup)) {
    await cp(state.plugin_backup, target, { recursive: true });
    restored = true;
  }
  const communityPath = path.join(vault, ".obsidian", "community-plugins.json");
  const community = await readJson(communityPath, null);
  if (Array.isArray(community)) {
    const withoutNew = community.filter((item) => item !== PLUGIN_ID);
    if (restored && state.legacy_was_enabled && !withoutNew.includes(LEGACY_PLUGIN_ID)) withoutNew.push(LEGACY_PLUGIN_ID);
    await atomicJson(communityPath, withoutNew);
  }
  await taskManager.restore(Array.isArray(state.legacy_tasks) ? state.legacy_tasks : []);
  const hooks = await restoreLegacyHooks(codexHome, state.legacy_hooks);
  return { restored, hook_conflicts: hooks.conflicts };
}

function createLegacyTaskManager(platform) {
  if (platform !== "win32") return { disable: async () => [], restore: async () => {} };
  return {
    async disable(names) {
      const result = [];
      for (const name of names) {
        const xml = await execFileAsync("schtasks.exe", ["/Query", "/TN", name, "/XML"], { timeout: 10_000, windowsHide: true })
          .then((value) => String(value.stdout || "")).catch(() => "");
        if (!xml) continue;
        const wasEnabled = legacyTaskWasEnabledFromXml(xml);
        await execFileAsync("schtasks.exe", ["/End", "/TN", name], { timeout: 10_000, windowsHide: true }).catch(() => undefined);
        if (wasEnabled) await execFileAsync("schtasks.exe", ["/Change", "/TN", name, "/DISABLE"], { timeout: 10_000, windowsHide: true });
        result.push({ name, was_enabled: wasEnabled });
      }
      return result;
    },
    async restore(states) {
      for (const state of states) {
        if (state?.was_enabled && LEGACY_TASK_NAMES.includes(state.name)) {
          await execFileAsync("schtasks.exe", ["/Change", "/TN", state.name, "/ENABLE"], { timeout: 10_000, windowsHide: true });
        }
      }
    }
  };
}

export function legacyTaskWasEnabledFromXml(xml) {
  return !/<Enabled>\s*false\s*<\/Enabled>/i.test(String(xml || ""));
}

function mergeLegacyTaskStates(previous, observed) {
  const merged = new Map();
  for (const state of Array.isArray(previous) ? previous : []) {
    if (LEGACY_TASK_NAMES.includes(state?.name)) merged.set(state.name, { name: state.name, was_enabled: Boolean(state.was_enabled) });
  }
  for (const state of Array.isArray(observed) ? observed : []) {
    if (!LEGACY_TASK_NAMES.includes(state?.name)) continue;
    const before = merged.get(state.name);
    merged.set(state.name, { name: state.name, was_enabled: Boolean(before?.was_enabled || state.was_enabled) });
  }
  return [...merged.values()];
}

async function migrateLegacyHooks(codexHome, previousState) {
  const target = path.join(codexHome, "hooks.json");
  const original = await readJson(target, {});
  const extracted = removeLegacyHooks(original, codexHome);
  const previousEntries = Array.isArray(previousState?.entries) ? previousState.entries : [];
  const entries = uniqueLegacyHookBackups([...previousEntries, ...extracted.backups]);
  if (extracted.changed) await atomicJson(target, extracted.config);
  return {
    state: entries.length > 0 ? { schema_version: 1, entries } : previousState || null,
    async rollback() {
      if (extracted.changed) await atomicJson(target, original);
    }
  };
}

async function restoreLegacyHooks(codexHome, state) {
  const backups = Array.isArray(state?.entries) ? state.entries : [];
  if (backups.length === 0) return { conflicts: [] };
  const target = path.join(codexHome, "hooks.json");
  const current = await readJson(target, {});
  const result = structuredClone(current && typeof current === "object" ? current : {});
  result.hooks = result.hooks && typeof result.hooks === "object" ? result.hooks : {};
  const conflicts = [];
  let changed = false;
  for (const backup of backups) {
    const eventName = String(backup?.event_name || "");
    if (!eventName || !["UserPromptSubmit", "Stop"].includes(eventName) || !backup?.entry) continue;
    const entries = Array.isArray(result.hooks[eventName]) ? result.hooks[eventName] : [];
    const existing = entries.map((entry) => legacyOnlyEntry(entry, codexHome)).filter(Boolean);
    if (existing.length > 0) {
      if (!existing.some((entry) => JSON.stringify(entry) === JSON.stringify(backup.entry))) conflicts.push(eventName);
      continue;
    }
    result.hooks[eventName] = [...entries, structuredClone(backup.entry)];
    changed = true;
  }
  if (changed) await atomicJson(target, result);
  return { conflicts: [...new Set(conflicts)] };
}

function removeLegacyHooks(config, codexHome) {
  const result = structuredClone(config && typeof config === "object" ? config : {});
  if (!result.hooks || typeof result.hooks !== "object") return { config: result, backups: [], changed: false };
  const backups = [];
  let changed = false;
  for (const eventName of ["UserPromptSubmit", "Stop"]) {
    const entries = Array.isArray(result.hooks[eventName]) ? result.hooks[eventName] : [];
    const kept = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) {
        kept.push(entry);
        continue;
      }
      const legacy = entry.hooks.filter((hook) => isLegacyObsidianHook(hook, codexHome));
      if (legacy.length === 0) {
        kept.push(entry);
        continue;
      }
      changed = true;
      backups.push({ event_name: eventName, entry: { ...entry, hooks: legacy } });
      const remaining = entry.hooks.filter((hook) => !isLegacyObsidianHook(hook, codexHome));
      if (remaining.length > 0) kept.push({ ...entry, hooks: remaining });
    }
    result.hooks[eventName] = kept;
  }
  return { config: result, backups, changed };
}

function legacyOnlyEntry(entry, codexHome) {
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) return null;
  const legacy = entry.hooks.filter((hook) => isLegacyObsidianHook(hook, codexHome));
  return legacy.length > 0 ? { ...entry, hooks: legacy } : null;
}

function uniqueLegacyHookBackups(backups) {
  const seen = new Set();
  const result = [];
  for (const backup of backups) {
    const key = JSON.stringify(backup);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(backup);
    }
  }
  return result;
}

export function isLegacyObsidianHook(hook, codexHome) {
  const command = typeof hook?.command === "string" ? hook.command.trim() : "";
  if (!/(?:^|[\\/\s"])(?:powershell|pwsh)(?:\.exe)?(?:"|\s)/i.test(command)) return false;
  const file = command.match(/(?:^|\s)-(?:File|f)\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
  if (!file) return false;
  const actual = normalizeHookPath(file[1] || file[2] || file[3]);
  const expected = normalizeHookPath(path.join(codexHome, "hooks", "obsidian-capture.ps1"));
  return actual === expected;
}

function normalizeHookPath(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "").replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLocaleLowerCase();
}

async function replaceManagedDirectory(source, target) {
  const staging = `${target}.staging-${randomUUID()}`;
  const backup = await exists(target) ? `${target}.backup-${Date.now()}-${randomUUID()}` : null;
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, staging, { recursive: true });
  if (backup) await rename(target, backup);
  try {
    await rename(staging, target);
  } catch (error) {
    if (backup) await rename(backup, target);
    throw error;
  }
  return {
    target,
    async rollback() {
      await rm(target, { recursive: true, force: true });
      if (backup && await exists(backup)) await rename(backup, target);
    },
    async commit() { if (backup) await rm(backup, { recursive: true, force: true }); }
  };
}

function replacePluginId(values, from, to) {
  const result = [];
  for (const value of values) {
    const next = value === from ? to : value;
    if (!result.includes(next)) result.push(next);
  }
  return result;
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

async function hashDirectory(root, ignoredNames = new Set()) {
  const hash = createHash("sha256");
  if (!await exists(root)) return "";
  for (const item of await listTree(root)) {
    if (ignoredNames.has(path.basename(item.relative))) continue;
    hash.update(item.relative.replace(/\\/g, "/"));
    hash.update("\0");
    if (item.type === "file") hash.update(await readFile(item.absolute));
    else if (item.type === "link") hash.update(await readlink(item.absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function listTree(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = path.join(relative, entry.name);
    const absolute = path.join(root, childRelative);
    if (entry.isDirectory()) result.push(...await listTree(root, childRelative));
    else if (entry.isFile()) result.push({ relative: childRelative, absolute, type: "file" });
    else if (entry.isSymbolicLink()) result.push({ relative: childRelative, absolute, type: "link" });
  }
  return result;
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

async function probeBrowserReceiver(root, fetchOverride) {
  const device = await readJson(path.join(root, "device.json"), null);
  if (!device?.receiver_token || !device?.receiver_port) {
    return { configured: false, supported: false, error: "本机接收器尚未配置" };
  }
  try {
    const request = fetchOverride || globalThis.fetch;
    const response = await request(`http://127.0.0.1:${Number(device.receiver_port)}/health`, {
      headers: { "X-Obsidian-Capture-Token": String(device.receiver_token) },
      signal: AbortSignal.timeout(2_000)
    });
    return response.ok ? { configured: true, supported: true, error: null }
      : { configured: true, supported: false, error: `本机接收器返回 HTTP ${response.status}` };
  } catch (error) {
    return { configured: true, supported: false,
      error: `本机接收器未通过探活：${String(error instanceof Error ? error.message : error).replace(/[\r\n]+/g, " ").slice(0, 180)}` };
  }
}

function staleSince(value, threshold = 36 * 60 * 60_000) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return !Number.isFinite(parsed) || Date.now() - parsed > threshold;
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

function equalPath(left, right) {
  const a = path.resolve(String(left));
  const b = path.resolve(String(right));
  return process.platform === "win32" ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b;
}

export async function sha256File(target) {
  return createHash("sha256").update(await readFile(target)).digest("hex");
}
