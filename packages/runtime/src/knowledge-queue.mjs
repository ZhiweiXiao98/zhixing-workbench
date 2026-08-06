import { createHash } from "node:crypto";

const AUTOMATION_PATTERN = /^\s*(?:<heartbeat>|Automation(?: ID)?\s*:)/i;
const EXCLUDED_PROMPT_PATTERN = /^\s*\[no-obsidian\]/i;
const SUGGESTION_PROMPT_PATTERN =
  /^\s*# Overview\s+Generate 0 to 3 hyperpersonalized suggestions\b/i;
const NO_OP_AUTOMATION_PATTERN =
  /收件箱为空|队列为空|无新增|暂无新增|暂无反馈|暂无待办|未发现新增|没有新的|没有待处理|没有可处理|无需用户操作|状态无新增变化|状态与上次一致|本轮未领取任何工单|本轮无新增处理结果/i;
const DURABLE_AUTOMATION_PATTERN =
  /(?:日报|早报|工作日志).{0,24}(?:已生成|已发送|已写入)|已写入.{0,24}(?:日报|日志)|message_id|日志\s*ID|记录\s*rec[a-z0-9]+|(?:创建|更新|关闭|处理|回复).{0,16}(?:Issue|工单|反馈)|(?:Issue|工单|反馈).{0,16}(?:已创建|已更新|已关闭|已处理|已回复)|commit\s*[0-9a-f]{7,40}/i;
const STATE_TRANSITION_PATTERN =
  /(?:通道|服务|Runner|端口).{0,20}(?:已恢复|恢复正常|首次中断|再次中断|再次离线)|(?:已恢复|恢复正常).{0,20}(?:通道|服务|Runner|端口)/i;

export function parseSessionIndex(text) {
  const titles = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const value = JSON.parse(line);
      if (typeof value.id !== "string" || typeof value.thread_name !== "string") {
        continue;
      }
      const candidate = {
        title: value.thread_name.trim(),
        updatedAt: typeof value.updated_at === "string" ? value.updated_at : ""
      };
      const existing = titles.get(value.id);
      if (!existing || candidate.updatedAt >= existing.updatedAt) {
        titles.set(value.id, candidate);
      }
    } catch {
      // A concurrently appended final line is retried on the next run.
    }
  }
  return titles;
}

