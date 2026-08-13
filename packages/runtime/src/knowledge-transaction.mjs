import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { compileKnowledgeQueue, parseSessionIndex } from "./knowledge-queue.mjs";
import { renderSemanticOutcome } from "./knowledge-semantic-renderer.mjs";

const REQUIRED_HEADINGS = [
  "问题与现象",
  "根因与判断依据",
  "尝试过的路径",
  "可复用的解决路径",
  "适用条件与边界",
  "验证方式与结果",
  "下次快速识别",
  "来源与关联"
];
const MEMORY_HEADINGS = [
  "当时我想做什么",
  "我遇到了什么",
  "我是怎么判断的",
  "我最后做了什么",
  "这次留下了什么",
  "下次遇到时",
  "需要追溯时"
];

export async function main(values = process.argv.slice(2)) {
  const args = parseArgs(values);
  const command = args._[0];
  if (!args.vault && !process.env.ZHIXING_VAULT) {
    throw new Error("缺少 Vault 路径，请使用 --vault 或 ZHIXING_VAULT");
  }
  const vault = path.resolve(args.vault || process.env.ZHIXING_VAULT);
  if (command === "prepare") {
    await recoverKnowledgeJournal(vault);
    const result = await prepareRun(vault, args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  if (command === "commit") {
    await recoverKnowledgeJournal(vault);
    const result = await commitRun(vault, args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.failed > 0) process.exitCode = 2;
    return result;
  }
  if (command === "fail") {
    await recoverKnowledgeJournal(vault);
    const result = await failRun(vault, args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  throw new Error("用法: node knowledge-transaction.mjs <prepare|commit|fail> --vault <路径>");
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

async function prepareRun(vaultRoot, options) {
  const runId = options["run-id"] || randomUUID();
  const state = await readJson(path.join(vaultRoot, "raw", "codex", "ingest-state.json"), {
    schema_version: 2,
    processed_event_ids: []
  });
  const ledger = await readJson(path.join(vaultRoot, "raw", "codex", "knowledge-settlements.json"), {
    schema_version: 2,
    outcomes: []
  });
  const records = await readEvents(vaultRoot);
  const processed = new Set(state.processed_event_ids || []);
  const settled = new Set((ledger.outcomes || []).flatMap((item) =>
    item.status === "succeeded" || item.status === "not-applicable" ? item.source_event_ids || [] : []
  ));
  const since = options.since || "1970-01-01";
  const backfill = Boolean(options["backfill-unsettled"]);
  const allPairs = pairRecords(records).filter((pair) => pair.date >= since);
  const pendingPairs = allPairs.filter((pair) => {
    const unprocessed = pair.source_event_ids.some((id) => !processed.has(id));
    const unsettled = pair.source_event_ids.some((id) => !settled.has(id));
    return unprocessed || (backfill && unsettled);
  });
  const pendingPairIds = new Set(pendingPairs.map((pair) => pair.id));
  const sessionIndex = await loadSessionIndex(options["session-index"]);
  const compiled = compileKnowledgeQueue(allPairs, ledger.outcomes || [], sessionIndex, {
    maxTopics: options["max-topics"],
    maxPairs: options["max-pairs"],
    maxChars: options["max-chars"],
    quietHours: options["quiet-hours"],
    retryBackoffHours: options["retry-backoff-hours"],
    laneOffset: ((positiveInteger(options["batch-index"]) || 1) - 1) % 3,
    now: options.now,
    pendingPairIds
  });
  const contractPath = path.join(vaultRoot, "raw", "codex", "ingest-run-contract.json");
  const resultPath = path.join(vaultRoot, "raw", "codex", "staging", `${runId}.json`);
  const systemResultPath = path.join(vaultRoot, "raw", "codex", "staging", `${runId}-system.json`);
  const historyPath = path.join(vaultRoot, "raw", "codex", "ingest-history", `${runId}.json`);
  const generatedAt = new Date().toISOString();
  const topics = await Promise.all(compiled.selectedTopics.map(async (topic) => ({
    ...topic,
    project_directory: await projectDirectory(vaultRoot, topic.project),
    existing_knowledge: await existingKnowledgeContext(vaultRoot, (ledger.outcomes || [])
      .find((outcome) => outcome.id === topic.id && outcome.status === "succeeded"))
  })));
  const contract = {
    schema_version: 3,
    run_id: runId,
    cycle_id: optionalIdentifier(options["cycle-id"]),
    batch_index: positiveInteger(options["batch-index"]),
    generated_at: generatedAt,
    since,
    backfill_unsettled: backfill,
    trigger: options.trigger === "automatic" ? "automatic" : "manual",
    log_path: optionalVaultPath(options["log-path"]),
    result_path: relativeVaultPath(vaultRoot, resultPath),
    system_result_path: relativeVaultPath(vaultRoot, systemResultPath),
    history_path: relativeVaultPath(vaultRoot, historyPath),
    pairs: compiled.selectedPairs,
    topics,
    queue: {
      ...compiled.queue,
      session_index_available: sessionIndex.available
    }
  };
  await atomicJson(systemResultPath, {
    schema_version: 3,
    run_id: runId,
    pairs: compiled.systemPairs,
    outcomes: compiled.systemOutcomes
  });
  await atomicJson(historyPath, {
    schema_version: 1,
    run_id: runId,
    started_at: generatedAt,
    status: "running",
    trigger: contract.trigger,
    cycle_id: contract.cycle_id,
    batch_index: contract.batch_index,
    log_path: contract.log_path,
    ...contract.queue,
    committed: 0,
    skipped: 0,
    pending: 0,
    failed: 0,
    system_committed_pairs: 0,
    remaining_pairs: contract.queue.raw_pending_pairs,
    remaining_topics: contract.queue.candidate_topics,
    topic_results: [],
    attempts: []
  });
  await atomicJson(contractPath, contract);
  await atomicJson(path.join(vaultRoot, "raw", "codex", "ingest-status.json"), {
    schema_version: 3,
    run_id: runId,
    status: pendingPairs.length === 0 ? "idle" : "running",
    ...contract.queue,
    updated_at: new Date().toISOString()
  });
  return {
    run_id: runId,
    pair_count: compiled.queue.selected_pairs,
    topic_count: compiled.queue.selected_topics,
    system_pair_count: compiled.queue.no_op_automation_pairs + compiled.queue.supporting_pairs,
    ...contract.queue,
    contract_path: contractPath,
    result_path: resultPath
  };
}

async function existingKnowledgeContext(vaultRoot, settlement) {
  if (!settlement) {
    return undefined;
  }
  const memoryPath = String(settlement.memory_path || "");
  const evidencePaths = uniqueStrings(settlement.evidence_paths?.length
    ? settlement.evidence_paths
    : (settlement.wiki_paths || []).filter((wikiPath) => wikiPath !== memoryPath));
  const documents = [];
  for (const documentPath of uniqueStrings([memoryPath, ...evidencePaths])) {
    const target = safeVaultPath(vaultRoot, documentPath, "wiki/");
    const content = await readText(target, "");
    if (!content) {
      continue;
    }
    documents.push({
      path: documentPath,
      role: documentPath === memoryPath ? "memory" : "evidence",
      stable_id: documentPath === memoryPath
        ? frontmatterValue(content, "zhixing_memory_id")
        : frontmatterValue(content, "zhixing_wiki_id"),
      managed: documentPath === memoryPath
        ? frontmatterValue(content, "zhixing_document") === "memory"
        : frontmatterValue(content, "zhixing_document") === "evidence",
      sha256: sha256(content),
      content
    });
  }
  return documents.length > 0 ? { documents } : undefined;
}

async function projectDirectory(vaultRoot, project) {
  const requested = String(project || "").trim() || "未归属";
  const wikiRoot = path.join(vaultRoot, "wiki");
  try {
    const entries = await readdir(wikiRoot, { withFileTypes: true });
    const existing = entries.find((entry) =>
      entry.isDirectory() &&
      entry.name !== "我的经历" &&
      entry.name.localeCompare(requested, undefined, { sensitivity: "accent" }) === 0);
    if (existing) {
      return existing.name;
    }
  } catch {
    // The renderer creates the project directory when the Vault has no Wiki yet.
  }
  return requested
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "未归属";
}

async function commitRun(vaultRoot, options) {
  const contractPath = path.join(vaultRoot, "raw", "codex", "ingest-run-contract.json");
  const contract = await readJson(contractPath);
  if (!contract || !Array.isArray(contract.pairs) || !Array.isArray(contract.topics)) {
    throw new Error("整理运行合同不存在或无效");
  }
  if (options["run-id"] && options["run-id"] !== contract.run_id) {
    throw new Error("整理运行 ID 与合同不一致");
  }
  const systemPath = safeVaultPath(vaultRoot, contract.system_result_path, "raw/codex/staging/");
  const system = await readJson(systemPath, { run_id: contract.run_id, pairs: [], outcomes: [] });
  if (system.run_id !== contract.run_id || !Array.isArray(system.pairs) || !Array.isArray(system.outcomes)) {
    throw new Error("确定性整理回执不存在或无效");
  }
  let result = { run_id: contract.run_id, outcomes: [] };
  let resultError;
  if (contract.topics.length > 0 && !options["system-only"]) {
    try {
      const resultPath = safeVaultPath(vaultRoot, contract.result_path, "raw/codex/staging/");
      result = await readJson(resultPath);
      if (!result || result.run_id !== contract.run_id || !Array.isArray(result.outcomes)) {
        throw new Error("智能体没有生成有效的整理回执");
      }
    } catch (error) {
      resultError = error instanceof Error ? error.message : String(error);
      result = { run_id: contract.run_id, outcomes: [] };
    }
  } else if (contract.topics.length > 0) {
    throw new Error("存在待语义整理主题，不能使用 system-only 提交");
  }

  const statePath = path.join(vaultRoot, "raw", "codex", "ingest-state.json");
  const ledgerPath = path.join(vaultRoot, "raw", "codex", "knowledge-settlements.json");
  const stateText = await readText(statePath, "");
  const ledgerText = await readText(ledgerPath, "");
  const state = stateText ? JSON.parse(stateText) : { schema_version: 2, processed_event_ids: [] };
  const ledger = ledgerText ? JSON.parse(ledgerText) : { schema_version: 2, outcomes: [] };
  const journal = await startKnowledgeJournal(vaultRoot, contract.run_id, [
    { target: statePath, content: stateText },
    { target: ledgerPath, content: ledgerText }
  ]);
  const processed = new Set(state.processed_event_ids || []);
  const nextSettlements = new Map((ledger.outcomes || []).map((item) => [item.id, item]));
  let committed = 0;
  let skipped = 0;
  let pending = 0;
  let failed = 0;
  let systemCommitted = 0;
  let stateChanged = false;
  const historyResults = [];

  const systemPairByEvent = new Map(system.pairs.flatMap((pair) =>
    pair.source_event_ids.map((id) => [id, pair])));
  for (const outcome of system.outcomes) {
    const currentSourceIds = uniqueStrings(outcome.source_event_ids);
    const pairs = uniqueObjects(currentSourceIds.map((id) => systemPairByEvent.get(id)).filter(Boolean), (item) => item.id);
    if (!outcome.id || pairs.length === 0 ||
        !sameStringSet(currentSourceIds, pairs.flatMap((pair) => pair.source_event_ids))) {
      throw new Error("确定性整理回执没有覆盖完整问答");
    }
    const existing = nextSettlements.get(outcome.id);
    const sourceIds = uniqueStrings([...(existing?.source_event_ids || []), ...currentSourceIds]);
    for (const pair of pairs) {
      await ensureDailySource(vaultRoot, pair, true);
    }
    removeSupersededSettlements(nextSettlements, sourceIds, outcome.id);
    nextSettlements.set(outcome.id, {
      id: outcome.id,
      status: "not-applicable",
      category: outcome.category,
      title: systemOutcomeTitle(outcome, pairs),
      source_event_ids: sourceIds,
      daily_paths: uniqueStrings([...(existing?.daily_paths || []), ...pairs.map((pair) => pair.daily_path)]),
      local_date: pairs.at(-1)?.date,
      occurred_at: pairs.at(-1)?.captured_at,
      project_label: projectLabelFromPairs(pairs),
      wiki_paths: [],
      knowledge_changes: [],
      reason: outcome.reason,
      updated_at: new Date().toISOString()
    });
    for (const id of currentSourceIds) {
      if (!processed.has(id)) {
        processed.add(id);
        stateChanged = true;
      }
    }
    skipped += 1;
    systemCommitted += pairs.length;
  }

  const outcomesById = new Map();
  const usedResultIds = new Set();
  const allowedOutcomeIds = new Set(contract.topics.map((topic) => topic.id));
  for (const outcome of result.outcomes) {
    if (!outcome?.id || outcomesById.has(outcome.id) || !allowedOutcomeIds.has(outcome.id)) {
      resultError = resultError || "整理回执包含重复、空白或合同外的 outcome id";
      continue;
    }
    outcomesById.set(outcome.id, outcome);
  }
  for (const topic of contract.topics) {
    const rawOutcome = outcomesById.get(topic.id);
    const pairs = contract.pairs.filter((pair) => topic.pair_ids.includes(pair.id));
    const sourceIds = uniqueStrings(topic.source_event_ids);
    const allSourceIds = uniqueStrings(
      Array.isArray(topic.all_source_event_ids) && topic.all_source_event_ids.length > 0
        ? topic.all_source_event_ids
        : sourceIds
    );
    try {
      if (resultError) {
        throw new Error(resultError);
      }
      if (!rawOutcome) {
        throw new Error("整理回执没有覆盖这个完整主题");
      }
      const outcome = isSemanticOutcome(rawOutcome)
        ? renderSemanticOutcome({
          topic,
          pairs,
          existingDocuments: topic.existing_knowledge?.documents,
          outcome: rawOutcome,
          now: contract.generated_at
        })
        : rawOutcome;
      validateOutcomePathClaims([outcome]);
      if (usedResultIds.has(outcome.id)) {
        throw new Error("整理回执重复覆盖同一主题");
      }
      usedResultIds.add(outcome.id);
      if (!sameStringSet(uniqueStrings(outcome.source_event_ids), sourceIds)) {
        throw new Error("整理回执的来源事件与合同主题不完全一致");
      }
      for (const pair of pairs) {
        await ensureDailySource(vaultRoot, pair);
      }
      if (options["fault-stage"] === "wiki-write") {
        throw new Error("故障注入：Wiki 写入阶段");
      }
      if (outcome.status === "succeeded") {
        validateDigest(outcome.digest);
        validateExistingKnowledgeReuse(topic, outcome);
        await applyKnowledgeUpdates(vaultRoot, outcome, pairs, options, journal);
      } else if (outcome.status === "pending") {
        if (!String(outcome.reason || "").trim()) {
          throw new Error("待沉淀结果必须说明缺少什么");
        }
      } else if (outcome.status !== "not-applicable") {
        throw new Error(outcome.last_error || "整理结果未成功");
      } else if (!String(outcome.reason || "").trim()) {
        throw new Error("无需沉淀的结果必须说明原因");
      }

      const updatedAt = new Date().toISOString();
      const evidencePaths = uniqueStrings((outcome.wiki_updates || []).map((item) => item.path));
      const memoryPath = String(outcome.memory_update?.path || "").trim() || undefined;
      const allWikiPaths = uniqueStrings([memoryPath, ...evidencePaths]);
      const previousSettlement = nextSettlements.get(topic.id);
      const preserveSuccessfulTopic = previousSettlement?.status === "succeeded" &&
        outcome.status !== "succeeded";
      const settlementId = preserveSuccessfulTopic
        ? `${outcome.status}:${topic.id}:${sha256(sourceIds.join("\n")).slice(0, 16)}`
        : topic.id;
      const settlementSourceIds = preserveSuccessfulTopic ? sourceIds : allSourceIds;
      const settlement = {
        id: settlementId,
        status: outcome.status,
        category: String(topic.anchor || "").startsWith("automation:") ? "durable-output" : "knowledge-topic",
        title: topic.title,
        local_date: String(topic.last_seen || "").slice(0, 10),
        occurred_at: topic.last_seen,
        project_label: topic.project,
        daily_paths: uniqueStrings([
          ...(outcome.status === "succeeded" ? previousSettlement?.daily_paths || [] : []),
          ...pairs.map((pair) => pair.daily_path)
        ]),
        source_event_ids: settlementSourceIds,
        wiki_paths: allWikiPaths,
        memory_path: memoryPath,
        evidence_paths: evidencePaths,
        knowledge_changes: [
          ...(outcome.memory_update ? [{
            action: outcome.memory_update.action === "created" ? "created" : "updated",
            path: outcome.memory_update.path,
            title: outcome.memory_update.title || path.basename(outcome.memory_update.path, ".md"),
            role: "memory"
          }] : []),
          ...(outcome.wiki_updates || []).map((item) => ({
          action: item.action === "created" ? "created" : "updated",
          path: item.path,
          title: item.title || path.basename(item.path, ".md"),
          role: "evidence"
        }))],
        reason: outcome.reason || undefined,
        digest: outcome.digest,
        reused_by_outcome_ids: uniqueStrings(outcome.reused_by_outcome_ids),
        updated_at: updatedAt
      };
      removeSupersededSettlements(
        nextSettlements,
        preserveSuccessfulTopic ? sourceIds : allSourceIds,
        settlementId
      );
      nextSettlements.set(settlementId, settlement);
      if (outcome.status === "pending") {
        sourceIds.forEach((id) => {
          if (processed.delete(id)) {
            stateChanged = true;
          }
        });
        pending += 1;
      } else {
        sourceIds.forEach((id) => {
          if (!processed.has(id)) {
            processed.add(id);
            stateChanged = true;
          }
        });
      }
      if (outcome.status === "not-applicable") {
        skipped += 1;
      } else if (outcome.status === "succeeded") {
        committed += 1;
      }
      historyResults.push({
        id: topic.id,
        title: topic.title,
        status: outcome.status,
        reason: outcome.reason || undefined,
        wiki_paths: settlement.wiki_paths,
        memory_path: settlement.memory_path,
        evidence_paths: settlement.evidence_paths,
        knowledge_changes: settlement.knowledge_changes,
        digest: settlement.digest,
        daily_paths: settlement.daily_paths,
        source_event_count: settlementSourceIds.length
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      sourceIds.forEach((id) => {
        if (processed.delete(id)) {
          stateChanged = true;
        }
      });
      removeSupersededSettlements(nextSettlements, sourceIds, `failed:${topic.id}`);
      nextSettlements.set(`failed:${topic.id}`, {
        id: `failed:${topic.id}`,
        status: "failed",
        category: "knowledge-topic",
        title: topic.title,
        local_date: String(topic.last_seen || "").slice(0, 10),
        occurred_at: topic.last_seen,
        project_label: topic.project,
        daily_paths: uniqueStrings(pairs.map((pair) => pair.daily_path)),
        source_event_ids: sourceIds,
        wiki_paths: [],
        memory_path: undefined,
        evidence_paths: [],
        knowledge_changes: [],
        digest: undefined,
        last_error: message,
        updated_at: new Date().toISOString()
      });
      historyResults.push({
        id: topic.id,
        title: topic.title,
        status: "failed",
        error: message,
        wiki_paths: [],
        evidence_paths: [],
        knowledge_changes: [],
        daily_paths: uniqueStrings(pairs.map((pair) => pair.daily_path)),
        source_event_count: sourceIds.length
      });
    }
  }

  await atomicJson(ledgerPath, {
    schema_version: 3,
    updated_at: new Date().toISOString(),
    outcomes: [...nextSettlements.values()]
  });
  if (stateChanged) {
    await atomicJson(statePath, {
      ...state,
      schema_version: 3,
      processed_event_ids: [...processed].sort(),
      last_successful_run: failed === 0 && pending === 0 ? new Date().toISOString() : state.last_successful_run
    });
  }
  await finishKnowledgeJournal(journal);
  const currentQueue = await compileCurrentQueue(vaultRoot, contract, processed, nextSettlements);
  const remainingPairs = currentQueue.raw_pending_pairs;
  const remainingTopics = currentQueue.candidate_topics;
  const counts = {
    ...contract.queue,
    batch_raw_pending_pairs: Number(contract.queue?.raw_pending_pairs || 0),
    batch_candidate_topics: Number(contract.queue?.candidate_topics || 0),
    raw_pending_pairs: currentQueue.raw_pending_pairs,
    no_op_automation_pairs: currentQueue.no_op_automation_pairs,
    substantive_automation_pairs: currentQueue.substantive_automation_pairs,
    supporting_pairs: currentQueue.supporting_pairs,
    candidate_pairs: currentQueue.candidate_pairs,
    candidate_topics: currentQueue.candidate_topics,
    deferred_topics: currentQueue.deferred_topics,
    deferred_oversize_topics: currentQueue.deferred_oversize_topics,
    needs_compaction_topics: currentQueue.needs_compaction_topics,
    open_topics: currentQueue.open_topics,
    ready_topics: currentQueue.ready_topics,
    retry_topics: currentQueue.retry_topics,
    cooling_retry_topics: currentQueue.cooling_retry_topics,
    backlog_topics: currentQueue.backlog_topics,
    recent_topics: currentQueue.recent_topics,
    committed,
    skipped,
    pending,
    failed,
    system_committed_pairs: systemCommitted,
    remaining_pairs: remainingPairs,
    remaining_topics: remainingTopics,
    tokens_used: nonnegativeInteger(options["tokens-used"]),
    duration_ms: nonnegativeInteger(options["duration-ms"]),
    input_chars: nonnegativeInteger(options["input-chars"]),
    cycle_id: contract.cycle_id,
    batch_index: contract.batch_index,
    queue_updated_at: new Date().toISOString()
  };
  const finalStatus = Number(contract.queue?.raw_pending_pairs || 0) === 0
    ? "idle"
    : failed > 0
      ? committed > 0 || skipped > 0 || systemCommitted > 0 ? "partial" : "failed"
      : pending > 0 ? "partial" : "succeeded";
  const finalError = failed > 0
    ? `${failed} 个主题未完成沉淀，将在下次重试`
    : pending > 0 ? `${pending} 个主题仍在待沉淀队列` : undefined;
  await writeRunHistory(vaultRoot, contract, finalStatus, finalError, counts, historyResults);
  await writeStatus(
    vaultRoot,
    contract.run_id,
    finalStatus,
    finalError,
    counts
  );
  return {
    ...counts,
    final_status: finalStatus,
    failures: historyResults.filter((item) => item.status === "failed").slice(0, 8).map((item) => ({
      id: item.id,
      title: item.title,
      error: item.error
    }))
  };
}

async function compileCurrentQueue(vaultRoot, contract, processed, settlements) {
  const since = String(contract.since || "1970-01-01");
  const allPairs = pairRecords(await readEvents(vaultRoot))
    .filter((pair) => pair.date >= since);
  const settled = new Set([...settlements.values()].flatMap((item) =>
    item.status === "succeeded" || item.status === "not-applicable"
      ? item.source_event_ids || []
      : []));
  const pendingPairIds = new Set(allPairs.filter((pair) => {
    const unprocessed = pair.source_event_ids.some((id) => !processed.has(id));
    const unsettled = pair.source_event_ids.some((id) => !settled.has(id));
    return unprocessed || (contract.backfill_unsettled && unsettled);
  }).map((pair) => pair.id));
  const sessionIndex = await loadSessionIndex();
  return compileKnowledgeQueue(allPairs, [...settlements.values()], sessionIndex, {
    maxTopics: 0,
    maxPairs: contract.queue?.max_pairs,
    maxChars: contract.queue?.max_chars,
    quietHours: contract.queue?.quiet_hours,
    recentHours: contract.queue?.recent_hours,
    retryBackoffHours: contract.queue?.retry_backoff_hours,
    pendingPairIds
  }).queue;
}

async function failRun(vaultRoot, options) {
  const contract = await readJson(path.join(vaultRoot, "raw", "codex", "ingest-run-contract.json"));
  if (!contract || !contract.run_id || (options["run-id"] && options["run-id"] !== contract.run_id)) {
    throw new Error("无法收口整理失败：运行合同不存在或 ID 不一致");
  }
  const historyPath = safeVaultPath(
    vaultRoot,
    contract.history_path || `raw/codex/ingest-history/${contract.run_id}.json`,
    "raw/codex/ingest-history/"
  );
  const existingHistory = await readJson(historyPath, {});
  if (["idle", "succeeded", "partial", "failed"].includes(existingHistory.status)) {
    return {
      committed: Number(existingHistory.committed || 0),
      skipped: Number(existingHistory.skipped || 0),
      pending: Number(existingHistory.pending || 0),
      failed: Number(existingHistory.failed || 0),
      remaining_pairs: Number(existingHistory.remaining_pairs || 0),
      remaining_topics: Number(existingHistory.remaining_topics || 0),
      final_status: existingHistory.status
    };
  }
  const error = String(options.error || "整理进程意外中断");
  const stage = String(options.stage || "unknown");
  const message = `${stage}: ${error}`;
  const failed = Number(contract.queue?.selected_topics || contract.topics?.length || 0);
  const counts = {
    ...contract.queue,
    committed: 0,
    skipped: 0,
    pending: 0,
    failed,
    system_committed_pairs: 0,
    remaining_pairs: Number(contract.queue?.raw_pending_pairs || 0),
    remaining_topics: Number(contract.queue?.candidate_topics || 0)
  };
  const topicResults = (contract.topics || []).map((topic) => ({
    id: topic.id,
    title: topic.title,
    status: "failed",
    error: message,
    wiki_paths: [],
    knowledge_changes: [],
    daily_paths: uniqueStrings((contract.pairs || [])
      .filter((pair) => topic.pair_ids?.includes(pair.id))
      .map((pair) => pair.daily_path)),
    source_event_count: uniqueStrings(topic.source_event_ids).length
  }));
  await writeRunHistory(vaultRoot, contract, "failed", message, counts, topicResults);
  await writeStatus(vaultRoot, contract.run_id, "failed", message, counts);
  return { ...counts, final_status: "failed" };
}

async function applyKnowledgeUpdates(vaultRoot, outcome, pairs, options, journal) {
  if (!Array.isArray(outcome.wiki_updates) || outcome.wiki_updates.length === 0) {
    throw new Error("已沉淀结果没有 AI 证据页更新");
  }
  if (!outcome.memory_update || typeof outcome.memory_update !== "object") {
    throw new Error("已沉淀结果没有面向本人阅读的经历文章");
  }
  const dailyPaths = new Set(pairs.map((pair) => pair.daily_path));
  const evidencePaths = uniqueStrings(outcome.wiki_updates.map((item) => item.path));
  const writes = [];
  for (const update of outcome.wiki_updates) {
    const target = safeVaultPath(vaultRoot, update.path, "wiki/");
    const content = String(update.content || "").replace(/\r\n/g, "\n").trimEnd() + "\n";
    const existing = await readText(target, "");
    validateEvidenceContent(content, pairs, dailyPaths, existing, outcome.memory_update.path);
    await assertStableIdUnique(vaultRoot, "zhixing_wiki_id", frontmatterValue(content, "zhixing_wiki_id"), target);
    const expected = String(update.expected_sha256 || "");
    validateWriteIntent(update, existing, content, "AI 证据页");
    if (expected && sha256(existing) !== expected && sha256(content) !== sha256(existing)) {
      throw new Error(`${update.path} 已被其他修改更新，拒绝覆盖`);
    }
    writes.push({ target, path: update.path, content, existing });
  }

  const memory = outcome.memory_update;
  const memoryTarget = safeVaultPath(vaultRoot, memory.path, "wiki/我的经历/");
  const memoryContent = String(memory.content || "").replace(/\r\n/g, "\n").trimEnd() + "\n";
  const existingMemory = await readText(memoryTarget, "");
  validateMemoryContent(memoryContent, outcome.digest, evidencePaths, existingMemory);
  await assertStableIdUnique(vaultRoot, "zhixing_memory_id", frontmatterValue(memoryContent, "zhixing_memory_id"), memoryTarget);
  validateWriteIntent(memory, existingMemory, memoryContent, "经历文章");
  const expectedMemory = String(memory.expected_sha256 || "");
  if (expectedMemory && sha256(existingMemory) !== expectedMemory &&
      sha256(memoryContent) !== sha256(existingMemory)) {
    throw new Error(`${memory.path} 已被其他修改更新，拒绝覆盖`);
  }
  writes.unshift({ target: memoryTarget, path: memory.path, content: memoryContent, existing: existingMemory });
  const journalEntries = writes.map((update) => ({
    path: relativeVaultPath(vaultRoot, update.target),
    existed: Boolean(update.existing),
    original_base64: Buffer.from(update.existing, "utf8").toString("base64")
  }));
  journal.files.push(...journalEntries);
  await atomicJson(journal.path, journal);

  const promoted = [];
  try {
    for (const update of writes) {
      await atomicText(update.target, update.content);
      promoted.push(update);
      if (options["fault-stage"] === "evidence-write" && update.path === memory.path) {
        throw new Error("故障注入：经历文章写入后、AI 证据页写入前");
      }
      const written = await readText(update.target, "");
      if (sha256(written) !== sha256(update.content)) {
        throw new Error(`${update.path} 写入后回读不一致`);
      }
    }
    if (options["fault-stage"] === "documents-written-crash") {
      process.exit(86);
    }
  } catch (error) {
    let rollbackError;
    for (const update of promoted.reverse()) {
      try {
        if (update.existing) {
          await atomicText(update.target, update.existing);
        } else {
          await unlink(update.target).catch(() => undefined);
        }
      } catch (currentError) {
        rollbackError = rollbackError || currentError;
      }
    }
    if (!rollbackError) {
      const paths = new Set(journalEntries.map((entry) => entry.path));
      journal.files = journal.files.filter((entry) => !paths.has(entry.path));
      await atomicJson(journal.path, journal);
    }
    if (rollbackError) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}；自动回滚未完成，将在下次运行前继续恢复`);
    }
    throw error;
  }
}

function validateWriteIntent(update, existing, content, label) {
  const action = update.action === "created" ? "created" : update.action === "updated" ? "updated" : "";
  const expected = String(update.expected_sha256 || "");
  if (!action) {
    throw new Error(`${label}缺少 created 或 updated 动作`);
  }
  if (action === "created" && existing && sha256(existing) !== sha256(content)) {
    throw new Error(`${label}声明为新增，但目标文件已经存在`);
  }
  if (action === "updated" && !existing) {
    throw new Error(`${label}声明为更新，但目标文件不存在`);
  }
  if (action === "updated" && !expected) {
    throw new Error(`${label}更新缺少写前 SHA256`);
  }
}

function isSemanticOutcome(outcome) {
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) {
    return false;
  }
  if (outcome.evidence_document || outcome.memory_document) {
    return true;
  }
  return (outcome.status === "pending" || outcome.status === "not-applicable") &&
    !Array.isArray(outcome.source_event_ids);
}

function validateEvidenceContent(content, pairs, dailyPaths, existing, memoryPath) {
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
  if (!title) {
    throw new Error("AI 证据页缺少标题");
  }
  const wikiId = frontmatterValue(content, "zhixing_wiki_id");
  const existingWikiId = frontmatterValue(existing, "zhixing_wiki_id");
  if (!wikiId || (existing && (!existingWikiId || existingWikiId !== wikiId))) {
    throw new Error("AI 证据页缺少稳定 ID，或试图改写非托管页面");
  }
  if (frontmatterValue(content, "zhixing_document") !== "evidence") {
    throw new Error("AI 证据页缺少 zhixing_document: evidence 托管边界");
  }
  if (!hasMarkdownLink(content, memoryPath)) {
    throw new Error("AI 证据页没有链接对应的经历文章");
  }
  if (!hasProjects(content)) {
    throw new Error("AI 证据页缺少 projects");
  }
  for (const heading of REQUIRED_HEADINGS) {
    if (!new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m").test(content)) {
      throw new Error(`AI 证据页缺少“${heading}”章节`);
    }
  }
  for (const pair of pairs) {
    if (!pair.source_event_ids.every((id) => content.includes(id))) {
      throw new Error("AI 证据页缺少稳定的原始事件来源标记");
    }
  }
  const currentEventIds = uniqueStrings(pairs.flatMap((pair) => pair.source_event_ids));
  const existingEventIds = extractEventIds(existing);
  const expectedEventIds = uniqueStrings([...existingEventIds, ...currentEventIds]);
  const referencedEventIds = uniqueStrings([...content.matchAll(
    /[^\s"'`]+:(?:UserPromptSubmit|Stop):[0-9a-f]{64}/gi
  )].map((match) => match[0]));
  if (!sameStringSet(referencedEventIds, expectedEventIds)) {
    throw new Error("AI 证据页的原始事件来源与合同主题不完全一致");
  }
  for (const dailyPath of dailyPaths) {
    if (!content.includes(dailyPath) && !content.includes(path.basename(dailyPath, ".md"))) {
      throw new Error(`AI 证据页缺少每日来源链接：${dailyPath}`);
    }
  }
  if (!/^last_verified:\s*\d{4}-\d{2}-\d{2}\s*$/m.test(content) ||
      !/^trust:\s*(?:verified|observed|inferred)\s*$/m.test(content)) {
    throw new Error("AI 证据页 frontmatter 缺少最后验证日期或可信状态");
  }
}

function validateMemoryContent(content, digest, evidencePaths, existing) {
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
  if (!title || /#\d+|\b[A-Za-z]+[a-z][A-Z][A-Za-z]*\b/.test(title)) {
    throw new Error("经历文章标题必须是自然中文，不能直接使用 Issue 编号或代码类名");
  }
  if (!frontmatterValue(content, "zhixing_memory_id") ||
      frontmatterValue(content, "zhixing_document") !== "memory" ||
      !/^last_reviewed:\s*\d{4}-\d{2}-\d{2}\s*$/m.test(frontmatter(content))) {
    throw new Error("经历文章 frontmatter 缺少稳定 ID、文档类型或最后整理日期");
  }
  if (!hasProjects(content)) {
    throw new Error("经历文章缺少 projects");
  }
  const memoryId = frontmatterValue(content, "zhixing_memory_id");
  const existingMemoryId = frontmatterValue(existing, "zhixing_memory_id");
  if (existing && (!existingMemoryId || existingMemoryId !== memoryId)) {
    throw new Error("经历文章试图改写非托管页面或改变稳定 ID");
  }
  for (const heading of MEMORY_HEADINGS) {
    const section = sectionContent(content, heading);
    if (section.replace(/\s+/g, "").length < (heading === "需要追溯时" ? 12 : 40)) {
      throw new Error(`经历文章的“${heading}”没有讲清楚`);
    }
    if (heading !== "需要追溯时" && !section.split(/\r?\n/)
      .some((line) => line.trim().length >= 40 && !/^[-*+\d]/.test(line.trim()))) {
      throw new Error(`经历文章的“${heading}”至少需要一个自然段，不能只列清单`);
    }
  }
  if (content.length < 650 || content.length > 8_000) {
    throw new Error("经历文章应为 650 至 8000 字符，完整讲清事情但不堆砌原始日志");
  }
  if (!/^>\s*\*\*发生时间\*\*[：:]\s*\d{4}-\d{2}-\d{2}/m.test(content)) {
    throw new Error("经历文章标题下必须显示发生时间，帮助本人恢复当时的时间背景");
  }
  for (const [headings, value] of [
    ["当时我想做什么", digest.about],
    ["我遇到了什么", digest.problem],
    [["我最后做了什么", "这次留下了什么"], digest.result],
    ["下次遇到时", digest.next_use]
  ]) {
    const candidates = Array.isArray(headings) ? headings : [headings];
    if (!candidates.some((heading) => sectionContent(content, heading).includes(value))) {
      throw new Error(`经历文章的“${candidates.join("”或“")}”缺少与回执一致的核心回忆`);
    }
  }
  for (const evidencePath of evidencePaths) {
    if (!hasMarkdownLink(content, evidencePath)) {
      throw new Error(`经历文章没有链接 AI 证据页：${evidencePath}`);
    }
  }
  const mainContent = MEMORY_HEADINGS
    .filter((heading) => heading !== "需要追溯时")
    .map((heading) => sectionContent(content, heading))
    .join("\n");
  if (/```|(?:UserPromptSubmit|Stop):[0-9a-f]{32,}/i.test(mainContent)) {
    throw new Error("经历文章正文不能包含代码块或原始事件 ID");
  }
  const codeLike = mainContent.match(/\b[A-Za-z]+[a-z][A-Z][A-Za-z]*\b|`[^`]+`/g) || [];
  if (codeLike.length > 6) {
    throw new Error("经历文章正文包含过多代码标识，应把技术细节移到 AI 证据页");
  }
  if (/闭环|收口|纵切片|权威状态|漂移重校验|自证授权|技术边界/u.test(mainContent)) {
    throw new Error("经历文章正文仍包含没有解释的人机内部术语");
  }
}

function extractEventIds(content) {
  return uniqueStrings([...String(content || "").matchAll(
    /[^\s"'`]+:(?:UserPromptSubmit|Stop):[0-9a-f]{64}/gi
  )].map((match) => match[0]));
}

function frontmatterValue(content, key) {
  return frontmatter(content).match(new RegExp(`^${escapeRegExp(key)}:\\s*([^\\r\\n]+)\\s*$`, "m"))?.[1]?.trim() || "";
}

function frontmatter(content) {
  return String(content || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)?.[1] || "";
}

function hasProjects(content) {
  const metadata = frontmatter(content);
  return /^projects:\s*\[[^\]]+\]\s*$/m.test(metadata) ||
    /^projects:\s*$\r?\n(?:\s+-\s+\S+\s*(?:\r?\n|$))+/m.test(metadata);
}

function hasMarkdownLink(content, targetPath) {
  const expected = linkCandidates(targetPath);
  const wikiLinks = [...String(content || "").matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)]
    .map((match) => normalizeLinkTarget(match[1]));
  const markdownLinks = [...String(content || "").matchAll(/\[[^\]]+]\(([^)]+)\)/g)]
    .map((match) => normalizeLinkTarget(match[1]));
  return [...wikiLinks, ...markdownLinks].some((candidate) =>
    expected.has(candidate) || expected.has(path.posix.basename(candidate)));
}

function linkCandidates(targetPath) {
  const normalized = normalizeLinkTarget(targetPath);
  return new Set([
    normalized,
    normalized.replace(/^wiki\//i, ""),
    path.posix.basename(normalized)
  ].filter(Boolean));
}

function normalizeLinkTarget(value) {
  let normalized = String(value || "").trim().replace(/\\/g, "/");
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
  }
  return normalized
    .replace(/^<|>$/g, "")
    .replace(/[?#].*$/, "")
    .replace(/\.md$/i, "")
    .replace(/^\.?\//, "")
    .replace(/^(\.\.\/)+/, "")
    .replace(/^\/+/, "");
}

function validateOutcomePathClaims(outcomes) {
  const claims = new Map();
  for (const outcome of outcomes || []) {
    if (outcome?.status !== "succeeded") {
      continue;
    }
    const memoryPath = String(outcome.memory_update?.path || "").replace(/\\/g, "/");
    const evidencePaths = (outcome.wiki_updates || []).map((item) => String(item.path || "").replace(/\\/g, "/"));
    if (memoryPath && !memoryPath.startsWith("wiki/我的经历/")) {
      throw new Error("经历文章必须位于 wiki/我的经历/");
    }
    if (/^wiki\/我的经历\/项目\//i.test(memoryPath)) {
      throw new Error("经历文章必须进入真实项目或主题目录，不能使用泛化的“项目”目录");
    }
    if (evidencePaths.some((item) => item.startsWith("wiki/我的经历/"))) {
      throw new Error("AI 证据页不能写入 wiki/我的经历/");
    }
    for (const claimedPath of [memoryPath, ...evidencePaths].filter(Boolean)) {
      if (claims.has(claimedPath)) {
        throw new Error(`整理回执包含重复写入路径：${claimedPath}`);
      }
      claims.set(claimedPath, outcome.id);
    }
  }
}

function validateExistingKnowledgeReuse(topic, outcome) {
  const existing = topic.existing_knowledge?.documents || [];
  const memory = existing.find((document) => document.role === "memory" && document.managed);
  if (memory && outcome.memory_update?.path !== memory.path) {
    throw new Error("同一主题已经有经历文章，必须更新原页面，不能重复新建");
  }
  const managedEvidence = existing
    .filter((document) => document.role === "evidence" && document.managed)
    .map((document) => document.path);
  const returnedEvidence = new Set((outcome.wiki_updates || []).map((update) => update.path));
  for (const evidencePath of managedEvidence) {
    if (!returnedEvidence.has(evidencePath)) {
      throw new Error(`同一主题已有 AI 证据页必须继续更新：${evidencePath}`);
    }
  }
}

async function assertStableIdUnique(vaultRoot, key, id, target) {
  if (!id) {
    return;
  }
  const wikiRoot = path.join(vaultRoot, "wiki");
  for (const candidate of await markdownFiles(wikiRoot)) {
    if (path.resolve(candidate) === path.resolve(target)) {
      continue;
    }
    const content = await readText(candidate, "");
    if (frontmatterValue(content, key) === id) {
      throw new Error(`${key} 已被其他页面使用：${relativeVaultPath(vaultRoot, candidate)}`);
    }
  }
}

async function markdownFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await markdownFiles(target));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(target);
    }
  }
  return files;
}

