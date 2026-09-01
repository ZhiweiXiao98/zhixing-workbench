import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CONTRACT_PATH = "raw/codex/maintenance-contract.json";
const STATE_PATH = "raw/codex/knowledge-maintenance-state.json";
const LEDGER_PATH = "raw/codex/knowledge-settlements.json";
const JOURNAL_PATH = "raw/codex/staging/maintenance-write-journal.json";
const SUMMARY_SECTIONS = [
  ["这份总览解决什么", "overview"],
  ["核心结论", "themes"],
  ["已确认的决策", "decisions"],
  ["失败路径与踩坑", "pitfalls"],
  ["可复用的行动路径", "playbook"],
  ["冲突、演变与当前口径", "conflicts"],
  ["适用边界", "boundaries"],
  ["待验证问题", "open_questions"]
];
const EVIDENCE_HEADINGS = new Set([
  "一眼看懂", "问题与现象", "根因与判断依据", "尝试过的路径", "可复用的解决路径",
  "适用条件与边界", "验证方式与结果", "下次快速识别", "来源与关联"
]);
const EVIDENCE_FRONTMATTER = new Set([
  "zhixing_wiki_id", "zhixing_document", "projects", "last_verified", "trust", "source_event_ids"
]);
const SYNTHESIS_FRONTMATTER = new Set([
  "zhixing_synthesis_id", "zhixing_document", "projects", "last_synthesized", "trust",
  "source_paths", "source_event_ids"
]);

export async function prepareMaintenance(vaultRoot, options = {}) {
  const vault = path.resolve(vaultRoot);
  await recoverMaintenanceJournal(vault);
  const runId = String(options.runId || options["run-id"] || randomUUID());
  const generatedAt = new Date().toISOString();
  const state = await readJson(vaultPath(vault, STATE_PATH), { schema_version: 1, projects: {} });
  const evidence = await scanEvidence(vault);
  const grouped = new Map();
  for (const document of evidence) {
    const items = grouped.get(document.project_directory) || [];
    items.push(document);
    grouped.set(document.project_directory, items);
  }
  for (const projectDirectory of Object.keys(state.projects || {})) {
    if (grouped.has(projectDirectory)) continue;
    const summaryPath = String(state.projects[projectDirectory]?.summary_path || "").replace(/\\/g, "/");
    if (!summaryPath.startsWith(`wiki/${projectDirectory}/`)) continue;
    const summary = await readText(vaultPath(vault, summaryPath), "");
    if (frontmatterValue(summary, "zhixing_document") === "synthesis") grouped.set(projectDirectory, []);
  }
  const maxProjects = integer(options.maxProjects ?? options["max-projects"], 2, 1, 8);
  const maxDocuments = integer(options.maxDocuments ?? options["max-documents"], 12, 2, 40);
  const maxChars = integer(options.maxChars ?? options["max-chars"], 120_000, 10_000, 400_000);
  const projects = [];
  for (const projectDirectory of [...grouped.keys()].sort((a, b) => a.localeCompare(b, "zh-CN"))) {
    if (projects.length >= maxProjects) break;
    const documents = grouped.get(projectDirectory).sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
    const projectState = state.projects?.[projectDirectory] || {};
    const stateSummaryPath = String(projectState.summary_path || "").replace(/\\/g, "/");
    const stateSummaryContent = stateSummaryPath.startsWith(`wiki/${projectDirectory}/`)
      ? await readText(vaultPath(vault, stateSummaryPath), "")
      : "";
    const savedProjectName = String(projectState.project_name || "").trim();
    const projectName = savedProjectName && !opaqueProjectName(savedProjectName)
      ? savedProjectName
      : projectDisplayName(projectDirectory, documents, stateSummaryContent);
    let summaryPath = `wiki/${projectDirectory}/${safeName(projectName)}知识总览.md`;
    let summaryContent = await readText(vaultPath(vault, summaryPath), "");
    let previousSummaryPath = "";
    if (!summaryContent && stateSummaryPath && stateSummaryPath !== summaryPath &&
        stateSummaryPath.startsWith(`wiki/${projectDirectory}/`)) {
      if (frontmatterValue(stateSummaryContent, "zhixing_document") === "synthesis") {
        summaryContent = stateSummaryContent;
        previousSummaryPath = stateSummaryPath;
      }
    }
    if (summaryContent && frontmatterValue(summaryContent, "zhixing_document") !== "synthesis") {
      summaryPath = `wiki/${projectDirectory}/${safeName(projectName)}知识总览（知行台）.md`;
      summaryContent = await readText(vaultPath(vault, summaryPath), "");
    }
    if (summaryContent && frontmatterValue(summaryContent, "zhixing_document") !== "synthesis") continue;
    const changed = documents.filter((document) => projectState.reviewed_shas?.[document.path] !== document.sha256);
    if (changed.length === 0 && !previousSummaryPath) continue;
    if (!summaryContent && documents.length < 2) continue;
    const selected = [];
    let selectedChars = summaryContent.length;
    const candidates = changed.length > 0
      ? [...changed, ...documents.filter((item) => !changed.includes(item))]
      : documents;
    for (const document of candidates) {
      if (selected.length >= maxDocuments || selectedChars + document.content.length > maxChars) continue;
      selected.push(document);
      selectedChars += document.content.length;
    }
    if (changed.length > 0 && !selected.some((document) => changed.includes(document))) continue;
    projects.push({
      project_id: projectDirectory,
      project_name: projectName,
      summary_path: summaryPath,
      previous_summary_path: previousSummaryPath || null,
      summary_expected_sha256: summaryContent ? sha256(summaryContent) : "",
      existing_summary: summaryContent || null,
      documents: selected
    });
  }
  const resultPath = `raw/codex/staging/${runId}-maintenance-result.json`;
  const contract = {
    schema_version: 1,
    run_id: runId,
    generated_at: generatedAt,
    result_path: resultPath,
    projects
  };
  await mkdir(path.dirname(vaultPath(vault, resultPath)), { recursive: true });
  await atomicJson(vaultPath(vault, CONTRACT_PATH), contract);
  return {
    run_id: runId,
    project_count: projects.length,
    document_count: projects.reduce((sum, project) => sum + project.documents.length, 0),
    contract_path: vaultPath(vault, CONTRACT_PATH),
    result_path: vaultPath(vault, resultPath)
  };
}