export function compileKnowledgeQueue(pairs, settlements, sessionIndex, options = {}) {
  const maxTopics = boundedInteger(options.maxTopics, 6, 0, 24);
  const maxPairs = boundedInteger(options.maxPairs, 40, 1, 240);
  const maxChars = boundedInteger(options.maxChars, 120_000, 1, 2_000_000);
  const quietHours = boundedNumber(options.quietHours, 2, 0, 168);
  const recentHours = boundedNumber(options.recentHours, 48, 1, 720);
  const retryBackoffHours = boundedNumber(options.retryBackoffHours, 12, 0, 168);
  const laneOffset = boundedInteger(options.laneOffset, 0, 0, 2);
  const now = validTimestamp(options.now) ?? Date.now();
  const pendingPairIds = options.pendingPairIds instanceof Set
    ? options.pendingPairIds
    : new Set(pairs.map((pair) => pair.id));
  const noOpAutomationPairs = [];
  const substantiveAutomationPairs = [];
  const supportingPairs = [];
  const candidatePairs = [];

  for (const pair of pairs) {
    const isPending = pendingPairIds.has(pair.id);
    const automation = classifyAutomationPair(pair);
    if (automation === "no-op") {
      if (isPending) {
        noOpAutomationPairs.push(pair);
      }
    } else if (automation === "substantive") {
      if (isPending) {
        substantiveAutomationPairs.push(pair);
      }
      candidatePairs.push(pair);
    } else if (isSupportingPair(pair, sessionIndex)) {
      if (isPending) {
        supportingPairs.push(pair);
      }
    } else {
      candidatePairs.push(pair);
    }
  }

  const topics = buildTopics(candidatePairs, settlements, sessionIndex, {
    pendingPairIds,
    now,
    quietHours,
    recentHours,
    retryBackoffHours
  })
    .filter((topic) => topic.pairIds.some((id) => pendingPairIds.has(id)));
  const eligibleTopics = topics.filter((topic) => topic.eligible);
  const selection = selectTopics(eligibleTopics, maxTopics, maxPairs, maxChars, laneOffset);
  const selectedTopics = selection.topics;
  const selectedIds = new Set(selectedTopics.map((topic) => topic.id));
  const deferredTopics = topics.filter((topic) =>
    !selectedIds.has(topic.id) || selection.partialTopicIds.has(topic.id));
  const selectedPairIds = new Set(selectedTopics.flatMap((topic) => topic.pendingPairIds));
  const selectedPairs = candidatePairs.filter((pair) =>
    pendingPairIds.has(pair.id) && selectedPairIds.has(pair.id));
  const systemOutcomes = [
    ...systemOutcomesFor("no-op-automation", noOpAutomationPairs,
      (pair) => `${automationKind(pair)}:${pair.date}`,
      "自动化本轮只有空队列、状态未变化或明确无新增的结果；原始记录保留，不重复生成知识。"),
    ...systemOutcomesFor("supporting-session", supportingPairs,
      (pair) => `${pair.session_id}:${pair.date}`,
      "该记录具有明确的内部辅助 Agent 指令签名，作为主任务证据保留，不独立生成 Wiki。")
  ];

  return {
    selectedPairs,
    selectedTopics: selectedTopics.map((topic) => contractTopic(topic)),
    systemPairs: [...noOpAutomationPairs, ...supportingPairs],
    systemOutcomes,
    queue: {
      raw_pending_pairs: pendingPairIds.size,
      no_op_automation_pairs: noOpAutomationPairs.length,
      substantive_automation_pairs: substantiveAutomationPairs.length,
      supporting_pairs: supportingPairs.length,
      candidate_pairs: candidatePairs.filter((pair) => pendingPairIds.has(pair.id)).length,
      candidate_topics: topics.length,
      selected_pairs: selectedPairs.length,
      selected_topics: selectedTopics.length,
      deferred_topics: deferredTopics.length,
      deferred_oversize_topics: selection.oversizeTopics,
      partial_topics: selection.partialTopics,
      needs_compaction_topics: selection.needsCompactionTopics,
      selected_chars: selection.characters,
      open_topics: topics.filter((topic) =>
        topic.eligibilityState === "open" && !topic.retryCooling).length,
      ready_topics: topics.filter((topic) => topic.eligible).length,
      retry_topics: topics.filter((topic) => topic.lane === "retry").length,
      cooling_retry_topics: topics.filter((topic) => topic.retryCooling).length,
      backlog_topics: topics.filter((topic) => topic.lane === "backlog").length,
      recent_topics: topics.filter((topic) => topic.lane === "recent").length,
      selected_lanes: selection.selectedLanes,
      lane_start: selection.laneOrder[0],
      max_topics: maxTopics,
      max_pairs: maxPairs,
      max_chars: maxChars,
      quiet_hours: quietHours,
      recent_hours: recentHours,
      retry_backoff_hours: retryBackoffHours
    }
  };
}