function sectionContent(content, heading) {
  return content.match(new RegExp(
    `^##\\s+${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`,
    "m"
  ))?.[1]?.trim() || "";
}

function validateDigest(value) {
  if (!value || typeof value !== "object") {
    throw new Error("已沉淀结果缺少“一眼看懂”摘要");
  }
  for (const [key, label] of [
    ["about", "这是什么"],
    ["problem", "解决了什么"],
    ["result", "得到什么"],
    ["next_use", "以后怎么用"]
  ]) {
    const text = String(value[key] || "").replace(/\s+/g, " ").trim();
    if (text.length < 18 || text.length > 320) {
      throw new Error(`“一眼看懂”的“${label}”必须是 18 至 320 字的具体说明`);
    }
    if (/^(?:这|该)?(?:是|次)?(?:一个|一项)?(?:值得)?(?:沉淀|整理|总结|记录)?(?:的)?(?:问题|经验|内容|方案|闭环|结果)[。.]?$/u.test(text) ||
        /^(?:已|已经)?(?:完成|形成)(?:了)?(?:闭环|验证|方案|处理|整理|总结)[。.]?$/u.test(text)) {
      throw new Error(`“一眼看懂”的“${label}”过于空泛，必须写明对象和具体结果`);
    }
    if (key === "about" && /^这篇(?:整理|记录|文章)/u.test(text)) {
      throw new Error("“一眼看懂”的“这是什么”必须直接回忆当时的目标，不能使用“这篇整理”式旁白");
    }
    if (/闭环|收口|纵切片|权威状态|漂移重校验|自证授权|技术边界/u.test(text)) {
      throw new Error(`“一眼看懂”的“${label}”仍包含内部术语，必须改写成人能直接理解的场景和行动`);
    }
  }
}

