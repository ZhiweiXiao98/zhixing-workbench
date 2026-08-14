import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const script = path.resolve("..", "runtime", "src", "knowledge-transaction.mjs");
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("knowledge transaction", () => {
  it("Wiki 写入失败时不推进状态，下次成功重试且继续幂等", async () => {
    const vault = await mkdtemp(path.join(os.tmpdir(), "zhixing-transaction-"));
    temporary.push(vault);
    await mkdir(path.join(vault, "raw", "codex", "events"), { recursive: true });
    await writeFile(path.join(vault, "raw", "codex", "ingest-state.json"), JSON.stringify({
      schema_version: 2,
      processed_event_ids: [],
      last_successful_run: "2026-07-23T00:00:00.000Z"
    }), "utf8");
    const promptId = `codex:${"a".repeat(32)}`;
    const stopId = `codex:${"b".repeat(32)}`;
    await writeFile(path.join(vault, "raw", "codex", "events", "2026-07-24.jsonl"), [
      JSON.stringify(record(promptId, "UserPromptSubmit", "接收器停止后无法自动恢复")),
      JSON.stringify(record(stopId, "Stop", "增加健康守护并完成验证"))
    ].join("\n") + "\n", "utf8");

    const prepare = await run(["prepare", "--vault", vault, "--run-id", "fault-run", "--since", "2026-07-20", "--backfill-unsettled"]);
    expect(JSON.parse(prepare.stdout).pair_count).toBe(1);
    expect(JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-history", "fault-run.json"),
      "utf8"
    ))).toMatchObject({ status: "running", trigger: "manual", attempts: [] });
    const contract = JSON.parse(await readFile(path.join(vault, "raw", "codex", "ingest-run-contract.json"), "utf8"));
    const resultPath = path.join(vault, ...contract.result_path.split("/"));
    await mkdir(path.dirname(resultPath), { recursive: true });
    await writeFile(resultPath, JSON.stringify(result("fault-run", contract.topics[0].id, promptId, stopId)), "utf8");

    const before = await readFile(path.join(vault, "raw", "codex", "ingest-state.json"), "utf8");
    await expect(run(["commit", "--vault", vault, "--run-id", "fault-run", "--fault-stage", "wiki-write"])).rejects.toMatchObject({
      code: 2
    });
    const afterFailure = await readFile(path.join(vault, "raw", "codex", "ingest-state.json"), "utf8");
    expect(hash(afterFailure)).toBe(hash(before));
    expect(JSON.parse(await readFile(path.join(vault, "raw", "codex", "ingest-status.json"), "utf8")).status).toBe("failed");
    expect(JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-history", "fault-run.json"),
      "utf8"
    ))).toMatchObject({
      status: "failed",
      failed: 1,
      attempts: [{ status: "failed" }],
      topic_results: [{ status: "failed" }]
    });

    const retry = await run([
      "prepare", "--vault", vault, "--run-id", "retry-run", "--since", "2026-07-20",
      "--backfill-unsettled", "--retry-backoff-hours", "0"
    ]);
    expect(JSON.parse(retry.stdout).pair_count).toBe(1);
    const retryContract = JSON.parse(await readFile(path.join(vault, "raw", "codex", "ingest-run-contract.json"), "utf8"));
    const retryPath = path.join(vault, ...retryContract.result_path.split("/"));
    await mkdir(path.dirname(retryPath), { recursive: true });
    await writeFile(retryPath, JSON.stringify(result("retry-run", retryContract.topics[0].id, promptId, stopId)), "utf8");
    await run(["commit", "--vault", vault, "--run-id", "retry-run"]);
    expect(JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-history", "retry-run.json"),
      "utf8"
    ))).toMatchObject({
      status: "succeeded",
      committed: 1,
      remaining_topics: 0,
      topic_results: [{
        status: "succeeded",
        wiki_paths: [
          "wiki/我的经历/Obsidian/网页对话为什么突然不再进入知识库.md",
          "wiki/Obsidian/接收器恢复.md"
        ],
        memory_path: "wiki/我的经历/Obsidian/网页对话为什么突然不再进入知识库.md",
        evidence_paths: ["wiki/Obsidian/接收器恢复.md"]
      }]
    });

    const state = JSON.parse(await readFile(path.join(vault, "raw", "codex", "ingest-state.json"), "utf8"));
    expect(state.processed_event_ids).toEqual([promptId, stopId].sort());
    const wikiPath = path.join(vault, "wiki", "Obsidian", "接收器恢复.md");
    const wikiHash = hash(await readFile(wikiPath, "utf8"));
    const dailyPath = path.join(vault, "raw", "codex", "daily", "2026-07-24.md");
    const daily = await readFile(dailyPath, "utf8");
    expect(daily.match(/codex-qna:prompt=/g)).toHaveLength(1);
    const finalized = JSON.parse((await run([
      "fail",
      "--vault", vault,
      "--run-id", "retry-run",
      "--stage", "write-log",
      "--error", "日志文件被占用"
    ])).stdout);
    expect(finalized.final_status).toBe("succeeded");
    expect(JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-history", "retry-run.json"),
      "utf8"
    )).status).toBe("succeeded");

    const third = await run(["prepare", "--vault", vault, "--run-id", "third-run", "--since", "2026-07-20", "--backfill-unsettled"]);
    expect(JSON.parse(third.stdout).pair_count).toBe(0);
    expect(hash(await readFile(wikiPath, "utf8"))).toBe(wikiHash);
  });

  it("system-only 会归档空跑心跳，重复运行不新增 settlement", async () => {
    const vault = await mkdtemp(path.join(os.tmpdir(), "zhixing-system-"));
    temporary.push(vault);
    await mkdir(path.join(vault, "raw", "codex", "events"), { recursive: true });
    await writeFile(path.join(vault, "raw", "codex", "events", "2026-07-24.jsonl"), [
      JSON.stringify(record("heartbeat:prompt", "UserPromptSubmit", "<heartbeat>检查反馈</heartbeat>")),
      JSON.stringify(record("heartbeat:stop", "Stop", "反馈收件箱为空，本轮无新增处理结果"))
    ].join("\n") + "\n", "utf8");

    const prepared = JSON.parse((await run([
      "prepare", "--vault", vault, "--run-id", "system-run", "--since", "2026-07-20"
    ])).stdout);
    expect(prepared.topic_count).toBe(0);
    expect(prepared.system_pair_count).toBe(1);
    await run(["commit", "--vault", vault, "--run-id", "system-run", "--system-only"]);
    expect(JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-history", "system-run.json"),
      "utf8"
    ))).toMatchObject({
      status: "succeeded",
      system_committed_pairs: 1
    });

    const firstLedger = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "knowledge-settlements.json"),
      "utf8"
    ));
    expect(firstLedger.outcomes).toHaveLength(1);
    const second = JSON.parse((await run([
      "prepare", "--vault", vault, "--run-id", "system-run-2", "--since", "2026-07-20", "--backfill-unsettled"
    ])).stdout);
    expect(second.raw_pending_pairs).toBe(0);
    expect(firstLedger.outcomes[0].category).toBe("no-op-automation");
  });

  it("拒绝只覆盖主题部分事件的语义回执", async () => {
    const vault = await mkdtemp(path.join(os.tmpdir(), "zhixing-coverage-"));
    temporary.push(vault);
    await mkdir(path.join(vault, "raw", "codex", "events"), { recursive: true });
    await writeFile(path.join(vault, "raw", "codex", "events", "2026-07-24.jsonl"), [
      JSON.stringify(record("coverage:prompt", "UserPromptSubmit", "整理接收器恢复经验")),
      JSON.stringify(record("coverage:stop", "Stop", "完成验证"))
    ].join("\n") + "\n", "utf8");
    await run(["prepare", "--vault", vault, "--run-id", "coverage-run", "--since", "2026-07-20"]);
    const contract = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-run-contract.json"),
      "utf8"
    ));
    const resultPath = path.join(vault, ...contract.result_path.split("/"));
    await mkdir(path.dirname(resultPath), { recursive: true });
    await writeFile(resultPath, JSON.stringify({
      schema_version: 3,
      run_id: "coverage-run",
      outcomes: [{
        id: contract.topics[0].id,
        status: "not-applicable",
        source_event_ids: ["coverage:prompt"],
        reason: "测试部分覆盖"
      }]
    }), "utf8");

    await expect(run(["commit", "--vault", vault, "--run-id", "coverage-run"])).rejects.toMatchObject({ code: 2 });
    const ledger = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "knowledge-settlements.json"),
      "utf8"
    ));
    expect(ledger.outcomes[0].status).toBe("failed");
    expect(ledger.outcomes[0].last_error).toContain("不完全一致");
  });

  it("缺少给本人阅读的经历文章时不登记为整理成功", async () => {
    const vault = await createSinglePairVault("missing-memory");
    await run(["prepare", "--vault", vault, "--run-id", "missing-memory-run", "--since", "2026-07-20"]);
    const contract = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-run-contract.json"),
      "utf8"
    ));
    const [promptId, stopId] = contract.topics[0].source_event_ids;
    const payload = result("missing-memory-run", contract.topics[0].id, promptId, stopId);
    delete (payload.outcomes[0] as { memory_update?: unknown }).memory_update;
    const resultPath = path.join(vault, ...contract.result_path.split("/"));
    await mkdir(path.dirname(resultPath), { recursive: true });
    await writeFile(resultPath, JSON.stringify(payload), "utf8");

    await expect(run(["commit", "--vault", vault, "--run-id", "missing-memory-run"]))
      .rejects.toMatchObject({ code: 2 });
    const state = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-state.json"),
      "utf8"
    ));
    expect(state.processed_event_ids).toEqual([]);
    const ledger = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "knowledge-settlements.json"),
      "utf8"
    ));
    expect(ledger.outcomes[0].last_error).toContain("没有面向本人阅读的经历文章");
  });

  it("AI 证据页写入失败时会撤回已经写入的经历文章", async () => {
    const vault = await createSinglePairVault("memory-rollback");
    await run(["prepare", "--vault", vault, "--run-id", "memory-rollback-run", "--since", "2026-07-20"]);
    const contract = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-run-contract.json"),
      "utf8"
    ));
    const [promptId, stopId] = contract.topics[0].source_event_ids;
    const resultPath = path.join(vault, ...contract.result_path.split("/"));
    await mkdir(path.dirname(resultPath), { recursive: true });
    await writeFile(
      resultPath,
      JSON.stringify(result("memory-rollback-run", contract.topics[0].id, promptId, stopId)),
      "utf8"
    );

    await expect(run([
      "commit", "--vault", vault, "--run-id", "memory-rollback-run",
      "--fault-stage", "evidence-write"
    ])).rejects.toMatchObject({ code: 2 });
    await expect(readFile(
      path.join(vault, "wiki", "我的经历", "Obsidian", "网页对话为什么突然不再进入知识库.md"),
      "utf8"
    )).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(
      path.join(vault, "wiki", "Obsidian", "接收器恢复.md"),
      "utf8"
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("文档写完后进程崩溃，下次运行会先按持久日志恢复", async () => {
    const vault = await createSinglePairVault("crash-recovery", true);
    const statePath = path.join(vault, "raw", "codex", "ingest-state.json");
    const beforeState = await readFile(statePath, "utf8");
    await run(["prepare", "--vault", vault, "--run-id", "crash-run", "--since", "2026-07-20"]);
    const contract = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-run-contract.json"),
      "utf8"
    ));
    const [promptId, stopId] = contract.topics[0].source_event_ids;
    const resultPath = path.join(vault, ...contract.result_path.split("/"));
    await mkdir(path.dirname(resultPath), { recursive: true });
    await writeFile(
      resultPath,
      JSON.stringify(result("crash-run", contract.topics[0].id, promptId, stopId)),
      "utf8"
    );

    await expect(run([
      "commit", "--vault", vault, "--run-id", "crash-run",
      "--fault-stage", "documents-written-crash"
    ])).rejects.toMatchObject({ code: 86 });
    expect(await readFile(
      path.join(vault, "wiki", "我的经历", "Obsidian", "网页对话为什么突然不再进入知识库.md"),
      "utf8"
    )).toContain("zhixing_memory_id: receiver-recovery-memory");

    await run(["prepare", "--vault", vault, "--run-id", "after-crash", "--since", "2026-07-20"]);
    await expect(readFile(
      path.join(vault, "wiki", "我的经历", "Obsidian", "网页对话为什么突然不再进入知识库.md"),
      "utf8"
    )).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(
      path.join(vault, "wiki", "Obsidian", "接收器恢复.md"),
      "utf8"
    )).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(statePath, "utf8")).toBe(beforeState);
  });

  it("意外中断会收口为可见失败且不推进处理状态", async () => {
    const vault = await createSinglePairVault("unexpected");
    const before = await readFile(path.join(vault, "raw", "codex", "ingest-state.json"), "utf8");
    await run(["prepare", "--vault", vault, "--run-id", "unexpected-run", "--since", "2026-07-20"]);
    const failed = JSON.parse((await run([
      "fail",
      "--vault", vault,
      "--run-id", "unexpected-run",
      "--stage", "start-codex",
      "--error", "Codex executable unavailable"
    ])).stdout);

    expect(failed.final_status).toBe("failed");
    expect(await readFile(path.join(vault, "raw", "codex", "ingest-state.json"), "utf8")).toBe(before);
    expect(JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-history", "unexpected-run.json"),
      "utf8"
    ))).toMatchObject({
      status: "failed",
      error: "start-codex: Codex executable unavailable",
      topic_results: [{ status: "failed" }]
    });
  });

  it("待沉淀结果以 partial 返回而不是伪装成功", async () => {
    const vault = await createSinglePairVault("partial");
    await run(["prepare", "--vault", vault, "--run-id", "partial-run", "--since", "2026-07-20"]);
    const contract = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-run-contract.json"),
      "utf8"
    ));
    const resultPath = path.join(vault, ...contract.result_path.split("/"));
    await mkdir(path.dirname(resultPath), { recursive: true });
    await writeFile(resultPath, JSON.stringify({
      schema_version: 3,
      run_id: "partial-run",
      outcomes: [{
        id: contract.topics[0].id,
        status: "pending",
        source_event_ids: contract.topics[0].source_event_ids,
        reason: "现有证据不足以判断根因"
      }]
    }), "utf8");

    const committed = JSON.parse((await run([
      "commit", "--vault", vault, "--run-id", "partial-run"
    ])).stdout);
    expect(committed.final_status).toBe("partial");
    expect(JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-history", "partial-run.json"),
      "utf8"
    ))).toMatchObject({ status: "partial", pending: 1 });
  });

  it("纯语义回执由确定性程序生成双层 Markdown", async () => {
    const vault = await createSinglePairVault("semantic", true);
    await run(["prepare", "--vault", vault, "--run-id", "semantic-run", "--since", "2026-07-20"]);
    const contract = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-run-contract.json"),
      "utf8"
    ));
    const resultPath = path.join(vault, ...contract.result_path.split("/"));
    await mkdir(path.dirname(resultPath), { recursive: true });
    await writeFile(resultPath, JSON.stringify(semanticResult(
      "semantic-run",
      contract.topics[0].id
    )), "utf8");

    const committed = JSON.parse((await run([
      "commit", "--vault", vault, "--run-id", "semantic-run",
      "--tokens-used", "12345", "--input-chars", "800", "--duration-ms", "1200"
    ])).stdout);
    expect(committed).toMatchObject({
      final_status: "succeeded",
      tokens_used: 12345,
      input_chars: 800,
      duration_ms: 1200
    });
    const history = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-history", "semantic-run.json"),
      "utf8"
    ));
    expect(history).toMatchObject({
      tokens_used: 12345,
      topic_results: [{
        status: "succeeded",
        memory_path: "wiki/我的经历/project/知识为什么没有按预期整理.md",
        evidence_paths: ["wiki/project/知识整理异常的判断与恢复.md"]
      }]
    });
    expect(await readFile(
      path.join(vault, "wiki", "我的经历", "project", "知识为什么没有按预期整理.md"),
      "utf8"
    )).toContain("<!-- zhixing-semantic:start:goal -->");
  });

  it("已成功主题的新证据待沉淀时保留旧 Wiki，并只让增量等待重试", async () => {
    const vault = await createSinglePairVault("reopened", true);
    await run(["prepare", "--vault", vault, "--run-id", "reopened-first", "--since", "2026-07-20"]);
    let contract = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-run-contract.json"),
      "utf8"
    ));
    let resultPath = path.join(vault, ...contract.result_path.split("/"));
    await mkdir(path.dirname(resultPath), { recursive: true });
    await writeFile(resultPath, JSON.stringify(semanticResult(
      "reopened-first",
      contract.topics[0].id
    )), "utf8");
    await run(["commit", "--vault", vault, "--run-id", "reopened-first"]);

    const eventPath = path.join(vault, "raw", "codex", "events", "2026-07-24.jsonl");
    const deltaPrompt = `reopened:delta:UserPromptSubmit:${"e".repeat(64)}`;
    const deltaStop = `reopened:delta:Stop:${"f".repeat(64)}`;
    await writeFile(eventPath, [
      JSON.stringify(record(deltaPrompt, "UserPromptSubmit", "继续", "delta-turn")),
      JSON.stringify(record(deltaStop, "Stop", "补充信息仍不足", "delta-turn"))
    ].join("\n") + "\n", { encoding: "utf8", flag: "a" });

    await run([
      "prepare", "--vault", vault, "--run-id", "reopened-pending", "--since", "2026-07-20",
      "--backfill-unsettled", "--retry-backoff-hours", "0"
    ]);
    contract = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-run-contract.json"),
      "utf8"
    ));
    expect(contract.pairs).toHaveLength(1);
    expect(contract.topics[0].source_event_ids).toEqual([deltaPrompt, deltaStop]);
    resultPath = path.join(vault, ...contract.result_path.split("/"));
    await writeFile(resultPath, JSON.stringify({
      schema_version: 4,
      run_id: "reopened-pending",
      outcomes: [{
        id: contract.topics[0].id,
        status: "pending",
        reason: "还没有足够证据说明新增信息改变了原来的结论"
      }]
    }), "utf8");
    await run(["commit", "--vault", vault, "--run-id", "reopened-pending"]);

    const ledger = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "knowledge-settlements.json"),
      "utf8"
    ));
    expect(ledger.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: contract.topics[0].id, status: "succeeded" }),
      expect.objectContaining({ status: "pending", source_event_ids: [deltaPrompt, deltaStop] })
    ]));
    const state = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-state.json"),
      "utf8"
    ));
    expect(state.processed_event_ids).not.toContain(deltaPrompt);
  });

  it.each(["pending", "failed"] as const)(
    "切片主题返回 %s 时剩余主题按真实主题去重",
    async (status) => {
      const vault = await createSinglePairVault(`partial-${status}`, true);
      const eventPath = path.join(vault, "raw", "codex", "events", "2026-07-24.jsonl");
      const secondPrompt = `${status}:second:UserPromptSubmit:${"e".repeat(64)}`;
      const secondStop = `${status}:second:Stop:${"f".repeat(64)}`;
      const prompt = record(secondPrompt, "UserPromptSubmit", "继续补充验证", "second-turn");
      const stop = record(secondStop, "Stop", "仍需继续处理", "second-turn");
      prompt.captured_at = "2026-07-24T09:00:00+08:00";
      stop.captured_at = "2026-07-24T09:30:00+08:00";
      await writeFile(eventPath, [
        JSON.stringify(prompt),
        JSON.stringify(stop)
      ].join("\n") + "\n", { encoding: "utf8", flag: "a" });

      await run([
        "prepare", "--vault", vault, "--run-id", `partial-${status}-run`,
        "--since", "2026-07-20", "--max-topics", "2", "--max-pairs", "1"
      ]);
      const contract = JSON.parse(await readFile(
        path.join(vault, "raw", "codex", "ingest-run-contract.json"),
        "utf8"
      ));
      expect(contract.topics[0].partial_topic).toBe(true);
      const resultPath = path.join(vault, ...contract.result_path.split("/"));
      await mkdir(path.dirname(resultPath), { recursive: true });
      await writeFile(resultPath, JSON.stringify({
        schema_version: 4,
        run_id: `partial-${status}-run`,
        outcomes: [{
          id: contract.topics[0].id,
          status,
          reason: status === "pending" ? "当前切片还缺少最终验证" : undefined,
          last_error: status === "failed" ? "故意制造失败用于验证计数" : undefined
        }]
      }), "utf8");

      if (status === "failed") {
        await expect(run([
          "commit", "--vault", vault, "--run-id", `partial-${status}-run`
        ])).rejects.toMatchObject({ code: 2 });
      } else {
        await run(["commit", "--vault", vault, "--run-id", `partial-${status}-run`]);
      }
      const history = JSON.parse(await readFile(
        path.join(vault, "raw", "codex", "ingest-history", `partial-${status}-run.json`),
        "utf8"
      ));
      expect(history.remaining_topics).toBe(1);
    }
  );

  it("旧宽主题拆段后，首个新主题成功也保留尚未完成迁移的旧成功账本", async () => {
    const vault = await mkdtemp(path.join(os.tmpdir(), "zhixing-wide-settlement-"));
    temporary.push(vault);
    await mkdir(path.join(vault, "raw", "codex", "events"), { recursive: true });
    const firstPrompt = `wide:first:UserPromptSubmit:${"1".repeat(64)}`;
    const firstStop = `wide:first:Stop:${"2".repeat(64)}`;
    const secondPrompt = `wide:second:UserPromptSubmit:${"3".repeat(64)}`;
    const secondStop = `wide:second:Stop:${"4".repeat(64)}`;
    const secondPromptRecord = record(secondPrompt, "UserPromptSubmit", "新目标：修复接收器", "turn-2");
    const secondStopRecord = record(secondStop, "Stop", "完成恢复验证", "turn-2");
    secondPromptRecord.captured_at = "2026-07-24T10:00:00+08:00";
    secondStopRecord.captured_at = "2026-07-24T10:30:00+08:00";
    await writeFile(path.join(vault, "raw", "codex", "events", "2026-07-24.jsonl"), [
      JSON.stringify(record(firstPrompt, "UserPromptSubmit", "完善日历筛选", "turn-1")),
      JSON.stringify(record(firstStop, "Stop", "日历筛选验证完成", "turn-1")),
      JSON.stringify(secondPromptRecord),
      JSON.stringify(secondStopRecord)
    ].join("\n") + "\n", "utf8");
    await writeFile(path.join(vault, "raw", "codex", "ingest-state.json"), JSON.stringify({
      schema_version: 3,
      processed_event_ids: []
    }), "utf8");
    await writeFile(path.join(vault, "raw", "codex", "knowledge-settlements.json"), JSON.stringify({
      schema_version: 3,
      outcomes: [{
        id: "topic:legacy-wide-success",
        status: "succeeded",
        source_event_ids: [firstPrompt, firstStop, secondPrompt, secondStop],
        wiki_paths: ["wiki/旧版宽主题.md"],
        memory_path: "wiki/我的经历/旧版宽主题.md",
        digest: { about: "旧目标", problem: "旧问题", result: "旧结果", next_use: "旧做法" }
      }]
    }), "utf8");

    await run([
      "prepare", "--vault", vault, "--run-id", "wide-first-run",
      "--since", "2026-07-20", "--max-topics", "1"
    ]);
    const contract = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "ingest-run-contract.json"),
      "utf8"
    ));
    expect(contract.topics).toHaveLength(1);
    expect(contract.topics[0].id).not.toBe("topic:legacy-wide-success");
    const resultPath = path.join(vault, ...contract.result_path.split("/"));
    await mkdir(path.dirname(resultPath), { recursive: true });
    await writeFile(resultPath, JSON.stringify(semanticResult(
      "wide-first-run",
      contract.topics[0].id
    )), "utf8");
    await run(["commit", "--vault", vault, "--run-id", "wide-first-run"]);

    const ledger = JSON.parse(await readFile(
      path.join(vault, "raw", "codex", "knowledge-settlements.json"),
      "utf8"
    ));
    expect(ledger.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "topic:legacy-wide-success",
        status: "succeeded",
        memory_path: "wiki/我的经历/旧版宽主题.md"
      }),
      expect.objectContaining({
        id: contract.topics[0].id,
        status: "succeeded"
      })
    ]));
  });
});