function buildTopics(pairs, settlements, sessionIndex, options) {
  const pairAnchors = segmentAnchors(pairs, sessionIndex);
  const grouped = new Map();
  for (const pair of pairs) {
    const segment = pairAnchors.get(pair.id);
    const anchor = segment?.anchor ?? fallbackAnchor(pair, sessionIndex);
    const id = `topic:${hash(anchor).slice(0, 24)}`;
    const topic = grouped.get(id) ?? {
      id,
      anchor,
      source: pair.source,
      project: projectLabel(pair),
      title: segment?.title ?? topicTitle(pair, sessionIndex).title,
      titleSource: segment?.titleSource ?? topicTitle(pair, sessionIndex).source,
      pairs: []
    };
    topic.pairs.push(pair);
    grouped.set(id, topic);
  }

  const latestDate = pairs.map((pair) => pair.date).sort().at(-1) ?? "1970-01-01";
  return [...grouped.values()].map((topic) => {
    topic.pairs.sort((left, right) =>
      left.captured_at.localeCompare(right.captured_at) || left.id.localeCompare(right.id));
    const sourceEventIds = unique(topic.pairs.flatMap((pair) => pair.source_event_ids));
    const pendingPairs = topic.pairs.filter((pair) => options.pendingPairIds.has(pair.id));
    const previous = settlements.filter((settlement) =>
      intersects(sourceEventIds, settlement.source_event_ids || []));
    const reusableSettlements = previous.filter((settlement) =>
      settlement.status === "succeeded" &&
      Array.isArray(settlement.source_event_ids) &&
      settlement.source_event_ids.length > 0 &&
      settlement.source_event_ids.every((id) => sourceEventIds.includes(id)));
    const stableId = reusableSettlements.length === 1 ? reusableSettlements[0].id : topic.id;
    const actualAttempts = previous.filter((settlement) =>
      (settlement.status === "pending" || settlement.status === "failed") &&
      !String(settlement.id || "").startsWith("outcome:backfill:"));
    const succeededBefore = previous.some((settlement) =>
      settlement.status === "succeeded" || settlement.status === "not-applicable");
    const firstSeen = topic.pairs[0]?.captured_at ?? "";
    const lastSeen = topic.pairs.at(-1)?.captured_at ?? firstSeen;
    const quietUntilMs = (validTimestamp(lastSeen) ?? options.now) + options.quietHours * 3_600_000;
    const lastAttemptAt = actualAttempts.map((item) => item.updated_at || "").sort().at(-1);
    const lastAttemptMs = validTimestamp(lastAttemptAt);
    const hasNewEvidence = lastAttemptMs !== undefined && pendingPairs.some((pair) =>
      (validTimestamp(pair.captured_at) ?? 0) > lastAttemptMs);
    const backoffHours = Math.min(
      options.retryBackoffHours * 2 ** Math.max(0, actualAttempts.length - 1),
      72
    );
    const retryAfterMs = lastAttemptMs === undefined ? undefined : lastAttemptMs + backoffHours * 3_600_000;
    const retryCooling = actualAttempts.length > 0 && !hasNewEvidence &&
      retryAfterMs !== undefined && options.now < retryAfterMs;
    const eligible = options.now >= quietUntilMs && !retryCooling;
    const eligibilityState = eligible ? (succeededBefore ? "reopened" : "ready") : "open";
    const recent = options.now - (validTimestamp(lastSeen) ?? options.now) <=
      options.recentHours * 3_600_000;
    const lane = actualAttempts.length > 0 ? "retry" : recent ? "recent" : "backlog";
    return {
      id: stableId,
      anchor: topic.anchor,
      source: topic.source,
      project: topic.project,
      title: topic.title,
      titleSource: topic.titleSource,
      pairIds: topic.pairs.map((pair) => pair.id),
      pendingPairIds: pendingPairs.map((pair) => pair.id),
      pendingPairs,
      contextPairs: topic.pairs.filter((pair) => !options.pendingPairIds.has(pair.id)),
      sourceEventIds,
      pendingSourceEventIds: unique(pendingPairs.flatMap((pair) => pair.source_event_ids)),
      pairCount: topic.pairs.length,
      pendingPairCount: pendingPairs.length,
      contextPairCount: topic.pairs.length - pendingPairs.length,
      pendingCharacterCount: pendingPairs.reduce((sum, pair) => sum + pairCharacters(pair), 0),
      contextCharacterCount: topic.pairs
        .filter((pair) => !options.pendingPairIds.has(pair.id))
        .reduce((sum, pair) => sum + pairCharacters(pair), 0),
      firstSeen,
      lastSeen,
      priority: topicPriority(topic.pairs, latestDate),
      attemptCount: actualAttempts.length,
      lastAttemptAt,
      eligible,
      eligibilityState,
      quietUntil: new Date(quietUntilMs).toISOString(),
      retryAfter: retryAfterMs === undefined ? undefined : new Date(retryAfterMs).toISOString(),
      retryCooling,
      lane,
      relatedSettlementIds: unique(previous.map((settlement) => settlement.id))
    };
  }).sort(compareTopics);
}