async function ensureDailySource(vaultRoot, pair, compact = false) {
  const target = safeVaultPath(vaultRoot, pair.daily_path, "raw/");
  const existing = await readText(target, "");
  const marker = sourceMarker(pair);
  if (existing.includes(marker)) {
    return;
  }
  const sourceName = pair.source === "chatgpt_web" ? "ChatGPT" : pair.source === "feishu" ? "飞书" : "Codex";
  const heading = existing ? "" : `# ${sourceName} ${pair.source === "feishu" ? "活动" : "原始问答"} - ${pair.date}\n\n`;
  const title = pair.source === "chatgpt_web" ? pair.title || "未命名对话" :
    pair.source === "feishu" ? pair.title || "未命名飞书记录" : pair.cwd || "未记录工作目录";
  const isAutomation = /^\s*(?:<heartbeat>|Automation(?: ID)?\s*:|\[no-obsidian\])/i
    .test(String(pair.prompt_content || ""));
  const block = pair.source === "feishu" ? [
    heading,
    `## ${sanitizeHeading(title)}`,
    marker,
    "",
    `- 来源：飞书 · ${feishuResourceLabel(pair.resource_type)}`,
    `- 访问状态：${pair.access_status === "available" ? "可访问" : "来源状态已变化"}`,
    "",
    quote(pair.stop_content),
    pair.url ? `\n[打开飞书来源](${pair.url})` : "",
    ""
  ].join("\n") : compact || isAutomation ? [
    heading,
    `## 自动化记录：${sanitizeHeading(automationDisplayName(pair))}`,
    marker,
    "",
    "### 结果",
    quote(String(pair.stop_content || "").slice(0, 2_000)),
    ""
  ].join("\n") : [
    heading,
    `## ${sanitizeHeading(title)}`,
    marker,
    "",
    "### 问题",
    quote(pair.prompt_content),
    "",
    "### 回答",
    quote(pair.stop_content),
    ""
  ].join("\n");
  await atomicText(target, existing + (existing && !existing.endsWith("\n") ? "\n" : "") + block);
}

