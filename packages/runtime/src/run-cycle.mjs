import { randomUUID } from "node:crypto";
import { appendFile, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { atomicJson, localDate, resolveInstall } from "./common.mjs";
import { syncFeishu } from "./feishu-sync.mjs";

const DEFAULTS = {
  batches: 3,
  maxTopics: 2,
  maxPairs: 16,
  maxChars: 60_000,
  hardTimeoutMs: 75 * 60_000,
  softTokenBudget: 150_000
};

export async function runCycle(options = {}) {
  const installed = await resolveInstall({ vault: options.vault });
  const configuredVault = options.vault || installed.vaultRoot;
  if (!configuredVault) throw new Error("尚未配置知行台 Vault");
  const vault = path.resolve(configuredVault);
  const runtimeRoot = path.dirname(fileURLToPath(import.meta.url));
  const transaction = path.resolve(options.transaction || path.join(runtimeRoot, "knowledge-transaction.mjs"));
  const prompt = await readFile(path.join(runtimeRoot, "ingest-prompt.md"), "utf8");
  const codex = options.codex || process.env.CODEX_BIN || "codex";
  const cycleId = options.cycleId || randomUUID();
  const logDirectory = path.join(vault, "raw", "codex", "automation", localDate());
  const lockPath = path.join(vault, "raw", "codex", "automation", "cycle.lock");
  const release = await acquireLock(lockPath, DEFAULTS.hardTimeoutMs + 15 * 60_000);
  const summary = {
    schema_version: 1,
    cycle_id: cycleId,
    trigger: options.trigger || "manual",
    started_at: new Date().toISOString(),
    status: "running",
    batches: [],
    tokens_used: 0,
    feishu: options.skipFeishu ? { status: "skipped" } : await syncFeishu({ vault }).catch((error) => ({
      status: "failed",
      error: safeError(error)
    }))
  };
  try {
    const batchCount = integer(options.batches, DEFAULTS.batches, 1, 12);
    for (let batchIndex = 1; batchIndex <= batchCount; batchIndex += 1) {
      if (summary.tokens_used >= integer(options.softTokenBudget, DEFAULTS.softTokenBudget, 1, 2_000_000)) {
        summary.status = "budget-paused";
        break;
      }
      const runId = randomUUID();
      const logPath = path.join(logDirectory, `${cycleId}-${batchIndex}.log`);
      const prepareArgs = [transaction, "prepare", "--vault", vault, "--run-id", runId,
        "--cycle-id", cycleId, "--batch-index", String(batchIndex), "--trigger", summary.trigger,
        "--max-topics", String(integer(options.maxTopics, DEFAULTS.maxTopics, 0, 24)),
        "--max-pairs", String(integer(options.maxPairs, DEFAULTS.maxPairs, 1, 240)),
        "--max-chars", String(integer(options.maxChars, DEFAULTS.maxChars, 1, 2_000_000)),
        "--log-path", path.relative(vault, logPath).replace(/\\/g, "/")];
      if (options.backfillUnsettled) prepareArgs.push("--backfill-unsettled");
      if (options.since) prepareArgs.push("--since", options.since);
      const prepared = await runCommand(process.execPath, prepareArgs, { cwd: vault, timeoutMs: 120_000 });
      const contract = JSON.parse(lastNonemptyLine(prepared.stdout));
      const batch = {
        batch_index: batchIndex,
        run_id: runId,
        selected_pairs: Number(contract.pair_count || 0),
        selected_topics: Number(contract.topic_count || 0),
        status: "prepared",
        tokens_used: 0
      };
      summary.batches.push(batch);
      if (batch.selected_topics === 0) {
        const committed = await runCommand(process.execPath,
          [transaction, "commit", "--vault", vault, "--run-id", runId, "--system-only"],
          { cwd: vault, timeoutMs: 120_000, acceptedExitCodes: [0, 2] });
        const receipt = JSON.parse(lastNonemptyLine(committed.stdout));
        await appendLog(logPath, "事务提交", committed.stdout, committed.stderr);
        applyReceipt(batch, receipt);
        if (batch.selected_pairs === 0 && Number(contract.system_pair_count || 0) === 0) break;
        continue;
      }

      const startedAt = Date.now();
      try {
        const agentOutputPath = path.join(vault, "raw", "codex", "staging", `${runId}-agent-output.json`);
        const codexArgs = [
          ...(Array.isArray(options.codexPrefixArgs) ? options.codexPrefixArgs : []),
          "exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--json",
          "--output-last-message", agentOutputPath, "-C", vault, "-"
        ];
        const codexResult = await runCommand(codex,
          codexArgs,
          {
            cwd: vault,
            input: prompt,
            timeoutMs: integer(options.hardTimeoutMs, DEFAULTS.hardTimeoutMs, 60_000, 6 * 60 * 60_000),
            env: { ...process.env, ZHIXING_CAPTURE_DISABLED: "1" }
          });
        await writeLog(logPath, codexResult.stdout, codexResult.stderr);
        const agentResult = JSON.parse(await readFile(agentOutputPath, "utf8"));
        if (agentResult?.run_id !== runId || !Array.isArray(agentResult?.outcomes)) {
          throw new Error("智能体没有返回与本次运行一致的合法回执");
        }
        await atomicJson(contract.result_path, agentResult);
        batch.tokens_used = tokenUsage(codexResult.stdout);
        summary.tokens_used += batch.tokens_used;
        const committed = await runCommand(process.execPath, [transaction, "commit", "--vault", vault,
          "--run-id", runId, "--tokens-used", String(batch.tokens_used),
          "--duration-ms", String(Date.now() - startedAt), "--input-chars", String(prompt.length)],
        { cwd: vault, timeoutMs: 120_000, acceptedExitCodes: [0, 2] });
        const receipt = JSON.parse(lastNonemptyLine(committed.stdout));
        await appendLog(logPath, "事务提交", committed.stdout, committed.stderr);
        applyReceipt(batch, receipt);
      } catch (error) {
        await appendLog(logPath, "执行失败", error instanceof CommandError ? error.stdout : "",
          error instanceof CommandError ? error.stderr : String(error));
        await runCommand(process.execPath, [transaction, "fail", "--vault", vault, "--run-id", runId],
          { cwd: vault, timeoutMs: 120_000 }).catch(() => undefined);
        batch.status = "failed";
        batch.error = safeError(error);
      }
    }
    if (summary.status === "running") {
      summary.status = summary.batches.some((batch) => ["failed", "partial"].includes(batch.status)) ? "partial" : "succeeded";
    }
    return summary;
  } catch (error) {
    summary.status = "failed";
    summary.error = safeError(error);
    throw error;
  } finally {
    summary.finished_at = new Date().toISOString();
    await atomicJson(path.join(vault, "raw", "codex", "automation", "last-cycle.json"), summary).catch(() => undefined);
    await release();
  }
}

async function acquireLock(lockPath, staleMs) {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(lockPath), { recursive: true }));
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs > staleMs) await unlink(lockPath);
  } catch {}
  let handle;
  try {
    handle = await open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("知行台正在整理，当前请求已跳过");
    throw error;
  }
  return async () => {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, options.timeoutMs || 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if ((options.acceptedExitCodes || [0]).includes(code)) resolve({ stdout, stderr, code });
      else reject(new CommandError(command, code, stdout, stderr));
    });
    if (options.input) child.stdin.end(options.input, "utf8");
    else child.stdin.end();
  });
}