function selectTopics(topics, maxTopics, maxPairs, maxChars, laneOffset) {
  if (maxTopics === 0) {
    return emptySelection(laneOffset);
  }
  const laneOrder = rotate(["retry", "backlog", "recent"], laneOffset);
  const oversizeTopics = topics.filter((topic) =>
    topic.pendingPairCount > maxPairs || topic.pendingCharacterCount > maxChars).length;
  const needsCompactionTopics = topics.filter((topic) =>
    topic.pendingPairs.some((pair) => pairCharacters(pair) > maxChars)).length;
  const lanes = new Map(["retry", "backlog", "recent"].map((lane) => [
    lane,
    projectRoundRobin(topics.filter((topic) => topic.lane === lane)
      .sort(lane === "retry" ? compareRetryTopics : compareTopics))
  ]));
  const fairnessLaneCount = Math.max(1, Math.min(
    maxTopics,
    [...lanes.values()].filter((queue) => queue.length > 0).length
  ));
  const lanePairCap = Math.max(1, Math.floor(maxPairs / fairnessLaneCount));
  const laneCharacterCap = Math.max(1, Math.floor(maxChars / fairnessLaneCount));
  const selected = [];
  let pairCount = 0;
  let characters = 0;
  let partialTopics = 0;
  const partialTopicIds = new Set();
  const selectedLanes = { retry: 0, backlog: 0, recent: 0 };
  while (selected.length < maxTopics && [...lanes.values()].some((queue) => queue.length > 0)) {
    let progressed = false;
    for (const lane of laneOrder) {
      const queue = lanes.get(lane);
      while (queue.length > 0) {
        const topic = queue.shift();
        const fitted = fitTopicSlice(
          topic,
          Math.min(maxPairs - pairCount, lanePairCap),
          Math.min(maxChars - characters, laneCharacterCap)
        );
        if (!fitted) {
          continue;
        }
        selected.push(fitted);
        pairCount += fitted.pendingPairCount;
        characters += fitted.pendingCharacterCount;
        if (fitted.partialTopic) {
          partialTopics += 1;
          partialTopicIds.add(fitted.id);
        }
        selectedLanes[lane] += 1;
        progressed = true;
        break;
      }
      if (selected.length >= maxTopics) {
        break;
      }
    }
    if (!progressed) {
      break;
    }
  }
  return {
    topics: selected,
    characters,
    oversizeTopics,
    partialTopics,
    needsCompactionTopics,
    partialTopicIds,
    selectedLanes,
    laneOrder
  };
}

function compareTopics(left, right) {
  const leftAttempted = Boolean(left.lastAttemptAt);
  const rightAttempted = Boolean(right.lastAttemptAt);
  if (leftAttempted !== rightAttempted) {
    return Number(leftAttempted) - Number(rightAttempted);
  }
  if (leftAttempted && rightAttempted) {
    const attemptOrder = left.lastAttemptAt.localeCompare(right.lastAttemptAt);
    if (attemptOrder !== 0) {
      return attemptOrder;
    }
  }
  return right.priority - left.priority ||
    left.firstSeen.localeCompare(right.firstSeen) ||
    left.id.localeCompare(right.id);
}

function compareRetryTopics(left, right) {
  return String(left.lastAttemptAt || "").localeCompare(String(right.lastAttemptAt || "")) ||
    compareTopics(left, right);
}

function projectRoundRobin(topics) {
  const projects = new Map();
  for (const topic of topics) {
    const queue = projects.get(topic.project) ?? [];
    queue.push(topic);
    projects.set(topic.project, queue);
  }
  const ordered = [];
  while ([...projects.values()].some((queue) => queue.length > 0)) {
    for (const queue of projects.values()) {
      const topic = queue.shift();
      if (topic) {
        ordered.push(topic);
      }
    }
  }
  return ordered;
}

function emptySelection(laneOffset = 0) {
  return {
    topics: [],
    characters: 0,
    oversizeTopics: 0,
    partialTopics: 0,
    needsCompactionTopics: 0,
    partialTopicIds: new Set(),
    selectedLanes: { retry: 0, backlog: 0, recent: 0 },
    laneOrder: rotate(["retry", "backlog", "recent"], laneOffset)
  };
}

function rotate(values, offset) {
  const start = Math.max(0, Number(offset) || 0) % values.length;
  return [...values.slice(start), ...values.slice(0, start)];
}

function fitTopicSlice(topic, availablePairs, availableChars) {
  if (availablePairs <= 0 || availableChars <= 0) {
    return undefined;
  }
  const selectedPending = [];
  let characters = 0;
  for (const pair of topic.pendingPairs) {
    const pairChars = pairCharacters(pair);
    if (selectedPending.length >= availablePairs || characters + pairChars > availableChars) {
      break;
    }
    selectedPending.push(pair);
    characters += pairChars;
  }
  if (selectedPending.length === 0) {
    return undefined;
  }
  if (selectedPending.length === topic.pendingPairs.length) {
    return {
      ...topic,
      partialTopic: false,
      remainingPendingPairs: 0
    };
  }
  const includedIds = new Set([
    ...topic.contextPairs.map((pair) => pair.id),
    ...selectedPending.map((pair) => pair.id)
  ]);
  const includedPairs = [...topic.contextPairs, ...selectedPending]
    .sort((left, right) =>
      left.captured_at.localeCompare(right.captured_at) || left.id.localeCompare(right.id));
  return {
    ...topic,
    pairs: includedPairs,
    pairIds: topic.pairIds.filter((id) => includedIds.has(id)),
    pendingPairs: selectedPending,
    pendingPairIds: selectedPending.map((pair) => pair.id),
    sourceEventIds: unique(includedPairs.flatMap((pair) => pair.source_event_ids)),
    pendingSourceEventIds: unique(selectedPending.flatMap((pair) => pair.source_event_ids)),
    pairCount: includedPairs.length,
    pendingPairCount: selectedPending.length,
    pendingCharacterCount: characters,
    partialTopic: true,
    remainingPendingPairs: topic.pendingPairs.length - selectedPending.length
  };
}

