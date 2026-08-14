import { createHash } from "node:crypto";
import path from "node:path";

const EVIDENCE_SECTIONS = [
  ["问题与现象", "problem"],
  ["根因与判断依据", "root_cause"],
  ["尝试过的路径", "attempts"],
  ["可复用的解决路径", "solution"],
  ["适用条件与边界", "boundaries"],
  ["验证方式与结果", "verification"],
  ["下次快速识别", "signals"]
];

const MEMORY_SECTIONS = [
  ["当时我想做什么", "goal"],
  ["我遇到了什么", "obstacle"],
  ["我是怎么判断的", "judgment"],
  ["我最后做了什么", "action"],
  ["这次留下了什么", "result"],
  ["下次遇到时", "next"]
];

const MANAGED_EVIDENCE_HEADINGS = new Set([
  "一眼看懂",
  ...EVIDENCE_SECTIONS.map(([heading]) => heading),
  "来源与关联"
]);
const MANAGED_MEMORY_HEADINGS = new Set([
  ...MEMORY_SECTIONS.map(([heading]) => heading),
  "需要追溯时"
]);
const MANAGED_EVIDENCE_FRONTMATTER = new Set([
  "zhixing_wiki_id",
  "zhixing_document",
  "projects",
  "last_verified",
  "trust",
  "source_event_ids"
]);
const MANAGED_MEMORY_FRONTMATTER = new Set([
  "zhixing_memory_id",
  "zhixing_document",
  "projects",
  "last_reviewed"
]);

/**
 * Converts an AI response that contains only semantic prose into the complete
 * outcome consumed by knowledge-transaction.mjs.
 */