export async function commitMaintenance(vaultRoot, options = {}) {
  const vault = path.resolve(vaultRoot);
  await recoverMaintenanceJournal(vault);
  const contract = await readJson(vaultPath(vault, CONTRACT_PATH));
  if (!contract || !Array.isArray(contract.projects)) throw new Error("知识综合合同不存在或无效");
  const requestedRunId = String(options.runId || options["run-id"] || "");
  if (requestedRunId && requestedRunId !== contract.run_id) throw new Error("知识综合运行 ID 与合同不一致");
  if (contract.projects.length === 0) {
    return { run_id: contract.run_id, status: "idle", summarized: 0, archived: 0, kept_active: 0 };
  }
  const result = await readJson(vaultPath(vault, contract.result_path));
  if (!result || result.schema_version !== 1 || result.run_id !== contract.run_id || !Array.isArray(result.outcomes)) {
    throw new Error("知识综合智能体没有生成有效回执");
  }
  const outcomes = new Map();
  for (const outcome of result.outcomes) {
    if (!outcome?.project_id || outcomes.has(outcome.project_id)) throw new Error("知识综合回执包含空白或重复项目");
    outcomes.set(outcome.project_id, outcome);
  }
  if (outcomes.size !== contract.projects.length || contract.projects.some((project) => !outcomes.has(project.project_id))) {
    throw new Error("知识综合回执没有完整覆盖合同项目");
  }

  const statePath = vaultPath(vault, STATE_PATH);
  const ledgerPath = vaultPath(vault, LEDGER_PATH);
  const stateText = await readText(statePath, "");
  const ledgerText = await readText(ledgerPath, "");
  const state = stateText ? JSON.parse(stateText) : { schema_version: 1, projects: {} };
  const ledger = ledgerText ? JSON.parse(ledgerText) : { schema_version: 3, outcomes: [] };
  state.schema_version = 1;
  state.projects ||= {};
  const summaryWrites = [];
  const archives = [];
  const archiveRewrites = [];
  let keptActive = 0;

  for (const project of contract.projects) {
    const outcome = outcomes.get(project.project_id);
    validateOutcome(project, outcome);
    const currentSummaryPath = project.previous_summary_path || project.summary_path;
    const currentSummary = await readText(vaultPath(vault, currentSummaryPath), "");
    if ((currentSummary ? sha256(currentSummary) : "") !== String(project.summary_expected_sha256 || "")) {
      throw new Error(`${project.summary_path} 在综合期间被修改，拒绝覆盖`);
    }
    const reviews = new Map(outcome.reviews.map((review) => [review.path, review]));
    const archivedPaths = new Map();
    if (outcome.status === "succeeded") {
      for (const document of project.documents) {
        const review = reviews.get(document.path);
        const current = await readText(vaultPath(vault, document.path), "");
        if (sha256(current) !== document.sha256) throw new Error(`${document.path} 在综合期间被修改，拒绝归档或标记已审查`);
        if (review.disposition === "archive" && document.managed_only) {
          const archivePath = `归档/知行台/${document.path.slice("wiki/".length)}`;
          const archiveTargetContent = renderArchive(current, document.path, project.summary_path,
            review.reason, contract.generated_at);
          const archiveExisting = await readText(vaultPath(vault, archivePath), "");
          if (archiveExisting && sha256(archiveExisting) !== sha256(archiveTargetContent)) {
            throw new Error(`${archivePath} 已存在其他归档内容，拒绝覆盖`);
          }
          archives.push({
            source_path: document.path,
            archive_path: archivePath,
            summary_path: project.summary_path,
            content: archiveTargetContent
          });
          archivedPaths.set(document.path, archivePath);
        } else {
          keptActive += 1;
        }
      }
      summaryWrites.push({
        path: project.summary_path,
        previous_path: project.previous_summary_path || undefined,
        content: renderSummary(project, outcome.summary, archivedPaths, contract.generated_at)
      });
    } else {
      keptActive += project.documents.length;
    }
    const projectState = state.projects[project.project_id] || { reviewed_shas: {}, archives: [] };
    projectState.reviewed_shas ||= {};
    projectState.archives ||= [];
    for (const document of project.documents) projectState.reviewed_shas[document.path] = document.sha256;
    for (const archive of archives.filter((item) => item.summary_path === project.summary_path)) {
      projectState.archives = uniqueObjects([...projectState.archives, {
        original_path: archive.source_path,
        archive_path: archive.archive_path,
        summary_path: archive.summary_path,
        archived_at: contract.generated_at
      }], (item) => item.original_path);
    }
    projectState.summary_path = project.summary_path;
    projectState.project_name = project.project_name;
    projectState.last_successful_run = contract.generated_at;
    state.projects[project.project_id] = projectState;
    if (project.previous_summary_path && project.previous_summary_path !== project.summary_path) {
      for (const archived of projectState.archives || []) {
        const archiveContent = await readText(vaultPath(vault, archived.archive_path), "");
        if (!archiveContent) continue;
        const updated = archiveContent
          .split(project.previous_summary_path).join(project.summary_path)
          .split(wikiLink(project.previous_summary_path)).join(wikiLink(project.summary_path));
        if (updated !== archiveContent) archiveRewrites.push({ path: archived.archive_path, content: updated });
      }
    }
  }

  rewriteLedgerForArchives(ledger, archives);
  rewriteLedgerForSummaryMoves(ledger, summaryWrites);
  state.updated_at = new Date().toISOString();
  const touched = [
    ...summaryWrites.flatMap((item) => [item.path, item.previous_path]),
    ...archives.flatMap((item) => [item.source_path, item.archive_path]),
    ...archiveRewrites.map((item) => item.path),
    STATE_PATH,
    LEDGER_PATH
  ];
  const journal = await startJournal(vault, contract.run_id, touched);
  try {
    for (const item of summaryWrites) await atomicText(vaultPath(vault, item.path), item.content);
    for (const item of archiveRewrites) await atomicText(vaultPath(vault, item.path), item.content);
    for (const [index, item] of archives.entries()) {
      await atomicText(vaultPath(vault, item.archive_path), item.content);
      await unlink(vaultPath(vault, item.source_path));
      if ((options.faultStage || options["fault-stage"]) === "first-archive" && index === 0) {
        throw new Error("故障注入：首篇归档后中断");
      }
    }
    for (const item of summaryWrites) {
      if (item.previous_path && item.previous_path !== item.path) {
        await unlink(vaultPath(vault, item.previous_path));
      }
    }
    await atomicJson(ledgerPath, ledger);
    await atomicJson(statePath, state);
    await finishJournal(journal);
  } catch (error) {
    await restoreJournal(vault, journal);
    throw error;
  }
  return {
    run_id: contract.run_id,
    status: "succeeded",
    summarized: summaryWrites.length,
    archived: archives.length,
    kept_active: keptActive,
    summary_paths: summaryWrites.map((item) => item.path),
    archive_paths: archives.map((item) => item.archive_path)
  };
}

