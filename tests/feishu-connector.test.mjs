import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { assertReadOnlyArgs, commandFor, FeishuDriverError, LarkCliDriver } from "../packages/runtime/src/feishu-driver.mjs";
import { selectFeishuMessages, shouldCaptureFeishuMessage } from "../packages/runtime/src/feishu-policy.mjs";
import { authorizationArgs, calculateFeishuPermissions } from "../packages/runtime/src/feishu-scopes.mjs";
import { normalizeFeishuResource, saveFeishuConfig, syncFeishu } from "../packages/runtime/src/feishu-sync.mjs";
import { compileKnowledgeQueue } from "../packages/runtime/src/knowledge-queue.mjs";
import { pairRecords } from "../packages/runtime/src/knowledge-transaction.mjs";

const CONFIG = {
  enabled: true,
  modules: {
    tasks: true,
    calendar: true,
    meetings: true,
    minutes: true,
    documents: true,
    base: true,
    approvals: true,
    messages: true
  },
  selected_chats: [{ chat_id: "oc_fictional_project", label: "虚构项目群", type: "project_group" }],
  selected_bases: [{
    selection_key: "fictional-demand-view",
    base_token: "bas_fictional",
    table_id: "tbl_fictional",
    view_id: "viw_fictional",
    label: "虚构需求视图",
    field_ids: ["标题", "状态"]
  }]
};
const execFileAsync = promisify(execFile);

test("所选飞书模块一次计算只读最小权限", () => {
  const permissions = calculateFeishuPermissions(CONFIG);
  assert.equal(permissions.modules.length, 8);
  assert.ok(permissions.scopes.includes("task:task:read"));
  assert.ok(permissions.scopes.includes("calendar:calendar.event:read"));
  assert.ok(permissions.scopes.includes("base:record:read"));
  assert.ok(permissions.scopes.includes("base:table:read"));
  assert.ok(permissions.scopes.includes("base:view:read"));
  assert.ok(permissions.scopes.includes("search:docs:read"));
  assert.ok(permissions.scopes.includes("im:message:readonly"));
  assert.ok(permissions.scopes.includes("im:chat:read"));
  assert.equal(new Set(permissions.scopes).size, permissions.scopes.length);
  const auth = authorizationArgs(CONFIG);
  assert.deepEqual(auth.slice(0, 2), ["auth", "login"]);
  assert.ok(auth.includes("--no-wait"));
  assert.doesNotMatch(auth.join(" "), /:write|:update|:create|write_only/);
});

test("飞书命令白名单拒绝所有写操作", () => {
  assert.doesNotThrow(() => assertReadOnlyArgs(commandFor("tasks", {})));
  assert.doesNotThrow(() => assertReadOnlyArgs(commandFor("messages", {
    selection: CONFIG.selected_chats[0],
    currentUserId: "ou_fictional",
    since: "2026-07-01T00:00:00Z",
    now: "2026-08-01T00:00:00Z"
  })));
  assert.doesNotThrow(() => assertReadOnlyArgs(commandFor("approvals", {
    selection: { kind: "initiated" },
    since: "2026-07-01T00:00:00Z",
    now: "2026-08-01T00:00:00Z"
  })));
  assert.throws(() => assertReadOnlyArgs(["task", "tasks", "create", "--yes"]), /只读白名单|禁止写操作/);
  assert.throws(() => assertReadOnlyArgs(["approval", "tasks", "approve", "--yes"]), /只读白名单|禁止写操作/);
  assert.doesNotThrow(() => assertReadOnlyArgs(["docs", "+fetch", "--as", "user", "--doc", "doc_fictional", "--json"]));
});

