import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { atomicJson } from "./common.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_LEASE_MS = 3 * 60_000;
const DEFAULT_HEARTBEAT_MS = 30_000;
const UNKNOWN_IDENTITY_GRACE_MS = 10 * 60_000;
const SAME_PROCESS_MAX_STALE_MS = 24 * 60 * 60_000;
let selfIdentityPromise;

export function runtimeLockPath(options) {
  const name = safeName(options.name || "automation");
  if (options.vault) return path.join(path.resolve(options.vault), "raw", "codex", "automation", "locks", `${name}.lock`);
  return path.join(path.resolve(options.root), "runtime", "locks", `${name}.lock`);
}

export async function acquireVaultAutomationLock(options) {
  return acquireRuntimeLock({ ...options, name: "automation", lockPath: runtimeLockPath({ vault: options.vault, name: "automation" }) });
}

export async function acquireBackgroundHostLock(options) {
  return acquireRuntimeLock({ ...options, name: "background-host",
    lockPath: runtimeLockPath({ root: options.configRoot, name: "background-host" }) });
}

export async function readVaultAutomationOwner(options) {
  return readActiveOwner(runtimeLockPath({ vault: options.vault, name: "automation" }), options);
}

export async function acquireRuntimeLock(options) {
  const lockPath = path.resolve(options.lockPath);
  const leaseMs = positive(options.leaseMs, DEFAULT_LEASE_MS);
  const heartbeatMs = positive(options.heartbeatMs, DEFAULT_HEARTBEAT_MS);
  const now = nowDate(options.now);
  const ownerId = randomUUID();
  const processIdentity = await identifyProcess(process.pid, options);
  const owner = ownerRecord({ ownerId, ownerKind: options.ownerKind, now, leaseMs, processIdentity });
  await mkdir(path.dirname(lockPath), { recursive: true });
  let recovered = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await mkdir(lockPath);
      await atomicJson(path.join(lockPath, "owner.json"), owner);
      await atomicJson(heartbeatPath(lockPath, ownerId), heartbeatRecord(owner));
      return acquiredLease({ lockPath, owner, recovered, heartbeatMs, leaseMs, now: options.now });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readOwner(lockPath);
      if (!existing && await newLockInProgress(lockPath, now, leaseMs)) {
        return { acquired: false, recovered: false, owner: null, lock_path: lockPath };
      }
      if (!expired(existing, now)) return { acquired: false, recovered: false, owner: existing, lock_path: lockPath };
      if (await sameLiveOwner(existing, now, options)) {
        return { acquired: false, recovered: false, owner: existing, lock_path: lockPath };
      }
      const stalePath = `${lockPath}.stale-${ownerId}-${attempt}`;
      try {
        await rename(lockPath, stalePath);
        await rm(stalePath, { recursive: true, force: true });
        recovered = true;
      } catch (renameError) {
        if (!["ENOENT", "EEXIST", "EPERM", "EACCES"].includes(renameError?.code)) throw renameError;
      }
    }
  }
  return { acquired: false, recovered: false, owner: await readOwner(lockPath), lock_path: lockPath };
}

export async function withLeaseHeartbeat(lease, work, options = {}) {
  if (!lease.acquired) return work(lease);
  const timer = setInterval(() => {
    void lease.heartbeat().then((owned) => options.onHeartbeat?.(owned)).catch(() => options.onHeartbeat?.(false));
  }, lease.heartbeat_ms);
  timer.unref?.();
  try {
    return await work(lease);
  } finally {
    clearInterval(timer);
    await lease.release();
  }
}

function acquiredLease(options) {
  return {
    acquired: true,
    recovered: options.recovered,
    owner: options.owner,
    lock_path: options.lockPath,
    heartbeat_ms: options.heartbeatMs,
    async heartbeat() {
      const existing = await readOwner(options.lockPath);
      if (existing?.owner_id !== options.owner.owner_id) return false;
      const now = nowDate(options.now);
      const updated = { ...existing, heartbeat_at: now.toISOString(),
        lease_until: new Date(now.getTime() + options.leaseMs).toISOString() };
      await atomicJson(heartbeatPath(options.lockPath, options.owner.owner_id), heartbeatRecord(updated));
      this.owner = updated;
      return true;
    },
    async release() {
      const existing = await readOwner(options.lockPath);
      if (existing?.owner_id !== options.owner.owner_id) return false;
      await rm(options.lockPath, { recursive: true, force: true });
      return true;
    }
  };
}