function removeSupersededSettlements(settlements, sourceIds, keepId) {
  const sourceSet = new Set(sourceIds);
  for (const [id, settlement] of settlements) {
    if (id === keepId || (settlement.status !== "pending" && settlement.status !== "failed")) {
      continue;
    }
    if ((settlement.source_event_ids || []).some((sourceId) => sourceSet.has(sourceId))) {
      settlements.delete(id);
    }
  }
}

function sameStringSet(left, right) {
  const leftSet = new Set(uniqueStrings(left));
  const rightSet = new Set(uniqueStrings(right));
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

function systemOutcomeTitle(outcome, pairs) {
  if (outcome.category === "supporting-session") {
    return `辅助 Agent 证据 · ${pairs.at(-1)?.date || "未标日期"}`;
  }
  return `${automationDisplayName(pairs.at(-1))} · ${pairs.at(-1)?.date || "未标日期"}`;
}

function automationDisplayName(pair) {
  const text = `${pair?.prompt_content || ""}\n${pair?.stop_content || ""}`;
  if (/AI\s*HOT|每日早报|早报已送达/i.test(text)) {
    return "AI 日报";
  }
  if (/工作日志|日志\s*ID|日志ID|记录\s*rec[a-z0-9]+/i.test(text)) {
    return "飞书工作日报";
  }
  if (/反馈|工单|feedback:inbox/i.test(text)) {
    return "平台反馈";
  }
  return "例行自动化";
}

function projectLabelFromPairs(pairs) {
  const pair = pairs.at(-1);
  if (!pair) {
    return "未归属";
  }
  if (pair.source === "chatgpt_web") {
    return "ChatGPT";
  }
  if (pair.source === "feishu") {
    return String(pair.cwd || "飞书");
  }
  return String(pair.cwd || "").replace(/\\/g, "/").split("/").filter(Boolean).at(-1) || "自动化";
}

function feishuResourceLabel(value) {
  return ({
    tasks: "任务",
    calendar: "日程",
    meetings: "会议",
    minutes: "会议纪要",
    documents: "文档与 Wiki",
    base: "Base",
    approvals: "审批",
    messages: "项目群消息"
  })[value] || "记录";
}

async function loadSessionIndex(configuredPath) {
  const codexHome = process.env.CODEX_HOME || path.join(homedir(), ".codex");
  const target = path.resolve(configuredPath || path.join(codexHome, "session_index.jsonl"));
  try {
    return {
      available: true,
      titles: parseSessionIndex(await readFile(target, "utf8"))
    };
  } catch {
    return { available: false, titles: new Map() };
  }
}

async function readEvents(vaultRoot) {
  const records = [];
  for (const relative of ["raw/codex/events", "raw/chatgpt/events", "raw/feishu/events"]) {
    const directory = path.join(vaultRoot, ...relative.split("/"));
    let names = [];
    try {
      names = (await readdir(directory)).filter((name) => name.endsWith(".jsonl")).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const lines = (await readFile(path.join(directory, name), "utf8")).split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index]?.trim()) {
          continue;
        }
        try {
          records.push(JSON.parse(lines[index]));
        } catch {
          if (index !== lines.length - 1) {
            throw new Error(`${relative}/${name}:${index + 1} 不是有效 JSONL`);
          }
        }
      }
    }
  }
  return records;
}