function contractTopic(topic) {
  return {
    id: topic.id,
    anchor: topic.anchor,
    source: topic.source,
    project: topic.project,
    title: topic.title,
    title_source: topic.titleSource,
    pair_ids: topic.pairIds,
    pending_pair_ids: topic.pendingPairIds,
    source_event_ids: topic.pendingSourceEventIds,
    all_source_event_ids: topic.sourceEventIds,
    pair_count: topic.pairCount,
    pending_pair_count: topic.pendingPairCount,
    context_pair_count: topic.contextPairCount,
    pending_character_count: topic.pendingCharacterCount,
    context_character_count: topic.contextCharacterCount,
    partial_topic: Boolean(topic.partialTopic),
    remaining_pending_pairs: topic.remainingPendingPairs || 0,
    first_seen: topic.firstSeen,
    last_seen: topic.lastSeen,
    quiet_until: topic.quietUntil,
    retry_after: topic.retryAfter,
    retry_cooling: topic.retryCooling,
    eligibility_state: topic.eligibilityState,
    eligible: topic.eligible,
    queue_lane: topic.lane,
    related_settlement_ids: topic.relatedSettlementIds,
    priority: topic.priority,
    attempt_count: topic.attemptCount,
    last_attempt_at: topic.lastAttemptAt
  };
}

function systemOutcomesFor(category, pairs, groupKey, reason) {
  const grouped = new Map();
  for (const pair of pairs) {
    const key = groupKey(pair);
    const group = grouped.get(key) ?? [];
    group.push(pair);
    grouped.set(key, group);
  }
  return [...grouped.entries()].map(([key, group]) => {
    const sourceEventIds = unique(group.flatMap((pair) => pair.source_event_ids));
    return {
      id: `outcome:system:${category}:${hash(key).slice(0, 20)}`,
      status: "not-applicable",
      category,
      group_key: key,
      source_event_ids: sourceEventIds,
      pair_count: group.length,
      reason
    };
  });
}

function classifyAutomationPair(pair) {
  const content = String(pair.prompt_content || "");
  const stop = String(pair.stop_content || "");
  if (EXCLUDED_PROMPT_PATTERN.test(content)) {
    return "no-op";
  }
  if (SUGGESTION_PROMPT_PATTERN.test(content)) {
    return "no-op";
  }
  if (!AUTOMATION_PATTERN.test(content)) {
    return "ordinary";
  }
  if (DURABLE_AUTOMATION_PATTERN.test(stop) || STATE_TRANSITION_PATTERN.test(stop)) {
    return "substantive";
  }
  return NO_OP_AUTOMATION_PATTERN.test(stop) ? "no-op" : "substantive";
}

function isSupportingPair(pair, sessionIndex) {
  return pair.source === "codex" &&
    sessionIndex.available &&
    !sessionIndex.titles.has(pair.session_id) &&
    /^\s*系统指令：/i.test(String(pair.prompt_content || "")) &&
    /你是.{0,40}(?:Agent|智能体)|唯一工作重点|通过平台 Action/i.test(String(pair.prompt_content || ""));
}

function segmentAnchors(pairs, sessionIndex) {
  const assignments = new Map();
  const numberedFamilies = numberedFamilyAnchors(pairs, sessionIndex);
  const sessions = new Map();
  for (const pair of pairs) {
    const key = `${pair.source}:${pair.session_id || pair.conversation_id || pair.id}`;
    const group = sessions.get(key) ?? [];
    group.push(pair);
    sessions.set(key, group);
  }
  for (const sessionPairs of sessions.values()) {
    sessionPairs.sort((left, right) =>
      left.captured_at.localeCompare(right.captured_at) || left.id.localeCompare(right.id));
    let current;
    let segmentOrdinal = 0;
    for (const pair of sessionPairs) {
      const explicit = explicitAnchor(pair);
      const newGoal = newGoalTitle(pair.prompt_content);
      const delegatedGoal = current && isDelegationPrompt(pair.prompt_content);
      if (!current || (explicit && explicit !== current.anchor) ||
          ((newGoal || delegatedGoal) && !isShortContinuation(pair.prompt_content))) {
        segmentOrdinal += 1;
        const family = numberedFamilies.get(pair.session_id);
        const anchor = explicit ?? (segmentOrdinal === 1 && family
          ? family
          : segmentAnchor(pair, newGoal, segmentOrdinal));
        const title = segmentTopicTitle(pair, sessionIndex, newGoal);
        current = { anchor, ...title };
      }
      assignments.set(pair.id, current);
    }
  }
  return assignments;
}