export async function main(values = process.argv.slice(2)) {
  const args = parseArgs(values);
  const command = args._[0];
  const vault = path.resolve(args.vault || process.env.ZHIXING_VAULT || "");
  if (!args.vault && !process.env.ZHIXING_VAULT) throw new Error("缺少 Vault 路径，请使用 --vault 或 ZHIXING_VAULT");
  const result = command === "prepare"
    ? await prepareMaintenance(vault, args)
    : command === "commit"
      ? await commitMaintenance(vault, args)
      : (() => { throw new Error("用法: node knowledge-maintenance.mjs <prepare|commit> --vault <路径>"); })();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

async function scanEvidence(vault) {
  const wikiRoot = vaultPath(vault, "wiki");
  const files = await markdownFiles(wikiRoot);
  const documents = [];
  for (const target of files) {
    const relative = relativeVaultPath(vault, target);
    if (relative.startsWith("wiki/我的经历/") || relative.startsWith("wiki/示例/")) continue;
    const content = await readText(target, "");
    if (frontmatterValue(content, "zhixing_document") !== "evidence") continue;
    const projectDirectory = path.posix.dirname(relative.slice("wiki/".length));
    if (!projectDirectory || projectDirectory === ".") continue;
    documents.push({
      path: relative,
      title: content.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.posix.basename(relative, ".md"),
      project_directory: projectDirectory,
      sha256: sha256(content),
      managed_only: isManagedOnlyEvidence(content),
      content
    });
  }
  return documents;
}

function isManagedOnlyEvidence(content) {
  if (/来源状态已变化|暂不可用|temporarily unavailable/i.test(content)) return false;
  const keys = frontmatterKeys(content);
  if (keys.some((key) => !EVIDENCE_FRONTMATTER.has(key))) return false;
  const headings = [...content.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1].trim());
  if (headings.some((heading) => !EVIDENCE_HEADINGS.has(heading))) return false;
  const afterTitle = content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
  const title = /^#\s+.+$/m.exec(afterTitle);
  const firstSection = afterTitle.search(/^##\s+/m);
  if (!title || firstSection < 0 || afterTitle.slice(title.index + title[0].length, firstSection).trim()) return false;
  return ["problem", "root_cause", "attempts", "solution", "boundaries", "verification", "signals"]
    .every((key) => content.includes(`<!-- zhixing-semantic:start:${key} -->`) &&
      content.includes(`<!-- zhixing-semantic:end:${key} -->`));
}

function validateOutcome(project, outcome) {
  if (!outcome || !["succeeded", "not-applicable"].includes(outcome.status)) {
    throw new Error(`${project.project_name} 的综合结果状态无效`);
  }
  if (!String(outcome.reason || "").trim()) throw new Error(`${project.project_name} 的综合结果缺少理由`);
  const paths = project.documents.map((document) => document.path);
  const reviews = Array.isArray(outcome.reviews) ? outcome.reviews : [];
  if (reviews.length !== paths.length || new Set(reviews.map((review) => review.path)).size !== paths.length ||
      paths.some((documentPath) => !reviews.some((review) => review.path === documentPath))) {
    throw new Error(`${project.project_name} 的归档审查没有完整覆盖合同文档`);
  }
  for (const review of reviews) {
    if (!["keep-active", "archive"].includes(review.disposition) || !String(review.reason || "").trim()) {
      throw new Error(`${review.path} 的归档审查无效`);
    }
  }
  if (outcome.status === "not-applicable") {
    if (outcome.summary != null || reviews.some((review) => review.disposition !== "keep-active")) {
      throw new Error("无需综合的项目必须保留全部原文");
    }
    return;
  }
  if (!outcome.summary || typeof outcome.summary !== "object") throw new Error(`${project.project_name} 缺少综合正文`);
  for (const [, key] of SUMMARY_SECTIONS) {
    if (String(outcome.summary[key] || "").trim().length < 8) throw new Error(`${project.project_name} 的综合章节 ${key} 过于空泛`);
  }
}

function renderSummary(project, summary, archivedPaths, generatedAt) {
  const existing = String(project.existing_summary || "");
  const priorPaths = yamlStringList(existing, "source_paths").map((item) => archivedPaths.get(item) || item);
  const currentPaths = project.documents.map((document) => archivedPaths.get(document.path) || document.path);
  const sourcePaths = uniqueStrings([...priorPaths, ...currentPaths]);
  const sourceIds = uniqueStrings([
    ...yamlStringList(existing, "source_event_ids"),
    ...project.documents.flatMap((document) => yamlStringList(document.content, "source_event_ids"))
  ]);
  const projects = uniqueStrings([
    ...yamlStringList(existing, "projects"),
    ...project.documents.flatMap((document) => yamlStringList(document.content, "projects")),
    project.project_name
  ]);
  const unknownFrontmatter = frontmatterBlocks(existing)
    .filter((block) => !SYNTHESIS_FRONTMATTER.has(block.key))
    .flatMap((block) => block.lines);
  const unknownSections = markdownSections(existing)
    .filter((section) => !new Set([...SUMMARY_SECTIONS.map(([heading]) => heading), "来源文档"]).has(section.heading))
    .map((section) => section.content);
  const preamble = markdownPreamble(existing);
  const lines = [
    "---",
    `zhixing_synthesis_id: zhixing-synthesis-${sha256(project.project_id).slice(0, 20)}`,
    "zhixing_document: synthesis",
    ...yamlList("projects", projects),
    `last_synthesized: ${String(generatedAt).slice(0, 10)}`,
    "trust: observed",
    ...yamlList("source_paths", sourcePaths),
    ...yamlList("source_event_ids", sourceIds),
    ...unknownFrontmatter,
    "---",
    `# ${project.project_name}知识总览`,
    "",
    ...(preamble ? [preamble, ""] : []),
    "> 这是一篇持续更新的项目知识总览。零散证据被综合为当前可采用的结论，原始依据仍可沿文末链接追溯。",
    ""
  ];
  for (const [heading, key] of SUMMARY_SECTIONS) {
    lines.push(`## ${heading}`, `<!-- zhixing-synthesis:start:${key} -->`, String(summary[key]).trim(),
      `<!-- zhixing-synthesis:end:${key} -->`, preservedManagedRemainder(existing, heading, key), "");
  }
  lines.push("## 来源文档", ...sourcePaths.map((sourcePath) => `- ${wikiLink(sourcePath)}`));
  if (unknownSections.length > 0) lines.push("", ...unknownSections);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function renderArchive(content, originalPath, summaryPath, reason, archivedAt) {
  const metadata = [
    "zhixing_archived: true",
    `archived_at: ${String(archivedAt).slice(0, 10)}`,
    `archive_reason: ${yamlScalar(reason)}`,
    `superseded_by: ${yamlScalar(summaryPath)}`,
    `original_path: ${yamlScalar(originalPath)}`
  ];
  const withMetadata = content.replace(/^(---\s*\r?\n)([\s\S]*?)(\r?\n---)/, (_, start, body, end) =>
    `${start}${body.trimEnd()}\n${metadata.join("\n")}${end}`);
  const title = /^#\s+.+$/m.exec(withMetadata);
  if (!title) return withMetadata;
  const position = title.index + title[0].length;
  const note = `\n\n> [!archive] 已归档\n> 本页内容已汇入 ${wikiLink(summaryPath)}。原文保留用于追溯，不再参与知行台的日常索引。\n`;
  return `${withMetadata.slice(0, position)}${note}${withMetadata.slice(position).replace(/^\s+/, "\n").trimEnd()}\n`;
}

function rewriteLedgerForArchives(ledger, archives) {
  const replacements = new Map(archives.map((item) => [item.source_path, item.summary_path]));
  const archivePaths = new Map(archives.map((item) => [item.source_path, item.archive_path]));
  if (!Array.isArray(ledger.outcomes)) ledger.outcomes = [];
  ledger.outcomes = ledger.outcomes.map((outcome) => {
    const affected = uniqueStrings([...(outcome.wiki_paths || []), ...(outcome.evidence_paths || [])])
      .filter((item) => replacements.has(item));
    if (affected.length === 0) return outcome;
    const replace = (items) => uniqueStrings((items || []).map((item) => replacements.get(item) || item));
    const changes = uniqueObjects((outcome.knowledge_changes || []).map((change) => ({
      ...change,
      path: replacements.get(change.path) || change.path,
      title: replacements.has(change.path) ? path.posix.basename(replacements.get(change.path), ".md") : change.title
    })), (change) => `${change.action}:${change.path}`);
    return {
      ...outcome,
      wiki_paths: replace(outcome.wiki_paths),
      evidence_paths: replace(outcome.evidence_paths),
      archived_paths: uniqueStrings([...(outcome.archived_paths || []), ...affected.map((item) => archivePaths.get(item))]),
      knowledge_changes: changes,
      updated_at: new Date().toISOString()
    };
  });
}

function rewriteLedgerForSummaryMoves(ledger, summaryWrites) {
  const replacements = new Map(summaryWrites
    .filter((item) => item.previous_path && item.previous_path !== item.path)
    .map((item) => [item.previous_path, item.path]));
  if (replacements.size === 0 || !Array.isArray(ledger.outcomes)) return;
  const replace = (items) => uniqueStrings((items || []).map((item) => replacements.get(item) || item));
  ledger.outcomes = ledger.outcomes.map((outcome) => ({
    ...outcome,
    wiki_paths: replace(outcome.wiki_paths),
    evidence_paths: replace(outcome.evidence_paths),
    knowledge_changes: uniqueObjects((outcome.knowledge_changes || []).map((change) => ({
      ...change,
      path: replacements.get(change.path) || change.path,
      title: replacements.has(change.path) ? path.posix.basename(replacements.get(change.path), ".md") : change.title
    })), (change) => `${change.action}:${change.path}`)
  }));
}

function projectDisplayName(projectDirectory, documents, existingSummary = "") {
  const fallback = projectDirectory.split("/").at(-1) || "未归属";
  if (!opaqueProjectName(fallback)) return fallback;
  const counts = new Map();
  for (const source of [existingSummary, ...documents.map((document) => document.content)]) {
    for (const label of yamlStringList(source, "projects")) {
      if (!label || opaqueProjectName(label) || label === fallback) continue;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  const ranked = [...counts].sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"));
  if (ranked.length === 0) return "未命名项目";
  if (ranked.length === 1 || ranked[0][1] > ranked[1][1]) return ranked[0][0];
  return `${ranked[0][0]} 与 ${ranked[1][0]}`;
}

function opaqueProjectName(value) {
  const name = String(value || "").trim();
  return !name || /^(?:未命名项目|[0-9a-f]{8,}(?:-fix)?|g-p-[a-z0-9-]+|w|memories)$/i.test(name);
}

async function startJournal(vault, runId, relativePaths) {
  const files = [];
  for (const relative of uniqueStrings(relativePaths)) {
    const content = await readText(vaultPath(vault, relative), "");
    files.push({ path: relative, existed: Boolean(content), original_base64: Buffer.from(content, "utf8").toString("base64") });
  }
  const target = vaultPath(vault, JOURNAL_PATH);
  const journal = { schema_version: 1, run_id: runId, started_at: new Date().toISOString(), files, path: target };
  await atomicJson(target, { ...journal, path: undefined });
  return journal;
}

async function finishJournal(journal) {
  const target = journal?.path;
  if (!target) return;
  await unlink(target).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

async function recoverMaintenanceJournal(vault) {
  const target = vaultPath(vault, JOURNAL_PATH);
  const journal = await readJson(target, null);
  if (!journal) return;
  await restoreJournal(vault, journal);
}

async function restoreJournal(vault, journal) {
  let firstError;
  for (const entry of [...(journal.files || [])].reverse()) {
    try {
      const target = vaultPath(vault, entry.path);
      if (entry.existed) await atomicText(target, Buffer.from(entry.original_base64, "base64").toString("utf8"));
      else await unlink(target).catch(() => undefined);
    } catch (error) {
      firstError ||= error;
    }
  }
  if (!firstError) await unlink(vaultPath(vault, JOURNAL_PATH)).catch(() => undefined);
  if (firstError) throw new Error("知识综合事务自动恢复失败，请保留现场后重试");
}

async function markdownFiles(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(target));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(target);
  }
  return files;
}

function frontmatterValue(content, key) {
  return unquote(frontmatter(content).match(new RegExp(`^${escapeRegExp(key)}:\\s*([^\\r\\n]+)\\s*$`, "m"))?.[1] || "");
}

function frontmatter(content) {
  return String(content || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)?.[1] || "";
}

function frontmatterKeys(content) {
  return frontmatterBlocks(content).map((block) => block.key);
}

function frontmatterBlocks(content) {
  const lines = frontmatter(content).split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const match = lines[index].match(/^([A-Za-z_][\w-]*):/);
    if (!match) { index += 1; continue; }
    const block = { key: match[1], lines: [lines[index]] };
    index += 1;
    while (index < lines.length && !/^[A-Za-z_][\w-]*:/.test(lines[index])) block.lines.push(lines[index++]);
    blocks.push(block);
  }
  return blocks;
}

function yamlStringList(content, key) {
  const metadata = frontmatter(content);
  const inline = metadata.match(new RegExp(`^${escapeRegExp(key)}:\\s*\\[([^\\]]*)]\\s*$`, "m"))?.[1];
  if (inline !== undefined) return inline.split(",").map(unquote).filter(Boolean);
  const block = metadata.match(new RegExp(`^${escapeRegExp(key)}:\\s*$\\r?\\n((?:\\s+-\\s+.*(?:\\r?\\n|$))*)`, "m"))?.[1] || "";
  return block.split(/\r?\n/).map((line) => unquote(line.replace(/^\s*-\s*/, ""))).filter(Boolean);
}

function markdownSections(content) {
  const value = String(content || "");
  const matches = [...value.matchAll(/^##\s+(.+?)\s*$/gm)];
  return matches.map((match, index) => ({
    heading: match[1].trim(),
    content: value.slice(match.index, matches[index + 1]?.index ?? value.length).trimEnd()
  }));
}

function markdownPreamble(content) {
  const body = String(content || "").replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
  const title = /^#\s+.+$/m.exec(body);
  if (!title) return "";
  const after = body.slice(title.index + title[0].length);
  const next = after.search(/^##\s+/m);
  return (next < 0 ? after : after.slice(0, next))
    .split(/\r?\n/).filter((line) => !/^> 这是一篇持续更新的项目知识总览/.test(line.trim())).join("\n").trim();
}

function preservedManagedRemainder(content, heading, key) {
  const section = markdownSections(content).find((item) => item.heading === heading)?.content || "";
  const body = section.replace(/^##\s+.+?\s*\r?\n/, "");
  return body.replace(new RegExp(`<!--\\s*zhixing-synthesis:start:${key}\\s*-->[\\s\\S]*?<!--\\s*zhixing-synthesis:end:${key}\\s*-->`), "").trim();
}

function wikiLink(target) {
  return `[[${String(target).replace(/\\/g, "/").replace(/\.md$/i, "")}]]`;
}

function yamlList(key, values) {
  return [`${key}:`, ...values.map((value) => `  - ${yamlScalar(value)}`)];
}

function yamlScalar(value) {
  const string = String(value || "").trim();
  return !string || /[:#[\]{},&*!|>'"%@`]|^\s|\s$/.test(string) ? JSON.stringify(string) : string;
}

function unquote(value) {
  const string = String(value || "").trim();
  if (string.startsWith('"') && string.endsWith('"')) { try { return JSON.parse(string); } catch {} }
  if (string.startsWith("'") && string.endsWith("'")) return string.slice(1, -1).replaceAll("''", "'");
  return string;
}

function safeName(value) {
  return String(value || "未归属").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "未归属";
}

function vaultPath(vault, relative) {
  const normalized = String(relative || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Vault 相对路径无效：${relative}`);
  }
  const target = path.resolve(vault, ...normalized.split("/"));
  const prefix = `${path.resolve(vault)}${path.sep}`.toLowerCase();
  if (!target.toLowerCase().startsWith(prefix)) throw new Error(`路径超出 Vault：${relative}`);
  return target;
}

function relativeVaultPath(vault, target) {
  const relative = path.relative(vault, target).replace(/\\/g, "/");
  if (!relative || relative.startsWith("../")) throw new Error("文件路径超出 Vault");
  return relative;
}

async function readText(target, fallback) {
  try { return await readFile(target, "utf8"); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function readJson(target, fallback) {
  const text = await readText(target, "");
  if (!text) return fallback;
  return JSON.parse(text);
}

async function atomicText(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}

async function atomicJson(target, value) {
  await atomicText(target, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function uniqueObjects(values, key) {
  const seen = new Set();
  return (values || []).filter((value) => { const id = key(value); if (seen.has(id)) return false; seen.add(id); return true; });
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(values) {
  const result = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) { result._.push(value); continue; }
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = values[index + 1];
    if (next && !next.startsWith("--")) { result[key] = next; index += 1; }
    else result[key] = true;
  }
  return result;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