test("官方 CLI 驱动为文档和审批补充有权读取的正文详情", async () => {
  const calls = [];
  const driver = new LarkCliDriver({ bin: "fictional-lark-cli", exec: async (_bin, args) => {
    calls.push(args);
    const key = args.slice(0, 3).join(" ");
    if (key.startsWith("drive +search")) return jsonResult({ ok: true, data: { items: [{ document_id: "doc-one", title: "虚构文档" }] } });
    if (key.startsWith("docs +fetch")) return jsonResult({ ok: true, data: { content: "虚构文档正文，包含问题与验证结果。" } });
    if (key === "approval tasks query") return jsonResult({ ok: true, data: { items: [{ instance_code: "approval-one", title: "虚构审批" }] } });
    if (key === "approval instances get") return jsonResult({ ok: true, data: { status: "通过", result: "允许虚构发布" } });
    throw new Error(`未处理的虚构命令：${key}`);
  } });
  const documents = await driver.list("documents", { module: "documents", since: "2026-08-01T00:00:00Z" });
  const approvals = await driver.list("approvals", { module: "approvals", selection: { topic: 2 }, since: "2026-08-01T00:00:00Z", now: "2026-08-06T00:00:00Z" });
  assert.match(documents.items[0].fetched_content, /正文/);
  assert.equal(approvals.items[0].approval_detail.status, "通过");
  assert.ok(calls.every((args) => !args.includes("--yes")));
});

test("无录制文件的会议仍作为正常会议同步", async () => {
  const driver = new LarkCliDriver({ bin: "fictional-lark-cli", exec: async (_bin, args) => {
    if (args[1] === "+search") return jsonResult({
      ok: true,
      data: { meetings: [{ meeting_id: "meeting-one", title: "虚构会议" }], has_more: false, page_token: "terminal-token" }
    });
    if (args[1] === "+recording") return jsonResult({
      ok: false,
      data: { recordings: [{ meeting_id: "meeting-one", error: "data not exist" }] }
    });
    throw new Error("未处理的虚构命令");
  } });
  const page = await driver.list("meetings", {
    module: "meetings",
    currentUserId: "ou_fictional",
    since: "2026-08-01T00:00:00Z",
    now: "2026-08-06T00:00:00Z"
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].title, "虚构会议");
  assert.equal(page.nextPage, undefined);
});

test("已发起审批使用专用只读接口而非无效 topic", () => {
  const command = commandFor("approvals", {
    selection: { kind: "initiated" },
    since: "2026-08-01T00:00:00Z",
    now: "2026-08-06T00:00:00Z"
  });
  assert.deepEqual(command.slice(0, 3), ["approval", "instances", "initiated"]);
  assert.ok(!command.includes("--topic"));
});

test("官方 CLI 登录状态只向连接器暴露显示名和作用域计算所需字段", async () => {
  const driver = new LarkCliDriver({ bin: "fictional-lark-cli", exec: async () => jsonResult({
    ok: true,
    identity: "user",
    data: {
      verified: true,
      identities: { user: { status: "logged_in", userName: "虚构用户", openId: "ou_fictional_identity", tokenStatus: "valid", scope: ["task:task:read"] } }
    }
  }) });
  const status = await driver.status();
  assert.deepEqual(status, {
    connected: true,
    userId: "ou_fictional_identity",
    tenantKey: "tenant",
    label: "虚构用户",
    scopes: ["task:task:read"]
  });
});

test("项目群可以用精确群名解析，避免要求普通用户查找群 ID", async () => {
  const calls = [];
  const driver = new LarkCliDriver({ bin: "fictional-lark-cli", exec: async (_bin, args) => {
    calls.push(args);
    if (args[1] === "+chat-search") return jsonResult({ ok: true, data: { items: [{ chat_id: "oc_fictional_resolved", name: "虚构发布群" }] } });
    if (args[1] === "+chat-messages-list") return jsonResult({ ok: true, data: { items: [{ message_id: "message-one", text: "决定发布虚构版本" }] } });
    throw new Error("未处理的虚构命令");
  } });
  const page = await driver.list("messages", { module: "messages", selection: { query: "虚构发布群", label: "虚构发布群", type: "project_group" },
    since: "2026-08-01T00:00:00Z", now: "2026-08-06T00:00:00Z" });
  assert.equal(page.items.length, 1);
  assert.ok(calls.some((args) => args.includes("oc_fictional_resolved")));
});