export function pairRecords(records) {
  const feishuPairs = records
    .filter((record) => record.source === "feishu" && record.event_id && record.resource_type && record.resource_id)
    .map((record) => {
      const date = record.date || String(record.occurred_at || record.captured_at).slice(0, 10);
      return {
        id: sha256(`feishu\0${record.event_id}`).slice(0, 24),
        source: "feishu",
        date,
        session_id: record.session_id || `feishu:${record.resource_type}:${record.resource_id}`,
        turn_id: record.turn_id || sha256(String(record.resource_version || record.event_id)).slice(0, 20),
        conversation_id: "",
        source_event_ids: [record.event_id],
        daily_path: `raw/feishu/daily/${date}.md`,
        captured_at: record.occurred_at || record.captured_at,
        cwd: record.project_hint || record.cwd || "飞书",
        title: record.title || "飞书记录",
        url: record.resource_url || "",
        resource_type: record.resource_type,
        resource_id: record.resource_id,
        resource_version: record.resource_version || "",
        access_status: record.access_status || "available",
        prompt_content: `飞书${feishuResourceLabel(record.resource_type)}：${record.title || "未命名记录"}\n状态：${record.resource_status || "已记录"}`,
        stop_content: record.content || "该来源只保留了状态与追溯信息。"
      };
    });
  const grouped = new Map();
  for (const record of records) {
    if (record.source === "feishu") {
      continue;
    }
    if (!record.session_id || !record.turn_id || !record.event_id) {
      continue;
    }
    const key = `${record.source}|${record.session_id}|${record.turn_id}`;
    const pair = grouped.get(key) || { prompt: undefined, stop: undefined };
    if (record.event === "UserPromptSubmit" && !pair.prompt) {
      pair.prompt = record;
    } else if (record.event === "Stop") {
      pair.stop = record;
    }
    grouped.set(key, pair);
  }
  const conversationPairs = [...grouped.values()].filter((item) => item.prompt && item.stop).map(({ prompt, stop }) => {
    const source = prompt.source || "codex";
    const date = prompt.date || String(prompt.captured_at).slice(0, 10);
    return {
      id: sha256(`${source}\0${prompt.event_id}\0${stop.event_id}`).slice(0, 24),
      source,
      date,
      session_id: prompt.session_id,
      turn_id: prompt.turn_id,
      conversation_id: prompt.conversation_id || "",
      source_event_ids: [prompt.event_id, stop.event_id],
      daily_path: `raw/${source === "chatgpt_web" ? "chatgpt" : "codex"}/daily/${date}.md`,
      captured_at: prompt.captured_at,
      cwd: prompt.cwd || "",
      title: prompt.title || "",
      url: prompt.url || "",
      prompt_content: prompt.content || "",
      stop_content: stop.content || ""
    };
  });
  return [...conversationPairs, ...feishuPairs]
    .sort((left, right) => left.captured_at.localeCompare(right.captured_at));
}