async function createSinglePairVault(prefix: string, hashedIds = false): Promise<string> {
  const vault = await mkdtemp(path.join(os.tmpdir(), `zhixing-${prefix}-`));
  temporary.push(vault);
  await mkdir(path.join(vault, "raw", "codex", "events"), { recursive: true });
  await writeFile(path.join(vault, "raw", "codex", "ingest-state.json"), JSON.stringify({
    schema_version: 3,
    processed_event_ids: []
  }), "utf8");
  await writeFile(path.join(vault, "raw", "codex", "events", "2026-07-24.jsonl"), [
    JSON.stringify(record(
      hashedIds ? `${prefix}:turn:UserPromptSubmit:${"c".repeat(64)}` : `${prefix}:prompt`,
      "UserPromptSubmit",
      "整理知识沉淀异常"
    )),
    JSON.stringify(record(
      hashedIds ? `${prefix}:turn:Stop:${"d".repeat(64)}` : `${prefix}:stop`,
      "Stop",
      "等待进一步验证"
    ))
  ].join("\n") + "\n", "utf8");
  return vault;
}

function record(eventId: string, event: string, content: string, turnId = "turn") {
  return {
    schema_version: 1,
    event_id: eventId,
    captured_at: event === "UserPromptSubmit" ? "2026-07-24T08:00:00+08:00" : "2026-07-24T08:30:00+08:00",
    date: "2026-07-24",
    source: "codex",
    event,
    session_id: "session",
    turn_id: turnId,
    cwd: "C:\\project",
    content
  };
}