function numberedFamilyAnchors(pairs, sessionIndex) {
  const sessions = new Map();
  const seen = new Set();
  for (const pair of pairs) {
    if (pair.source !== "codex" || seen.has(pair.session_id)) {
      continue;
    }
    seen.add(pair.session_id);
    const title = sessionIndex.titles.get(pair.session_id)?.title?.trim();
    if (!title) {
      continue;
    }
    const numbered = title.match(/^(.*?)\s*\(((?:[2-9]|\d{2,3}))\)\s*$/);
    const base = (numbered?.[1] ?? title).trim();
    const key = `${normalizedProject(pair.cwd)}:${normalizeText(base)}`;
    const group = sessions.get(key) ?? [];
    group.push({
      sessionId: pair.session_id,
      numbered: Boolean(numbered),
      firstSeen: pair.captured_at
    });
    sessions.set(key, group);
  }
  const anchors = new Map();
  for (const [key, group] of sessions) {
    const numbered = group.filter((item) => item.numbered);
    if (numbered.length === 0 || group.length < 2) {
      continue;
    }
    const base = group.filter((item) => !item.numbered)
      .sort((left, right) => left.firstSeen.localeCompare(right.firstSeen))[0];
    for (const item of [...numbered, ...(base ? [base] : [])]) {
      anchors.set(item.sessionId, `codex:numbered-family:${key}`);
    }
  }
  return anchors;
}

function segmentAnchor(pair, newGoal, ordinal) {
  if (pair.source === "feishu") {
    return `feishu:${pair.resource_type || "record"}:${pair.resource_id || pair.session_id}`;
  }
  if (pair.source === "chatgpt_web") {
    return `chatgpt:${pair.conversation_id || pair.session_id}`;
  }
  const base = `codex:${normalizedProject(pair.cwd)}:session:${pair.session_id}`;
  return ordinal === 1 ? base : `${base}:segment:${hash(newGoal || pair.id).slice(0, 16)}`;
}

function segmentTopicTitle(pair, sessionIndex, newGoal) {
  if (pair.source === "chatgpt_web" || pair.source === "feishu" || substantiveAutomationId(pair)) {
    const derived = topicTitle(pair, sessionIndex);
    return { title: derived.title, titleSource: derived.source };
  }
  const restored = restoredSessionTitle(pair.prompt_content, sessionIndex);
  if (restored) {
    return { title: restored, titleSource: "restored-session-index" };
  }
  if (newGoal) {
    return { title: newGoal, titleSource: "segment-prompt" };
  }
  const prompt = meaningfulPromptTitle(pair.prompt_content);
  if (prompt && !isShortContinuation(prompt)) {
    return { title: prompt, titleSource: "prompt" };
  }
  const indexed = sessionIndex.titles.get(pair.session_id)?.title;
  if (indexed) {
    return { title: indexed, titleSource: "session-index" };
  }
  return { title: prompt || "Codex 任务", titleSource: prompt ? "prompt" : "fallback" };
}

function newGoalTitle(value) {
  const line = meaningfulPromptTitle(value) || "";
  const match = line.match(
    /^(?:(?:新目标|新任务|另一个任务|另外一件事|切换任务|切换到|开始处理)\s*(?:是|为|要|请|做)?|接下来\s*(?:请|要|做|我们)?)\s*[:：，,]?\s*(.+)$/i
  );
  return match?.[1]?.trim().slice(0, 72);
}

function isShortContinuation(value) {
  const normalized = normalizeText(meaningfulPromptTitle(value) || "").replace(/[，,。.!！]/g, " ");
  if (!normalized || normalized.length > 24) {
    return false;
  }
  return /^(?:好|好的|可以|确认|同意|do|继续|接着|执行|开始|修复)(?:\s+(?:do|继续|接着|执行|开始|修复))?$/.test(normalized);
}

function isDelegationPrompt(value) {
  return /<codex_delegation\b/i.test(String(value || "")) && /<input\b/i.test(String(value || ""));
}