class CommandError extends Error {
  constructor(command, code, stdout, stderr) {
    const detail = firstReadableLine(stderr) || firstReadableLine(stdout);
    super(`${command} 执行失败，退出码 ${code}${detail ? `：${detail}` : ""}`);
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

async function writeLog(filePath, stdout, stderr) {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(filePath), { recursive: true }));
  const safe = `${String(stdout || "")}\n${String(stderr || "")}`
    .replace(/(receiver_token|X-Obsidian-Capture-Token)["'\s:=]+[^\s,"']+/gi, "$1=[已隐藏]");
  await writeFile(filePath, safe.slice(-4_000_000), "utf8");
}

async function appendLog(filePath, label, stdout, stderr) {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(filePath), { recursive: true }));
  const safe = `\n[${label}]\n${String(stdout || "")}\n${String(stderr || "")}`
    .replace(/(receiver_token|X-Obsidian-Capture-Token)["'\s:=]+[^\s,"']+/gi, "$1=[已隐藏]");
  await appendFile(filePath, safe.slice(-1_000_000), "utf8");
}

function applyReceipt(batch, receipt) {
  const failed = Number(receipt.failed || 0);
  const committed = Number(receipt.committed || 0);
  const status = ["succeeded", "partial", "failed"].includes(receipt.final_status)
    ? receipt.final_status
    : failed > 0 ? committed > 0 ? "partial" : "failed" : "succeeded";
  batch.status = status;
  batch.committed = committed;
  batch.failed = failed;
  if (failed > 0) {
    batch.error = receiptFailure(receipt);
    batch.failures = Array.isArray(receipt.failures) ? receipt.failures.slice(0, 8) : [];
  }
}

function receiptFailure(receipt) {
  const failures = Array.isArray(receipt.failures) ? receipt.failures : [];
  const details = failures.map((item) => [item.title, item.error].filter(Boolean).join("：")).filter(Boolean);
  return details.length > 0
    ? `${Number(receipt.failed || details.length)} 个主题未完成沉淀：${details.join("；")}`.slice(0, 1000)
    : `${Number(receipt.failed || 0)} 个主题未完成沉淀，将在下次重试`;
}

function firstReadableLine(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 300) || "";
}

function tokenUsage(jsonl) {
  let total = 0;
  for (const line of String(jsonl || "").split(/\r?\n/)) {
    try {
      const value = JSON.parse(line);
      const usage = value.usage || value.item?.usage || value.turn?.usage;
      total = Math.max(total, Number(usage?.total_tokens || usage?.total || 0));
    } catch {}
  }
  return total;
}

function lastNonemptyLine(text) {
  return String(text || "").split(/\r?\n/).filter((line) => line.trim()).at(-1) || "{}";
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error).slice(0, 240);
}

export function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    const next = values[index + 1];
    const name = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (next && !next.startsWith("--")) { result[name] = next; index += 1; }
    else result[name] = true;
  }
  return result;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  runCycle(parseArgs(process.argv.slice(2))).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "partial") process.exitCode = 2;
  }).catch((error) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
}