export function renderSemanticOutcome({
  topic,
  pairs = [],
  existingDocuments,
  outcome,
  now
}) {
  assertObject(topic, "topic");
  assertObject(outcome, "outcome");

  const sourceEventIds = uniqueStrings(topic.source_event_ids);
  const status = String(outcome.status || "").trim();
  const base = {
    id: String(topic.id || "").trim(),
    status,
    source_event_ids: sourceEventIds,
    reason: text(outcome.reason) || undefined
  };

  if (!base.id) {
    throw new Error("主题缺少稳定 ID");
  }
  if (status === "pending" || status === "not-applicable") {
    return base;
  }
  if (status !== "succeeded") {
    throw new Error(`不支持的语义整理状态：${status || "空"}`);
  }

  const evidenceSemantic = requiredObject(outcome.evidence_document, "evidence_document");
  const memorySemantic = requiredObject(outcome.memory_document, "memory_document");
  const evidenceSections = requiredObject(evidenceSemantic.sections, "evidence_document.sections");
  const memorySections = requiredObject(memorySemantic.sections, "memory_document.sections");
  const documents = Array.isArray(existingDocuments)
    ? existingDocuments
    : topic.existing_knowledge?.documents || [];
  const managedEvidence = documents.filter((document) =>
    document?.role === "evidence" && document?.managed !== false);
  const managedMemory = documents.find((document) =>
    document?.role === "memory" && document?.managed !== false);

  const projectDirectory = projectPath(topic.project_directory || topic.project);
  const projects = uniqueStrings([
    ...frontmatterProjects(managedMemory?.content),
    ...managedEvidence.flatMap((document) => frontmatterProjects(document.content)),
    ...arrayStrings(memorySemantic.projects),
    ...arrayStrings(evidenceSemantic.projects),
    text(topic.project)
  ]).filter(Boolean);
  if (projects.length === 0) {
    projects.push(projectDirectory.replaceAll("/", "、"));
  }

  const memoryTitle = naturalTitle(memorySemantic.title, topic.title, "这次工作留下的经验");
  const evidenceTitle = naturalTitle(evidenceSemantic.title, topic.title, "这次工作的判断与验证");
  const memoryPath = managedMemory
    ? safeManagedPath(managedMemory.path, "memory")
    : `wiki/我的经历/${projectDirectory}/${fileName(memoryTitle)}.md`;
  const evidenceDocuments = managedEvidence.length > 0
    ? managedEvidence
    : [{
      role: "evidence",
      managed: true,
      path: `wiki/${projectDirectory}/${fileName(evidenceTitle)}.md`,
      stable_id: stableId("evidence", topic.id)
    }];
  const evidencePaths = evidenceDocuments.map((document) =>
    safeManagedPath(document.path, "evidence"));

  const currentEventIds = uniqueStrings(pairs.flatMap((pair) =>
    pair?.source_event_ids || []));
  const currentDailyPaths = uniqueStrings(pairs.map((pair) => pair?.daily_path));
  const today = latestDate(pairs, topic) || isoDate(now);
  const occurredTime = text(memorySemantic.occurred_time) || dateRange(pairs, topic, today);
  const lastReviewed = validDate(memorySemantic.last_reviewed) || today;
  const lastVerified = validDate(evidenceSemantic.last_verified) ||
    latestDate(pairs, topic) || today;
  const trust = ["verified", "observed", "inferred"].includes(evidenceSemantic.trust)
    ? evidenceSemantic.trust
    : "observed";

  const digest = {
    about: memorySectionText(memorySections, "goal", "当时我想做什么"),
    problem: memorySectionText(memorySections, "obstacle", "我遇到了什么"),
    result: memorySectionText(memorySections, "result", "这次留下了什么"),
    next_use: memorySectionText(memorySections, "next", "下次遇到时")
  };

  const wikiUpdates = evidenceDocuments.map((document, index) => {
    const documentPath = evidencePaths[index];
    const existing = rawText(document.content);
    const stable = frontmatterValue(existing, "zhixing_wiki_id") ||
      text(document.stable_id) ||
      stableId("evidence", topic.id, index);
    const content = renderEvidence({
      title: evidenceTitle,
      projects,
      lastVerified,
      trust,
      sourceEventIds: uniqueStrings([
        ...extractSourceEventIds(existing),
        ...currentEventIds
      ]),
      sections: evidenceSections,
      memoryPath,
      evidencePath: documentPath,
      dailyPaths: uniqueStrings([
        ...extractDailyPaths(existing),
        ...currentDailyPaths
      ]),
      extraFrontmatter: unknownFrontmatter(existing, MANAGED_EVIDENCE_FRONTMATTER),
      extraSections: unknownSections(existing, MANAGED_EVIDENCE_HEADINGS),
      preservedSections: preservedManagedSections(existing, EVIDENCE_SECTIONS),
      preamble: preservedPreamble(existing, "evidence"),
      stableId: stable,
      digest
    });
    return {
      action: existing ? "updated" : "created",
      path: documentPath,
      title: evidenceTitle,
      expected_sha256: existing ? text(document.sha256) || sha256(existing) : "",
      content
    };
  });

  const existingMemory = rawText(managedMemory?.content);
  const memoryStableId = frontmatterValue(existingMemory, "zhixing_memory_id") ||
    text(managedMemory?.stable_id) ||
    stableId("memory", topic.id);
  const memoryContent = renderMemory({
    title: memoryTitle,
    projects,
    lastReviewed,
    occurredTime,
    sections: memorySections,
    evidencePaths,
    extraFrontmatter: unknownFrontmatter(existingMemory, MANAGED_MEMORY_FRONTMATTER),
    extraSections: unknownSections(existingMemory, MANAGED_MEMORY_HEADINGS),
    preservedSections: preservedManagedSections(existingMemory, MEMORY_SECTIONS),
    preamble: preservedPreamble(existingMemory, "memory"),
    stableId: memoryStableId
  });

  return {
    ...base,
    digest,
    wiki_updates: wikiUpdates,
    memory_update: {
      action: existingMemory ? "updated" : "created",
      path: memoryPath,
      title: memoryTitle,
      expected_sha256: existingMemory
        ? text(managedMemory?.sha256) || sha256(existingMemory)
        : "",
      content: memoryContent
    }
  };
}

export const renderKnowledgeOutcome = renderSemanticOutcome;