function meaningfulPromptTitle(value) {
  const raw = String(value || "");
  const input = raw.match(/<input\b[^>]*>([\s\S]*?)<\/input>/i)?.[1] ?? raw;
  for (const line of input.split(/\r?\n/)) {
    const candidate = line
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!candidate ||
        /^(?:source_thread_id|项目目录|工作目录|仓库路径|路径|Files mentioned by the user|My request for Codex)\s*[:：]?/i.test(candidate) ||
        /^[A-Za-z]:[\\/][^\s]+$/.test(candidate) ||
        /^[^:：]{1,120}:\s*[A-Za-z]:[\\/]/.test(candidate)) {
      continue;
    }
    return humanizeTopicTitle(candidate).slice(0, 72);
  }
  return undefined;
}

function restoredSessionTitle(value, sessionIndex) {
  const targetId = String(value || "").match(
    /恢复任务\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  )?.[1];
  if (!targetId) {
    return undefined;
  }
  const title = sessionIndex.titles.get(targetId)?.title?.trim();
  return title && !/^恢复任务/i.test(title) ? humanizeTopicTitle(title).slice(0, 72) : undefined;
}

function humanizeTopicTitle(value) {
  const title = String(value || "").trim();
  const issueTitle = title.match(/\bIssue\s*#?\d+[^「」]*「([^」]+)」/i)?.[1];
  if (issueTitle) {
    return issueTitle.replace(/^\[[^\]]{1,24}\]\s*/, "").trim();
  }
  return title.replace(/[。.]\s*严格遵循\s*[:：].*$/i, "").trim();
}