async function readActiveOwner(lockPath, options) {
  const owner = await readOwner(lockPath);
  if (!owner) return null;
  const now = nowDate(options.now);
  return !expired(owner, now) || await sameLiveOwner(owner, now, options) ? owner : null;
}

async function readOwner(lockPath) {
  try {
    const owner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
    const heartbeat = await readHeartbeat(lockPath, owner.owner_id);
    return heartbeat?.owner_id === owner.owner_id ? { ...owner, heartbeat_at: heartbeat.heartbeat_at,
      lease_until: heartbeat.lease_until } : owner;
  } catch { return null; }
}

async function readHeartbeat(lockPath, ownerId) {
  try { return JSON.parse(await readFile(heartbeatPath(lockPath, ownerId), "utf8")); } catch { return null; }
}

async function newLockInProgress(lockPath, now, leaseMs) {
  try { return now.getTime() - (await stat(lockPath)).mtimeMs < leaseMs; } catch { return false; }
}

function heartbeatPath(lockPath, ownerId) {
  return path.join(lockPath, `heartbeat-${safeName(ownerId)}.json`);
}

function heartbeatRecord(owner) {
  return { owner_id: owner.owner_id, heartbeat_at: owner.heartbeat_at, lease_until: owner.lease_until };
}

function ownerRecord(options) {
  return {
    schema_version: 1,
    owner_id: options.ownerId,
    owner_kind: String(options.ownerKind || "unknown").slice(0, 40),
    pid: process.pid,
    process_identity: options.processIdentity,
    acquired_at: options.now.toISOString(),
    heartbeat_at: options.now.toISOString(),
    lease_until: new Date(options.now.getTime() + options.leaseMs).toISOString()
  };
}

async function sameLiveOwner(owner, now, options) {
  if (!Number.isInteger(owner?.pid) || owner.pid <= 0 || !processAlive(owner.pid)) return false;
  const heartbeatAt = Date.parse(owner.heartbeat_at || owner.acquired_at || "");
  const age = Number.isFinite(heartbeatAt) ? Math.max(0, now.getTime() - heartbeatAt) : Number.POSITIVE_INFINITY;
  const identity = await identifyProcess(owner.pid, options);
  if (owner.process_identity && identity) {
    return owner.process_identity === identity && age < SAME_PROCESS_MAX_STALE_MS;
  }
  return age < UNKNOWN_IDENTITY_GRACE_MS;
}

async function identifyProcess(pid, options) {
  if (options.processIdentity) return options.processIdentity(pid);
  const platform = options.platform || process.platform;
  if (pid === process.pid) {
    selfIdentityPromise ||= queryProcessIdentity(pid, platform);
    return selfIdentityPromise;
  }
  return queryProcessIdentity(pid, platform);
}

async function queryProcessIdentity(pid, platform) {
  try {
    if (platform === "linux") {
      const value = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = value.slice(value.lastIndexOf(")") + 2).trim().split(/\s+/);
      return fields[19] ? `linux:${fields[19]}` : null;
    }
    if (platform === "darwin") {
      const { stdout } = await execFileAsync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { timeout: 2_000 });
      return stdout.trim() ? `darwin:${stdout.trim()}` : null;
    }
    if (platform === "win32") {
      const command = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`;
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command],
        { windowsHide: true, timeout: 3_000 });
      return stdout.trim() ? `win32:${stdout.trim()}` : null;
    }
  } catch {}
  return null;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function expired(owner, now) {
  const leaseUntil = Date.parse(owner?.lease_until || "");
  return !Number.isFinite(leaseUntil) || leaseUntil <= now.getTime();
}

function nowDate(value) {
  const result = typeof value === "function" ? value() : value;
  const date = result instanceof Date ? new Date(result) : new Date(result || Date.now());
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9-]/gi, "-").slice(0, 60) || "runtime";
}
