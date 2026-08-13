import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const MARKER = "zhixing-workbench-background-scheduler:v1";

export function startupEntryDefinition(options) {
  const platform = options.platform || process.platform;
  const home = options.home || homedir();
  const env = options.env || process.env;
  const paths = platform === "win32" ? path.win32 : path.posix;
  const nodePath = paths.resolve(options.nodePath);
  const schedulerPath = paths.join(paths.resolve(options.programRoot), "runtime", "background-scheduler.mjs");
  const config = paths.resolve(options.configRoot);
  if (platform === "win32") {
    const appData = env.APPDATA || paths.join(home, "AppData", "Roaming");
    const entryPath = paths.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup",
      "知行台后台调度.vbs");
    const command = [nodePath, schedulerPath, "--config", config].map(vbsQuote).join(" ");
    return {
      platform,
      kind: "windows-startup",
      entryPath,
      content: `' ${MARKER}\r\nSet shell = CreateObject("WScript.Shell")\r\nshell.Run "${command}", 0, False\r\n`
    };
  }
  if (platform === "darwin") {
    const entryPath = paths.join(home, "Library", "LaunchAgents", "com.zhixing.workbench.scheduler.plist");
    const args = [nodePath, schedulerPath, "--config", config]
      .map((value) => `    <string>${xmlEscape(value)}</string>`).join("\n");
    return {
      platform,
      kind: "launch-agent",
      entryPath,
      content: `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${MARKER} -->\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>com.zhixing.workbench.scheduler</string>\n  <key>ProgramArguments</key>\n  <array>\n${args}\n  </array>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n  <key>ProcessType</key><string>Background</string>\n</dict>\n</plist>\n`
    };
  }
  const xdgConfig = env.XDG_CONFIG_HOME || paths.join(home, ".config");
  const entryPath = paths.join(xdgConfig, "autostart", "zhixing-workbench-scheduler.desktop");
  const command = [nodePath, schedulerPath, "--config", config].map(desktopQuote).join(" ");
  return {
    platform,
    kind: "xdg-autostart",
    entryPath,
    content: `[Desktop Entry]\n# ${MARKER}\nType=Application\nName=知行台后台调度\nExec=${command}\nTerminal=false\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n`
  };
}

export async function registerBackgroundScheduler(options) {
  const definition = startupEntryDefinition(options);
  const previous = options.previousState;
  const existing = await readOptional(definition.entryPath);
  const existingHash = existing === null ? null : sha256(existing);
  if (existing !== null && existing !== definition.content) {
    const ownedUnmodified = previous?.installed && previous.entry_path === definition.entryPath &&
      previous.content_sha256 === existingHash;
    if (!ownedUnmodified) {
      return unchangedResult({
        schema_version: 1,
        installed: false,
        platform: definition.platform,
        kind: definition.kind,
        entry_path: definition.entryPath,
        content_sha256: null,
        conflict: true,
        error: "后台调度启动项已被修改或被同名文件占用，已保留现状"
      });
    }
  }
  await atomicText(definition.entryPath, definition.content);
  const state = {
    schema_version: 1,
    installed: true,
    platform: definition.platform,
    kind: definition.kind,
    entry_path: definition.entryPath,
    content_sha256: sha256(definition.content),
    conflict: false,
    error: null
  };
  return {
    state,
    async rollback() {
      if (existing === null) await rm(definition.entryPath, { force: true });
      else await atomicText(definition.entryPath, existing);
    },
    async commit() {}
  };
}

export async function removeBackgroundScheduler(state) {
  if (!state?.entry_path) return { removed: false, conflict: false, error: null };
  const existing = await readOptional(state.entry_path);
  if (existing === null) return { removed: false, conflict: false, error: null };
  if (!state.content_sha256 || sha256(existing) !== state.content_sha256) {
    return { removed: false, conflict: true, error: "后台调度启动项已被修改，卸载时予以保留" };
  }
  await rm(state.entry_path, { force: true });
  return { removed: true, conflict: false, error: null };
}

export async function inspectBackgroundSchedulerRegistration(state) {
  if (!state?.installed || !state?.entry_path) {
    return { configured: false, error: state?.error || "后台调度尚未注册" };
  }
  const existing = await readOptional(state.entry_path);
  if (existing === null) return { configured: false, error: "后台调度启动项不存在" };
  if (sha256(existing) !== state.content_sha256) return { configured: false, error: "后台调度启动项发生冲突" };
  return { configured: true, error: null };
}

export function launchBackgroundScheduler(options) {
  const scheduler = path.join(path.resolve(options.programRoot), "runtime", "background-scheduler.mjs");
  const child = (options.spawn || spawn)(options.nodePath || process.execPath,
    [scheduler, "--config", path.resolve(options.configRoot)], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, ZHIXING_CAPTURE_DISABLED: "1" }
    });
  child.unref();
  return { started: true, pid: child.pid || null };
}

function unchangedResult(state) {
  return { state, async rollback() {}, async commit() {} };
}

async function readOptional(target) {
  try { return await readFile(target, "utf8"); } catch { return null; }
}

async function atomicText(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function vbsQuote(value) {
  return `""${String(value).replace(/"/g, '""')}""`;
}

function desktopQuote(value) {
  return `"${String(value).replace(/([\\"])/g, "\\$1")}"`;
}

function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