function explicitAnchor(pair) {
  if (pair.source === "feishu") {
    const project = normalizedProject(pair.cwd);
    const searchable = `${pair.prompt_content || ""}\n${pair.stop_content || ""}`;
    const issue = searchable.match(/\b(?:issue|议题|问题单)\s*#?(\d{1,8})\b/i)?.[1];
    return issue
      ? `codex:${project}:issue:${issue}`
      : `feishu:${pair.resource_type || "record"}:${pair.resource_id || pair.session_id}`;
  }
  if (pair.source === "chatgpt_web") {
    return `chatgpt:${pair.conversation_id || pair.session_id}`;
  }
  const automationId = substantiveAutomationId(pair);
  if (automationId) {
    const durableId = automationId === "平台反馈" ? durableAutomationTopicId(pair) : undefined;
    return durableId
      ? `automation:${normalizeText(automationId)}:${durableId}`
      : `automation:${normalizeText(automationId)}:${pair.date}`;
  }
  const project = normalizedProject(pair.cwd);
  const searchable = `${pair.prompt_content || ""}\n${pair.stop_content || ""}`.replace(/\\/g, "/");
  const task = searchable.match(/(?:^|\/)\.agent\/tasks\/([a-z0-9][a-z0-9._-]*)/i)?.[1];
  if (task) {
    return `codex:${project}:agent-task:${task.toLocaleLowerCase()}`;
  }
  const issue = searchable.match(/\b(?:issue|议题|问题单)\s*#?(\d{1,8})\b/i)?.[1];
  return issue ? `codex:${project}:issue:${issue}` : undefined;
}

function fallbackAnchor(pair, sessionIndex) {
  if (pair.source === "feishu") {
    return `feishu:${pair.resource_type || "record"}:${pair.resource_id || pair.session_id}`;
  }
  if (pair.source === "chatgpt_web") {
    return `chatgpt:${pair.conversation_id || pair.session_id}`;
  }
  const title = sessionIndex.titles.get(pair.session_id)?.title ?? "";
  const numbered = title.match(/^(.*?)\s*\((?:[2-9]|\d{2,})\)\s*$/)?.[1]?.trim();
  if (numbered) {
    return `codex:${normalizedProject(pair.cwd)}:numbered:${normalizeText(numbered)}`;
  }
  return `codex:${normalizedProject(pair.cwd)}:session:${pair.session_id}`;
}

function topicTitle(pair, sessionIndex) {
  if (pair.source === "feishu") {
    return {
      title: pair.title || firstLine(pair.stop_content) || "飞书记录",
      source: pair.title ? "source-title" : "content"
    };
  }
  if (pair.source === "chatgpt_web") {
    return {
      title: pair.title || firstLine(pair.prompt_content) || "ChatGPT 对话",
      source: pair.title ? "source-title" : "prompt"
    };
  }
  const automationId = substantiveAutomationId(pair);
  if (automationId) {
    const inboxTitle = String(pair.stop_content || "").match(/::inbox-item\{title="([^"]+)"/i)?.[1];
    return {
      title: inboxTitle || `${automationId} · ${pair.date}`,
      source: inboxTitle ? "automation-result" : "automation"
    };
  }
  const indexed = sessionIndex.titles.get(pair.session_id)?.title;
  return {
    title: indexed || firstLine(pair.prompt_content) || "Codex 任务",
    source: indexed ? "session-index" : "prompt"
  };
}

function substantiveAutomationId(pair) {
  if (classifyAutomationPair(pair) !== "substantive") {
    return undefined;
  }
  if (SUGGESTION_PROMPT_PATTERN.test(String(pair.prompt_content || ""))) {
    return undefined;
  }
  return automationKind(pair);
}

function automationKind(pair) {
  const text = `${pair.prompt_content || ""}\n${pair.stop_content || ""}`;
  if (SUGGESTION_PROMPT_PATTERN.test(String(pair.prompt_content || ""))) {
    return "建议生成";
  }
  if (/AI\s*HOT|每日早报|早报已送达/i.test(text)) {
    return "AI 日报";
  }
  if (/工作日志|日志\s*ID|日志ID|记录\s*rec[a-z0-9]+/i.test(text)) {
    return "飞书工作日报";
  }
  if (/反馈|工单|feedback:inbox/i.test(text)) {
    return "平台反馈";
  }
  return String(pair.prompt_content || "").match(/<automation_id>([^<]+)<\/automation_id>/i)?.[1]?.trim() ||
    "自动化";
}

function durableAutomationTopicId(pair) {
  const text = `${pair.prompt_content || ""}\n${pair.stop_content || ""}`;
  const issue = text.match(/(?:\/issues\/|\bIssue\s*#?)(\d{1,8})\b/i)?.[1];
  if (issue) {
    return `issue:${issue}`;
  }
  const feedback = text.match(/\b(?:feedback[_ -]?id|工单\s*ID|反馈\s*ID)\s*[:：#]?\s*([a-z0-9_-]{4,64})/i)?.[1];
  return feedback ? `feedback:${feedback.toLocaleLowerCase()}` : undefined;
}

function projectLabel(pair) {
  if (pair.source === "chatgpt_web") {
    return "ChatGPT";
  }
  if (pair.source === "feishu") {
    return String(pair.cwd || "飞书");
  }
  const normalized = normalizedProject(pair.cwd);
  return normalized.split("/").filter(Boolean).at(-1) || normalized || "未归属";
}

function normalizedProject(value) {
  let normalized = String(value || "unassigned").replace(/\\/g, "/").replace(/\/+$/, "");
  const worktree = normalized.match(/^(?:[A-Za-z]:\/Users\/[^/]+|\/(?:Users|home)\/[^/]+)\/\.codex\/worktrees\/[^/]+\/(.+)$/i)?.[1];
  if (worktree) {
    normalized = worktree;
  }
  return normalized.toLocaleLowerCase();
}

function topicPriority(pairs, latestDate) {
  const text = pairs.map((pair) => `${pair.prompt_content || ""}\n${pair.stop_content || ""}`).join("\n");
  const firstDate = pairs.map((pair) => pair.date).sort()[0] ?? latestDate;
  const ageDays = Math.max(0, Math.round((Date.parse(`${latestDate}T00:00:00Z`) -
    Date.parse(`${firstDate}T00:00:00Z`)) / 86_400_000));
  const repeated = Math.min(8, Math.max(0, pairs.length - 1));
  const failure = /失败|报错|异常|根因|竞态|权限|受阻|恢复|重试|回滚/i.test(text) ? 5 : 0;
  const validation = /测试|验证|构建|提交|commit|SHA256|HTTP\s*200/i.test(text) ? 3 : 0;
  const decision = /方案|架构|设计|决策|取舍|边界|迁移/i.test(text) ? 2 : 0;
  const automatedOutput = /message_id|日志\s*ID|记录\s*rec[a-z0-9]+|(?:处理|回复|关闭).{0,16}(?:反馈|工单|Issue)/i
    .test(text) ? 4 : 0;
  return repeated + failure + validation + decision + automatedOutput + Math.min(ageDays, 14);
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 72);
}

function normalizeText(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function validTimestamp(value) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pairCharacters(pair) {
  return String(pair.prompt_content || "").length + String(pair.stop_content || "").length;
}

function intersects(left, right) {
  const values = new Set(left);
  return right.some((value) => values.has(value));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