function sourceMarker(pair) {
  if (pair.source === "feishu") {
    return `<!-- feishu-record:event=${pair.source_event_ids[0]} -->`;
  }
  const prefix = pair.source === "chatgpt_web" ? "chatgpt-qna" : "codex-qna";
  return `<!-- ${prefix}:prompt=${pair.source_event_ids[0]};stop=${pair.source_event_ids[1]} -->`;
}

async function writeStatus(vaultRoot, runId, status, error, counts = {}) {
  await atomicJson(path.join(vaultRoot, "raw", "codex", "ingest-status.json"), {
    schema_version: 3,
    run_id: runId,
    status,
    ...counts,
    error,
    updated_at: new Date().toISOString()
  });
}

async function writeRunHistory(vaultRoot, contract, status, error, counts, topicResults) {
  const relative = contract.history_path ||
    `raw/codex/ingest-history/${contract.run_id}.json`;
  const target = safeVaultPath(vaultRoot, relative, "raw/codex/ingest-history/");
  const existing = await readJson(target, {
    schema_version: 1,
    run_id: contract.run_id,
    started_at: contract.generated_at,
    trigger: contract.trigger || "manual",
    attempts: []
  });
  const finishedAt = new Date().toISOString();
  const attemptPayload = {
    status,
    error,
    counts,
    topic_results: topicResults
  };
  const attemptId = `attempt:${sha256(JSON.stringify(attemptPayload)).slice(0, 20)}`;
  const attempts = Array.isArray(existing.attempts)
    ? existing.attempts.filter((attempt) => attempt?.id !== attemptId)
    : [];
  attempts.push({
    id: attemptId,
    finished_at: finishedAt,
    status,
    error,
    committed: counts.committed,
    skipped: counts.skipped,
    pending: counts.pending,
    failed: counts.failed
  });
  await atomicJson(target, {
    ...existing,
    schema_version: 1,
    run_id: contract.run_id,
    started_at: existing.started_at || contract.generated_at,
    finished_at: finishedAt,
    status,
    trigger: contract.trigger || existing.trigger || "manual",
    cycle_id: contract.cycle_id || existing.cycle_id,
    batch_index: contract.batch_index || existing.batch_index,
    log_path: contract.log_path || existing.log_path,
    ...counts,
    error,
    topic_results: topicResults,
    attempts
  });
}

