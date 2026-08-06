import { describe, expect, it } from "vitest";
// @ts-expect-error The production queue compiler is a Node ESM automation module.
import { compileKnowledgeQueue } from "../../runtime/src/knowledge-queue.mjs";

const sessionIndex = { available: true, titles: new Map<string, { title: string; updatedAt: string }>() };

describe("knowledge queue", () => {
  it("只归档明确空跑的心跳，保留日报、飞书记录和有反馈的处理", () => {
    const pairs = [
      pair("empty", "<heartbeat>检查反馈</heartbeat>", "反馈收件箱为空，本轮无新增处理结果"),
      pair("ai-daily", "Automation: AI HOT", "AI 早报已送达，message_id: om_123"),
      pair("work-log", "<heartbeat>写飞书工作日志</heartbeat>", "工作日志已写入，日志 ID：recvABC123"),
      pair("feedback", "<heartbeat>处理反馈</heartbeat>", "已处理 Issue #42，并回复用户"),
      pair("dont-notify", "<heartbeat>处理反馈</heartbeat>", "DONT_NOTIFY\n已更新反馈 ID: fb_2026")
    ];
    const compiled = compileKnowledgeQueue(pairs, [], sessionIndex, { maxTopics: 10, maxPairs: 20 });

    expect(compiled.queue.no_op_automation_pairs).toBe(1);
    expect(compiled.queue.substantive_automation_pairs).toBe(4);
    expect(compiled.selectedPairs.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(["ai-daily", "work-log", "feedback", "dont-notify"])
    );
    expect(compiled.systemPairs.map((item: { id: string }) => item.id)).toContain("empty");
  });

  it("正文偶然提到 Automation ID 不会误判，未索引普通会话也不会被丢弃", () => {
    const ordinary = pair("ordinary", "请解释字段 Automation ID: 的含义", "这是一个配置字段。");
    const unindexed = pair("desktop", "研究 Codex SDK 的提供商接入", "完成了 8 轮调查。");
    unindexed.session_id = "missing";
    const compiled = compileKnowledgeQueue([ordinary, unindexed], [], sessionIndex, {
      maxTopics: 10,
      maxPairs: 20
    });
    expect(compiled.queue.no_op_automation_pairs).toBe(0);
    expect(compiled.queue.supporting_pairs).toBe(0);
    expect(compiled.queue.candidate_pairs).toBe(2);
  });

  it("精确内部辅助签名才作为 supporting，旧 pending 仍保留轮转槽位", () => {
    const supporting = pair(
      "support",
      "系统指令：你是验证 Agent。唯一工作重点是检查现有实现。",
      "验证完成。"
    );
    supporting.session_id = "internal";
    const old = pair("old", "修复接收器失败", "仍缺少正文");
    old.session_id = "old-session";
    const fresh = pair("fresh", "新增日历入口", "已完成验证");
    fresh.session_id = "fresh-session";
    const settlements = [{
      id: "old-pending",
      status: "pending",
      source_event_ids: old.source_event_ids,
      updated_at: "2026-07-20T00:00:00.000Z"
    }];
    const compiled = compileKnowledgeQueue([supporting, old, fresh], settlements, sessionIndex, {
      maxTopics: 1,
      maxPairs: 20
    });

    expect(compiled.queue.supporting_pairs).toBe(1);
    expect(compiled.selectedPairs.map((item: { id: string }) => item.id)).toEqual(["old"]);
  });

  it("同一反馈跨日合并，不同反馈保持分开", () => {
    const first = pair("feedback-1a", "<heartbeat>处理反馈</heartbeat>", "已处理反馈 ID: fb-1");
    const second = pair("feedback-1b", "<heartbeat>处理反馈</heartbeat>", "已更新反馈 ID: fb-1");
    second.date = "2026-07-25";
    second.captured_at = "2026-07-25T08:00:00+08:00";
    const other = pair("feedback-2", "<heartbeat>处理反馈</heartbeat>", "已处理反馈 ID: fb-2");
    const compiled = compileKnowledgeQueue([first, second, other], [], sessionIndex, {
      maxTopics: 10,
      maxPairs: 20
    });

    expect(compiled.queue.candidate_topics).toBe(2);
    expect(compiled.selectedTopics.map((topic: { pair_count: number }) => topic.pair_count).sort()).toEqual([1, 2]);
  });

  it("长会话遇到新目标会保守切段，短继续指令继承当前段", () => {
    const first = pair("segment-a", "完善日历视图的筛选", "日历筛选已完成");
    first.session_id = "long-session";
    first.captured_at = "2026-07-24T08:00:00+08:00";
    const continuation = pair("segment-a2", "继续", "补充了筛选测试");
    continuation.session_id = "long-session";
    continuation.captured_at = "2026-07-24T09:00:00+08:00";
    const second = pair("segment-b", "新目标：修复 ChatGPT 接收器健康检查", "接收器已恢复");
    second.session_id = "long-session";
    second.captured_at = "2026-07-24T10:00:00+08:00";
    const confirm = pair("segment-b2", "确认，继续", "端到端落盘验证通过");
    confirm.session_id = "long-session";
    confirm.captured_at = "2026-07-24T11:00:00+08:00";
    const index = indexed([["long-session", "已经过时的会话标题"]]);

    const compiled = compileKnowledgeQueue([first, continuation, second, confirm], [], index, {
      maxTopics: 10,
      maxPairs: 20,
      now: "2026-07-25T00:00:00+08:00",
      quietHours: 2
    });

    expect(compiled.queue.candidate_topics).toBe(2);
    expect(compiled.selectedTopics.map((topic: { pair_count: number }) => topic.pair_count).sort()).toEqual([2, 2]);
    expect(compiled.selectedTopics.some((topic: { title: string }) =>
      topic.title === "已经过时的会话标题")).toBe(false);
    const receiver = compiled.selectedTopics.find((topic: { title: string }) =>
      topic.title.includes("ChatGPT 接收器"));
    expect(receiver).toMatchObject({
      title: "修复 ChatGPT 接收器健康检查",
      title_source: "segment-prompt"
    });
  });

  it("同一长会话切换强任务锚点时拆段，没有新锚点的继续轮次仍继承", () => {
    const first = pair("anchor-a", "处理 C:\\project\\.agent\\tasks\\calendar-filter", "已完成");
    first.session_id = "anchor-session";
    const second = pair("anchor-b", "处理 C:\\project\\.agent\\tasks\\task-timeline", "已完成");
    second.session_id = "anchor-session";
    second.captured_at = "2026-07-24T09:00:00+08:00";
    const continuation = pair("anchor-b2", "继续", "补充测试");
    continuation.session_id = "anchor-session";
    continuation.captured_at = "2026-07-24T10:00:00+08:00";

    const compiled = compileKnowledgeQueue([first, second, continuation], [], sessionIndex, {
      maxTopics: 10,
      maxPairs: 20,
      now: "2026-07-25T00:00:00+08:00"
    });

    expect(compiled.selectedTopics.map((topic: { pair_count: number }) => topic.pair_count).sort()).toEqual([1, 2]);
    expect(new Set(compiled.selectedTopics.map((topic: { anchor: string }) => topic.anchor))).toEqual(
      new Set([
        "codex:c:/project:agent-task:calendar-filter",
        "codex:c:/project:agent-task:task-timeline"
      ])
    );
  });

  it("委派包装不会变成标题，优先提取其中有意义的工作目标", () => {
    const delegated = pair(
      "delegated",
      `<codex_delegation>
<source_thread_id>thread-1</source_thread_id>
<input>
请接手 Workflow Page Studio 四边停靠与滚动布局的修复。
项目目录：C:\\fictional-workbench
</input>
</codex_delegation>`,
      "实现与测试已经完成"
    );
    const index = indexed([[delegated.session_id, "启动85和本地服务"]]);

    const compiled = compileKnowledgeQueue([delegated], [], index, {
      maxTopics: 2,
      maxPairs: 10,
      now: "2026-07-25T00:00:00+08:00"
    });

    expect(compiled.selectedTopics[0].title).toContain("Workflow Page Studio");
    expect(compiled.selectedTopics[0].title).not.toContain("<codex_delegation>");
    expect(compiled.selectedTopics[0].title_source).toBe("prompt");
  });

  it("恢复任务会找回原任务名称，Issue 指令只保留真正主题", () => {
    const restored = pair(
      "restored-title",
      "恢复任务019f6fa3-5a90-7d22-92ad-cde986557636",
      "任务已恢复"
    );
    restored.session_id = "restored-session";
    const issue = pair(
      "issue-title",
      "执行 Fictional-Platform GitLab Issue #13「[可靠性] 统一目标进程监督、资源限制与凭据隔离边界」。严格遵循：",
      "已完成"
    );
    issue.session_id = "issue-session";
    const attachment = pair(
      "attachment-title",
      `# Files mentioned by the user:
## 演示包.zip: C:/Users/demo/Desktop/演示包.zip
## My request for Codex:
检查这个演示包为什么无法安装`,
      "已经完成检查"
    );
    attachment.session_id = "attachment-session";
    const index = indexed([
      ["019f6fa3-5a90-7d22-92ad-cde986557636", "完成官网动效执行计划"],
      ["restored-session", "恢复任务019f6fa3"],
      ["issue-session", "执行 Issue #13"]
    ]);

    const compiled = compileKnowledgeQueue([restored, issue, attachment], [], index, {
      maxTopics: 3,
      maxPairs: 10,
      now: "2026-07-25T00:00:00+08:00"
    });

    expect(compiled.selectedTopics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "完成官网动效执行计划",
        title_source: "restored-session-index"
      }),
      expect.objectContaining({
        title: "统一目标进程监督、资源限制与凭据隔离边界",
        title_source: "prompt"
      }),
      expect.objectContaining({
        title: "检查这个演示包为什么无法安装",
        title_source: "prompt"
      })
    ]));
  });

  it("没有冒号的新任务句式也会触发保守切段", () => {
    const first = pair("plain-goal-a", "继续完善日历筛选", "已完成");
    first.session_id = "plain-goal-session";
    const second = pair("plain-goal-b", "接下来修复 ChatGPT 接收器", "已恢复");
    second.session_id = "plain-goal-session";
    second.captured_at = "2026-07-24T10:00:00+08:00";

    const compiled = compileKnowledgeQueue([first, second], [], sessionIndex, {
      maxTopics: 10,
      maxPairs: 10,
      now: "2026-07-25T00:00:00+08:00"
    });

    expect(compiled.selectedTopics).toHaveLength(2);
    expect(compiled.selectedTopics.some((topic: { title: string }) =>
      topic.title === "修复 ChatGPT 接收器")).toBe(true);
  });

  it("编号副本只在同项目存在编号家族时与原会话合并", () => {
    const base = pair("family-base", "完成插件开发", "第一轮完成");
    base.session_id = "family-base-session";
    const numbered = pair("family-copy", "继续完成插件开发", "第二轮完成");
    numbered.session_id = "family-copy-session";
    const sameName = pair("same-name", "另一项同名工作", "完成");
    sameName.session_id = "same-name-session";
    const otherProject = pair("other-project", "另一项目中的副本", "完成");
    otherProject.session_id = "other-project-session";
    otherProject.cwd = "C:\\other";
    const index = indexed([
      ["family-base-session", "开发知行台插件"],
      ["family-copy-session", "开发知行台插件 (2)"],
      ["same-name-session", "开发知行台插件"],
      ["other-project-session", "开发知行台插件 (3)"]
    ]);

    const compiled = compileKnowledgeQueue([base, numbered, sameName, otherProject], [], index, {
      maxTopics: 10,
      maxPairs: 20,
      now: "2026-07-25T00:00:00+08:00",
      quietHours: 2
    });

    expect(compiled.queue.candidate_topics).toBe(3);
    expect(compiled.selectedTopics.map((topic: { pair_count: number }) => topic.pair_count).sort()).toEqual([1, 1, 2]);
  });

  it("静默窗口内保持 open，窗口结束后 ready，已有知识的新增证据标为 reopened", () => {
    const active = pair("active", "继续修复", "尚在处理");
    active.captured_at = "2026-07-24T11:30:00+08:00";
    const ready = pair("ready", "完成文档", "已验证");
    ready.captured_at = "2026-07-24T08:00:00+08:00";
    const reopened = pair("reopened", "补充验证", "新的验证通过");
    reopened.captured_at = "2026-07-24T07:00:00+08:00";
    const settlements = [{
      id: "existing-wiki",
      status: "succeeded",
      source_event_ids: ["reopened:prompt"],
      updated_at: "2026-07-23T12:00:00.000Z"
    }];
    const compiled = compileKnowledgeQueue([active, ready, reopened], settlements, sessionIndex, {
      maxTopics: 10,
      maxPairs: 20,
      now: "2026-07-24T12:00:00+08:00",
      quietHours: 2
    });

    expect(compiled.queue.open_topics).toBe(1);
    expect(compiled.queue.ready_topics).toBe(2);
    expect(compiled.selectedPairs.map((item: { id: string }) => item.id).sort()).toEqual(["ready", "reopened"]);
    expect(compiled.selectedTopics.find((topic: { pending_pair_ids: string[] }) =>
      topic.pending_pair_ids.includes("reopened"))?.eligibility_state).toBe("reopened");
  });

  it("选择器为重试、积压和近期主题保留公平槽，并在槽内按项目轮转", () => {
    const retry = pair("retry", "修复失败主题", "再次验证");
    retry.cwd = "C:\\retry";
    retry.captured_at = "2026-07-20T08:00:00+08:00";
    const backlogA = pair("backlog-a", "旧主题 A", "完成");
    backlogA.cwd = "C:\\project-a";
    backlogA.captured_at = "2026-07-20T09:00:00+08:00";
    const backlogB = pair("backlog-b", "旧主题 B", "完成");
    backlogB.cwd = "C:\\project-b";
    backlogB.captured_at = "2026-07-20T10:00:00+08:00";
    const recent = pair("recent", "刚完成的新主题", "完成");
    recent.cwd = "C:\\recent";
    recent.captured_at = "2026-07-24T08:00:00+08:00";
    const settlements = [{
      id: "retry-failed",
      status: "failed",
      source_event_ids: retry.source_event_ids,
      updated_at: "2026-07-23T00:00:00.000Z"
    }];

    const compiled = compileKnowledgeQueue([retry, backlogA, backlogB, recent], settlements, sessionIndex, {
      maxTopics: 3,
      maxPairs: 3,
      now: "2026-07-25T00:00:00+08:00",
      quietHours: 2,
      recentHours: 48
    });

    expect(compiled.selectedPairs.map((item: { id: string }) => item.id).sort()).toEqual(
      ["backlog-a", "recent", "retry"]
    );
    expect(compiled.queue.selected_lanes).toEqual({ retry: 1, backlog: 1, recent: 1 });
  });

  it("默认每批两个主题时轮换队列起点，三批内不会饿死近期主题", () => {
    const retry = pair("rotation-retry", "重试主题", "完成");
    retry.captured_at = "2026-07-20T08:00:00+08:00";
    const backlog = pair("rotation-backlog", "积压主题", "完成");
    backlog.captured_at = "2026-07-20T09:00:00+08:00";
    const recent = pair("rotation-recent", "近期主题", "完成");
    recent.captured_at = "2026-07-24T08:00:00+08:00";
    const settlements = [{
      id: "rotation-failed",
      status: "failed",
      source_event_ids: retry.source_event_ids,
      updated_at: "2026-07-20T10:00:00.000Z"
    }];
    const selectedLanes = [0, 1, 2].map((laneOffset) =>
      compileKnowledgeQueue([retry, backlog, recent], settlements, sessionIndex, {
        maxTopics: 2,
        maxPairs: 2,
        laneOffset,
        now: "2026-07-25T00:00:00+08:00",
        recentHours: 48
      }).selectedTopics.map((topic: { queue_lane: string }) => topic.queue_lane));

    expect(selectedLanes).toEqual([
      ["retry", "backlog"],
      ["backlog", "recent"],
      ["recent", "retry"]
    ]);
  });

  it("失败主题在退避期内不会被同一微批周期立即重试，到期后回到 retry 队列", () => {
    const failed = pair("failed-retry", "修复失败主题", "仍需重试");
    failed.captured_at = "2026-07-24T08:00:00+08:00";
    const settlements = [{
      id: "failed-outcome",
      status: "failed",
      source_event_ids: failed.source_event_ids,
      updated_at: "2026-07-24T10:00:00+08:00"
    }];

    const cooling = compileKnowledgeQueue([failed], settlements, sessionIndex, {
      maxTopics: 2,
      maxPairs: 10,
      now: "2026-07-24T11:00:00+08:00",
      quietHours: 2,
      retryBackoffHours: 12
    });
    const due = compileKnowledgeQueue([failed], settlements, sessionIndex, {
      maxTopics: 2,
      maxPairs: 10,
      now: "2026-07-24T22:01:00+08:00",
      quietHours: 2,
      retryBackoffHours: 12
    });

    expect(cooling.selectedPairs).toEqual([]);
    expect(cooling.queue.open_topics).toBe(0);
    expect(cooling.queue.cooling_retry_topics).toBe(1);
    expect(due.selectedPairs.map((item: { id: string }) => item.id)).toEqual(["failed-retry"]);
    expect(due.queue.selected_lanes.retry).toBe(1);
  });

  it("退避期内出现新的 pending 证据时可以立即继续该主题", () => {
    const failed = pair("failed-history", "修复失败主题", "首次失败");
    failed.session_id = "retry-with-delta";
    failed.captured_at = "2026-07-24T08:00:00+08:00";
    const delta = pair("failed-delta", "继续", "补充了新的必要证据");
    delta.session_id = "retry-with-delta";
    delta.captured_at = "2026-07-24T10:30:00+08:00";
    const settlements = [{
      id: "failed-outcome",
      status: "failed",
      source_event_ids: failed.source_event_ids,
      updated_at: "2026-07-24T10:00:00+08:00"
    }];

    const compiled = compileKnowledgeQueue([failed, delta], settlements, sessionIndex, {
      maxTopics: 2,
      maxPairs: 10,
      pendingPairIds: new Set(["failed-history", "failed-delta"]),
      now: "2026-07-24T13:00:00+08:00",
      quietHours: 2,
      retryBackoffHours: 12
    });

    expect(compiled.selectedTopics[0].queue_lane).toBe("retry");
    expect(compiled.queue.cooling_retry_topics).toBe(0);
  });

  it("同一公平队列中按项目轮转，避免单个项目连续占满", () => {
    const projectA1 = pair("project-a1", "项目 A 旧任务一", "完成");
    projectA1.cwd = "C:\\project-a";
    projectA1.captured_at = "2026-07-20T08:00:00+08:00";
    const projectA2 = pair("project-a2", "项目 A 旧任务二", "完成");
    projectA2.cwd = "C:\\project-a";
    projectA2.captured_at = "2026-07-20T09:00:00+08:00";
    const projectB = pair("project-b", "项目 B 旧任务", "完成");
    projectB.cwd = "C:\\project-b";
    projectB.captured_at = "2026-07-20T10:00:00+08:00";

    const compiled = compileKnowledgeQueue([projectA1, projectA2, projectB], [], sessionIndex, {
      maxTopics: 2,
      maxPairs: 2,
      now: "2026-07-25T00:00:00+08:00",
      recentHours: 48
    });

    expect(compiled.selectedPairs.map((item: { id: string }) => item.id)).toEqual(["project-a1", "project-b"]);
  });

  it("大型重试主题会切片给积压和近期主题留下公平预算", () => {
    const retryPairs = ["retry-a", "retry-b", "retry-c"].map((id, index) => {
      const item = pair(id, index === 0 ? "修复失败主题" : "继续", `重试证据 ${index}`);
      item.session_id = "large-retry-session";
      item.cwd = "C:\\retry";
      item.captured_at = `2026-07-20T0${8 + index}:00:00+08:00`;
      return item;
    });
    const backlog = pair("fair-backlog", "积压主题", "完成");
    backlog.cwd = "C:\\backlog";
    backlog.captured_at = "2026-07-20T12:00:00+08:00";
    const recent = pair("fair-recent", "近期主题", "完成");
    recent.cwd = "C:\\recent";
    recent.captured_at = "2026-07-24T08:00:00+08:00";
    const compiled = compileKnowledgeQueue([...retryPairs, backlog, recent], [{
      id: "failed-retry",
      status: "failed",
      source_event_ids: retryPairs[0]!.source_event_ids,
      updated_at: "2026-07-20T20:00:00+08:00"
    }], sessionIndex, {
      maxTopics: 3,
      maxPairs: 3,
      now: "2026-07-25T12:00:00+08:00",
      recentHours: 48
    });

    expect(compiled.queue.selected_lanes).toEqual({ retry: 1, backlog: 1, recent: 1 });
    expect(compiled.selectedPairs).toHaveLength(3);
    expect(compiled.selectedTopics.find((topic: { queue_lane: string }) =>
      topic.queue_lane === "retry")?.partial_topic).toBe(true);
  });

  it("大主题按稳定增量切片前进且不突破硬上限，单个超长问答进入压缩队列", () => {
    const first = pair("large-a", "新目标：大型主题", "x".repeat(120));
    first.session_id = "large-session";
    const second = pair("large-b", "继续", "y".repeat(120));
    second.session_id = "large-session";
    second.captured_at = "2026-07-24T09:00:00+08:00";

    const pairLimited = compileKnowledgeQueue([first, second], [], sessionIndex, {
      maxTopics: 2,
      maxPairs: 1,
      now: "2026-07-25T00:00:00+08:00"
    });
    const charLimited = compileKnowledgeQueue([first], [], sessionIndex, {
      maxTopics: 2,
      maxPairs: 10,
      maxChars: 32,
      now: "2026-07-25T00:00:00+08:00"
    });

    expect(pairLimited.selectedPairs.map((item: { id: string }) => item.id)).toEqual(["large-a"]);
    expect(pairLimited.selectedTopics[0]).toMatchObject({
      partial_topic: true,
      remaining_pending_pairs: 1,
      pending_pair_count: 1
    });
    expect(pairLimited.queue.partial_topics).toBe(1);
    expect(charLimited.selectedPairs).toEqual([]);
    expect(charLimited.queue.deferred_oversize_topics).toBe(1);
    expect(charLimited.queue.needs_compaction_topics).toBe(1);

    const nextBatch = compileKnowledgeQueue([first, second], [{
      id: pairLimited.selectedTopics[0].id,
      status: "succeeded",
      source_event_ids: first.source_event_ids,
      updated_at: "2026-07-24T12:00:00+08:00"
    }], sessionIndex, {
      maxTopics: 2,
      maxPairs: 1,
      pendingPairIds: new Set(["large-b"]),
      now: "2026-07-25T00:00:00+08:00"
    });
    expect(nextBatch.selectedTopics[0].id).toBe(pairLimited.selectedTopics[0].id);
    expect(nextBatch.selectedPairs.map((item: { id: string }) => item.id)).toEqual(["large-b"]);
    expect(nextBatch.selectedTopics[0].partial_topic).toBe(false);
  });

  it("重开主题只把 pending delta 送入本轮，同时保留全部来源与历史上下文统计", () => {
    const historical = pair("history", "建立知识页", "首次完成");
    historical.session_id = "delta-session";
    const delta = pair("delta", "继续", "补充了新验证");
    delta.session_id = "delta-session";
    delta.captured_at = "2026-07-24T10:00:00+08:00";
    const pendingIds = new Set(["delta"]);
    const settlements = [{
      id: "settled",
      status: "succeeded",
      source_event_ids: historical.source_event_ids,
      updated_at: "2026-07-23T00:00:00.000Z"
    }];

    const compiled = compileKnowledgeQueue([historical, delta], settlements, sessionIndex, {
      maxTopics: 2,
      maxPairs: 10,
      pendingPairIds: pendingIds,
      now: "2026-07-25T00:00:00+08:00"
    });

    expect(compiled.selectedPairs.map((item: { id: string }) => item.id)).toEqual(["delta"]);
    expect(compiled.selectedTopics[0]).toMatchObject({
      pair_ids: ["history", "delta"],
      pending_pair_ids: ["delta"],
      pair_count: 2,
      pending_pair_count: 1,
      context_pair_count: 1,
      eligibility_state: "reopened"
    });
    expect(compiled.selectedTopics[0].source_event_ids).toEqual([
      "delta:prompt", "delta:stop"
    ]);
    expect(compiled.selectedTopics[0].all_source_event_ids).toEqual([
      "history:prompt", "history:stop", "delta:prompt", "delta:stop"
    ]);
  });

  it("旧宽主题切段后为每段生成独立稳定 ID，只保留旧账本关联", () => {
    const first = pair("legacy-a", "完善日历", "已完成");
    first.session_id = "legacy-session";
    const second = pair("legacy-b", "新目标：修复任务轨迹", "已完成");
    second.session_id = "legacy-session";
    second.captured_at = "2026-07-24T10:00:00+08:00";
    const settlements = [{
      id: "topic:legacy-wide",
      status: "succeeded",
      source_event_ids: [...first.source_event_ids, ...second.source_event_ids],
      updated_at: "2026-07-23T00:00:00.000Z"
    }];

    const compiled = compileKnowledgeQueue([first, second], settlements, sessionIndex, {
      maxTopics: 10,
      maxPairs: 10,
      now: "2026-07-25T00:00:00+08:00"
    });

    expect(new Set(compiled.selectedTopics.map((topic: { id: string }) => topic.id)).size).toBe(2);
    expect(compiled.selectedTopics.every((topic: { related_settlement_ids: string[] }) =>
      topic.related_settlement_ids.includes("topic:legacy-wide"))).toBe(true);
  });

  it("旧账本来源完整落入唯一主题时复用原 ID，保持已有 Wiki 更新链路", () => {
    const historical = pair("stable-history", "建立已有知识", "完成");
    historical.session_id = "stable-session";
    const delta = pair("stable-delta", "继续", "补充新证据");
    delta.session_id = "stable-session";
    delta.captured_at = "2026-07-24T10:00:00+08:00";
    const compiled = compileKnowledgeQueue([historical, delta], [{
      id: "topic:existing-stable-id",
      status: "succeeded",
      source_event_ids: historical.source_event_ids,
      updated_at: "2026-07-23T00:00:00.000Z"
    }], sessionIndex, {
      maxTopics: 10,
      maxPairs: 10,
      pendingPairIds: new Set(["stable-delta"]),
      now: "2026-07-25T00:00:00+08:00"
    });

    expect(compiled.selectedTopics[0].id).toBe("topic:existing-stable-id");
    expect(compiled.selectedTopics[0].eligibility_state).toBe("reopened");
  });
});

function pair(id: string, prompt: string, stop: string) {
  return {
    id,
    source: "codex",
    date: "2026-07-24",
    session_id: `session-${id}`,
    turn_id: `turn-${id}`,
    conversation_id: "",
    source_event_ids: [`${id}:prompt`, `${id}:stop`],
    daily_path: "raw/codex/daily/2026-07-24.md",
    captured_at: "2026-07-24T08:00:00+08:00",
    cwd: "C:\\project",
    title: "",
    url: "",
    prompt_content: prompt,
    stop_content: stop
  };
}

function indexed(entries: Array<[string, string]>) {
  return {
    available: true,
    titles: new Map(entries.map(([id, title]) => [id, {
      title,
      updatedAt: "2026-07-24T00:00:00.000Z"
    }]))
  };
}