test("默认不会采集私聊、闲聊、机器人通知或项目群全量消息", () => {
  const context = { selectedProjectGroup: true, currentUserId: "ou_current", chatType: "project_group" };
  assert.equal(shouldCaptureFeishuMessage({ chat_type: "p2p", text: "确认方案并交付" }, context), false);
  assert.equal(shouldCaptureFeishuMessage({ sender: { type: "bot" }, text: "系统通知：任务完成" }, context), false);
  assert.equal(shouldCaptureFeishuMessage({ sender_id: "ou_other", text: "收到" }, context), false);
  assert.equal(shouldCaptureFeishuMessage({ sender_id: "ou_other", text: "今晚吃什么" }, context), false);
  assert.equal(shouldCaptureFeishuMessage({ sender_id: "ou_other", text: "决定采用方案 A，明天完成验收" }, context), true);
  assert.equal(shouldCaptureFeishuMessage({ sender_id: "ou_current", text: "结论：问题已修复并验证" }, context), true);
  assert.equal(shouldCaptureFeishuMessage({ sender_id: "ou_other", text: "请看一下", mentions: [{ id: "ou_current" }] }, context), true);
  assert.equal(shouldCaptureFeishuMessage({ sender_id: "ou_other", text: "决定采用方案 A" }, { ...context, selectedProjectGroup: false }), false);
  const withContext = selectFeishuMessages([
    { message_id: "before", sender_id: "ou_other", text: "上一个版本昨天已经验证" },
    { message_id: "mention", sender_id: "ou_other", text: "请确认", mentions: [{ id: "ou_current" }] },
    { message_id: "after", sender_id: "ou_other", text: "收到" },
    { message_id: "unrelated", sender_id: "ou_other", text: "闲聊内容" }
  ], context);
  assert.deepEqual(withContext.map((item) => item.message_id), ["before", "mention", "after"]);
  assert.equal(withContext[2].zhixing_context_only, true);
});