function safeVaultPath(vaultRoot, relative, requiredPrefix) {
  const normalized = String(relative || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.startsWith(requiredPrefix) || normalized.includes("..") || path.isAbsolute(normalized)) {
    throw new Error(`路径超出允许范围：${relative}`);
  }
  const target = path.resolve(vaultRoot, ...normalized.split("/"));
  const relativeTarget = path.relative(vaultRoot, target);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    throw new Error(`路径超出 Vault：${relative}`);
  }
  return target;
}

function optionalVaultPath(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.startsWith("raw/codex/automation/") &&
    !normalized.includes("..") &&
    !path.isAbsolute(normalized)
    ? normalized
    : undefined;
}

function optionalIdentifier(value) {
  const identifier = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9._:-]{1,120}$/.test(identifier) ? identifier : undefined;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function nonnegativeInteger(value) {
  const parsed = Number.parseInt(String(value || "0").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function relativeVaultPath(vaultRoot, target) {
  return path.relative(vaultRoot, target).replace(/\\/g, "/");
}

async function atomicJson(target, value) {
  await atomicText(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function atomicText(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  try {
    await rename(temporary, target);
  } catch (firstError) {
    const backup = `${target}.${process.pid}.${randomUUID()}.bak`;
    let movedExisting = false;
    try {
      await rename(target, backup);
      movedExisting = true;
      await rename(temporary, target);
      await unlink(backup).catch(() => undefined);
    } catch (secondError) {
      if (movedExisting) {
        await rename(backup, target).catch(() => undefined);
      }
      await unlink(temporary).catch(() => undefined);
      throw secondError || firstError;
    }
  }
}

async function startKnowledgeJournal(vaultRoot, runId, baselines) {
  const target = path.join(vaultRoot, "raw", "codex", "staging", "knowledge-write-journal.json");
  const journal = {
    schema_version: 1,
    run_id: runId,
    created_at: new Date().toISOString(),
    baselines: baselines.map((entry) => ({
      path: relativeVaultPath(vaultRoot, entry.target),
      existed: Boolean(entry.content),
      original_base64: Buffer.from(entry.content, "utf8").toString("base64")
    })),
    files: [],
    path: target
  };
  await atomicJson(target, { ...journal, path: undefined });
  return journal;
}

async function finishKnowledgeJournal(journal) {
  await unlink(journal.path).catch((error) => {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  });
}

async function recoverKnowledgeJournal(vaultRoot) {
  const target = path.join(vaultRoot, "raw", "codex", "staging", "knowledge-write-journal.json");
  const text = await readText(target, "");
  if (!text) {
    return;
  }
  const stored = JSON.parse(text);
  const entries = [...(stored.files || []), ...(stored.baselines || [])].reverse();
  const restored = new Set();
  for (const entry of entries) {
    if (!entry?.path || restored.has(entry.path)) {
      continue;
    }
    const destination = safeVaultPath(vaultRoot, entry.path, entry.path.startsWith("wiki/") ? "wiki/" : "raw/codex/");
    if (entry.existed) {
      await atomicText(destination, Buffer.from(String(entry.original_base64 || ""), "base64").toString("utf8"));
    } else {
      await unlink(destination).catch((error) => {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      });
    }
    restored.add(entry.path);
  }
  await unlink(target);
}

async function readJson(target, fallback) {
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if (fallback !== undefined && error && error.code === "ENOENT") {
      return fallback;
    }
    if (fallback !== undefined && !await exists(target)) {
      return fallback;
    }
    throw error;
  }
}

async function readText(target, fallback) {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function quote(value) {
  return String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((line) => `> ${line}`).join("\n");
}

function sanitizeHeading(value) {
  return String(value || "未命名").replace(/[\r\n]+/g, " ").replace(/[#*_[\]`]/g, "").trim() || "未命名";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value.trim()))];
}

function uniqueObjects(values, key) {
  const seen = new Set();
  return values.filter((value) => {
    const itemKey = key(value);
    if (seen.has(itemKey)) {
      return false;
    }
    seen.add(itemKey);
    return true;
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(values) {
  const result = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}