function semanticResult(runId: string, outcomeId: string) {
  return {
    schema_version: 4,
    run_id: runId,
    outcomes: [{
      id: outcomeId,
      status: "succeeded",
      reason: "这次异常留下了可复用的判断和恢复路径",
      evidence_document: {
        title: "知识整理异常的判断与恢复",
        projects: ["知识工作台 团队版"],
        last_verified: "2026-07-24",
        trust: "observed",
        sections: {
          problem: "原始记录已经存在，但夜间整理没有生成可以长期阅读和复用的知识页面。",
          root_cause: "整理任务收到的证据不足，或者写入事务没有完整通过验证，因此状态不能提前前移。",
          attempts: "只检查计划任务退出码无法证明知识页面已经写入，也无法发现写入后回读失败。",
          solution: "先核对原始事件与每日来源，再生成语义结果，由确定性程序补齐路径、来源和双向链接后提交。",
          boundaries: "适用于本地知识整理事务；外部网页事实仍需要独立来源，不能由对话报告直接确认。",
          verification: "事务提交后回读经历文章、证据页和处理状态，三者一致才算本轮完成。",
          signals: "任务显示成功但没有经历文章，或者处理状态已前移而 Wiki 不存在，都是需要立即重试的信号。"
        }
      },
      memory_document: {
        title: "知识为什么没有按预期整理",
        projects: ["知识工作台 团队版"],
        last_reviewed: "2026-07-24",
        occurred_time: "2026-07-24",
        sections: {
          goal: "我希望每天产生的工作记录能自动变成看得懂的经历文章，不需要第二天再依靠记忆手工补写。",
          obstacle: "原始问答虽然已经采集，但整理结果可能停在日志里，Obsidian 中没有出现能让我回忆事情的文章。",
          judgment: "我把采集、来源页、语义整理和最终写入分开检查，确认只有所有环节都成功才可以推进状态。",
          action: "2026-07-24 我保留原始事件，让语义模型只回答内容问题，再由本地程序生成文件结构、来源链接和稳定编号。",
          result: "整理成功后会同时留下经历文章和证据页，任何一步失败都不会吞掉尚未处理的原始记录。",
          next: "下次发现文章缺失时，我会先看整理记录标出的失败环节，再核对原始事件是否仍在等待队列中，然后只重试尚未完成的主题。"
        }
      }
    }]
  };
}