test("任务、日程、纪要、文档、Base、审批和消息增量同步到 raw 与每日来源页", async () => {
  const vault = await mkdtemp(path.join(tmpdir(), "zhixing-feishu-"));
  const driver = fixtureDriver();
  try {
    await saveFeishuConfig(vault, CONFIG);
    const first = await syncFeishu({ vault, driver, now: "2026-08-06T10:00:00Z", force: true });
    assert.equal(first.status, "succeeded");
    assert.equal(first.failed_modules, 0);
    assert.ok(first.accepted >= 8);
    assert.ok(driver.calls.some((call) => call.module === "tasks" && call.pageToken === "page-2"), "分页游标应继续读取第二页");

    const eventFiles = await readdir(path.join(vault, "raw", "feishu", "events"));
    const all = [];
    for (const file of eventFiles) {
      const lines = (await readFile(path.join(vault, "raw", "feishu", "events", file), "utf8")).trim().split(/\r?\n/);
      all.push(...lines.map(JSON.parse));
    }
    assert.ok(all.some((item) => item.resource_type === "tasks" && item.activity_kind === "task_completed"));
    assert.ok(all.some((item) => item.resource_type === "minutes"));
    assert.ok(all.some((item) => item.resource_type === "messages"));
    assert.ok(all.every((item) => item.source === "feishu" && item.untrusted_source === true));
    assert.ok(all.every((item) => !JSON.stringify(item).includes("ou_private_fixture")), "用户身份只能保存为不可逆作用域");
    assert.ok(all.every((item) => !JSON.stringify(item).includes("app_secret")));

    const daily = (await Promise.all((await readdir(path.join(vault, "raw", "feishu", "daily")))
      .map((file) => readFile(path.join(vault, "raw", "feishu", "daily", file), "utf8")))).join("\n");
    assert.match(daily, /飞书活动/);
    assert.match(daily, /虚构任务已完成/);
    assert.match(daily, /打开飞书来源/);

    const prepared = await execFileAsync(process.execPath, [path.resolve("packages/runtime/src/knowledge-transaction.mjs"),
      "prepare", "--vault", vault, "--run-id", "fictional-feishu-e2e", "--max-topics", "12", "--max-pairs", "40", "--quiet-hours", "0"],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, CODEX_HOME: path.join(vault, ".test-codex-home") } });
    const contract = JSON.parse(prepared.stdout.trim().split(/\r?\n/).at(-1));
    assert.ok(contract.topic_count > 0);
    const contractBody = JSON.parse(await readFile(contract.contract_path, "utf8"));
    assert.ok(contractBody.topics.some((topic) => topic.source === "feishu"));

    const second = await syncFeishu({ vault, driver: fixtureDriver(), now: "2026-08-06T10:05:00Z", force: true });
    assert.equal(second.accepted, 0);
    assert.ok(second.duplicates >= first.accepted);
    const dailyAgain = (await Promise.all((await readdir(path.join(vault, "raw", "feishu", "daily")))
      .map((file) => readFile(path.join(vault, "raw", "feishu", "daily", file), "utf8")))).join("\n");
    assert.equal((dailyAgain.match(/feishu-record:event=/g) || []).length, (daily.match(/feishu-record:event=/g) || []).length);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

test("缺少 scope、授权过期和限流都会留下可重试状态", async () => {
  for (const scenario of ["missing_scope", "auth_expired", "rate_limit"]) {
    const vault = await mkdtemp(path.join(tmpdir(), `zhixing-feishu-${scenario}-`));
    try {
      const config = { ...CONFIG, modules: { ...CONFIG.modules, calendar: false, meetings: false, minutes: false,
        documents: false, base: false, approvals: false, messages: false } };
      const driver = fixtureDriver({ scenario });
      const result = await syncFeishu({ vault, config, driver, now: "2026-08-06T10:00:00Z", force: true });
      assert.equal(result.status, "failed");
      assert.ok(result.retry_at);
      const state = JSON.parse(await readFile(path.join(vault, "raw", "feishu", "sync-state.json"), "utf8"));
      assert.notEqual(state.access_status, "available");
      if (scenario === "missing_scope") assert.deepEqual(state.missing_scopes, ["task:task:read"]);
    } finally {
      await rm(vault, { recursive: true, force: true });
    }
  }
});

test("删除或撤权资源保留来源状态且不伪装为仍可访问", () => {
  const deleted = normalizeFeishuResource("documents", {
    document_id: "doc_fictional",
    title: "虚构说明",
    update_time: "2026-08-06T09:00:00Z",
    deleted: true
  }, { identityScope: "scope", capturedAt: "2026-08-06T10:00:00Z" });
  const revoked = normalizeFeishuResource("base", {
    record_id: "rec_fictional",
    title: "虚构需求",
    update_time: "2026-08-06T09:00:00Z",
    permission_denied: true
  }, { identityScope: "scope", capturedAt: "2026-08-06T10:00:00Z" });
  assert.equal(deleted.access_status, "deleted");
  assert.equal(revoked.access_status, "revoked");
});

test("同一飞书对象的多次更新归并为一个长期主题", () => {
  const base = {
    schema_version: 1,
    source: "feishu",
    event: "ResourceUpdate",
    date: "2026-08-06",
    occurred_at: "2026-08-06T08:00:00Z",
    captured_at: "2026-08-06T10:00:00Z",
    session_id: "feishu:tasks:tasks:task-one",
    resource_type: "tasks",
    resource_id: "tasks:task-one",
    resource_status: "推进中",
    project_hint: "虚构项目",
    title: "推进虚构任务",
    content: "先验证范围，再执行交付。"
  };
  const pairs = pairRecords([
    { ...base, event_id: "feishu:event-one", turn_id: "version-one", resource_version: "1" },
    { ...base, event_id: "feishu:event-two", turn_id: "version-two", resource_version: "2", resource_status: "已完成",
      content: "任务已完成，并通过虚构验收。", captured_at: "2026-08-06T11:00:00Z" }
  ]);
  const compiled = compileKnowledgeQueue(pairs, [], { available: false, titles: new Map() }, {
    now: "2026-08-06T12:00:00Z", quietHours: 0, maxTopics: 4, maxPairs: 10
  });
  assert.equal(pairs.length, 2);
  assert.equal(compiled.selectedTopics.length, 1);
  assert.equal(compiled.selectedTopics[0].pair_count, 2);
  assert.equal(compiled.selectedTopics[0].source, "feishu");
});

function fixtureDriver(options = {}) {
  const calls = [];
  return {
    calls,
    async status() {
      if (options.scenario === "auth_expired") throw new FeishuDriverError("授权已过期", { category: "auth_expired", permanent: true });
      return { connected: true, userId: "ou_private_fixture", tenantKey: "fixture", label: "虚构用户" };
    },
    async checkScopes() {
      if (options.scenario === "missing_scope") return { ok: false, missing: ["task:task:read"] };
      return { ok: true, missing: [] };
    },
    async list(module, request) {
      calls.push({ module, pageToken: request.pageToken, selection: request.selection });
      if (options.scenario === "rate_limit") throw new FeishuDriverError("请求过于频繁", { category: "rate_limit", retryAfterMs: 120_000 });
      if (module === "tasks" && !request.pageToken) return { items: [task("task-one", "进行中")], nextPage: "page-2" };
      if (module === "tasks") return { items: [task("task-two", "已完成")], nextPage: undefined };
      if (module === "calendar") return { items: [{ event_id: "event-one", title: "虚构项目评审", start_time: "2026-08-06T02:00:00Z", update_time: "2026-08-06T01:00:00Z" }] };
      if (module === "meetings") return { items: [{ meeting_id: "meeting-one", title: "虚构评审会", start_time: "2026-08-06T02:00:00Z", update_time: "2026-08-06T03:00:00Z", minute_token: "minute-one" }] };
      if (module === "minutes") return { items: [{ minute_token: "minute-one", title: "虚构评审会纪要", update_time: "2026-08-06T03:10:00Z", summary: "决定采用分批发布，并由测试人员完成验收。", todos: ["补充回滚演练"] }] };
      if (module === "documents") return { items: [{ document_id: "doc-one", title: "虚构发布说明", edit_time: "2026-08-06T04:00:00Z", summary: "记录发布步骤和验证结果。", url: "https://example.invalid/docs/doc-one" }] };
      if (module === "base") return { items: [{ record_id: "record-one", title: "虚构需求", update_time: "2026-08-06T05:00:00Z", status: "推进中", fields: { 标题: "虚构需求", 状态: "推进中" } }], nextPage: undefined };
      if (module === "approvals") return { items: [{ instance_code: `approval-${request.selection.kind || request.selection.topic}`, definition_name: "虚构发布审批", update_time: "2026-08-06T06:00:00Z", status: "通过", result: "允许发布虚构版本" }] };
      if (module === "messages") return { items: [
        { message_id: "message-one", sender_id: "ou_private_fixture", chat_type: "group", create_time: "2026-08-06T07:00:00Z", update_time: "2026-08-06T07:00:00Z", text: "结论：虚构版本已验证，可以发布。" },
        { message_id: "message-chatter", sender_id: "ou_other", chat_type: "group", create_time: "2026-08-06T07:01:00Z", text: "收到" }
      ] };
      return { items: [] };
    }
  };
}

function task(id, status) {
  return { task_id: id, summary: status === "已完成" ? "虚构任务已完成" : "推进虚构任务", status,
    create_time: "2026-08-05T08:00:00Z", update_time: status === "已完成" ? "2026-08-06T08:30:00Z" : "2026-08-06T08:00:00Z",
    description: "验证任务、记录结果并保留来源。", url: `https://example.invalid/tasks/${id}` };
}

function jsonResult(value) {
  return { stdout: JSON.stringify(value), stderr: "" };
}
