import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export function configRoot(options = {}) {
  const env = options.env ?? process.env;
  if (env.ZHIXING_CONFIG) return path.resolve(env.ZHIXING_CONFIG);
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  if (platform === "win32") {
    return path.win32.resolve(env.APPDATA || path.win32.join(home, "AppData", "Roaming"), "ZhixingWorkbench");
  }
  if (platform === "darwin") {
    return path.posix.join(home, "Library", "Application Support", "ZhixingWorkbench");
  }
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, ".config"), "zhixing-workbench");
}

export async function resolveInstall(options = {}) {
  const root = configRoot(options);
  const install = await readJson(path.join(root, "install.json"), null);
  const device = await readJson(path.join(root, "device.json"), null);
  const vaultRoot = options.vault || process.env.ZHIXING_VAULT || install?.vault_root;
  return {
    configRoot: root,
    device,
    install,
    programRoot: install?.program_root ? path.resolve(install.program_root) : null,
    vaultRoot: vaultRoot ? path.resolve(vaultRoot) : null
  };
}

export function localDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function redactText(input) {
  let text = String(input || "");
  const rules = [
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, "[已隐藏私钥]"],
    [/\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, "[已隐藏密钥]"],
    [/\b(?:ghp|github_pat|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{16,}\b/g, "[已隐藏 GitHub 凭据]"],
    [/\bAKIA[0-9A-Z]{16}\b/g, "[已隐藏云凭据]"],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[已隐藏令牌]"],
    [/\b(authorization|api[_ -]?key|access[_ -]?token|password|passwd|secret)\s*[:=]\s*["']?[^\s,"']{6,}/gi, "$1=[已隐藏]"],
    [/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@/gi, "$1://[已隐藏]@"]
  ];
  for (const [pattern, replacement] of rules) text = text.replace(pattern, replacement);
  return text;
}

export async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

export async function appendJsonLine(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, "a");
  try {
    await handle.write(`${JSON.stringify(value)}\n`, null, "utf8");
  } finally {
    await handle.close();
  }
}

export async function readStdin(limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > limit) throw new Error("输入内容超过安全上限");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