function result(runId: string, outcomeId: string, promptId: string, stopId: string) {
  const daily = "raw/codex/daily/2026-07-24.md";
  return {
    schema_version: 2,
    run_id: runId,
    outcomes: [{
      id: outcomeId,
      status: "succeeded",
      source_event_ids: [promptId, stopId],
      reason: "接收器停止后的恢复路径可重复使用",
      digest: {
        about: "我希望网页采集服务停止后能够自动恢复，继续把新对话写入知识库。",
        problem: "接收器退出后端口不再监听，浏览器里的新对话无法继续写入知识库。",
        result: "现在通过健康检查发现停止状态，并由后台任务自动重新启动接收器。",
        next_use: "下次发现网页内容没有进入知识库时，先检查健康端点和计划任务状态。"
      },
      wiki_updates: [{
        action: "created",
        path: "wiki/Obsidian/接收器恢复.md",
        title: "接收器恢复",
        expected_sha256: "",
        content: [
          "---",
          "zhixing_wiki_id: receiver-recovery",
          "zhixing_document: evidence",
          "projects: [Obsidian]",
          "last_verified: 2026-07-24",
          "trust: verified",
          `source_event_ids: [\"${promptId}\", \"${stopId}\"]`,
          "---",
          "# 接收器恢复",
          "",
          "## 一眼看懂",
          "- **这是什么**：我希望网页采集服务停止后能够自动恢复，继续把新对话写入知识库。",
          "- **解决了什么**：接收器退出后端口不再监听，浏览器里的新对话无法继续写入知识库。",
          "- **得到什么**：现在通过健康检查发现停止状态，并由后台任务自动重新启动接收器。",
          "- **以后怎么用**：下次发现网页内容没有进入知识库时，先检查健康端点和计划任务状态。",
          "",
          "## 问题与现象",
          "网页采集停止，端口没有监听。",
          "## 根因与判断依据",
          "计划任务进程被终止后没有健康守护。",
          "## 尝试过的路径",
          "只保留登录触发无法处理运行中的退出。",
          "## 可复用的解决路径",
          "检查健康端点，异常时重启接收器。",
          "## 适用条件与边界",
          "适用于本机回环接收器，不处理浏览器扩展权限。",
          "## 验证方式与结果",
          "健康检查、JSONL 和每日 Markdown 均通过。",
          "## 下次快速识别",
          "43123 无监听且计划任务 Ready。",
          "## 来源与关联",
          "- [[我的经历/Obsidian/网页对话为什么突然不再进入知识库]]",
          `- [每日来源](${daily})`,
          `- prompt: ${promptId}`,
          `- stop: ${stopId}`
        ].join("\n")
      }],
      memory_update: {
        action: "created",
        path: "wiki/我的经历/Obsidian/网页对话为什么突然不再进入知识库.md",
        title: "网页对话为什么突然不再进入知识库",
        expected_sha256: "",
        content: [
          "---",
          "zhixing_memory_id: receiver-recovery-memory",
          "zhixing_document: memory",
          "projects: [Obsidian]",
          "last_reviewed: 2026-07-24",
          "---",
          "# 网页对话为什么突然不再进入知识库",
          "",
          "> **发生时间**：2026-07-24 · **项目**：Obsidian",
          "",
          "## 当时我想做什么",
          "我希望网页采集服务停止后能够自动恢复，继续把新对话写入知识库。我希望 ChatGPT 网页里的新对话能自动进入 Obsidian，不需要每次复制粘贴，也不需要事后靠记忆补录。",
          "",
          "## 我遇到了什么",
          "接收器退出后端口不再监听，浏览器里的新对话无法继续写入知识库。界面仍然像是开着的，但新的聊天内容没有落到本地，所以问题很容易在积累几天之后才被发现。",
          "",
          "## 我是怎么判断的",
          "我先把问题分成浏览器没有发送、本地没有接收和接收后没有写入三段。检查后发现浏览器端仍会尝试发送，而本机对应端口已经没有程序监听，说明中断发生在本地接收这一段。只在登录时启动一次并不可靠，因为运行中退出后不会自行恢复。",
          "",
          "## 我最后做了什么",
          "现在通过健康检查发现停止状态，并由后台任务自动重新启动接收器。我同时保留了接收测试和实际落盘检查，这样恢复的不只是一个进程，而是从网页发送到本地文件的完整路径。",
          "",
          "## 这次留下了什么",
          "留下了可以持续运行的接收服务、定时健康检查和一条端到端验证方法。验证时既检查本机端口确实恢复监听，也发送一条测试内容并确认它进入当天的原始记录，避免只看进程存在就误以为采集正常。",
          "",
          "## 下次遇到时",
          "下次发现网页内容没有进入知识库时，先检查健康端点和计划任务状态。若端口没有监听，先恢复接收服务；若端口正常，再分别检查浏览器是否发送以及本地文件是否新增，不要一上来就重装插件。",
          "",
          "## 需要追溯时",
          "- AI 证据页：[[Obsidian/接收器恢复]]"
        ].join("\n")
      }
    }]
  };
}

async function run(args: string[]) {
  try {
    return await execFileAsync(process.execPath, [script, ...args], { windowsHide: true });
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    const vaultIndex = args.indexOf("--vault");
    const runIndex = args.indexOf("--run-id");
    let history = "";
    const vault = args[vaultIndex + 1];
    const runId = args[runIndex + 1];
    if (args[0] === "commit" && vaultIndex >= 0 && runIndex >= 0 && vault && runId) {
      history = await readFile(path.join(
        vault,
        "raw",
        "codex",
        "ingest-history",
        `${runId}.json`
      ), "utf8").catch(() => "");
    }
    failure.message = [
      failure.message,
      failure.stdout ? `stdout:\n${failure.stdout}` : "",
      failure.stderr ? `stderr:\n${failure.stderr}` : "",
      history ? `history:\n${history}` : ""
    ].filter(Boolean).join("\n");
    throw failure;
  }
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