function renderEvidence({
  title,
  projects,
  lastVerified,
  trust,
  sourceEventIds,
  sections,
  memoryPath,
  evidencePath,
  dailyPaths,
  extraFrontmatter,
  extraSections,
  preservedSections,
  preamble,
  stableId,
  digest
}) {
  const lines = [
    "---",
    `zhixing_wiki_id: ${yamlScalar(stableId)}`,
    "zhixing_document: evidence",
    ...yamlList("projects", projects),
    `last_verified: ${lastVerified}`,
    `trust: ${trust}`,
    ...yamlList("source_event_ids", sourceEventIds),
    ...extraFrontmatter,
    "---",
    `# ${title}`,
    "",
    ...(preamble ? [preamble, ""] : []),
    "## 一眼看懂",
    `- **这是什么**：${digest.about}`,
    `- **解决了什么**：${digest.problem}`,
    `- **得到什么**：${digest.result}`,
    `- **以后怎么用**：${digest.next_use}`,
    ""
  ];
  for (const [heading, key] of EVIDENCE_SECTIONS) {
    lines.push(
      `## ${heading}`,
      managedBlock(key, sectionText(sections, key, heading)),
      preservedSections.get(heading) || "",
      ""
    );
  }
  lines.push(
    "## 来源与关联",
    `- 经历文章：${wikiLink(memoryPath)}`,
    ...dailyPaths.map((dailyPath) =>
      `- [${path.posix.basename(dailyPath, ".md")} 来源页](${relativeLink(evidencePath, dailyPath)})`),
    "",
    "### 本次来源事件",
    "```text",
    ...sourceEventIds,
    "```"
  );
  if (extraSections.length > 0) {
    lines.push("", ...extraSections);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderMemory({
  title,
  projects,
  lastReviewed,
  occurredTime,
  sections,
  evidencePaths,
  extraFrontmatter,
  extraSections,
  preservedSections,
  preamble,
  stableId
}) {
  const lines = [
    "---",
    `zhixing_memory_id: ${yamlScalar(stableId)}`,
    "zhixing_document: memory",
    ...yamlList("projects", projects),
    `last_reviewed: ${lastReviewed}`,
    ...extraFrontmatter,
    "---",
    `# ${title}`,
    "",
    `> **发生时间**：${occurredTime} · **项目**：${projects.join("、")}`,
    ...(preamble ? ["", preamble] : []),
    ""
  ];
  for (const [heading, key] of MEMORY_SECTIONS) {
    lines.push(
      `## ${heading}`,
      managedBlock(key, memorySectionText(sections, key, heading)),
      preservedSections.get(heading) || "",
      ""
    );
  }
  lines.push(
    "## 需要追溯时",
    ...evidencePaths.map((evidencePath) => `- AI 证据页：${wikiLink(evidencePath)}`)
  );
  if (extraSections.length > 0) {
    lines.push("", ...extraSections);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function sectionText(sections, key, label) {
  const value = text(sections?.[key]);
  if (!value) {
    throw new Error(`语义结果缺少“${label}”`);
  }
  return value;
}

function memorySectionText(sections, key, label) {
  const value = sectionText(sections, key, label);
  if (value.replace(/\s+/g, "").length < 40 ||
      !value.split(/\r?\n/).some((line) =>
        line.trim().length >= 40 && !/^(?:[-*+]\s|\d+[.)、]\s?)/.test(line.trim()))) {
    throw new Error(`语义结果的“${label}”需要用完整自然段讲清楚`);
  }
  return value;
}

function unknownSections(content, managedHeadings) {
  const value = text(content);
  if (!value) {
    return [];
  }
  const matches = [...value.matchAll(/^##\s+(.+?)\s*$/gm)];
  const sections = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const heading = match[1].trim();
    if (managedHeadings.has(heading)) {
      continue;
    }
    const start = match.index;
    const end = matches[index + 1]?.index ?? value.length;
    sections.push(value.slice(start, end).trimEnd());
  }
  return sections;
}

function preservedPreamble(content, role) {
  const value = rawText(content);
  if (!value) {
    return "";
  }
  const withoutFrontmatter = value.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
  const title = /^#\s+.+$/m.exec(withoutFrontmatter);
  if (!title) {
    return "";
  }
  const afterTitle = withoutFrontmatter.slice(title.index + title[0].length);
  const firstSection = afterTitle.search(/^##\s+/m);
  const preamble = (firstSection < 0 ? afterTitle : afterTitle.slice(0, firstSection))
    .split(/\r?\n/)
    .filter((line) => role !== "memory" ||
      !/^>\s*\*\*发生时间\*\*[：:]/.test(line.trim()))
    .join("\n")
    .trim();
  return preamble;
}

function preservedManagedSections(content, sectionDefinitions) {
  const preserved = new Map();
  for (const [heading, key] of sectionDefinitions) {
    const body = markdownSectionBody(content, heading);
    if (!body) {
      continue;
    }
    const withoutManaged = body.replace(
      new RegExp(
        `<!--\\s*zhixing-semantic:start:${escapeRegExp(key)}\\s*-->[\\s\\S]*?` +
        `<!--\\s*zhixing-semantic:end:${escapeRegExp(key)}\\s*-->`,
        "g"
      ),
      ""
    ).trim();
    if (withoutManaged !== body.trim()) {
      if (withoutManaged) {
        preserved.set(heading, withoutManaged);
      }
      continue;
    }

    // Legacy pages had no generated-block markers. Keep everything after the
    // first prose block so inline notes and level-three user sections survive
    // the one-time migration to deterministic managed blocks.
    const blocks = withoutManaged.split(/\r?\n\s*\r?\n/).filter((block) => block.trim());
    if (blocks.length > 1) {
      preserved.set(heading, blocks.slice(1).join("\n\n").trim());
    } else if (/^###\s+/m.test(withoutManaged)) {
      preserved.set(heading, withoutManaged.slice(withoutManaged.search(/^###\s+/m)).trim());
    }
  }
  return preserved;
}

function markdownSectionBody(content, heading) {
  const value = rawText(content);
  const match = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m").exec(value);
  if (!match) {
    return "";
  }
  const start = match.index + match[0].length;
  const remaining = value.slice(start);
  const next = remaining.search(/^##\s+/m);
  return (next < 0 ? remaining : remaining.slice(0, next)).trim();
}

function managedBlock(key, value) {
  return [
    `<!-- zhixing-semantic:start:${key} -->`,
    value,
    `<!-- zhixing-semantic:end:${key} -->`
  ].join("\n");
}

function unknownFrontmatter(content, managedKeys) {
  const metadata = frontmatter(text(content));
  if (!metadata) {
    return [];
  }
  const lines = metadata.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const match = lines[index].match(/^([A-Za-z_][\w-]*):/);
    if (!match) {
      index += 1;
      continue;
    }
    const block = [lines[index]];
    index += 1;
    while (index < lines.length && !/^[A-Za-z_][\w-]*:/.test(lines[index])) {
      block.push(lines[index]);
      index += 1;
    }
    if (!managedKeys.has(match[1])) {
      blocks.push(...block);
    }
  }
  return blocks;
}

function frontmatterProjects(content) {
  const metadata = frontmatter(text(content));
  if (!metadata) {
    return [];
  }
  const inline = metadata.match(/^projects:\s*\[([^\]]*)]\s*$/m)?.[1];
  if (inline !== undefined) {
    return inline.split(",").map(unquote).filter(Boolean);
  }
  const block = metadata.match(/^projects:\s*$\r?\n((?:\s+-\s+.*(?:\r?\n|$))*)/m)?.[1] || "";
  return block.split(/\r?\n/)
    .map((line) => unquote(line.replace(/^\s*-\s*/, "")))
    .filter(Boolean);
}

function extractSourceEventIds(content) {
  const metadata = frontmatter(text(content));
  const inline = metadata.match(/^source_event_ids:\s*\[([^\]]*)]\s*$/m)?.[1];
  let metadataIds;
  if (inline !== undefined) {
    metadataIds = inline.split(",").map(unquote).filter(Boolean);
  } else {
    const block = metadata.match(
      /^source_event_ids:\s*$\r?\n((?:\s+-\s+.*(?:\r?\n|$))*)/m
    )?.[1] || "";
    metadataIds = block.split(/\r?\n/)
      .map((line) => unquote(line.replace(/^\s*-\s*/, "")))
      .filter(Boolean);
  }
  const canonicalIds = [...rawText(content).matchAll(
    /[^\s"'`]+:(?:UserPromptSubmit|Stop):[0-9a-f]{64}/gi
  )].map((match) => match[0]);
  return uniqueStrings(metadataIds.length > 0 ? metadataIds : canonicalIds);
}

function extractDailyPaths(content) {
  return uniqueStrings([...text(content).matchAll(
    /(?:\.\.\/)*((?:raw\/(?:codex|chatgpt)\/daily\/)\d{4}-\d{2}-\d{2}\.md)/gi
  )].map((match) => match[1]));
}

function frontmatterValue(content, key) {
  const raw = frontmatter(content)
    .match(new RegExp(`^${escapeRegExp(key)}:\\s*([^\\r\\n]+)\\s*$`, "m"))?.[1]?.trim() || "";
  return unquote(raw);
}

function frontmatter(content) {
  return text(content).match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)?.[1] || "";
}

function projectPath(value) {
  const raw = text(value);
  let candidate = /^[A-Za-z]:[\\/]/.test(raw)
    ? path.win32.basename(raw)
    : raw;
  candidate = candidate.replaceAll("\\", "/");
  const parts = candidate.split("/")
    .map((part) => safePathPart(part))
    .filter(Boolean)
    .filter((part) => part !== "." && part !== ".." && part !== "我的经历");
  if (parts.length === 0) {
    return "未归类";
  }
  return parts.join("/");
}

function safeManagedPath(value, role) {
  const normalized = text(value).replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized.endsWith(".md") || normalized.includes("..") ||
      normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`已有${role === "memory" ? "经历文章" : "AI 证据页"}路径无效`);
  }
  const memory = normalized.startsWith("wiki/我的经历/");
  if (role === "memory" ? !memory : !normalized.startsWith("wiki/") || memory) {
    throw new Error(`已有${role === "memory" ? "经历文章" : "AI 证据页"}超出允许目录`);
  }
  return normalized;
}

function fileName(value) {
  let cleaned = text(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\.{2,}/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/g, "");
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(cleaned)) {
    cleaned = `${cleaned}-笔记`;
  }
  return cleaned || "未命名经验";
}

function safePathPart(value) {
  return fileName(value).replace(/^未命名经验$/, "");
}

function naturalTitle(primary, fallback, defaultValue) {
  const value = text(primary) || text(fallback) || defaultValue;
  return value.replace(/^#+\s*/, "").trim();
}

function wikiLink(target) {
  const normalized = text(target).replaceAll("\\", "/")
    .replace(/^wiki\//, "")
    .replace(/\.md$/i, "");
  return `[[${normalized}]]`;
}

function relativeLink(from, to) {
  const relative = path.posix.relative(path.posix.dirname(from), to);
  return relative || path.posix.basename(to);
}

function yamlList(key, values) {
  return [
    `${key}:`,
    ...values.map((value) => `  - ${yamlScalar(value)}`)
  ];
}

function yamlScalar(value) {
  const string = text(value);
  if (!string || /^(?:null|true|false|yes|no|[-+]?\d+(?:\.\d+)?)$/i.test(string) ||
      /[:#[\]{},&*!|>'"%@`]|^\s|\s$/.test(string)) {
    return JSON.stringify(string);
  }
  return string;
}

function dateRange(pairs, topic, fallback) {
  const dates = uniqueStrings([
    ...pairs.map((pair) => pair?.date || String(pair?.captured_at || "").slice(0, 10)),
    topic.first_seen?.slice?.(0, 10),
    topic.last_seen?.slice?.(0, 10)
  ]).filter(validDate).sort();
  if (dates.length === 0) {
    return fallback;
  }
  return dates.length === 1 ? dates[0] : `${dates[0]} 至 ${dates.at(-1)}`;
}

function latestDate(pairs, topic) {
  return uniqueStrings([
    ...pairs.map((pair) => pair?.date || String(pair?.captured_at || "").slice(0, 10)),
    topic.last_seen?.slice?.(0, 10)
  ]).filter(validDate).sort().at(-1);
}

function validDate(value) {
  const candidate = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : "";
}

function isoDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  if (value === undefined || value === null || value === "") {
    throw new Error("主题和合同都缺少可用于渲染的日期");
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error("now 不是有效日期");
  }
  return date.toISOString().slice(0, 10);
}

function stableId(role, topicId, index = 0) {
  return `zhixing-${role}-${sha256(`${topicId}\0${index}`).slice(0, 20)}`;
}

function sha256(value) {
  return createHash("sha256").update(text(value), "utf8").digest("hex");
}

function uniqueStrings(values) {
  return [...new Set(arrayStrings(values))];
}

function arrayStrings(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function unquote(value) {
  const candidate = text(value);
  if ((candidate.startsWith('"') && candidate.endsWith('"')) ||
      (candidate.startsWith("'") && candidate.endsWith("'"))) {
    try {
      return candidate.startsWith('"')
        ? JSON.parse(candidate)
        : candidate.slice(1, -1).replaceAll("''", "'");
    } catch {
      return candidate.slice(1, -1);
    }
  }
  return candidate;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function rawText(value) {
  return typeof value === "string" ? value : "";
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
}

function requiredObject(value, label) {
  assertObject(value, label);
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
