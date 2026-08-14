"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ActivityLedgerPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian6 = require("obsidian");

// src/artifact-writer.ts
var import_obsidian = require("obsidian");

// src/core/artifact-markdown.ts
var import_node_crypto = require("node:crypto");
var ARTIFACT_ROOT = "\u6210\u679C/\u77E5\u884C\u53F0";
var GENERATED_START = "<!-- zhixing-generated:start -->";
var GENERATED_END = "<!-- zhixing-generated:end -->";
var USER_START = "<!-- zhixing-user:start -->";
var USER_END = "<!-- zhixing-user:end -->";
var LEGACY_GENERATED_START = "%% zhixing-generated:start %%";
var LEGACY_GENERATED_END = "%% zhixing-generated:end %%";
var LEGACY_USER_START = "%% zhixing-user:start %%";
var LEGACY_USER_END = "%% zhixing-user:end %%";
var STALE_NOTICE = "> [!warning] \u5386\u53F2\u6210\u679C\n> \u6B64\u6587\u4EF6\u5DF2\u4E0D\u5728\u5F53\u524D\u6210\u679C\u7D22\u5F15\u4E2D\u3002\u81EA\u52A8\u5185\u5BB9\u6309\u5386\u53F2\u8BB0\u5F55\u4FDD\u7559\u3002";
var MAX_ARTIFACT_FILE_TITLE_CHARACTERS = 96;
var LONG_TITLE_SUFFIX = "\uFF08\u5B8C\u6574\u6807\u9898\u89C1\u6B63\u6587\uFF09";
var PROOF_LABELS = {
  independent: "\u72EC\u7ACB\u9A8C\u8BC1",
  "target-present": "\u76EE\u6807\u5B58\u5728",
  "report-only": "\u4EC5\u5B8C\u6210\u62A5\u544A"
};
var MANAGED_FRONTMATTER_KEYS = [
  "zhixing_schema",
  "zhixing_generated",
  "cssclasses",
  "aliases",
  "zhixing_id",
  "zhixing_fingerprint",
  "zhixing_stale",
  "date",
  "project",
  "kind",
  "proof",
  "curation",
  "source_event_ids",
  "target_keys"
];
function artifactNotePath(artifact, copyNumber = 1) {
  assertLocalDate(artifact.localDate);
  if (!Number.isInteger(copyNumber) || copyNumber < 1) {
    throw new Error("\u6210\u679C\u6587\u4EF6\u5E8F\u53F7\u5FC5\u987B\u4E3A\u6B63\u6574\u6570");
  }
  const suffix = copyNumber === 1 ? "" : `\uFF08${copyNumber}\uFF09`;
  return `${ARTIFACT_ROOT}/${artifact.localDate}/${readableArtifactFileTitle(artifact.title)}${suffix}.md`;
}
function readableArtifactFileTitle(title) {
  const cleaned = title.replace(/<!--|-->/g, " ").replace(/[<>:"/\\|?*\u0000-\u001f\[\]#^`]/g, " ").replace(/[*_~]+/g, " ").replace(/\s+/g, " ").replace(/^[.\s-]+|[.\s-]+$/g, "").trim();
  const readable = cleaned || "\u672A\u547D\u540D\u6210\u679C";
  const characters = Array.from(readable);
  if (characters.length <= MAX_ARTIFACT_FILE_TITLE_CHARACTERS) {
    return readable;
  }
  const suffixLength = Array.from(LONG_TITLE_SUFFIX).length;
  return `${characters.slice(0, MAX_ARTIFACT_FILE_TITLE_CHARACTERS - suffixLength).join("")}${LONG_TITLE_SUFFIX}`;
}
function dailyArtifactIndexPath(date) {
  assertLocalDate(date);
  return `${ARTIFACT_ROOT}/${date}.md`;
}
function isValidLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function renderArtifactNote(artifact) {
  assertLocalDate(artifact.localDate);
  const generated = renderArtifactGeneratedBlock(artifact);
  return [
    "---",
    "zhixing_schema: 1",
    "zhixing_generated: true",
    "cssclasses: [zhixing-artifact-note]",
    `aliases: ${yamlArray([legacyArtifactAlias(artifact.id)])}`,
    `zhixing_id: ${yamlString(artifact.id)}`,
    `zhixing_fingerprint: ${yamlString(artifact.fingerprint)}`,
    "zhixing_stale: false",
    `date: ${artifact.localDate}`,
    `project: ${yamlString(artifact.projectLabel)}`,
    `kind: ${artifact.kind}`,
    `proof: ${artifact.proof}`,
    "curation: auto",
    `source_event_ids: ${yamlArray(artifact.sourceEventIds)}`,
    `target_keys: ${yamlArray(frontmatterTargetKeys(artifact.targets))}`,
    "---",
    "",
    GENERATED_START,
    `# ${markdownText(artifact.title)}`,
    "",
    generated,
    GENERATED_END,
    "",
    USER_START,
    "## \u6211\u7684\u8865\u5145",
    "",
    USER_END,
    ""
  ].join("\n");
}
function renderDailyArtifactIndex(date, artifacts) {
  assertLocalDate(date);
  const lines = [
    "---",
    "zhixing_schema: 1",
    "zhixing_generated: true",
    "cssclasses: [zhixing-artifact-note]",
    `zhixing_id: ${yamlString(`daily:${date}`)}`,
    "zhixing_stale: false",
    `date: ${date}`,
    "kind: daily-artifact-index",
    "---",
    "",
    GENERATED_START,
    `# ${date} \u6210\u679C`,
    "",
    "> \u7531\u77E5\u884C\u53F0\u81EA\u52A8\u6574\u7406\u3002\u72EC\u7ACB\u9A8C\u8BC1\u3001\u76EE\u6807\u5B58\u5728\u548C\u5B8C\u6210\u62A5\u544A\u91C7\u7528\u4E0D\u540C\u53EF\u4FE1\u53E3\u5F84\u3002",
    ""
  ];
  const byProject = /* @__PURE__ */ new Map();
  for (const artifact of [...artifacts].sort(compareArtifacts)) {
    const group = byProject.get(artifact.projectLabel) ?? [];
    group.push(artifact);
    byProject.set(artifact.projectLabel, group);
  }
  if (byProject.size === 0) {
    lines.push("\u5F53\u5929\u6CA1\u6709\u5F53\u524D\u5FEB\u7167\u4E2D\u7684\u6210\u679C\u6761\u76EE\u3002", "");
  }
  for (const [project, projectArtifacts] of byProject) {
    lines.push(`## ${markdownText(project)}`, "");
    for (const artifact of projectArtifacts) {
      const pathWithoutExtension = (artifact.notePath || artifactNotePath(artifact)).replace(/\.md$/i, "");
      lines.push(
        `- [[${pathWithoutExtension}|${wikilinkText(artifact.title)}]] \xB7 ${PROOF_LABELS[artifact.proof]}`,
        `  - ${inlineText(firstReadableLine(artifact.result))}`
      );
    }
    lines.push("");
  }
  lines.push(GENERATED_END, "", USER_START, "## \u6211\u7684\u8865\u5145", "", USER_END, "");
  return lines.join("\n");
}
function readManagedArtifactMetadata(content) {
  const parsed = parseManagedDocument(content);
  return parsed?.metadata ?? null;
}
function mergeGeneratedBlock(existing, desired) {
  const existingDocument = parseManagedDocument(existing);
  const desiredDocument = parseManagedDocument(desired);
  if (!existingDocument) {
    return { ok: false, content: existing, error: "\u76EE\u6807\u6587\u4EF6\u4E0D\u5C5E\u4E8E\u77E5\u884C\u53F0\u6216\u7ED3\u6784\u5DF2\u635F\u574F\uFF0C\u5DF2\u62D2\u7EDD\u8986\u76D6" };
  }
  if (!desiredDocument) {
    return { ok: false, content: existing, error: "\u5F85\u5199\u5165\u6210\u679C\u6587\u4EF6\u7ED3\u6784\u65E0\u6548" };
  }
  if (existingDocument.metadata.id !== desiredDocument.metadata.id) {
    return { ok: false, content: existing, error: "\u76EE\u6807\u6587\u4EF6\u7684\u77E5\u884C\u53F0 ID \u4E0D\u5339\u914D\uFF0C\u5DF2\u62D2\u7EDD\u8986\u76D6" };
  }
  const desiredBlock = desired.slice(desiredDocument.markers.start, desiredDocument.markers.end);
  const withGeneratedBlock = `${existing.slice(0, existingDocument.markers.start)}${desiredBlock}${existing.slice(existingDocument.markers.end)}`;
  const withFrontmatter = mergeManagedFrontmatter(withGeneratedBlock, desired);
  return { ok: true, content: normalizeLegacyMarkers(removeLegacyManagedHeading(withFrontmatter)) };
}
function markArtifactNoteStale(existing) {
  const document = parseManagedDocument(existing);
  if (!document || document.metadata.id.startsWith("daily:")) {
    return { ok: false, content: existing, error: "\u76EE\u6807\u6587\u4EF6\u4E0D\u662F\u6709\u6548\u7684\u77E5\u884C\u53F0\u6210\u679C\u7B14\u8BB0" };
  }
  const generated = existing.slice(document.markers.start, document.markers.end);
  const staleGenerated = generated.includes(STALE_NOTICE) ? generated : generated.replace(/^(%% zhixing-generated:start %%|<!-- zhixing-generated:start -->)\r?\n?/, `$1
${STALE_NOTICE}

`);
  const withNotice = `${existing.slice(0, document.markers.start)}${staleGenerated}${existing.slice(document.markers.end)}`;
  return {
    ok: true,
    content: normalizeLegacyMarkers(updateFrontmatterValues(withNotice, /* @__PURE__ */ new Map([["zhixing_stale", "true"]])))
  };
}
function addManagedAlias(existing, alias) {
  const document = parseManagedDocument(existing);
  const cleaned = inlineText(alias);
  if (!document || document.metadata.id.startsWith("daily:") || !cleaned) {
    return { ok: false, content: existing, error: "\u76EE\u6807\u6587\u4EF6\u4E0D\u662F\u53EF\u6DFB\u52A0\u522B\u540D\u7684\u77E5\u884C\u53F0\u6210\u679C" };
  }
  const aliases = parseYamlStringArray(document.frontmatter.values.get("aliases") ?? "");
  if (aliases.includes(cleaned)) {
    return { ok: true, content: existing };
  }
  return {
    ok: true,
    content: updateFrontmatterValues(existing, /* @__PURE__ */ new Map([["aliases", yamlArray([...aliases, cleaned])]]))
  };
}
function renderArtifactGeneratedBlock(artifact) {
  const lines = [
    `> ${PROOF_LABELS[artifact.proof]} \xB7 ${kindDescription(artifact.kind)} \xB7 \u81EA\u52A8\u6574\u7406`,
    "",
    "## \u89E3\u51B3\u7684\u95EE\u9898",
    "",
    artifact.problem ? paragraphText(artifact.problem) : "\u672A\u4ECE\u6765\u6E90\u4E2D\u63D0\u53D6\u5230\u660E\u786E\u95EE\u9898\u63CF\u8FF0\u3002",
    "",
    "## \u5F62\u6210\u7684\u6210\u679C",
    "",
    paragraphText(artifact.result),
    "",
    "## \u9A8C\u8BC1\u7ED3\u679C",
    ""
  ];
  lines.push(...listOrFallback(artifact.validation, "\u6765\u6E90\u672A\u63D0\u4F9B\u660E\u786E\u9A8C\u8BC1\u7ED3\u679C\u3002"));
  lines.push("", "## \u5B9E\u9645\u5165\u53E3", "");
  lines.push(...targetsOrFallback(artifact.targets));
  lines.push("", "## \u6765\u6E90\u8BC1\u636E", "");
  lines.push(...sourcesOrFallback(artifact.sourceRefs));
  lines.push("", "## \u5DF2\u77E5\u9650\u5236", "");
  lines.push(...listOrFallback(artifact.limitations, artifact.proof === "independent" ? "\u672A\u53D1\u73B0\u989D\u5916\u9650\u5236\u8BF4\u660E\u3002" : "\u8BE5\u6761\u76EE\u6765\u81EA\u5B8C\u6210\u62A5\u544A\uFF0C\u4ECD\u9700\u7ED3\u5408\u5B9E\u9645\u5165\u53E3\u548C\u6765\u6E90\u8BC1\u636E\u5224\u65AD\u3002"));
  return lines.join("\n");
}
function targetsOrFallback(targets) {
  if (targets.length === 0) {
    return ["- \u6682\u65E0\u53EF\u76F4\u63A5\u6253\u5F00\u7684\u5B9E\u9645\u5165\u53E3\u3002"];
  }
  return targets.map((target) => {
    const attribution = target.attribution === "reported" ? "\uFF08Codex \u62A5\u544A\uFF09" : "";
    if (target.type === "vault-note" && target.path) {
      return `- [[${target.path.replace(/\.md$/i, "")}|${wikilinkText(target.label)}]]${attribution}`;
    }
    if (target.type === "url" && target.url) {
      return `- [${inlineText(target.label)}](${safeUrl(target.url)})${attribution}`;
    }
    const location = target.hash ?? target.path ?? target.url ?? target.key;
    return `- ${inlineText(target.label)}${attribution}\uFF1A\`${inlineCode(location)}\``;
  });
}
function sourcesOrFallback(sources) {
  if (sources.length === 0) {
    return ["- \u6682\u65E0\u6765\u6E90\u3002"];
  }
  return sources.map((source) => {
    if ((source.type === "wiki" || source.type === "codex" || source.type === "chatgpt" || source.type === "feishu") && source.path?.endsWith(".md") && !/^[A-Za-z]:[\\/]/.test(source.path)) {
      return `- [[${source.path.replace(/\.md$/i, "")}|${wikilinkText(source.label)}]]`;
    }
    if (source.url) {
      return `- [${inlineText(source.label)}](${safeUrl(source.url)})`;
    }
    const location = `${source.path ?? ""}${source.line ? `:${source.line}` : ""}`;
    return `- ${inlineText(source.label)}${location ? `\uFF1A\`${inlineCode(location)}\`` : ""}`;
  });
}
function listOrFallback(items, fallback) {
  return items.length > 0 ? items.map((item) => `- ${inlineText(item)}`) : [`- ${fallback}`];
}
function parseManagedDocument(content) {
  const frontmatter = parseFrontmatter(content);
  const markers = markerBounds(content);
  if (!frontmatter || !markers || markers.start <= frontmatter.closeEnd) {
    return null;
  }
  if (frontmatter.values.get("zhixing_schema") !== "1" || frontmatter.values.get("zhixing_generated") !== "true") {
    return null;
  }
  const date = parseYamlScalar(frontmatter.values.get("date") ?? "");
  const kind = parseYamlScalar(frontmatter.values.get("kind") ?? "");
  const explicitId = parseYamlScalar(frontmatter.values.get("zhixing_id") ?? "");
  const id = explicitId || (kind === "daily-artifact-index" && isValidLocalDate(date) ? `daily:${date}` : "");
  if (!id || !isValidLocalDate(date) || !kind) {
    return null;
  }
  const generatedBlock = content.slice(markers.start, markers.end);
  const title = kind === "daily-artifact-index" ? void 0 : (generatedBlock.match(/^#\s+(.+)\s*$/m) ?? content.slice(frontmatter.closeEnd, markers.end).match(/^#\s+(.+)\s*$/m))?.[1]?.trim();
  return {
    frontmatter,
    markers,
    metadata: {
      id,
      date,
      kind,
      stale: frontmatter.values.get("zhixing_stale") === "true",
      title
    }
  };
}
function parseFrontmatter(content) {
  const opening = content.match(/^---\r?\n/);
  if (!opening) {
    return null;
  }
  const openEnd = opening[0].length;
  const closingPattern = /^---[ \t]*\r?$/gm;
  closingPattern.lastIndex = openEnd;
  const closing = closingPattern.exec(content);
  if (!closing) {
    return null;
  }
  const body = content.slice(openEnd, closing.index);
  const lines = body.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const values = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const match2 = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (!match2) {
      continue;
    }
    const key = match2[1] ?? "";
    if (values.has(key)) {
      return null;
    }
    values.set(key, (match2[2] ?? "").trim());
  }
  return {
    openEnd,
    closeStart: closing.index,
    closeEnd: closing.index + closing[0].length,
    lines,
    values
  };
}
function markerBounds(content) {
  const currentCounts = [count(content, GENERATED_START), count(content, GENERATED_END)];
  const legacyCounts = [count(content, LEGACY_GENERATED_START), count(content, LEGACY_GENERATED_END)];
  const currentValid = currentCounts[0] === 1 && currentCounts[1] === 1 && legacyCounts[0] === 0 && legacyCounts[1] === 0;
  const legacyValid = legacyCounts[0] === 1 && legacyCounts[1] === 1 && currentCounts[0] === 0 && currentCounts[1] === 0;
  const currentUserCounts = [count(content, USER_START), count(content, USER_END)];
  const legacyUserCounts = [count(content, LEGACY_USER_START), count(content, LEGACY_USER_END)];
  const currentUserValid = currentUserCounts[0] === 1 && currentUserCounts[1] === 1 && legacyUserCounts[0] === 0 && legacyUserCounts[1] === 0;
  const legacyUserValid = legacyUserCounts[0] === 1 && legacyUserCounts[1] === 1 && currentUserCounts[0] === 0 && currentUserCounts[1] === 0;
  if (!currentValid && !legacyValid || !currentUserValid && !legacyUserValid) {
    return null;
  }
  const startMarker = currentValid ? GENERATED_START : LEGACY_GENERATED_START;
  const endMarker = currentValid ? GENERATED_END : LEGACY_GENERATED_END;
  const userStartMarker = currentUserValid ? USER_START : LEGACY_USER_START;
  const userEndMarker = currentUserValid ? USER_END : LEGACY_USER_END;
  const start = content.indexOf(startMarker);
  const generatedEnd = content.indexOf(endMarker);
  const userStart = content.indexOf(userStartMarker);
  const userEnd = content.indexOf(userEndMarker);
  if (start < 0 || generatedEnd <= start || userStart <= generatedEnd || userEnd <= userStart) {
    return null;
  }
  if (!isStandaloneMarker(content, start, startMarker) || !isStandaloneMarker(content, generatedEnd, endMarker) || !isStandaloneMarker(content, userStart, userStartMarker) || !isStandaloneMarker(content, userEnd, userEndMarker)) {
    return null;
  }
  return {
    start,
    end: generatedEnd + endMarker.length,
    userStart,
    userEnd: userEnd + userEndMarker.length
  };
}
function normalizeLegacyMarkers(content) {
  return content.replace(LEGACY_GENERATED_START, GENERATED_START).replace(LEGACY_GENERATED_END, GENERATED_END).replace(LEGACY_USER_START, USER_START).replace(LEGACY_USER_END, USER_END);
}
function mergeManagedFrontmatter(existing, desired) {
  const existingFrontmatter = parseFrontmatter(existing);
  const desiredFrontmatter = parseFrontmatter(desired);
  if (!existingFrontmatter || !desiredFrontmatter) {
    return existing;
  }
  const values = /* @__PURE__ */ new Map();
  for (const key of MANAGED_FRONTMATTER_KEYS) {
    if (key === "aliases") {
      continue;
    }
    const value = desiredFrontmatter.values.get(key);
    if (value !== void 0) {
      values.set(key, value);
    }
  }
  const aliases = [.../* @__PURE__ */ new Set([
    ...parseYamlStringArray(existingFrontmatter.values.get("aliases") ?? ""),
    ...parseYamlStringArray(desiredFrontmatter.values.get("aliases") ?? "")
  ])];
  if (aliases.length > 0) {
    values.set("aliases", yamlArray(aliases));
  }
  return updateFrontmatterValues(existing, values);
}
function updateFrontmatterValues(content, updates) {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    return content;
  }
  const remaining = new Map(updates);
  const lines = frontmatter.lines.map((line) => {
    const match2 = line.match(/^([A-Za-z0-9_-]+):/);
    const key = match2?.[1];
    if (!key || !remaining.has(key)) {
      return line;
    }
    const replacement = `${key}: ${remaining.get(key) ?? ""}`;
    remaining.delete(key);
    return replacement;
  });
  for (const [key, value] of remaining) {
    lines.push(`${key}: ${value}`);
  }
  const body = `${lines.join("\n")}
`;
  return `${content.slice(0, frontmatter.openEnd)}${body}${content.slice(frontmatter.closeStart)}`;
}
function removeLegacyManagedHeading(content) {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    return content;
  }
  const generatedStart = content.indexOf(GENERATED_START, frontmatter.closeEnd);
  if (generatedStart < 0) {
    return content;
  }
  const prelude = content.slice(frontmatter.closeEnd, generatedStart);
  if (!/^\s*# [^\r\n]+\s*$/.test(prelude)) {
    return content;
  }
  return `${content.slice(0, frontmatter.closeEnd)}

${content.slice(generatedStart)}`;
}
function compareArtifacts(left, right) {
  return right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id);
}
function kindDescription(kind) {
  switch (kind) {
    case "git-commit":
      return "Git \u63D0\u4EA4";
    case "knowledge-note":
      return "\u77E5\u8BC6\u7B14\u8BB0";
    case "file-deliverable":
      return "\u5173\u8054\u6587\u4EF6";
    case "completion-report":
      return "\u5B8C\u6210\u62A5\u544A";
  }
}
function firstReadableLine(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "\u6682\u65E0\u6458\u8981";
}
function paragraphText(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(markdownText).join("\n\n");
}
function markdownText(value) {
  return value.replace(/[<>]/g, "").replace(/<!--|-->/g, "").trim();
}
function inlineText(value) {
  return markdownText(value).replace(/[\r\n|]/g, " ").replace(/\s+/g, " ").trim();
}
function wikilinkText(value) {
  return inlineText(value).replace(/[\[\]#^]/g, " ").replace(/\s+/g, " ").trim();
}
function inlineCode(value) {
  return value.replace(/`/g, "'").replace(/[\r\n]/g, " ").trim();
}
function safeUrl(value) {
  return /^https?:\/\//i.test(value) ? value.replace(/[<>\s]/g, "") : "";
}
function yamlString(value) {
  return JSON.stringify(value.replace(/[\r\n]/g, " "));
}
function yamlArray(values) {
  return `[${values.map(yamlString).join(", ")}]`;
}
function parseYamlScalar(value) {
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : "";
    } catch {
      return "";
    }
  }
  return value.trim();
}
function parseYamlStringArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}
function frontmatterTargetKeys(targets) {
  const primary = targets.filter((target) => target.type === "git-commit" || target.type === "vault-note");
  return (primary.length > 0 ? primary : targets).slice(0, 6).map((target) => target.key);
}
function legacyArtifactAlias(id) {
  const code = (0, import_node_crypto.createHash)("sha256").update(id).digest("hex").slice(0, 12);
  return `\u6210\u679C-${code}`;
}
function assertLocalDate(value) {
  if (!isValidLocalDate(value)) {
    throw new Error(`\u65E0\u6548\u7684\u672C\u5730\u65E5\u671F\uFF1A${value}`);
  }
}
function count(content, marker) {
  return content.split(marker).length - 1;
}
function isStandaloneMarker(content, position, marker) {
  const before = position === 0 || content[position - 1] === "\n";
  const afterPosition = position + marker.length;
  const after = afterPosition === content.length || content[afterPosition] === "\n" || content.slice(afterPosition, afterPosition + 2) === "\r\n";
  return before && after;
}

// src/artifact-writer.ts
var ArtifactWriter = class {
  constructor(app) {
    this.app = app;
  }
  app;
  async sync(artifacts) {
    const result2 = {
      persistedIds: /* @__PURE__ */ new Set(),
      notes: 0,
      writes: 0,
      errors: []
    };
    const managed = await this.findManagedFiles(result2.errors);
    if (artifacts.length === 0 && managed.length === 0) {
      return result2;
    }
    try {
      await this.ensureFolder(ARTIFACT_ROOT);
    } catch (error) {
      result2.errors.push(errorMessage(error));
      return result2;
    }
    await this.migrateHistoricalFiles(new Set(artifacts.map((artifact) => artifact.id)), managed, result2);
    const prepared = this.prepareArtifacts(artifacts, managed, result2.errors);
    const managedDates = new Set(managed.map((entry) => entry.date));
    const migration = await this.migrateManagedFiles(prepared, managed, result2);
    const blockedIds = migration.blockedIds;
    const byDate = groupByDate(prepared);
    const persistedByDate = /* @__PURE__ */ new Map();
    for (const [date, dateArtifacts] of byDate) {
      try {
        await this.ensureFolder(`${ARTIFACT_ROOT}/${date}`);
      } catch (error) {
        result2.errors.push(errorMessage(error));
        continue;
      }
      const persisted = [];
      for (const artifact of dateArtifacts) {
        if (blockedIds.has(artifact.id)) {
          continue;
        }
        try {
          const write = await this.writeManagedFile(artifact.notePath, renderArtifactNote(artifact));
          result2.writes += write ? 1 : 0;
          result2.notes += 1;
          result2.persistedIds.add(artifact.id);
          persisted.push(artifact);
        } catch (error) {
          result2.errors.push(`${artifact.notePath}: ${errorMessage(error)}`);
        }
      }
      persistedByDate.set(date, persisted);
    }
    const currentPaths = new Set(prepared.map((artifact) => artifact.notePath));
    for (const entry of managed) {
      if (entry.daily || blockedIds.has(entry.id) || migration.protectedIds.has(entry.id) || currentPaths.has(entry.path)) {
        continue;
      }
      try {
        const write = await this.markStale(entry.file);
        result2.writes += write ? 1 : 0;
      } catch (error) {
        result2.errors.push(`${entry.path}: ${errorMessage(error)}`);
      }
    }
    const dates = /* @__PURE__ */ new Set([
      ...byDate.keys(),
      ...managedDates,
      ...managed.map((entry) => entry.date)
    ]);
    for (const date of [...dates].sort()) {
      const indexPath = dailyArtifactIndexPath(date);
      try {
        const write = await this.writeManagedFile(indexPath, renderDailyArtifactIndex(date, persistedByDate.get(date) ?? []));
        result2.writes += write ? 1 : 0;
      } catch (error) {
        result2.errors.push(`${indexPath}: ${errorMessage(error)}`);
      }
    }
    return result2;
  }
  prepareArtifacts(artifacts, managed, errors) {
    const prepared = [];
    const reserved = new Map(
      managed.filter((entry) => !entry.daily).map((entry) => [entry.path, entry.id])
    );
    for (const artifact of artifacts) {
      try {
        if (!isValidLocalDate(artifact.localDate)) {
          throw new Error(`\u65E0\u6548\u7684\u672C\u5730\u65E5\u671F\uFF1A${artifact.localDate}`);
        }
        const allowedPaths = Array.from({ length: 99 }, (_, index) => artifactNotePath(artifact, index + 1));
        if (artifact.notePath && !allowedPaths.includes(normalizeAndValidatePath(artifact.notePath))) {
          throw new Error("\u6210\u679C\u8DEF\u5F84\u4E0D\u662F\u8BE5\u6761\u76EE\u7684\u89C4\u8303\u6258\u7BA1\u8DEF\u5F84");
        }
        const ownedPath = managed.find((entry) => entry.id === artifact.id && allowedPaths.includes(entry.path))?.path;
        const candidatePaths = ownedPath ? [ownedPath, ...allowedPaths.filter((candidate) => candidate !== ownedPath)] : allowedPaths;
        const canonicalPath = candidatePaths.find((candidate) => {
          const owner = reserved.get(candidate);
          const occupied = this.app.vault.getAbstractFileByPath(candidate);
          return (!owner || owner === artifact.id) && (!occupied || owner === artifact.id);
        });
        if (!canonicalPath) {
          throw new Error("\u6210\u679C\u7684\u81EA\u7136\u8BED\u8A00\u6587\u4EF6\u540D\u53CA 98 \u4E2A\u91CD\u540D\u5E8F\u53F7\u5747\u5DF2\u88AB\u5360\u7528");
        }
        reserved.set(canonicalPath, artifact.id);
        artifact.notePath = canonicalPath;
        prepared.push({ ...artifact, notePath: canonicalPath });
      } catch (error) {
        errors.push(`${artifact.id}: ${errorMessage(error)}`);
      }
    }
    return prepared;
  }
  async findManagedFiles(errors) {
    const entries = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const path13 = (0, import_obsidian.normalizePath)(file.path);
      const pathInfo = managedPathInfo(path13);
      if (!pathInfo) {
        continue;
      }
      try {
        const content = await this.app.vault.cachedRead(file);
        const metadata = readManagedArtifactMetadata(content);
        if (!metadata || metadata.date !== pathInfo.date || metadata.id.startsWith("daily:") !== pathInfo.daily) {
          if (/^zhixing_generated:\s*true\s*$/m.test(content)) {
            errors.push(`${path13}: \u6258\u7BA1\u6587\u4EF6\u7684 frontmatter\u3001ID \u6216\u6807\u8BB0\u65E0\u6548\uFF0C\u5DF2\u8DF3\u8FC7`);
          }
          continue;
        }
        if (pathInfo.daily && metadata.id !== `daily:${pathInfo.date}`) {
          errors.push(`${path13}: \u65E5\u7D22\u5F15 ID \u4E0D\u5339\u914D\uFF0C\u5DF2\u8DF3\u8FC7`);
          continue;
        }
        entries.push({
          file,
          path: path13,
          id: metadata.id,
          date: metadata.date,
          daily: pathInfo.daily,
          stale: metadata.stale,
          title: metadata.title
        });
      } catch (error) {
        errors.push(`${path13}: ${errorMessage(error)}`);
      }
    }
    return entries;
  }
  async migrateManagedFiles(artifacts, managed, result2) {
    const blockedIds = /* @__PURE__ */ new Set();
    const protectedIds = /* @__PURE__ */ new Set();
    const currentById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    const byId = /* @__PURE__ */ new Map();
    for (const entry of managed) {
      if (entry.daily) {
        continue;
      }
      const entries = byId.get(entry.id) ?? [];
      entries.push(entry);
      byId.set(entry.id, entries);
    }
    for (const [id, entries] of byId) {
      const current = currentById.get(id);
      if (!current) {
        continue;
      }
      const title = current?.title ?? entries[0]?.title;
      const date = current?.localDate ?? entries[0]?.date;
      if (!title || !date) {
        continue;
      }
      const desiredPath = current?.notePath || artifactNotePath({ id, localDate: date, title });
      const canonical = entries.find((entry2) => entry2.path === desiredPath);
      if (entries.length !== 1) {
        const primary = canonical ?? [...entries].sort(compareManagedCopies)[0];
        if (!primary) {
          continue;
        }
        const secondaries = entries.filter((entry2) => entry2 !== primary).sort((left, right) => left.path.localeCompare(right.path));
        const destinations = /* @__PURE__ */ new Map([[primary, desiredPath]]);
        const claimedPaths = /* @__PURE__ */ new Set([desiredPath]);
        secondaries.forEach((entry2) => {
          if (/（历史记录\d*）\.md$/.test(entry2.path) && !claimedPaths.has(entry2.path)) {
            destinations.set(entry2, entry2.path);
            claimedPaths.add(entry2.path);
            return;
          }
          const historyTitle = readableArtifactFileTitle(entry2.title ?? title);
          const historyPath = this.availableHistoryPath(entry2, historyTitle, claimedPaths);
          destinations.set(entry2, historyPath);
          claimedPaths.add(historyPath);
        });
        try {
          await this.renameManagedCopies(destinations, result2);
        } catch (error) {
          result2.errors.push(`${id}: \u65E0\u6CD5\u6574\u7406\u540C ID \u7684\u5386\u53F2\u526F\u672C\uFF1A${errorMessage(error)}`);
          protectedIds.add(id);
          if (current) {
            blockedIds.add(id);
          }
        }
        continue;
      }
      if (canonical) {
        continue;
      }
      const entry = entries[0];
      if (!entry) {
        continue;
      }
      try {
        await this.renameManagedCopies(/* @__PURE__ */ new Map([[entry, desiredPath]]), result2);
        entry.date = date;
        entry.title = title;
      } catch (error) {
        result2.errors.push(`${entry.path}: \u65E0\u6CD5\u8FC1\u79FB\u4E3A ${desiredPath}\uFF1A${errorMessage(error)}`);
        if (current) {
          blockedIds.add(id);
        }
      }
    }
    return { blockedIds, protectedIds };
  }
  async migrateHistoricalFiles(currentIds, managed, result2) {
    const historical = managed.filter((entry) => !entry.daily && !currentIds.has(entry.id));
    const claimedPaths = /* @__PURE__ */ new Set();
    const destinations = /* @__PURE__ */ new Map();
    for (const entry of historical.sort((left, right) => left.path.localeCompare(right.path))) {
      if (/（历史记录\d*）\.md$/.test(entry.path) && !claimedPaths.has(entry.path)) {
        destinations.set(entry, entry.path);
        claimedPaths.add(entry.path);
        continue;
      }
      if (!entry.title) {
        continue;
      }
      const historyPath = this.availableHistoryPath(entry, readableArtifactFileTitle(entry.title), claimedPaths);
      destinations.set(entry, historyPath);
      claimedPaths.add(historyPath);
    }
    try {
      await this.renameManagedCopies(destinations, result2);
    } catch (error) {
      result2.errors.push(`\u65E0\u6CD5\u6574\u7406\u5386\u53F2\u6210\u679C\uFF1A${errorMessage(error)}`);
    }
  }
  availableHistoryPath(entry, title, claimedPaths) {
    for (let copyNumber = 1; copyNumber <= 999; copyNumber += 1) {
      const suffix = copyNumber === 1 ? "" : String(copyNumber);
      const candidate = `${ARTIFACT_ROOT}/${entry.date}/${title}\uFF08\u5386\u53F2\u8BB0\u5F55${suffix}\uFF09.md`;
      if (claimedPaths.has(candidate)) {
        continue;
      }
      const occupied = this.app.vault.getAbstractFileByPath(candidate);
      if (!occupied || occupied === entry.file) {
        return candidate;
      }
    }
    throw new Error(`${title} \u7684\u5386\u53F2\u526F\u672C\u6587\u4EF6\u540D\u5DF2\u7528\u5C3D`);
  }
  async renameManagedCopies(destinations, result2) {
    for (const [entry, desiredPath] of destinations) {
      if (entry.path === desiredPath) {
        continue;
      }
      await this.ensureFolder(desiredPath.slice(0, desiredPath.lastIndexOf("/")));
      const destination = this.app.vault.getAbstractFileByPath(desiredPath);
      if (destination && destination !== entry.file) {
        throw new Error(`${desiredPath} \u5DF2\u88AB\u5176\u4ED6\u6587\u4EF6\u5360\u7528`);
      }
    }
    for (const [entry, desiredPath] of destinations) {
      if (entry.path === desiredPath) {
        continue;
      }
      const alias = fileBaseName(entry.path);
      const existing = await this.app.vault.cachedRead(entry.file);
      const aliased = addManagedAlias(existing, alias);
      if (!aliased.ok) {
        throw new Error(aliased.error ?? "\u65E0\u6CD5\u4FDD\u7559\u65E7\u6587\u4EF6\u540D\u522B\u540D");
      }
      if (aliased.content !== existing) {
        await this.app.vault.process(entry.file, (current) => {
          const updated = addManagedAlias(current, alias);
          return updated.ok ? updated.content : current;
        });
        result2.writes += 1;
      }
      await this.app.vault.rename(entry.file, desiredPath);
      entry.path = desiredPath;
      result2.writes += 1;
    }
  }
  async ensureFolder(folderPath) {
    const normalized = normalizeAndValidateFolderPath(folderPath);
    const parts = normalized.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof import_obsidian.TFolder) {
        continue;
      }
      if (existing) {
        throw new Error(`${current} \u5DF2\u5B58\u5728\u4E14\u4E0D\u662F\u6587\u4EF6\u5939`);
      }
      try {
        await this.app.vault.createFolder(current);
      } catch {
        const raced = this.app.vault.getAbstractFileByPath(current);
        if (!(raced instanceof import_obsidian.TFolder)) {
          throw new Error(`\u65E0\u6CD5\u521B\u5EFA\u6210\u679C\u76EE\u5F55 ${current}`);
        }
      }
    }
  }
  async writeManagedFile(filePath, desired) {
    const normalized = normalizeAndValidatePath(filePath);
    if (!managedPathInfo(normalized)) {
      throw new Error("\u6210\u679C\u6587\u4EF6\u8DEF\u5F84\u4E0D\u5728\u5141\u8BB8\u7684\u6258\u7BA1\u76EE\u5F55\u4E2D");
    }
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (!existing) {
      try {
        await this.app.vault.create(normalized, desired);
        return true;
      } catch {
        const raced = this.app.vault.getAbstractFileByPath(normalized);
        if (!(raced instanceof import_obsidian.TFile)) {
          throw new Error("\u521B\u5EFA\u5931\u8D25\u4E14\u76EE\u6807\u4E0D\u662F\u53EF\u5904\u7406\u7684\u6587\u4EF6");
        }
        return this.processExisting(raced, desired);
      }
    }
    if (!(existing instanceof import_obsidian.TFile)) {
      throw new Error("\u76EE\u6807\u8DEF\u5F84\u5DF2\u88AB\u6587\u4EF6\u5939\u5360\u7528");
    }
    return this.processExisting(existing, desired);
  }
  async processExisting(file, desired) {
    const existing = await this.app.vault.cachedRead(file);
    const preview = mergeGeneratedBlock(existing, desired);
    if (!preview.ok) {
      throw new Error(preview.error ?? "\u65E0\u6CD5\u66F4\u65B0\u6210\u679C\u6587\u4EF6");
    }
    if (preview.content === existing) {
      return false;
    }
    let changed = false;
    let failure;
    await this.app.vault.process(file, (current) => {
      const merged = mergeGeneratedBlock(current, desired);
      if (!merged.ok) {
        failure = merged.error ?? "\u65E0\u6CD5\u66F4\u65B0\u6210\u679C\u6587\u4EF6";
        return current;
      }
      changed = merged.content !== current;
      return merged.content;
    });
    if (failure) {
      throw new Error(failure);
    }
    return changed;
  }
  async markStale(file) {
    const existing = await this.app.vault.cachedRead(file);
    const preview = markArtifactNoteStale(existing);
    if (!preview.ok) {
      throw new Error(preview.error ?? "\u65E0\u6CD5\u6807\u8BB0\u5386\u53F2\u6210\u679C");
    }
    if (preview.content === existing) {
      return false;
    }
    let changed = false;
    let failure;
    await this.app.vault.process(file, (current) => {
      const stale = markArtifactNoteStale(current);
      if (!stale.ok) {
        failure = stale.error ?? "\u65E0\u6CD5\u6807\u8BB0\u5386\u53F2\u6210\u679C";
        return current;
      }
      changed = stale.content !== current;
      return stale.content;
    });
    if (failure) {
      throw new Error(failure);
    }
    return changed;
  }
};
function groupByDate(artifacts) {
  const byDate = /* @__PURE__ */ new Map();
  for (const artifact of artifacts) {
    const dateArtifacts = byDate.get(artifact.localDate) ?? [];
    dateArtifacts.push(artifact);
    byDate.set(artifact.localDate, dateArtifacts);
  }
  return byDate;
}
function compareManagedCopies(left, right) {
  const staleOrder = Number(left.stale) - Number(right.stale);
  if (staleOrder !== 0) {
    return staleOrder;
  }
  const leftPrimary = /\/成果-[0-9a-f]{12}\.md$/.test(left.path) ? 0 : 1;
  const rightPrimary = /\/成果-[0-9a-f]{12}\.md$/.test(right.path) ? 0 : 1;
  return leftPrimary - rightPrimary || left.path.localeCompare(right.path);
}
function managedPathInfo(path13) {
  const daily = path13.match(/^成果\/知行台\/(\d{4}-\d{2}-\d{2})\.md$/);
  if (daily?.[1] && isValidLocalDate(daily[1])) {
    return { date: daily[1], daily: true };
  }
  const readable = path13.match(/^成果\/知行台\/(\d{4}-\d{2}-\d{2})\/[^/]+\.md$/);
  if (readable?.[1] && isValidLocalDate(readable[1])) {
    return { date: readable[1], daily: false };
  }
  return null;
}
function normalizeAndValidatePath(filePath) {
  const slashPath = filePath.replace(/\\/g, "/");
  if (slashPath.startsWith("/") || /^[A-Za-z]:/.test(slashPath) || slashPath.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("\u6210\u679C\u8DEF\u5F84\u5305\u542B\u7EDD\u5BF9\u8DEF\u5F84\u6216\u76EE\u5F55\u7A7F\u8D8A");
  }
  const normalized = (0, import_obsidian.normalizePath)(slashPath);
  if (!normalized.startsWith(`${ARTIFACT_ROOT}/`) || normalized === ARTIFACT_ROOT) {
    throw new Error("\u6210\u679C\u8DEF\u5F84\u8D85\u51FA\u77E5\u884C\u53F0\u6258\u7BA1\u76EE\u5F55");
  }
  return normalized;
}
function fileBaseName(filePath) {
  const name = filePath.split("/").at(-1) ?? filePath;
  return name.replace(/\.md$/i, "");
}
function normalizeAndValidateFolderPath(folderPath) {
  const slashPath = folderPath.replace(/\\/g, "/");
  if (slashPath.startsWith("/") || /^[A-Za-z]:/.test(slashPath) || slashPath.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("\u6210\u679C\u76EE\u5F55\u5305\u542B\u7EDD\u5BF9\u8DEF\u5F84\u6216\u76EE\u5F55\u7A7F\u8D8A");
  }
  const normalized = (0, import_obsidian.normalizePath)(slashPath);
  if (normalized !== ARTIFACT_ROOT && !normalized.startsWith(`${ARTIFACT_ROOT}/`)) {
    throw new Error("\u6210\u679C\u76EE\u5F55\u8D85\u51FA\u77E5\u884C\u53F0\u6258\u7BA1\u76EE\u5F55");
  }
  return normalized;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// node_modules/date-fns/constants.js
var daysInYear = 365.2425;
var maxTime = Math.pow(10, 8) * 24 * 60 * 60 * 1e3;
var minTime = -maxTime;
var millisecondsInWeek = 6048e5;
var millisecondsInDay = 864e5;
var millisecondsInMinute = 6e4;
var millisecondsInHour = 36e5;
var secondsInHour = 3600;
var secondsInDay = secondsInHour * 24;
var secondsInWeek = secondsInDay * 7;
var secondsInYear = secondsInDay * daysInYear;
var secondsInMonth = secondsInYear / 12;
var secondsInQuarter = secondsInMonth * 3;
var constructFromSymbol = /* @__PURE__ */ Symbol.for("constructDateFrom");

// node_modules/date-fns/constructFrom.js
function constructFrom(date, value) {
  if (typeof date === "function") return date(value);
  if (date && typeof date === "object" && constructFromSymbol in date)
    return date[constructFromSymbol](value);
  if (date instanceof Date) return new date.constructor(value);
  return new Date(value);
}

// node_modules/date-fns/toDate.js
function toDate(argument, context) {
  return constructFrom(context || argument, argument);
}

// node_modules/date-fns/addDays.js
function addDays(date, amount, options) {
  const _date = toDate(date, options?.in);
  if (isNaN(amount)) return constructFrom(options?.in || date, NaN);
  if (!amount) return _date;
  _date.setDate(_date.getDate() + amount);
  return _date;
}

// node_modules/date-fns/addMonths.js
function addMonths(date, amount, options) {
  const _date = toDate(date, options?.in);
  if (isNaN(amount)) return constructFrom(options?.in || date, NaN);
  if (!amount) {
    return _date;
  }
  const dayOfMonth = _date.getDate();
  const endOfDesiredMonth = constructFrom(options?.in || date, _date.getTime());
  endOfDesiredMonth.setMonth(_date.getMonth() + amount + 1, 0);
  const daysInMonth = endOfDesiredMonth.getDate();
  if (dayOfMonth >= daysInMonth) {
    return endOfDesiredMonth;
  } else {
    _date.setFullYear(
      endOfDesiredMonth.getFullYear(),
      endOfDesiredMonth.getMonth(),
      dayOfMonth
    );
    return _date;
  }
}

// node_modules/date-fns/_lib/defaultOptions.js
var defaultOptions = {};
function getDefaultOptions() {
  return defaultOptions;
}

// node_modules/date-fns/startOfWeek.js
function startOfWeek(date, options) {
  const defaultOptions2 = getDefaultOptions();
  const weekStartsOn = options?.weekStartsOn ?? options?.locale?.options?.weekStartsOn ?? defaultOptions2.weekStartsOn ?? defaultOptions2.locale?.options?.weekStartsOn ?? 0;
  const _date = toDate(date, options?.in);
  const day = _date.getDay();
  const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
  _date.setDate(_date.getDate() - diff);
  _date.setHours(0, 0, 0, 0);
  return _date;
}

// node_modules/date-fns/startOfISOWeek.js
function startOfISOWeek(date, options) {
  return startOfWeek(date, { ...options, weekStartsOn: 1 });
}

// node_modules/date-fns/getISOWeekYear.js
function getISOWeekYear(date, options) {
  const _date = toDate(date, options?.in);
  const year = _date.getFullYear();
  const fourthOfJanuaryOfNextYear = constructFrom(_date, 0);
  fourthOfJanuaryOfNextYear.setFullYear(year + 1, 0, 4);
  fourthOfJanuaryOfNextYear.setHours(0, 0, 0, 0);
  const startOfNextYear = startOfISOWeek(fourthOfJanuaryOfNextYear);
  const fourthOfJanuaryOfThisYear = constructFrom(_date, 0);
  fourthOfJanuaryOfThisYear.setFullYear(year, 0, 4);
  fourthOfJanuaryOfThisYear.setHours(0, 0, 0, 0);
  const startOfThisYear = startOfISOWeek(fourthOfJanuaryOfThisYear);
  if (_date.getTime() >= startOfNextYear.getTime()) {
    return year + 1;
  } else if (_date.getTime() >= startOfThisYear.getTime()) {
    return year;
  } else {
    return year - 1;
  }
}

// node_modules/date-fns/_lib/getTimezoneOffsetInMilliseconds.js
function getTimezoneOffsetInMilliseconds(date) {
  const _date = toDate(date);
  const utcDate = new Date(
    Date.UTC(
      _date.getFullYear(),
      _date.getMonth(),
      _date.getDate(),
      _date.getHours(),
      _date.getMinutes(),
      _date.getSeconds(),
      _date.getMilliseconds()
    )
  );
  utcDate.setUTCFullYear(_date.getFullYear());
  return +date - +utcDate;
}

// node_modules/date-fns/_lib/normalizeDates.js
function normalizeDates(context, ...dates) {
  const normalize = constructFrom.bind(
    null,
    context || dates.find((date) => typeof date === "object")
  );
  return dates.map(normalize);
}

// node_modules/date-fns/startOfDay.js
function startOfDay(date, options) {
  const _date = toDate(date, options?.in);
  _date.setHours(0, 0, 0, 0);
  return _date;
}

// node_modules/date-fns/differenceInCalendarDays.js
function differenceInCalendarDays(laterDate, earlierDate, options) {
  const [laterDate_, earlierDate_] = normalizeDates(
    options?.in,
    laterDate,
    earlierDate
  );
  const laterStartOfDay = startOfDay(laterDate_);
  const earlierStartOfDay = startOfDay(earlierDate_);
  const laterTimestamp = +laterStartOfDay - getTimezoneOffsetInMilliseconds(laterStartOfDay);
  const earlierTimestamp = +earlierStartOfDay - getTimezoneOffsetInMilliseconds(earlierStartOfDay);
  return Math.round((laterTimestamp - earlierTimestamp) / millisecondsInDay);
}

// node_modules/date-fns/startOfISOWeekYear.js
function startOfISOWeekYear(date, options) {
  const year = getISOWeekYear(date, options);
  const fourthOfJanuary = constructFrom(options?.in || date, 0);
  fourthOfJanuary.setFullYear(year, 0, 4);
  fourthOfJanuary.setHours(0, 0, 0, 0);
  return startOfISOWeek(fourthOfJanuary);
}

// node_modules/date-fns/isDate.js
function isDate(value) {
  return value instanceof Date || typeof value === "object" && Object.prototype.toString.call(value) === "[object Date]";
}

// node_modules/date-fns/isValid.js
function isValid(date) {
  return !(!isDate(date) && typeof date !== "number" || isNaN(+toDate(date)));
}

// node_modules/date-fns/endOfMonth.js
function endOfMonth(date, options) {
  const _date = toDate(date, options?.in);
  const month = _date.getMonth();
  _date.setFullYear(_date.getFullYear(), month + 1, 0);
  _date.setHours(23, 59, 59, 999);
  return _date;
}

// node_modules/date-fns/_lib/normalizeInterval.js
function normalizeInterval(context, interval) {
  const [start, end] = normalizeDates(context, interval.start, interval.end);
  return { start, end };
}

// node_modules/date-fns/eachDayOfInterval.js
function eachDayOfInterval(interval, options) {
  const { start, end } = normalizeInterval(options?.in, interval);
  let reversed = +start > +end;
  const endTime = reversed ? +start : +end;
  const date = reversed ? end : start;
  date.setHours(0, 0, 0, 0);
  let step = options?.step ?? 1;
  if (!step) return [];
  if (step < 0) {
    step = -step;
    reversed = !reversed;
  }
  const dates = [];
  while (+date <= endTime) {
    dates.push(constructFrom(start, date));
    date.setDate(date.getDate() + step);
    date.setHours(0, 0, 0, 0);
  }
  return reversed ? dates.reverse() : dates;
}

// node_modules/date-fns/startOfMonth.js
function startOfMonth(date, options) {
  const _date = toDate(date, options?.in);
  _date.setDate(1);
  _date.setHours(0, 0, 0, 0);
  return _date;
}

// node_modules/date-fns/startOfYear.js
function startOfYear(date, options) {
  const date_ = toDate(date, options?.in);
  date_.setFullYear(date_.getFullYear(), 0, 1);
  date_.setHours(0, 0, 0, 0);
  return date_;
}

// node_modules/date-fns/endOfWeek.js
function endOfWeek(date, options) {
  const defaultOptions2 = getDefaultOptions();
  const weekStartsOn = options?.weekStartsOn ?? options?.locale?.options?.weekStartsOn ?? defaultOptions2.weekStartsOn ?? defaultOptions2.locale?.options?.weekStartsOn ?? 0;
  const _date = toDate(date, options?.in);
  const day = _date.getDay();
  const diff = (day < weekStartsOn ? -7 : 0) + 6 - (day - weekStartsOn);
  _date.setDate(_date.getDate() + diff);
  _date.setHours(23, 59, 59, 999);
  return _date;
}

// node_modules/date-fns/locale/en-US/_lib/formatDistance.js
var formatDistanceLocale = {
  lessThanXSeconds: {
    one: "less than a second",
    other: "less than {{count}} seconds"
  },
  xSeconds: {
    one: "1 second",
    other: "{{count}} seconds"
  },
  halfAMinute: "half a minute",
  lessThanXMinutes: {
    one: "less than a minute",
    other: "less than {{count}} minutes"
  },
  xMinutes: {
    one: "1 minute",
    other: "{{count}} minutes"
  },
  aboutXHours: {
    one: "about 1 hour",
    other: "about {{count}} hours"
  },
  xHours: {
    one: "1 hour",
    other: "{{count}} hours"
  },
  xDays: {
    one: "1 day",
    other: "{{count}} days"
  },
  aboutXWeeks: {
    one: "about 1 week",
    other: "about {{count}} weeks"
  },
  xWeeks: {
    one: "1 week",
    other: "{{count}} weeks"
  },
  aboutXMonths: {
    one: "about 1 month",
    other: "about {{count}} months"
  },
  xMonths: {
    one: "1 month",
    other: "{{count}} months"
  },
  aboutXYears: {
    one: "about 1 year",
    other: "about {{count}} years"
  },
  xYears: {
    one: "1 year",
    other: "{{count}} years"
  },
  overXYears: {
    one: "over 1 year",
    other: "over {{count}} years"
  },
  almostXYears: {
    one: "almost 1 year",
    other: "almost {{count}} years"
  }
};
var formatDistance = (token, count2, options) => {
  let result2;
  const tokenValue = formatDistanceLocale[token];
  if (typeof tokenValue === "string") {
    result2 = tokenValue;
  } else if (count2 === 1) {
    result2 = tokenValue.one;
  } else {
    result2 = tokenValue.other.replace("{{count}}", count2.toString());
  }
  if (options?.addSuffix) {
    if (options.comparison && options.comparison > 0) {
      return "in " + result2;
    } else {
      return result2 + " ago";
    }
  }
  return result2;
};

// node_modules/date-fns/locale/_lib/buildFormatLongFn.js
function buildFormatLongFn(args) {
  return (options = {}) => {
    const width = options.width ? String(options.width) : args.defaultWidth;
    const format2 = args.formats[width] || args.formats[args.defaultWidth];
    return format2;
  };
}

// node_modules/date-fns/locale/en-US/_lib/formatLong.js
var dateFormats = {
  full: "EEEE, MMMM do, y",
  long: "MMMM do, y",
  medium: "MMM d, y",
  short: "MM/dd/yyyy"
};
var timeFormats = {
  full: "h:mm:ss a zzzz",
  long: "h:mm:ss a z",
  medium: "h:mm:ss a",
  short: "h:mm a"
};
var dateTimeFormats = {
  full: "{{date}} 'at' {{time}}",
  long: "{{date}} 'at' {{time}}",
  medium: "{{date}}, {{time}}",
  short: "{{date}}, {{time}}"
};
var formatLong = {
  date: buildFormatLongFn({
    formats: dateFormats,
    defaultWidth: "full"
  }),
  time: buildFormatLongFn({
    formats: timeFormats,
    defaultWidth: "full"
  }),
  dateTime: buildFormatLongFn({
    formats: dateTimeFormats,
    defaultWidth: "full"
  })
};

// node_modules/date-fns/locale/en-US/_lib/formatRelative.js
var formatRelativeLocale = {
  lastWeek: "'last' eeee 'at' p",
  yesterday: "'yesterday at' p",
  today: "'today at' p",
  tomorrow: "'tomorrow at' p",
  nextWeek: "eeee 'at' p",
  other: "P"
};
var formatRelative = (token, _date, _baseDate, _options) => formatRelativeLocale[token];

// node_modules/date-fns/locale/_lib/buildLocalizeFn.js
function buildLocalizeFn(args) {
  return (value, options) => {
    const context = options?.context ? String(options.context) : "standalone";
    let valuesArray;
    if (context === "formatting" && args.formattingValues) {
      const defaultWidth = args.defaultFormattingWidth || args.defaultWidth;
      const width = options?.width ? String(options.width) : defaultWidth;
      valuesArray = args.formattingValues[width] || args.formattingValues[defaultWidth];
    } else {
      const defaultWidth = args.defaultWidth;
      const width = options?.width ? String(options.width) : args.defaultWidth;
      valuesArray = args.values[width] || args.values[defaultWidth];
    }
    const index = args.argumentCallback ? args.argumentCallback(value) : value;
    return valuesArray[index];
  };
}

// node_modules/date-fns/locale/en-US/_lib/localize.js
var eraValues = {
  narrow: ["B", "A"],
  abbreviated: ["BC", "AD"],
  wide: ["Before Christ", "Anno Domini"]
};
var quarterValues = {
  narrow: ["1", "2", "3", "4"],
  abbreviated: ["Q1", "Q2", "Q3", "Q4"],
  wide: ["1st quarter", "2nd quarter", "3rd quarter", "4th quarter"]
};
var monthValues = {
  narrow: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"],
  abbreviated: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ],
  wide: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ]
};
var dayValues = {
  narrow: ["S", "M", "T", "W", "T", "F", "S"],
  short: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  abbreviated: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  wide: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
  ]
};
var dayPeriodValues = {
  narrow: {
    am: "a",
    pm: "p",
    midnight: "mi",
    noon: "n",
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    night: "night"
  },
  abbreviated: {
    am: "AM",
    pm: "PM",
    midnight: "midnight",
    noon: "noon",
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    night: "night"
  },
  wide: {
    am: "a.m.",
    pm: "p.m.",
    midnight: "midnight",
    noon: "noon",
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    night: "night"
  }
};
var formattingDayPeriodValues = {
  narrow: {
    am: "a",
    pm: "p",
    midnight: "mi",
    noon: "n",
    morning: "in the morning",
    afternoon: "in the afternoon",
    evening: "in the evening",
    night: "at night"
  },
  abbreviated: {
    am: "AM",
    pm: "PM",
    midnight: "midnight",
    noon: "noon",
    morning: "in the morning",
    afternoon: "in the afternoon",
    evening: "in the evening",
    night: "at night"
  },
  wide: {
    am: "a.m.",
    pm: "p.m.",
    midnight: "midnight",
    noon: "noon",
    morning: "in the morning",
    afternoon: "in the afternoon",
    evening: "in the evening",
    night: "at night"
  }
};
var ordinalNumber = (dirtyNumber, _options) => {
  const number = Number(dirtyNumber);
  const rem100 = number % 100;
  if (rem100 > 20 || rem100 < 10) {
    switch (rem100 % 10) {
      case 1:
        return number + "st";
      case 2:
        return number + "nd";
      case 3:
        return number + "rd";
    }
  }
  return number + "th";
};
var localize = {
  ordinalNumber,
  era: buildLocalizeFn({
    values: eraValues,
    defaultWidth: "wide"
  }),
  quarter: buildLocalizeFn({
    values: quarterValues,
    defaultWidth: "wide",
    argumentCallback: (quarter) => quarter - 1
  }),
  month: buildLocalizeFn({
    values: monthValues,
    defaultWidth: "wide"
  }),
  day: buildLocalizeFn({
    values: dayValues,
    defaultWidth: "wide"
  }),
  dayPeriod: buildLocalizeFn({
    values: dayPeriodValues,
    defaultWidth: "wide",
    formattingValues: formattingDayPeriodValues,
    defaultFormattingWidth: "wide"
  })
};

// node_modules/date-fns/locale/_lib/buildMatchFn.js
function buildMatchFn(args) {
  return (string, options = {}) => {
    const width = options.width;
    const matchPattern = width && args.matchPatterns[width] || args.matchPatterns[args.defaultMatchWidth];
    const matchResult = string.match(matchPattern);
    if (!matchResult) {
      return null;
    }
    const matchedString = matchResult[0];
    const parsePatterns = width && args.parsePatterns[width] || args.parsePatterns[args.defaultParseWidth];
    const key = Array.isArray(parsePatterns) ? findIndex(parsePatterns, (pattern) => pattern.test(matchedString)) : (
      // [TODO] -- I challenge you to fix the type
      findKey(parsePatterns, (pattern) => pattern.test(matchedString))
    );
    let value;
    value = args.valueCallback ? args.valueCallback(key) : key;
    value = options.valueCallback ? (
      // [TODO] -- I challenge you to fix the type
      options.valueCallback(value)
    ) : value;
    const rest = string.slice(matchedString.length);
    return { value, rest };
  };
}
function findKey(object, predicate) {
  for (const key in object) {
    if (Object.prototype.hasOwnProperty.call(object, key) && predicate(object[key])) {
      return key;
    }
  }
  return void 0;
}
function findIndex(array, predicate) {
  for (let key = 0; key < array.length; key++) {
    if (predicate(array[key])) {
      return key;
    }
  }
  return void 0;
}

// node_modules/date-fns/locale/_lib/buildMatchPatternFn.js
function buildMatchPatternFn(args) {
  return (string, options = {}) => {
    const matchResult = string.match(args.matchPattern);
    if (!matchResult) return null;
    const matchedString = matchResult[0];
    const parseResult = string.match(args.parsePattern);
    if (!parseResult) return null;
    let value = args.valueCallback ? args.valueCallback(parseResult[0]) : parseResult[0];
    value = options.valueCallback ? options.valueCallback(value) : value;
    const rest = string.slice(matchedString.length);
    return { value, rest };
  };
}

// node_modules/date-fns/locale/en-US/_lib/match.js
var matchOrdinalNumberPattern = /^(\d+)(th|st|nd|rd)?/i;
var parseOrdinalNumberPattern = /\d+/i;
var matchEraPatterns = {
  narrow: /^(b|a)/i,
  abbreviated: /^(b\.?\s?c\.?|b\.?\s?c\.?\s?e\.?|a\.?\s?d\.?|c\.?\s?e\.?)/i,
  wide: /^(before christ|before common era|anno domini|common era)/i
};
var parseEraPatterns = {
  any: [/^b/i, /^(a|c)/i]
};
var matchQuarterPatterns = {
  narrow: /^[1234]/i,
  abbreviated: /^q[1234]/i,
  wide: /^[1234](th|st|nd|rd)? quarter/i
};
var parseQuarterPatterns = {
  any: [/1/i, /2/i, /3/i, /4/i]
};
var matchMonthPatterns = {
  narrow: /^[jfmasond]/i,
  abbreviated: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  wide: /^(january|february|march|april|may|june|july|august|september|october|november|december)/i
};
var parseMonthPatterns = {
  narrow: [
    /^j/i,
    /^f/i,
    /^m/i,
    /^a/i,
    /^m/i,
    /^j/i,
    /^j/i,
    /^a/i,
    /^s/i,
    /^o/i,
    /^n/i,
    /^d/i
  ],
  any: [
    /^ja/i,
    /^f/i,
    /^mar/i,
    /^ap/i,
    /^may/i,
    /^jun/i,
    /^jul/i,
    /^au/i,
    /^s/i,
    /^o/i,
    /^n/i,
    /^d/i
  ]
};
var matchDayPatterns = {
  narrow: /^[smtwf]/i,
  short: /^(su|mo|tu|we|th|fr|sa)/i,
  abbreviated: /^(sun|mon|tue|wed|thu|fri|sat)/i,
  wide: /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i
};
var parseDayPatterns = {
  narrow: [/^s/i, /^m/i, /^t/i, /^w/i, /^t/i, /^f/i, /^s/i],
  any: [/^su/i, /^m/i, /^tu/i, /^w/i, /^th/i, /^f/i, /^sa/i]
};
var matchDayPeriodPatterns = {
  narrow: /^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,
  any: /^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i
};
var parseDayPeriodPatterns = {
  any: {
    am: /^a/i,
    pm: /^p/i,
    midnight: /^mi/i,
    noon: /^no/i,
    morning: /morning/i,
    afternoon: /afternoon/i,
    evening: /evening/i,
    night: /night/i
  }
};
var match = {
  ordinalNumber: buildMatchPatternFn({
    matchPattern: matchOrdinalNumberPattern,
    parsePattern: parseOrdinalNumberPattern,
    valueCallback: (value) => parseInt(value, 10)
  }),
  era: buildMatchFn({
    matchPatterns: matchEraPatterns,
    defaultMatchWidth: "wide",
    parsePatterns: parseEraPatterns,
    defaultParseWidth: "any"
  }),
  quarter: buildMatchFn({
    matchPatterns: matchQuarterPatterns,
    defaultMatchWidth: "wide",
    parsePatterns: parseQuarterPatterns,
    defaultParseWidth: "any",
    valueCallback: (index) => index + 1
  }),
  month: buildMatchFn({
    matchPatterns: matchMonthPatterns,
    defaultMatchWidth: "wide",
    parsePatterns: parseMonthPatterns,
    defaultParseWidth: "any"
  }),
  day: buildMatchFn({
    matchPatterns: matchDayPatterns,
    defaultMatchWidth: "wide",
    parsePatterns: parseDayPatterns,
    defaultParseWidth: "any"
  }),
  dayPeriod: buildMatchFn({
    matchPatterns: matchDayPeriodPatterns,
    defaultMatchWidth: "any",
    parsePatterns: parseDayPeriodPatterns,
    defaultParseWidth: "any"
  })
};

// node_modules/date-fns/locale/en-US.js
var enUS = {
  code: "en-US",
  formatDistance,
  formatLong,
  formatRelative,
  localize,
  match,
  options: {
    weekStartsOn: 0,
    firstWeekContainsDate: 1
  }
};

// node_modules/date-fns/getDayOfYear.js
function getDayOfYear(date, options) {
  const _date = toDate(date, options?.in);
  const diff = differenceInCalendarDays(_date, startOfYear(_date));
  const dayOfYear = diff + 1;
  return dayOfYear;
}

// node_modules/date-fns/getISOWeek.js
function getISOWeek(date, options) {
  const _date = toDate(date, options?.in);
  const diff = +startOfISOWeek(_date) - +startOfISOWeekYear(_date);
  return Math.round(diff / millisecondsInWeek) + 1;
}

// node_modules/date-fns/getWeekYear.js
function getWeekYear(date, options) {
  const _date = toDate(date, options?.in);
  const year = _date.getFullYear();
  const defaultOptions2 = getDefaultOptions();
  const firstWeekContainsDate = options?.firstWeekContainsDate ?? options?.locale?.options?.firstWeekContainsDate ?? defaultOptions2.firstWeekContainsDate ?? defaultOptions2.locale?.options?.firstWeekContainsDate ?? 1;
  const firstWeekOfNextYear = constructFrom(options?.in || date, 0);
  firstWeekOfNextYear.setFullYear(year + 1, 0, firstWeekContainsDate);
  firstWeekOfNextYear.setHours(0, 0, 0, 0);
  const startOfNextYear = startOfWeek(firstWeekOfNextYear, options);
  const firstWeekOfThisYear = constructFrom(options?.in || date, 0);
  firstWeekOfThisYear.setFullYear(year, 0, firstWeekContainsDate);
  firstWeekOfThisYear.setHours(0, 0, 0, 0);
  const startOfThisYear = startOfWeek(firstWeekOfThisYear, options);
  if (+_date >= +startOfNextYear) {
    return year + 1;
  } else if (+_date >= +startOfThisYear) {
    return year;
  } else {
    return year - 1;
  }
}

// node_modules/date-fns/startOfWeekYear.js
function startOfWeekYear(date, options) {
  const defaultOptions2 = getDefaultOptions();
  const firstWeekContainsDate = options?.firstWeekContainsDate ?? options?.locale?.options?.firstWeekContainsDate ?? defaultOptions2.firstWeekContainsDate ?? defaultOptions2.locale?.options?.firstWeekContainsDate ?? 1;
  const year = getWeekYear(date, options);
  const firstWeek = constructFrom(options?.in || date, 0);
  firstWeek.setFullYear(year, 0, firstWeekContainsDate);
  firstWeek.setHours(0, 0, 0, 0);
  const _date = startOfWeek(firstWeek, options);
  return _date;
}

// node_modules/date-fns/getWeek.js
function getWeek(date, options) {
  const _date = toDate(date, options?.in);
  const diff = +startOfWeek(_date, options) - +startOfWeekYear(_date, options);
  return Math.round(diff / millisecondsInWeek) + 1;
}

// node_modules/date-fns/_lib/addLeadingZeros.js
function addLeadingZeros(number, targetLength) {
  const sign = number < 0 ? "-" : "";
  const output = Math.abs(number).toString().padStart(targetLength, "0");
  return sign + output;
}

// node_modules/date-fns/_lib/format/lightFormatters.js
var lightFormatters = {
  // Year
  y(date, token) {
    const signedYear = date.getFullYear();
    const year = signedYear > 0 ? signedYear : 1 - signedYear;
    return addLeadingZeros(token === "yy" ? year % 100 : year, token.length);
  },
  // Month
  M(date, token) {
    const month = date.getMonth();
    return token === "M" ? String(month + 1) : addLeadingZeros(month + 1, 2);
  },
  // Day of the month
  d(date, token) {
    return addLeadingZeros(date.getDate(), token.length);
  },
  // AM or PM
  a(date, token) {
    const dayPeriodEnumValue = date.getHours() / 12 >= 1 ? "pm" : "am";
    switch (token) {
      case "a":
      case "aa":
        return dayPeriodEnumValue.toUpperCase();
      case "aaa":
        return dayPeriodEnumValue;
      case "aaaaa":
        return dayPeriodEnumValue[0];
      case "aaaa":
      default:
        return dayPeriodEnumValue === "am" ? "a.m." : "p.m.";
    }
  },
  // Hour [1-12]
  h(date, token) {
    return addLeadingZeros(date.getHours() % 12 || 12, token.length);
  },
  // Hour [0-23]
  H(date, token) {
    return addLeadingZeros(date.getHours(), token.length);
  },
  // Minute
  m(date, token) {
    return addLeadingZeros(date.getMinutes(), token.length);
  },
  // Second
  s(date, token) {
    return addLeadingZeros(date.getSeconds(), token.length);
  },
  // Fraction of second
  S(date, token) {
    const numberOfDigits = token.length;
    const milliseconds = date.getMilliseconds();
    const fractionalSeconds = Math.trunc(
      milliseconds * Math.pow(10, numberOfDigits - 3)
    );
    return addLeadingZeros(fractionalSeconds, token.length);
  }
};

// node_modules/date-fns/_lib/format/formatters.js
var dayPeriodEnum = {
  am: "am",
  pm: "pm",
  midnight: "midnight",
  noon: "noon",
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
  night: "night"
};
var formatters = {
  // Era
  G: function(date, token, localize2) {
    const era = date.getFullYear() > 0 ? 1 : 0;
    switch (token) {
      // AD, BC
      case "G":
      case "GG":
      case "GGG":
        return localize2.era(era, { width: "abbreviated" });
      // A, B
      case "GGGGG":
        return localize2.era(era, { width: "narrow" });
      // Anno Domini, Before Christ
      case "GGGG":
      default:
        return localize2.era(era, { width: "wide" });
    }
  },
  // Year
  y: function(date, token, localize2) {
    if (token === "yo") {
      const signedYear = date.getFullYear();
      const year = signedYear > 0 ? signedYear : 1 - signedYear;
      return localize2.ordinalNumber(year, { unit: "year" });
    }
    return lightFormatters.y(date, token);
  },
  // Local week-numbering year
  Y: function(date, token, localize2, options) {
    const signedWeekYear = getWeekYear(date, options);
    const weekYear = signedWeekYear > 0 ? signedWeekYear : 1 - signedWeekYear;
    if (token === "YY") {
      const twoDigitYear = weekYear % 100;
      return addLeadingZeros(twoDigitYear, 2);
    }
    if (token === "Yo") {
      return localize2.ordinalNumber(weekYear, { unit: "year" });
    }
    return addLeadingZeros(weekYear, token.length);
  },
  // ISO week-numbering year
  R: function(date, token) {
    const isoWeekYear = getISOWeekYear(date);
    return addLeadingZeros(isoWeekYear, token.length);
  },
  // Extended year. This is a single number designating the year of this calendar system.
  // The main difference between `y` and `u` localizers are B.C. years:
  // | Year | `y` | `u` |
  // |------|-----|-----|
  // | AC 1 |   1 |   1 |
  // | BC 1 |   1 |   0 |
  // | BC 2 |   2 |  -1 |
  // Also `yy` always returns the last two digits of a year,
  // while `uu` pads single digit years to 2 characters and returns other years unchanged.
  u: function(date, token) {
    const year = date.getFullYear();
    return addLeadingZeros(year, token.length);
  },
  // Quarter
  Q: function(date, token, localize2) {
    const quarter = Math.ceil((date.getMonth() + 1) / 3);
    switch (token) {
      // 1, 2, 3, 4
      case "Q":
        return String(quarter);
      // 01, 02, 03, 04
      case "QQ":
        return addLeadingZeros(quarter, 2);
      // 1st, 2nd, 3rd, 4th
      case "Qo":
        return localize2.ordinalNumber(quarter, { unit: "quarter" });
      // Q1, Q2, Q3, Q4
      case "QQQ":
        return localize2.quarter(quarter, {
          width: "abbreviated",
          context: "formatting"
        });
      // 1, 2, 3, 4 (narrow quarter; could be not numerical)
      case "QQQQQ":
        return localize2.quarter(quarter, {
          width: "narrow",
          context: "formatting"
        });
      // 1st quarter, 2nd quarter, ...
      case "QQQQ":
      default:
        return localize2.quarter(quarter, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Stand-alone quarter
  q: function(date, token, localize2) {
    const quarter = Math.ceil((date.getMonth() + 1) / 3);
    switch (token) {
      // 1, 2, 3, 4
      case "q":
        return String(quarter);
      // 01, 02, 03, 04
      case "qq":
        return addLeadingZeros(quarter, 2);
      // 1st, 2nd, 3rd, 4th
      case "qo":
        return localize2.ordinalNumber(quarter, { unit: "quarter" });
      // Q1, Q2, Q3, Q4
      case "qqq":
        return localize2.quarter(quarter, {
          width: "abbreviated",
          context: "standalone"
        });
      // 1, 2, 3, 4 (narrow quarter; could be not numerical)
      case "qqqqq":
        return localize2.quarter(quarter, {
          width: "narrow",
          context: "standalone"
        });
      // 1st quarter, 2nd quarter, ...
      case "qqqq":
      default:
        return localize2.quarter(quarter, {
          width: "wide",
          context: "standalone"
        });
    }
  },
  // Month
  M: function(date, token, localize2) {
    const month = date.getMonth();
    switch (token) {
      case "M":
      case "MM":
        return lightFormatters.M(date, token);
      // 1st, 2nd, ..., 12th
      case "Mo":
        return localize2.ordinalNumber(month + 1, { unit: "month" });
      // Jan, Feb, ..., Dec
      case "MMM":
        return localize2.month(month, {
          width: "abbreviated",
          context: "formatting"
        });
      // J, F, ..., D
      case "MMMMM":
        return localize2.month(month, {
          width: "narrow",
          context: "formatting"
        });
      // January, February, ..., December
      case "MMMM":
      default:
        return localize2.month(month, { width: "wide", context: "formatting" });
    }
  },
  // Stand-alone month
  L: function(date, token, localize2) {
    const month = date.getMonth();
    switch (token) {
      // 1, 2, ..., 12
      case "L":
        return String(month + 1);
      // 01, 02, ..., 12
      case "LL":
        return addLeadingZeros(month + 1, 2);
      // 1st, 2nd, ..., 12th
      case "Lo":
        return localize2.ordinalNumber(month + 1, { unit: "month" });
      // Jan, Feb, ..., Dec
      case "LLL":
        return localize2.month(month, {
          width: "abbreviated",
          context: "standalone"
        });
      // J, F, ..., D
      case "LLLLL":
        return localize2.month(month, {
          width: "narrow",
          context: "standalone"
        });
      // January, February, ..., December
      case "LLLL":
      default:
        return localize2.month(month, { width: "wide", context: "standalone" });
    }
  },
  // Local week of year
  w: function(date, token, localize2, options) {
    const week = getWeek(date, options);
    if (token === "wo") {
      return localize2.ordinalNumber(week, { unit: "week" });
    }
    return addLeadingZeros(week, token.length);
  },
  // ISO week of year
  I: function(date, token, localize2) {
    const isoWeek = getISOWeek(date);
    if (token === "Io") {
      return localize2.ordinalNumber(isoWeek, { unit: "week" });
    }
    return addLeadingZeros(isoWeek, token.length);
  },
  // Day of the month
  d: function(date, token, localize2) {
    if (token === "do") {
      return localize2.ordinalNumber(date.getDate(), { unit: "date" });
    }
    return lightFormatters.d(date, token);
  },
  // Day of year
  D: function(date, token, localize2) {
    const dayOfYear = getDayOfYear(date);
    if (token === "Do") {
      return localize2.ordinalNumber(dayOfYear, { unit: "dayOfYear" });
    }
    return addLeadingZeros(dayOfYear, token.length);
  },
  // Day of week
  E: function(date, token, localize2) {
    const dayOfWeek = date.getDay();
    switch (token) {
      // Tue
      case "E":
      case "EE":
      case "EEE":
        return localize2.day(dayOfWeek, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "EEEEE":
        return localize2.day(dayOfWeek, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "EEEEEE":
        return localize2.day(dayOfWeek, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "EEEE":
      default:
        return localize2.day(dayOfWeek, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Local day of week
  e: function(date, token, localize2, options) {
    const dayOfWeek = date.getDay();
    const localDayOfWeek = (dayOfWeek - options.weekStartsOn + 8) % 7 || 7;
    switch (token) {
      // Numerical value (Nth day of week with current locale or weekStartsOn)
      case "e":
        return String(localDayOfWeek);
      // Padded numerical value
      case "ee":
        return addLeadingZeros(localDayOfWeek, 2);
      // 1st, 2nd, ..., 7th
      case "eo":
        return localize2.ordinalNumber(localDayOfWeek, { unit: "day" });
      case "eee":
        return localize2.day(dayOfWeek, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "eeeee":
        return localize2.day(dayOfWeek, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "eeeeee":
        return localize2.day(dayOfWeek, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "eeee":
      default:
        return localize2.day(dayOfWeek, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Stand-alone local day of week
  c: function(date, token, localize2, options) {
    const dayOfWeek = date.getDay();
    const localDayOfWeek = (dayOfWeek - options.weekStartsOn + 8) % 7 || 7;
    switch (token) {
      // Numerical value (same as in `e`)
      case "c":
        return String(localDayOfWeek);
      // Padded numerical value
      case "cc":
        return addLeadingZeros(localDayOfWeek, token.length);
      // 1st, 2nd, ..., 7th
      case "co":
        return localize2.ordinalNumber(localDayOfWeek, { unit: "day" });
      case "ccc":
        return localize2.day(dayOfWeek, {
          width: "abbreviated",
          context: "standalone"
        });
      // T
      case "ccccc":
        return localize2.day(dayOfWeek, {
          width: "narrow",
          context: "standalone"
        });
      // Tu
      case "cccccc":
        return localize2.day(dayOfWeek, {
          width: "short",
          context: "standalone"
        });
      // Tuesday
      case "cccc":
      default:
        return localize2.day(dayOfWeek, {
          width: "wide",
          context: "standalone"
        });
    }
  },
  // ISO day of week
  i: function(date, token, localize2) {
    const dayOfWeek = date.getDay();
    const isoDayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek;
    switch (token) {
      // 2
      case "i":
        return String(isoDayOfWeek);
      // 02
      case "ii":
        return addLeadingZeros(isoDayOfWeek, token.length);
      // 2nd
      case "io":
        return localize2.ordinalNumber(isoDayOfWeek, { unit: "day" });
      // Tue
      case "iii":
        return localize2.day(dayOfWeek, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "iiiii":
        return localize2.day(dayOfWeek, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "iiiiii":
        return localize2.day(dayOfWeek, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "iiii":
      default:
        return localize2.day(dayOfWeek, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // AM or PM
  a: function(date, token, localize2) {
    const hours = date.getHours();
    const dayPeriodEnumValue = hours / 12 >= 1 ? "pm" : "am";
    switch (token) {
      case "a":
      case "aa":
        return localize2.dayPeriod(dayPeriodEnumValue, {
          width: "abbreviated",
          context: "formatting"
        });
      case "aaa":
        return localize2.dayPeriod(dayPeriodEnumValue, {
          width: "abbreviated",
          context: "formatting"
        }).toLowerCase();
      case "aaaaa":
        return localize2.dayPeriod(dayPeriodEnumValue, {
          width: "narrow",
          context: "formatting"
        });
      case "aaaa":
      default:
        return localize2.dayPeriod(dayPeriodEnumValue, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // AM, PM, midnight, noon
  b: function(date, token, localize2) {
    const hours = date.getHours();
    let dayPeriodEnumValue;
    if (hours === 12) {
      dayPeriodEnumValue = dayPeriodEnum.noon;
    } else if (hours === 0) {
      dayPeriodEnumValue = dayPeriodEnum.midnight;
    } else {
      dayPeriodEnumValue = hours / 12 >= 1 ? "pm" : "am";
    }
    switch (token) {
      case "b":
      case "bb":
        return localize2.dayPeriod(dayPeriodEnumValue, {
          width: "abbreviated",
          context: "formatting"
        });
      case "bbb":
        return localize2.dayPeriod(dayPeriodEnumValue, {
          width: "abbreviated",
          context: "formatting"
        }).toLowerCase();
      case "bbbbb":
        return localize2.dayPeriod(dayPeriodEnumValue, {
          width: "narrow",
          context: "formatting"
        });
      case "bbbb":
      default:
        return localize2.dayPeriod(dayPeriodEnumValue, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // in the morning, in the afternoon, in the evening, at night
  B: function(date, token, localize2) {
    const hours = date.getHours();
    let dayPeriodEnumValue;
    if (hours >= 17) {
      dayPeriodEnumValue = dayPeriodEnum.evening;
    } else if (hours >= 12) {
      dayPeriodEnumValue = dayPeriodEnum.afternoon;
    } else if (hours >= 4) {
      dayPeriodEnumValue = dayPeriodEnum.morning;
    } else {
      dayPeriodEnumValue = dayPeriodEnum.night;
    }
    switch (token) {
      case "B":
      case "BB":
      case "BBB":
        return localize2.dayPeriod(dayPeriodEnumValue, {
          width: "abbreviated",
          context: "formatting"
        });
      case "BBBBB":
        return localize2.dayPeriod(dayPeriodEnumValue, {
          width: "narrow",
          context: "formatting"
        });
      case "BBBB":
      default:
        return localize2.dayPeriod(dayPeriodEnumValue, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Hour [1-12]
  h: function(date, token, localize2) {
    if (token === "ho") {
      let hours = date.getHours() % 12;
      if (hours === 0) hours = 12;
      return localize2.ordinalNumber(hours, { unit: "hour" });
    }
    return lightFormatters.h(date, token);
  },
  // Hour [0-23]
  H: function(date, token, localize2) {
    if (token === "Ho") {
      return localize2.ordinalNumber(date.getHours(), { unit: "hour" });
    }
    return lightFormatters.H(date, token);
  },
  // Hour [0-11]
  K: function(date, token, localize2) {
    const hours = date.getHours() % 12;
    if (token === "Ko") {
      return localize2.ordinalNumber(hours, { unit: "hour" });
    }
    return addLeadingZeros(hours, token.length);
  },
  // Hour [1-24]
  k: function(date, token, localize2) {
    let hours = date.getHours();
    if (hours === 0) hours = 24;
    if (token === "ko") {
      return localize2.ordinalNumber(hours, { unit: "hour" });
    }
    return addLeadingZeros(hours, token.length);
  },
  // Minute
  m: function(date, token, localize2) {
    if (token === "mo") {
      return localize2.ordinalNumber(date.getMinutes(), { unit: "minute" });
    }
    return lightFormatters.m(date, token);
  },
  // Second
  s: function(date, token, localize2) {
    if (token === "so") {
      return localize2.ordinalNumber(date.getSeconds(), { unit: "second" });
    }
    return lightFormatters.s(date, token);
  },
  // Fraction of second
  S: function(date, token) {
    return lightFormatters.S(date, token);
  },
  // Timezone (ISO-8601. If offset is 0, output is always `'Z'`)
  X: function(date, token, _localize) {
    const timezoneOffset = date.getTimezoneOffset();
    if (timezoneOffset === 0) {
      return "Z";
    }
    switch (token) {
      // Hours and optional minutes
      case "X":
        return formatTimezoneWithOptionalMinutes(timezoneOffset);
      // Hours, minutes and optional seconds without `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `XX`
      case "XXXX":
      case "XX":
        return formatTimezone(timezoneOffset);
      // Hours, minutes and optional seconds with `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `XXX`
      case "XXXXX":
      case "XXX":
      // Hours and minutes with `:` delimiter
      default:
        return formatTimezone(timezoneOffset, ":");
    }
  },
  // Timezone (ISO-8601. If offset is 0, output is `'+00:00'` or equivalent)
  x: function(date, token, _localize) {
    const timezoneOffset = date.getTimezoneOffset();
    switch (token) {
      // Hours and optional minutes
      case "x":
        return formatTimezoneWithOptionalMinutes(timezoneOffset);
      // Hours, minutes and optional seconds without `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `xx`
      case "xxxx":
      case "xx":
        return formatTimezone(timezoneOffset);
      // Hours, minutes and optional seconds with `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `xxx`
      case "xxxxx":
      case "xxx":
      // Hours and minutes with `:` delimiter
      default:
        return formatTimezone(timezoneOffset, ":");
    }
  },
  // Timezone (GMT)
  O: function(date, token, _localize) {
    const timezoneOffset = date.getTimezoneOffset();
    switch (token) {
      // Short
      case "O":
      case "OO":
      case "OOO":
        return "GMT" + formatTimezoneShort(timezoneOffset, ":");
      // Long
      case "OOOO":
      default:
        return "GMT" + formatTimezone(timezoneOffset, ":");
    }
  },
  // Timezone (specific non-location)
  z: function(date, token, _localize) {
    const timezoneOffset = date.getTimezoneOffset();
    switch (token) {
      // Short
      case "z":
      case "zz":
      case "zzz":
        return "GMT" + formatTimezoneShort(timezoneOffset, ":");
      // Long
      case "zzzz":
      default:
        return "GMT" + formatTimezone(timezoneOffset, ":");
    }
  },
  // Seconds timestamp
  t: function(date, token, _localize) {
    const timestamp = Math.trunc(+date / 1e3);
    return addLeadingZeros(timestamp, token.length);
  },
  // Milliseconds timestamp
  T: function(date, token, _localize) {
    return addLeadingZeros(+date, token.length);
  }
};
function formatTimezoneShort(offset, delimiter = "") {
  const sign = offset > 0 ? "-" : "+";
  const absOffset = Math.abs(offset);
  const hours = Math.trunc(absOffset / 60);
  const minutes = absOffset % 60;
  if (minutes === 0) {
    return sign + String(hours);
  }
  return sign + String(hours) + delimiter + addLeadingZeros(minutes, 2);
}
function formatTimezoneWithOptionalMinutes(offset, delimiter) {
  if (offset % 60 === 0) {
    const sign = offset > 0 ? "-" : "+";
    return sign + addLeadingZeros(Math.abs(offset) / 60, 2);
  }
  return formatTimezone(offset, delimiter);
}
function formatTimezone(offset, delimiter = "") {
  const sign = offset > 0 ? "-" : "+";
  const absOffset = Math.abs(offset);
  const hours = addLeadingZeros(Math.trunc(absOffset / 60), 2);
  const minutes = addLeadingZeros(absOffset % 60, 2);
  return sign + hours + delimiter + minutes;
}

// node_modules/date-fns/_lib/format/longFormatters.js
var dateLongFormatter = (pattern, formatLong2) => {
  switch (pattern) {
    case "P":
      return formatLong2.date({ width: "short" });
    case "PP":
      return formatLong2.date({ width: "medium" });
    case "PPP":
      return formatLong2.date({ width: "long" });
    case "PPPP":
    default:
      return formatLong2.date({ width: "full" });
  }
};
var timeLongFormatter = (pattern, formatLong2) => {
  switch (pattern) {
    case "p":
      return formatLong2.time({ width: "short" });
    case "pp":
      return formatLong2.time({ width: "medium" });
    case "ppp":
      return formatLong2.time({ width: "long" });
    case "pppp":
    default:
      return formatLong2.time({ width: "full" });
  }
};
var dateTimeLongFormatter = (pattern, formatLong2) => {
  const matchResult = pattern.match(/(P+)(p+)?/) || [];
  const datePattern = matchResult[1];
  const timePattern = matchResult[2];
  if (!timePattern) {
    return dateLongFormatter(pattern, formatLong2);
  }
  let dateTimeFormat;
  switch (datePattern) {
    case "P":
      dateTimeFormat = formatLong2.dateTime({ width: "short" });
      break;
    case "PP":
      dateTimeFormat = formatLong2.dateTime({ width: "medium" });
      break;
    case "PPP":
      dateTimeFormat = formatLong2.dateTime({ width: "long" });
      break;
    case "PPPP":
    default:
      dateTimeFormat = formatLong2.dateTime({ width: "full" });
      break;
  }
  return dateTimeFormat.replace("{{date}}", dateLongFormatter(datePattern, formatLong2)).replace("{{time}}", timeLongFormatter(timePattern, formatLong2));
};
var longFormatters = {
  p: timeLongFormatter,
  P: dateTimeLongFormatter
};

// node_modules/date-fns/_lib/protectedTokens.js
var dayOfYearTokenRE = /^D+$/;
var weekYearTokenRE = /^Y+$/;
var throwTokens = ["D", "DD", "YY", "YYYY"];
function isProtectedDayOfYearToken(token) {
  return dayOfYearTokenRE.test(token);
}
function isProtectedWeekYearToken(token) {
  return weekYearTokenRE.test(token);
}
function warnOrThrowProtectedError(token, format2, input) {
  const _message = message(token, format2, input);
  console.warn(_message);
  if (throwTokens.includes(token)) throw new RangeError(_message);
}
function message(token, format2, input) {
  const subject = token[0] === "Y" ? "years" : "days of the month";
  return `Use \`${token.toLowerCase()}\` instead of \`${token}\` (in \`${format2}\`) for formatting ${subject} to the input \`${input}\`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md`;
}

// node_modules/date-fns/format.js
var formattingTokensRegExp = /[yYQqMLwIdDecihHKkms]o|(\w)\1*|''|'(''|[^'])+('|$)|./g;
var longFormattingTokensRegExp = /P+p+|P+|p+|''|'(''|[^'])+('|$)|./g;
var escapedStringRegExp = /^'([^]*?)'?$/;
var doubleQuoteRegExp = /''/g;
var unescapedLatinCharacterRegExp = /[a-zA-Z]/;
function format(date, formatStr, options) {
  const defaultOptions2 = getDefaultOptions();
  const locale = options?.locale ?? defaultOptions2.locale ?? enUS;
  const firstWeekContainsDate = options?.firstWeekContainsDate ?? options?.locale?.options?.firstWeekContainsDate ?? defaultOptions2.firstWeekContainsDate ?? defaultOptions2.locale?.options?.firstWeekContainsDate ?? 1;
  const weekStartsOn = options?.weekStartsOn ?? options?.locale?.options?.weekStartsOn ?? defaultOptions2.weekStartsOn ?? defaultOptions2.locale?.options?.weekStartsOn ?? 0;
  const originalDate = toDate(date, options?.in);
  if (!isValid(originalDate)) {
    throw new RangeError("Invalid time value");
  }
  let parts = formatStr.match(longFormattingTokensRegExp).map((substring) => {
    const firstCharacter = substring[0];
    if (firstCharacter === "p" || firstCharacter === "P") {
      const longFormatter = longFormatters[firstCharacter];
      return longFormatter(substring, locale.formatLong);
    }
    return substring;
  }).join("").match(formattingTokensRegExp).map((substring) => {
    if (substring === "''") {
      return { isToken: false, value: "'" };
    }
    const firstCharacter = substring[0];
    if (firstCharacter === "'") {
      return { isToken: false, value: cleanEscapedString(substring) };
    }
    if (formatters[firstCharacter]) {
      return { isToken: true, value: substring };
    }
    if (firstCharacter.match(unescapedLatinCharacterRegExp)) {
      throw new RangeError(
        "Format string contains an unescaped latin alphabet character `" + firstCharacter + "`"
      );
    }
    return { isToken: false, value: substring };
  });
  if (locale.localize.preprocessor) {
    parts = locale.localize.preprocessor(originalDate, parts);
  }
  const formatterOptions = {
    firstWeekContainsDate,
    weekStartsOn,
    locale
  };
  return parts.map((part) => {
    if (!part.isToken) return part.value;
    const token = part.value;
    if (!options?.useAdditionalWeekYearTokens && isProtectedWeekYearToken(token) || !options?.useAdditionalDayOfYearTokens && isProtectedDayOfYearToken(token)) {
      warnOrThrowProtectedError(token, formatStr, String(date));
    }
    const formatter = formatters[token[0]];
    return formatter(originalDate, token, locale.localize, formatterOptions);
  }).join("");
}
function cleanEscapedString(input) {
  const matched = input.match(escapedStringRegExp);
  if (!matched) {
    return input;
  }
  return matched[1].replace(doubleQuoteRegExp, "'");
}

// node_modules/date-fns/isSameMonth.js
function isSameMonth(laterDate, earlierDate, options) {
  const [laterDate_, earlierDate_] = normalizeDates(
    options?.in,
    laterDate,
    earlierDate
  );
  return laterDate_.getFullYear() === earlierDate_.getFullYear() && laterDate_.getMonth() === earlierDate_.getMonth();
}

// node_modules/date-fns/parseISO.js
function parseISO(argument, options) {
  const invalidDate = () => constructFrom(options?.in, NaN);
  const additionalDigits = options?.additionalDigits ?? 2;
  const dateStrings = splitDateString(argument);
  let date;
  if (dateStrings.date) {
    const parseYearResult = parseYear(dateStrings.date, additionalDigits);
    date = parseDate(parseYearResult.restDateString, parseYearResult.year);
  }
  if (!date || isNaN(+date)) return invalidDate();
  const timestamp = +date;
  let time = 0;
  let offset;
  if (dateStrings.time) {
    time = parseTime(dateStrings.time);
    if (isNaN(time)) return invalidDate();
  }
  if (dateStrings.timezone) {
    offset = parseTimezone(dateStrings.timezone);
    if (isNaN(offset)) return invalidDate();
  } else {
    const tmpDate = new Date(timestamp + time);
    const result2 = toDate(0, options?.in);
    result2.setFullYear(
      tmpDate.getUTCFullYear(),
      tmpDate.getUTCMonth(),
      tmpDate.getUTCDate()
    );
    result2.setHours(
      tmpDate.getUTCHours(),
      tmpDate.getUTCMinutes(),
      tmpDate.getUTCSeconds(),
      tmpDate.getUTCMilliseconds()
    );
    return result2;
  }
  return toDate(timestamp + time + offset, options?.in);
}
var patterns = {
  dateTimeDelimiter: /[T ]/,
  timeZoneDelimiter: /[Z ]/i,
  timezone: /([Z+-].*)$/
};
var dateRegex = /^-?(?:(\d{3})|(\d{2})(?:-?(\d{2}))?|W(\d{2})(?:-?(\d{1}))?|)$/;
var timeRegex = /^(\d{2}(?:[.,]\d*)?)(?::?(\d{2}(?:[.,]\d*)?))?(?::?(\d{2}(?:[.,]\d*)?))?$/;
var timezoneRegex = /^([+-])(\d{2})(?::?(\d{2}))?$/;
function splitDateString(dateString) {
  const dateStrings = {};
  const array = dateString.split(patterns.dateTimeDelimiter);
  let timeString;
  if (array.length > 2) {
    return dateStrings;
  }
  if (/:/.test(array[0])) {
    timeString = array[0];
  } else {
    dateStrings.date = array[0];
    timeString = array[1];
    if (patterns.timeZoneDelimiter.test(dateStrings.date)) {
      dateStrings.date = dateString.split(patterns.timeZoneDelimiter)[0];
      timeString = dateString.substr(
        dateStrings.date.length,
        dateString.length
      );
    }
  }
  if (timeString) {
    const token = patterns.timezone.exec(timeString);
    if (token) {
      dateStrings.time = timeString.replace(token[1], "");
      dateStrings.timezone = token[1];
    } else {
      dateStrings.time = timeString;
    }
  }
  return dateStrings;
}
function parseYear(dateString, additionalDigits) {
  const regex = new RegExp(
    "^(?:(\\d{4}|[+-]\\d{" + (4 + additionalDigits) + "})|(\\d{2}|[+-]\\d{" + (2 + additionalDigits) + "})$)"
  );
  const captures = dateString.match(regex);
  if (!captures) return { year: NaN, restDateString: "" };
  const year = captures[1] ? parseInt(captures[1]) : null;
  const century = captures[2] ? parseInt(captures[2]) : null;
  return {
    year: century === null ? year : century * 100,
    restDateString: dateString.slice((captures[1] || captures[2]).length)
  };
}
function parseDate(dateString, year) {
  if (year === null) return /* @__PURE__ */ new Date(NaN);
  const captures = dateString.match(dateRegex);
  if (!captures) return /* @__PURE__ */ new Date(NaN);
  const isWeekDate = !!captures[4];
  const dayOfYear = parseDateUnit(captures[1]);
  const month = parseDateUnit(captures[2]) - 1;
  const day = parseDateUnit(captures[3]);
  const week = parseDateUnit(captures[4]);
  const dayOfWeek = parseDateUnit(captures[5]) - 1;
  if (isWeekDate) {
    if (!validateWeekDate(year, week, dayOfWeek)) {
      return /* @__PURE__ */ new Date(NaN);
    }
    return dayOfISOWeekYear(year, week, dayOfWeek);
  } else {
    const date = /* @__PURE__ */ new Date(0);
    if (!validateDate(year, month, day) || !validateDayOfYearDate(year, dayOfYear)) {
      return /* @__PURE__ */ new Date(NaN);
    }
    date.setUTCFullYear(year, month, Math.max(dayOfYear, day));
    return date;
  }
}
function parseDateUnit(value) {
  return value ? parseInt(value) : 1;
}
function parseTime(timeString) {
  const captures = timeString.match(timeRegex);
  if (!captures) return NaN;
  const hours = parseTimeUnit(captures[1]);
  const minutes = parseTimeUnit(captures[2]);
  const seconds = parseTimeUnit(captures[3]);
  if (!validateTime(hours, minutes, seconds)) {
    return NaN;
  }
  return hours * millisecondsInHour + minutes * millisecondsInMinute + seconds * 1e3;
}
function parseTimeUnit(value) {
  return value && parseFloat(value.replace(",", ".")) || 0;
}
function parseTimezone(timezoneString) {
  if (timezoneString === "Z") return 0;
  const captures = timezoneString.match(timezoneRegex);
  if (!captures) return 0;
  const sign = captures[1] === "+" ? -1 : 1;
  const hours = parseInt(captures[2]);
  const minutes = captures[3] && parseInt(captures[3]) || 0;
  if (!validateTimezone(hours, minutes)) {
    return NaN;
  }
  return sign * (hours * millisecondsInHour + minutes * millisecondsInMinute);
}
function dayOfISOWeekYear(isoWeekYear, week, day) {
  const date = /* @__PURE__ */ new Date(0);
  date.setUTCFullYear(isoWeekYear, 0, 4);
  const fourthOfJanuaryDay = date.getUTCDay() || 7;
  const diff = (week - 1) * 7 + day + 1 - fourthOfJanuaryDay;
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}
var daysInMonths = [31, null, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function isLeapYearIndex(year) {
  return year % 400 === 0 || year % 4 === 0 && year % 100 !== 0;
}
function validateDate(year, month, date) {
  return month >= 0 && month <= 11 && date >= 1 && date <= (daysInMonths[month] || (isLeapYearIndex(year) ? 29 : 28));
}
function validateDayOfYearDate(year, dayOfYear) {
  return dayOfYear >= 1 && dayOfYear <= (isLeapYearIndex(year) ? 366 : 365);
}
function validateWeekDate(_year, week, day) {
  return week >= 1 && week <= 53 && day >= 0 && day <= 6;
}
function validateTime(hours, minutes, seconds) {
  if (hours === 24) {
    return minutes === 0 && seconds === 0;
  }
  return seconds >= 0 && seconds < 60 && minutes >= 0 && minutes < 60 && hours >= 0 && hours < 25;
}
function validateTimezone(_hours, minutes) {
  return minutes >= 0 && minutes <= 59;
}

// node_modules/date-fns/subMonths.js
function subMonths(date, amount, options) {
  return addMonths(date, -amount, options);
}

// src/core/time.ts
function toLocalDate(iso) {
  const value = parseISO(iso);
  if (Number.isNaN(value.getTime())) {
    return iso.slice(0, 10);
  }
  return format(value, "yyyy-MM-dd");
}
function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}
function dateKey(date) {
  return format(date, "yyyy-MM-dd");
}
function monthLabel(date) {
  return format(date, "yyyy \u5E74 M \u6708");
}
function dayLabel(key) {
  return format(dateFromKey(key), "M \u6708 d \u65E5");
}
function timeLabel(iso) {
  const value = parseISO(iso);
  return Number.isNaN(value.getTime()) ? "--:--" : format(value, "HH:mm");
}
function weekLabel(range) {
  return `${format(dateFromKey(range.start), "M/d")} - ${format(dateFromKey(range.end), "M/d")}`;
}
function weekRange(anchor) {
  return {
    start: dateKey(startOfWeek(anchor, { weekStartsOn: 1 })),
    end: dateKey(endOfWeek(anchor, { weekStartsOn: 1 }))
  };
}
function dayRange(anchor) {
  const key = dateKey(anchor);
  return { start: key, end: key };
}
function monthGrid(anchor) {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const start = startOfWeek(monthStart, { weekStartsOn: 1 });
  const end = endOfWeek(monthEnd, { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end }).map((day) => ({
    date: dateKey(day),
    inMonth: isSameMonth(day, anchor)
  }));
}
function moveMonth(anchor, direction) {
  return direction === -1 ? subMonths(anchor, 1) : addMonths(anchor, 1);
}
function moveRangeAnchor(anchor, mode, direction) {
  return addDays(anchor, direction * (mode === "week" ? 7 : 1));
}
function inRange(date, range) {
  return date >= range.start && date <= range.end;
}

// src/core/aggregate.ts
var TASK_KINDS = /* @__PURE__ */ new Set([
  "task_started",
  "task_progress",
  "task_completed",
  "task_blocked"
]);
function aggregateTasks(events) {
  const grouped = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (!event.taskKey || !TASK_KINDS.has(event.kind)) {
      continue;
    }
    const items = grouped.get(event.taskKey) ?? [];
    items.push(event);
    grouped.set(event.taskKey, items);
  }
  const tasks = [];
  for (const [taskKey, taskEvents] of grouped) {
    taskEvents.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const first = taskEvents[0];
    const latest = taskEvents.at(-1);
    if (!first || !latest) {
      continue;
    }
    const status = latest.kind === "task_completed" ? "completed" : latest.kind === "task_blocked" ? "blocked" : "active";
    tasks.push({
      taskKey,
      projectKey: latest.projectKey,
      projectLabel: latest.projectLabel,
      title: first.title,
      status,
      statusConfidence: latest.confidence,
      firstObservedAt: first.occurredAt,
      lastActivityAt: latest.observedAt,
      activeDates: [...new Set(taskEvents.map((event) => event.localDate))].sort(),
      eventIds: taskEvents.map((event) => event.id),
      sourceRefs: dedupeSourceRefs(taskEvents.flatMap((event) => event.sourceRefs)),
      turnCount: new Set(taskEvents.map((event) => `${event.sessionId ?? "unknown"}:${event.turnId ?? event.id}`)).size
    });
  }
  return tasks.sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
}
function filterEvents(events, range, filters) {
  return events.filter((event) => {
    if (!inRange(event.localDate, range)) {
      return false;
    }
    if (filters.projectKey !== "all" && event.projectKey !== filters.projectKey) {
      return false;
    }
    return filters.confidence === "all" || event.confidence === filters.confidence;
  });
}
function summarizeCalendarDay(date, events) {
  const dayEvents = events.filter((event) => event.localDate === date);
  const tasks = new Set(dayEvents.filter((event) => event.taskKey && TASK_KINDS.has(event.kind)).map((event) => event.taskKey)).size;
  const outputs = uniqueByIdentity(dayEvents.filter((event) => event.kind === "output_created")).length;
  const knowledge = uniqueKnowledgeByNote(dayEvents.filter((event) => event.kind === "knowledge_created" || event.kind === "knowledge_updated")).length;
  return { date, tasks, outputs, knowledge, events: dayEvents };
}
function metricsForRange(events, range, filters, outcomes = []) {
  const scoped = filterEvents(events, range, filters);
  const activity = activityUnits(scoped);
  const activityEvents = activity.map((unit) => unit.representative);
  const outputs = outcomes.length > 0 ? outcomes.filter((outcome) => inRange(outcome.localDate, range)).filter((outcome) => filters.projectKey === "all" || outcome.projectKey === filters.projectKey).map(outcomeMetricEvent).filter((event) => filters.confidence === "all" || event.confidence === filters.confidence) : uniqueByIdentity(scoped.filter((event) => event.kind === "output_created"));
  const knowledge = uniqueKnowledgeByDate(scoped.filter((event) => event.kind === "knowledge_created" || event.kind === "knowledge_updated"));
  const reuse = uniqueByIdentity(scoped.filter((event) => event.kind === "knowledge_reused"));
  const switches = focusSwitchEvents(activity);
  const tasks = new Set(activity.map((unit) => unit.identity)).size;
  const projects = new Set(activityEvents.filter((event) => event.projectKey !== "unassigned").map((event) => event.projectKey)).size;
  const knowledgeNotes = /* @__PURE__ */ new Map();
  for (const event of knowledge) {
    const notePath = wikiNotePath(event) ?? event.objectKey ?? event.id;
    const items = knowledgeNotes.get(notePath) ?? [];
    items.push(event);
    knowledgeNotes.set(notePath, items);
  }
  const sourcedNotes = [...knowledgeNotes.values()].filter((items) => items.some((event) => event.sourceRefs.some((ref) => ref.type === "codex" || ref.type === "chatgpt" || ref.type === "feishu"))).length;
  const coverage = knowledgeNotes.size === 0 ? "\u6682\u65E0\u77E5\u8BC6\u6570\u636E" : `\u6765\u6E90\u8986\u76D6 ${sourcedNotes}/${knowledgeNotes.size}`;
  const activeDays = new Set(activity.map((unit) => unit.anchor.localDate)).size;
  return [
    {
      dimension: "activity",
      label: "\u4EFB\u52A1\u63A8\u8FDB",
      value: activityEvents.length,
      note: `${tasks} \u9879\u4EFB\u52A1\u6216\u5BF9\u8BDD \xB7 ${projects} \u4E2A\u5DF2\u5F52\u5C5E\u9879\u76EE \xB7 \u6BCF\u9879\u6BCF\u65E5\u8BA1 1 \u6B21`,
      events: activityEvents
    },
    {
      dimension: "output",
      label: "\u4EA7\u51FA",
      value: outputs.length,
      note: outputs.length === 0 ? "\u6682\u65E0\u771F\u5B9E\u6210\u679C" : outcomes.length > 0 ? "\u6309\u540C\u4E00\u771F\u5B9E\u4EFB\u52A1\u5408\u5E76 \xB7 \u53EF\u5C55\u5F00\u5E95\u5C42\u8BC1\u636E" : "\u4EE5 Git commit \u7B49\u53EF\u6838\u5BF9\u4E8B\u5B9E\u8BA1\u6570",
      events: outputs
    },
    {
      dimension: "knowledge",
      label: "\u77E5\u8BC6",
      value: knowledge.length,
      note: coverage,
      events: knowledge
    },
    {
      dimension: "reuse",
      label: "\u79EF\u7D2F",
      value: reuse.length,
      note: reuse.length === 0 ? "\u6682\u65E0\u663E\u5F0F\u77E5\u8BC6\u590D\u7528\u8BC1\u636E" : "\u663E\u5F0F Wiki \u5F15\u7528 \xB7 \u65E5\u671F\u6309\u4FEE\u6539\u65F6\u95F4\u4F30\u7B97",
      events: reuse
    },
    {
      dimension: "focus",
      label: "\u9879\u76EE\u5207\u6362",
      value: switches.length,
      note: `\u6309\u4EFB\u52A1\u9996\u6B21\u6D3B\u52A8\u4F30\u7B97 \xB7 ${activeDays} \u4E2A\u6D3B\u8DC3\u65E5 \xB7 90 \u5206\u949F\u5185`,
      events: switches
    }
  ];
}
function outcomeMetricEvent(outcome) {
  const confidence = outcome.proof === "independent" ? "verified" : outcome.proof === "target-present" ? "observed" : "reported";
  return {
    id: outcome.id,
    kind: "output_created",
    occurredAt: outcome.occurredAt,
    observedAt: outcome.occurredAt,
    localDate: outcome.localDate,
    timeBasis: "captured",
    title: outcome.title,
    summary: outcome.problem ? `${outcome.problem}
${outcome.summary}` : outcome.summary,
    projectKey: outcome.projectKey,
    projectLabel: outcome.projectLabel,
    taskKey: outcome.taskKeys[0],
    objectKey: outcome.id,
    confidence,
    evidence: `${outcome.artifactIds.length} \u6761\u5E95\u5C42\u8BC1\u636E \xB7 ${settlementEvidence(outcome)}`,
    sourceRefs: dedupeSourceRefs([...outcome.wikiRefs, ...outcome.sourceRefs])
  };
}
function settlementEvidence(outcome) {
  switch (outcome.settlement.status) {
    case "succeeded":
      return "\u5DF2\u6C89\u6DC0\u4E3A\u957F\u671F\u77E5\u8BC6";
    case "pending":
      return "\u5F85\u6C89\u6DC0";
    case "failed":
      return "\u6C89\u6DC0\u5931\u8D25\uFF0C\u7B49\u5F85\u91CD\u8BD5";
    case "not-applicable":
      return "\u65E0\u9700\u5355\u72EC\u6C89\u6DC0";
  }
}
function projectOptions(events) {
  const labels = /* @__PURE__ */ new Map();
  for (const event of events) {
    labels.set(event.projectKey, event.projectLabel);
  }
  return [...labels].map(([key, label]) => ({ key, label })).sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}
function eventDimension(event) {
  if (TASK_KINDS.has(event.kind)) {
    return "task";
  }
  if (event.kind === "output_created") {
    return "output";
  }
  if (event.kind === "knowledge_reused") {
    return "reuse";
  }
  if (event.kind === "research_activity") {
    return "research";
  }
  return "knowledge";
}
function activityUnits(events) {
  const grouped = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (!TASK_KINDS.has(event.kind) && event.kind !== "research_activity") {
      continue;
    }
    const identity2 = event.taskKey ?? `research:${event.sessionId ?? event.id}`;
    const key = `${event.localDate}:${identity2}`;
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }
  return [...grouped.values()].map((group) => {
    group.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    const anchor = group[0];
    const representative = [...group].sort((left, right) => {
      const priority = activityRepresentativePriority(right) - activityRepresentativePriority(left);
      return priority || right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id);
    })[0];
    return {
      identity: anchor.taskKey ?? `research:${anchor.sessionId ?? anchor.id}`,
      anchor,
      representative
    };
  }).sort((left, right) => left.anchor.occurredAt.localeCompare(right.anchor.occurredAt) || left.identity.localeCompare(right.identity));
}
function activityRepresentativePriority(event) {
  switch (event.kind) {
    case "task_blocked":
      return 4;
    case "task_completed":
      return 3;
    case "task_progress":
      return 2;
    case "task_started":
      return 1;
    default:
      return 0;
  }
}
function focusSwitchEvents(units) {
  const candidates = units.map((unit) => unit.anchor).filter((event) => event.projectKey !== "unassigned").sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
  const switches = [];
  let previous;
  for (const event of candidates) {
    if (!previous) {
      previous = event;
      continue;
    }
    const gapMinutes = (Date.parse(event.occurredAt) - Date.parse(previous.occurredAt)) / 6e4;
    if (event.localDate === previous.localDate && gapMinutes >= 0 && gapMinutes <= 90 && event.projectKey !== previous.projectKey) {
      switches.push(event);
    }
    previous = event;
  }
  return switches;
}
function uniqueKnowledgeByDate(events) {
  const seen = /* @__PURE__ */ new Set();
  return events.filter((event) => {
    const key = `${event.localDate}:${wikiNotePath(event) ?? event.objectKey ?? event.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
function uniqueKnowledgeByNote(events) {
  const seen = /* @__PURE__ */ new Set();
  return events.filter((event) => {
    const key = wikiNotePath(event) ?? event.objectKey ?? event.id;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
function wikiNotePath(event) {
  return event.sourceRefs.find((ref) => ref.type === "wiki")?.path;
}
function uniqueByIdentity(events) {
  const seen = /* @__PURE__ */ new Set();
  return events.filter((event) => {
    const key = event.objectKey ?? event.id;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
function dedupeSourceRefs(refs) {
  const seen = /* @__PURE__ */ new Set();
  return refs.filter((ref) => {
    const key = `${ref.type}:${ref.path ?? ref.url ?? ref.label}:${ref.line ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// src/core/artifacts.ts
var import_node_crypto2 = require("node:crypto");
var import_node_path = __toESM(require("node:path"), 1);
var import_promises = require("node:fs/promises");

// src/core/artifact-title.ts
var CONVENTIONAL_ACTIONS = {
  feat: "\u65B0\u589E",
  fix: "\u4FEE\u590D",
  docs: "\u66F4\u65B0",
  test: "\u8865\u5145",
  style: "\u4F18\u5316",
  refactor: "\u91CD\u6784",
  perf: "\u4F18\u5316",
  revert: "\u64A4\u9500",
  build: "\u66F4\u65B0",
  ci: "\u66F4\u65B0",
  chore: "\u66F4\u65B0"
};
var NATURAL_ACTION = /^(?:新增|增加|实现|支持|完成|修复|解决|恢复|优化|改进|调整|更新|升级|完善|补充|重构|整理|记录|沉淀|发布|部署|安装|验证|测试|删除|移除|统一|保持|切换|新增功能|功能：|体验：|样式：|文档：|测试：)/;
function artifactDisplayTitle(event, kind) {
  const parsed = parseTitle(event.title);
  if (kind === "git-commit") {
    return gitTitle(event, parsed);
  }
  if (kind === "knowledge-note") {
    return hasChinese(parsed.subject) ? naturalChineseTitle(parsed.subject, "\u6574\u7406") : `\u6574\u7406 ${event.projectLabel} \u77E5\u8BC6\u5E76\u5F62\u6210\u7B14\u8BB0`;
  }
  const reportTitle = stripLocalPaths(parsed.subject);
  return hasChinese(reportTitle) ? naturalChineseTitle(reportTitle, "\u5B8C\u6210") : `\u5B8C\u6210 ${event.projectLabel} \u4EFB\u52A1\u5E76\u5F62\u6210\u4EA4\u4ED8\u8BB0\u5F55`;
}
function gitTitle(event, parsed) {
  if (hasChinese(parsed.subject)) {
    const action2 = parsed.type ? CONVENTIONAL_ACTIONS[parsed.type] : void 0;
    return naturalChineseTitle(parsed.subject, action2 ?? "\u5B8C\u6210");
  }
  const action = parsed.type ? CONVENTIONAL_ACTIONS[parsed.type] ?? "\u5B8C\u6210" : "\u5B8C\u6210";
  const files = [...new Set(event.sourceRefs.filter((source) => source.type === "file").map((source) => source.label))];
  const area = changedArea(files);
  return files.length > 0 ? `${action} ${event.projectLabel} ${area}\uFF0C\u66F4\u65B0 ${files.length} \u4E2A\u6587\u4EF6` : `${action} ${event.projectLabel} ${area}\u5E76\u5F62\u6210\u63D0\u4EA4`;
}
function changedArea(files) {
  if (files.length > 0 && files.every((file) => /(?:^|\/)(?:docs?|requirements?|wiki)(?:\/|$)|\.md$/i.test(file))) {
    return "\u6587\u6863";
  }
  if (files.some((file) => /\.(?:css|scss|sass|less|html|vue|tsx|jsx)$/i.test(file))) {
    return "\u754C\u9762";
  }
  if (files.some((file) => /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\./i.test(file))) {
    return "\u6D4B\u8BD5";
  }
  if (files.some((file) => /(?:package(?:-lock)?\.json|tsconfig|vite\.config|webpack|\.ya?ml)$/i.test(file))) {
    return "\u5DE5\u7A0B\u914D\u7F6E";
  }
  return "\u529F\u80FD";
}
function parseTitle(value) {
  const cleaned = value.normalize("NFKC").replace(/\s*\((?:[2-9]|\d{2,})\)\s*$/, "").replace(/…+$/, "").replace(/\s+/g, " ").trim();
  const conventional = cleaned.match(/^([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/i);
  return conventional?.[2] ? { type: conventional[1]?.toLocaleLowerCase(), subject: conventional[2].trim() } : { subject: cleaned };
}
function naturalChineseTitle(subject, fallbackAction) {
  const cleaned = subject.replace(/^[：:\-–—\s]+|[：:\-–—\s]+$/g, "").trim();
  if (!cleaned) {
    return `${fallbackAction}\u9879\u76EE\u6210\u679C`;
  }
  return NATURAL_ACTION.test(cleaned) ? cleaned : `${fallbackAction}\uFF1A${cleaned}`;
}
function stripLocalPaths(value) {
  return value.replace(/[A-Za-z]:[\\/][^\r\n，。；：！？]+/g, " ").replace(/\s+/g, " ").replace(/^[，。；：！？\s]+|[，。；：！？\s]+$/g, "").trim();
}
function hasChinese(value) {
  return /[\u3400-\u9fff]/.test(value);
}

// src/core/text.ts
var COMPLETION_EVIDENCE_PATTERN = /(?:\b[0-9a-f]{7,40}\b|测试.{0,12}通过|构建.{0,12}通过|验证.{0,12}通过|\b(?:build|test|check)\b.{0,24}(?:通过|成功)|HTTP\s*200|截图|commit|提交|安装位置|已写入)/i;
function isAutomationPrompt(content) {
  return /<heartbeat>|<automation_id>|Automation ID:/i.test(content);
}
function extractMeaningfulPrompt(content) {
  const trimmed = content.trim();
  if (isAutomationPrompt(trimmed) || trimmed.startsWith("# Overview\nGenerate 0 to 3 hyperpersonalized suggestions")) {
    return null;
  }
  const delegated = content.match(/<codex_delegation>[\s\S]*?<input>([\s\S]*?)<\/input>[\s\S]*?<\/codex_delegation>/i);
  if (delegated?.[1]?.trim()) {
    return delegated[1].trim();
  }
  if (trimmed.startsWith("# Browser comments:")) {
    const comments = [...trimmed.matchAll(/^Comment:\s*\r?\n([\s\S]*?)(?=^## Comment|^<in-app-browser-context|^## My request for Codex:|\s*$)/gim)].map((match2) => match2[1]?.trim()).filter((comment) => Boolean(comment));
    if (comments.length > 0) {
      return comments.join("\uFF1B");
    }
  }
  const requestMarker = "## My request for Codex:";
  const markerIndex = content.lastIndexOf(requestMarker);
  if (markerIndex >= 0) {
    const request = content.slice(markerIndex + requestMarker.length).trim();
    return request || null;
  }
  const ambientOnly = content.includes("<in-app-browser-context") && !content.includes("My request for Codex");
  if (ambientOnly) {
    return null;
  }
  const cleaned = trimmed.replace(/<in-app-browser-context[\s\S]*?<\/in-app-browser-context>/gi, "").replace(/^# Files mentioned by the user:[\s\S]*?## My request for Codex:/im, "").trim();
  return cleaned || null;
}
function conciseTitle(content, fallback) {
  const lines = content.replace(/<[^>]+>/g, " ").split(/\r?\n/).map((line) => line.replace(/^\s*(?:#{1,6}|[-*]|\d+\.)\s*/, "").trim()).filter(Boolean);
  const first = lines[0] ?? fallback;
  return truncate(first.replace(/\s+/g, " "), 72);
}
function conciseSummary(content) {
  return truncate(content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), 180);
}
function classifyReportedStatus(stopContent) {
  if (!stopContent) {
    return "progress";
  }
  if (hasDirectBlockedAssertion(stopContent)) {
    return "blocked";
  }
  const completionSection = directCompletionSection(stopContent).join("\n");
  if (completionSection && COMPLETION_EVIDENCE_PATTERN.test(completionSection)) {
    return "completed";
  }
  return "progress";
}
function hasDirectCompletionAssertion(content) {
  const units = statusUnits(content).slice(0, 4);
  const completionIndex = units.findIndex(
    (line) => isDirectCompletionLine(line)
  );
  if (completionIndex < 0) {
    return false;
  }
  return !units.slice(0, completionIndex + 1).some(
    (line) => isStatusBoundary(line)
  );
}
function hasDirectBlockedAssertion(content) {
  const units = statusUnits(content).slice(0, 4);
  const blockedIndex = units.findIndex(
    (line) => /^(?:(?:本次|这次)(?:工作|任务)?|当前|任务)?\s*(?:无法完成|未能完成|仍然受阻|需要用户|等待用户|缺少权限|blocked|无法继续)/i.test(line)
  );
  return blockedIndex >= 0 && !units.slice(0, blockedIndex + 1).some((line) => isStatusBoundary(line));
}
function directCompletionSection(content) {
  const units = statusUnits(content);
  const completionIndex = units.findIndex((line) => isDirectCompletionLine(line));
  if (completionIndex < 0 || completionIndex >= 4 || units.slice(0, completionIndex + 1).some((line) => isStatusBoundary(line))) {
    return [];
  }
  const section = [];
  for (const line of units.slice(completionIndex, completionIndex + 20)) {
    if (section.length > 0 && isStatusBoundary(line)) {
      break;
    }
    section.push(line);
  }
  return section;
}
function statusUnits(content) {
  return content.slice(0, 4e3).replace(/<[^>]*>/g, " ").split(/\r?\n|(?<=[。！？])\s*/).map((line) => line.replace(/^\s*(?:#{1,6}|[-*+]\s+|\d+\.\s+)/, "").trim().replace(/^(?:\*\*|__)(?=\S)/, "").replace(/(?:\*\*|__)$/, "")).filter(Boolean);
}
function isDirectCompletionLine(line) {
  if (/(?:并|，)\s*(?:将|会|需|需要)?继续(?:推进|处理|开发|完善|工作|优化|收口)?|后续(?:还要|将|会|需|需要)?继续/i.test(line)) {
    return false;
  }
  return /^(?:(?:你[^。！？]{0,32}(?:所以|因此)[，,]?\s*)|(?:(?:本次|这次)(?:工作|任务)?)?\s*)(?:我\s*)?(?:已完成|已经完成|已继续完成|已修复|已实现|已安装|已恢复|已提交|已全部处理|已定位并修复|已补上|已整理|整理完成|修复完成|实现完成|安装完成|已经改成|已改成|已经改为|已改为|已经做完|已做完)/i.test(line);
}
function isStatusBoundary(line) {
  return /^(?:把下面.*发给|(?:以下|这是)?.*提示词|验收标准|请(?:你|将|按|完成|实现|开发|修复)|建议(?:你|先|改为|采用)?|(?:这就清楚了[。！]?\s*)?你需要的(?:不是|是)|目标(?:是|：|:)|如果|可以(?:用|把|让)|下一步|后续(?:建议|计划)?|模板(?:是|：|:))/i.test(line);
}
function truncate(value, length) {
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, Math.max(0, length - 1)).trimEnd()}\u2026`;
}

// src/core/artifacts.ts
async function buildArtifacts(input, pathExists = defaultPathExists) {
  const gitArtifacts = mergeGitArtifacts(input.events.filter((event) => event.kind === "output_created" && event.sourceRefs.some((source) => source.type === "git")).map(buildGitArtifact));
  const wikiByPath = new Map(input.wikiDocuments.map((document) => [document.path, document]));
  const wikiArtifacts = input.events.filter((event) => event.kind === "knowledge_created" || event.kind === "knowledge_updated").map((event) => buildWikiArtifact(event, wikiByPath)).filter((artifact) => Boolean(artifact));
  const outcomeEvents = input.events.filter((event) => event.kind === "task_completed" && event.confidence === "reported");
  const reportArtifacts = (await Promise.all(outcomeEvents.map(async (event) => {
    const stopRecord = findStopRecord(input.records, event);
    if (!stopRecord) {
      return null;
    }
    return buildReportArtifact(event, stopRecord, input.events, pathExists);
  }))).filter((artifact) => Boolean(artifact));
  const merged = mergeReportsIntoGit(gitArtifacts, reportArtifacts);
  const artifacts = [...merged.git, ...merged.reports, ...wikiArtifacts].map(finalizeArtifact).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
  return artifacts;
}
function sanitizeSourceText(content) {
  return content.replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_match, pathText, label) => label || pathText).replace(/^\s*::[a-z-]+\{.*\}\s*$/gim, "").replace(/^\s*```[^\r\n]*$/gm, "").replace(/^\s*---\s*$/gm, "").replace(/^.*zhixing-(?:generated|user).*$/gim, "").split(/\r?\n/).map((line) => line.replace(/^\s*(?:#{1,6}|[-*+]\s+|\d+\.\s+)/, "").trim()).filter(Boolean).join("\n").slice(0, 12e3).trim();
}
function extractLocalPaths(content) {
  const paths = /* @__PURE__ */ new Set();
  const candidates = [
    ...[...content.matchAll(/\[[^\]]*\]\((\/?[A-Za-z]:[\\/][^)#]+)(?:#[^)]*)?\)/g)].map((match2) => match2[1]),
    ...[...content.matchAll(/`(\/?[A-Za-z]:[\\/][^`\r\n]+)`/g)].map((match2) => match2[1])
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const normalized = candidate.replace(/^\/(?=[A-Za-z]:[\\/])/, "").replace(/:\d+(?::\d+)?$/, "").trim();
    if (/^[A-Za-z]:[\\/]/.test(normalized)) {
      paths.add(import_node_path.default.normalize(normalized));
    }
  }
  return [...paths];
}
function isDirectCompletionReport(content) {
  return hasDirectCompletionAssertion(content);
}
function buildGitArtifact(event) {
  const hash = commitHashFromEvent(event);
  const fileRefs = event.sourceRefs.filter((source) => source.type === "file" && source.path);
  const gitRefs = event.sourceRefs.filter((source) => source.type === "git");
  const targets = [
    ...gitRefs.map((source) => ({
      key: `git:${hash ?? event.id}:${source.path?.toLocaleLowerCase() ?? source.label}`,
      type: "git-commit",
      label: `${source.label || "Git \u63D0\u4EA4"}`,
      hash,
      path: source.path,
      attribution: "independent"
    }))
  ];
  if (targets.length === 0) {
    targets.push({
      key: `git:${hash ?? event.id}`,
      type: "git-commit",
      label: hash ? hash.slice(0, 8) : "Git \u63D0\u4EA4",
      hash,
      attribution: "independent"
    });
  }
  const changedFiles2 = fileRefs.map((source) => source.label);
  const result2 = changedFiles2.length > 0 ? `${event.title}
Git \u63D0\u4EA4\u8BB0\u5F55\u5217\u51FA ${changedFiles2.length} \u4E2A\u76F8\u5173\u6587\u4EF6\uFF1A${changedFiles2.slice(0, 8).join("\u3001")}${changedFiles2.length > 8 ? "\u7B49" : ""}\u3002` : event.title;
  return artifactBase({
    id: hash ? `artifact:git:${hash.toLowerCase()}` : `artifact:${event.objectKey ?? event.id}`,
    event,
    kind: "git-commit",
    result: result2,
    validation: [hash ? `Git \u5386\u53F2\u4E2D\u5B58\u5728\u5B8C\u6574\u63D0\u4EA4 ${hash}\u3002` : "Git \u5386\u53F2\u4E2D\u5B58\u5728\u8BE5\u63D0\u4EA4\u3002"],
    limitations: [],
    proof: "independent",
    targets,
    sourceEventIds: [event.id]
  });
}
function buildWikiArtifact(event, wikiByPath) {
  const wikiPath = event.sourceRefs.find((source) => source.type === "wiki")?.path;
  if (!wikiPath) {
    return null;
  }
  const document = wikiByPath.get(wikiPath);
  if (!document) {
    return null;
  }
  return artifactBase({
    id: `artifact:${event.objectKey ?? event.id}`,
    event,
    kind: "knowledge-note",
    result: wikiResult(document.content),
    validation: ["\u77E5\u8BC6\u7B14\u8BB0\u5DF2\u5B58\u5728\u4E8E\u5F53\u524D Vault\u3002"],
    limitations: event.confidence === "inferred" ? [event.evidence] : [],
    proof: "independent",
    targets: [{
      key: `wiki:${wikiPath}`,
      type: "vault-note",
      label: event.title,
      path: wikiPath,
      exists: true,
      attribution: "independent"
    }],
    sourceEventIds: [event.id]
  });
}
async function buildReportArtifact(event, stopRecord, allEvents, pathExists) {
  if (!isDirectCompletionReport(stopRecord.content)) {
    return null;
  }
  const body = sanitizeSourceText(stopRecord.content);
  const reportBody = directReportSection(stopRecord.content);
  const targets = await extractReportedTargets(stopRecord.content, pathExists);
  const problemEvent = allEvents.find(
    (candidate) => candidate.sessionId === event.sessionId && candidate.turnId === event.turnId && (candidate.kind === "task_started" || candidate.kind === "task_progress")
  );
  const hasExistingTarget = targets.some((target) => target.type === "local-file" && target.exists);
  return artifactBase({
    id: `artifact:report:${event.sessionId ?? "unknown"}:${event.turnId ?? stopRecord.turn_id}`,
    event,
    kind: hasExistingTarget ? "file-deliverable" : "completion-report",
    problem: problemEvent ? sanitizeSourceText(problemEvent.summary) : void 0,
    result: extractResultSummary(stopRecord.content) || body || event.summary,
    validation: extractLines(reportBody, /(?:(?:测试|构建|验证|提交|commit|安装|SHA256|截图).*(?:通过|完成|成功|[0-9a-f]{7,})|HTTP\s*200)/i),
    limitations: extractLines(reportBody, /(?:尚未|未完成|仍需|限制|受限|失败|无法|不能|留待)/i),
    proof: hasExistingTarget ? "target-present" : "report-only",
    targets,
    sourceEventIds: [event.id, stopRecord.event_id]
  });
}
async function extractReportedTargets(content, pathExists) {
  const localTargets = await Promise.all(extractLocalPaths(content).slice(0, 24).map(async (targetPath) => {
    if (!await pathExists(targetPath)) {
      return null;
    }
    return {
      key: `file:${targetPath.toLocaleLowerCase()}`,
      type: "local-file",
      label: import_node_path.default.basename(targetPath),
      path: targetPath,
      exists: true,
      attribution: "reported"
    };
  }));
  const targets = localTargets.filter((target) => Boolean(target));
  for (const url of extractHttpUrls(content).slice(0, 12)) {
    targets.push({
      key: `url:${url}`,
      type: "url",
      label: url,
      url,
      attribution: "reported"
    });
  }
  return targets;
}
function extractResultSummary(content) {
  const section = directReportUnits(content);
  const selected = section.filter((line, index) => {
    if (index === 0 || /(?:提交|commit)(?:为|是|：|:|\s)*[`']?[0-9a-f]{7,40}/i.test(line)) {
      return true;
    }
    if (/^(?:验证|测试|限制|已知限制|来源|证据|下一步|后续)(?:结果)?\s*[：:]?$/i.test(line)) {
      return false;
    }
    return !/(?:尚未|未完成|仍需|限制|受限|失败|无法|不能|留待)/i.test(line) && !/(?:测试|构建|验证|SHA256|HTTP|截图).*(?:通过|完成|成功|[0-9a-f]{7,})/i.test(line);
  });
  return selected.slice(0, 6).join("\n").slice(0, 1200).trim();
}
function directReportSection(content) {
  return directReportUnits(content).join("\n");
}
function directReportUnits(content) {
  const units = reportUnits(content);
  const completionIndex = units.findIndex((line) => isDirectCompletionLine(line));
  if (completionIndex < 0) {
    return [];
  }
  const section = [];
  for (const line of units.slice(completionIndex, completionIndex + 20)) {
    if (section.length > 0 && isPromptOrDiscussionLine(line)) {
      break;
    }
    const boundaryIndex = line.search(/(?:验收标准|提示词|下一步|后续(?:建议|计划)?|模板)\s*[：:]/i);
    if (boundaryIndex === 0) {
      break;
    }
    section.push(boundaryIndex > 0 ? line.slice(0, boundaryIndex).trim() : line);
    if (boundaryIndex > 0) {
      break;
    }
  }
  return section;
}
function reportUnits(content) {
  return sanitizeSourceText(content.slice(0, 4e3)).split(/\r?\n|(?<=[。！？])\s*/).map((line) => line.trim().replace(/^(?:\*\*|__)(?=\S)/, "").replace(/(?:\*\*|__)$/, "")).filter(Boolean);
}
function isPromptOrDiscussionLine(line) {
  return /^(?:把下面.*发给|(?:以下|这是)?.*提示词|验收标准|请(?:你|将|按|完成|实现|开发|修复)|建议(?:你|先|改为|采用)?|(?:这就清楚了[。！]?\s*)?你需要的(?:不是|是)|目标(?:是|：|:)|如果|可以(?:用|把|让)|下一步|后续(?:建议|计划)?|模板(?:是|：|:))/i.test(line);
}
function extractHttpUrls(content) {
  const candidates = [
    ...[...content.matchAll(/\]\(\s*(https?:\/\/[^\s)]+)(?:\s+["'][^)]*)?\)/gi)].map((match2) => match2[1]),
    ...content.match(/https?:\/\/[^\s<>()\[\]{}"'`，。；：！？、」』【】）》（）]+/gi) ?? []
  ];
  const urls = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const trimmed = candidate.replace(/^[<(`]+/, "").replace(/[`，。；：！？、」』】）》）.,;!?]+$/g, "");
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        urls.add(parsed.toString());
      }
    } catch {
    }
  }
  return [...urls];
}
function mergeReportsIntoGit(gitArtifacts, reports) {
  const remainingReports = [];
  for (const report of reports) {
    const prefixes = commitPrefixes(report.result);
    const matches = gitArtifacts.filter((artifact) => {
      const hash = artifact.targets.find((target2) => target2.type === "git-commit")?.hash;
      return Boolean(hash && prefixes.some((prefix) => hash.toLowerCase().startsWith(prefix.toLowerCase())));
    });
    if (matches.length !== 1) {
      remainingReports.push(report);
      continue;
    }
    const target = matches[0];
    if (!target) {
      remainingReports.push(report);
      continue;
    }
    target.problem = report.problem ? `Codex \u62A5\u544A\uFF1A${report.problem}` : target.problem;
    target.validation = unique([
      ...target.validation,
      `Codex \u4EA4\u4ED8\u8BF4\u660E\uFF1A${report.result}`,
      ...report.validation.map((line) => `Codex \u62A5\u544A\uFF1A${line}`)
    ]);
    target.limitations = unique([...target.limitations, ...report.limitations.map((line) => `Codex \u62A5\u544A\uFF1A${line}`)]);
    target.targets = uniqueBy([...target.targets, ...report.targets], (item) => item.key);
    target.sourceEventIds = unique([...target.sourceEventIds, ...report.sourceEventIds]);
    target.sourceRefs = uniqueBy([...target.sourceRefs, ...report.sourceRefs], sourceKey);
  }
  return { git: gitArtifacts, reports: remainingReports };
}
function mergeGitArtifacts(artifacts) {
  const merged = /* @__PURE__ */ new Map();
  for (const artifact of artifacts) {
    const hash = artifact.targets.find((target) => target.type === "git-commit")?.hash?.toLowerCase();
    const key = hash ?? artifact.id;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, artifact);
      continue;
    }
    existing.targets = uniqueBy([...existing.targets, ...artifact.targets], (item) => item.key);
    existing.sourceEventIds = unique([...existing.sourceEventIds, ...artifact.sourceEventIds]);
    existing.sourceRefs = uniqueBy([...existing.sourceRefs, ...artifact.sourceRefs], gitSourceKey);
    const fileLabels = existing.sourceRefs.filter((source) => source.type === "file").map((source) => source.label);
    existing.result = fileLabels.length > 0 ? `${existing.title}
Git \u63D0\u4EA4\u8BB0\u5F55\u5217\u51FA ${fileLabels.length} \u4E2A\u76F8\u5173\u6587\u4EF6\uFF1A${fileLabels.slice(0, 8).join("\u3001")}${fileLabels.length > 8 ? "\u7B49" : ""}\u3002` : existing.title;
  }
  return [...merged.values()];
}
function artifactBase(input) {
  return {
    id: input.id,
    fingerprint: "",
    localDate: input.event.localDate,
    occurredAt: input.event.occurredAt,
    timeBasis: input.event.timeBasis,
    projectKey: input.event.projectKey,
    projectLabel: input.event.projectLabel,
    taskKey: input.event.taskKey,
    kind: input.kind,
    title: artifactDisplayTitle(input.event, input.kind),
    problem: input.problem,
    result: input.result,
    validation: unique(input.validation),
    limitations: unique(input.limitations),
    proof: input.proof,
    curation: "auto",
    targets: input.targets,
    sourceEventIds: unique(input.sourceEventIds),
    sourceRefs: input.event.sourceRefs,
    notePath: ""
  };
}
function finalizeArtifact(artifact) {
  const canonical = {
    id: artifact.id,
    localDate: artifact.localDate,
    occurredAt: artifact.occurredAt,
    timeBasis: artifact.timeBasis,
    projectKey: artifact.projectKey,
    projectLabel: artifact.projectLabel,
    taskKey: artifact.taskKey,
    kind: artifact.kind,
    title: artifact.title,
    problem: artifact.problem,
    result: artifact.result,
    validation: artifact.validation,
    limitations: artifact.limitations,
    proof: artifact.proof,
    curation: artifact.curation,
    targets: artifact.targets,
    sourceEventIds: artifact.sourceEventIds,
    sourceRefs: artifact.sourceRefs
  };
  const fingerprint = (0, import_node_crypto2.createHash)("sha256").update(JSON.stringify(canonical)).digest("hex");
  const finalized = { ...artifact, fingerprint };
  finalized.notePath = artifactNotePath(finalized);
  return finalized;
}
function findStopRecord(records, event) {
  return records.filter((record) => record.event === "Stop" && record.session_id === event.sessionId && record.turn_id === event.turnId).sort((left, right) => left.captured_at.localeCompare(right.captured_at)).at(-1);
}
function wikiResult(content) {
  const match2 = /^##\s+结论\s*$/m.exec(content);
  const afterHeading = match2 ? content.slice(match2.index + match2[0].length) : "";
  const nextHeading = afterHeading.search(/^##\s+/m);
  const conclusion = match2 ? afterHeading.slice(0, nextHeading >= 0 ? nextHeading : void 0) : "";
  return sanitizeSourceText(conclusion || content) || "\u77E5\u8BC6\u7B14\u8BB0\u5DF2\u5F62\u6210\u3002";
}
function extractLines(content, pattern) {
  return unique(content.split(/\r?\n|(?<=[。！？])/).map((line) => line.trim()).filter((line) => line && pattern.test(line))).slice(0, 8);
}
function commitPrefixes(content) {
  return unique([...content.matchAll(/(?:提交|commit)(?:为|是|：|:|\s)*[`']?([0-9a-f]{7,40})/gi)].map((match2) => match2[1]).filter((value) => Boolean(value)));
}
function commitHashFromEvent(event) {
  return (event.objectKey ?? event.id).match(/([0-9a-f]{40})$/i)?.[1];
}
function sourceKey(source) {
  return `${source.type}:${source.path ?? ""}:${source.url ?? ""}:${source.line ?? ""}`;
}
function gitSourceKey(source) {
  return source.type === "file" ? `git-file:${source.label.toLocaleLowerCase()}` : sourceKey(source);
}
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
function uniqueBy(values, key) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((value) => {
    const itemKey = key(value);
    if (seen.has(itemKey)) {
      return false;
    }
    seen.add(itemKey);
    return true;
  });
}
async function defaultPathExists(targetPath) {
  try {
    const entry = await (0, import_promises.stat)(targetPath);
    return entry.isFile();
  } catch {
    return false;
  }
}

// src/core/outcomes.ts
var import_node_crypto3 = require("node:crypto");
var import_node_path2 = __toESM(require("node:path"), 1);
function aggregateOutcomes(artifacts, settlements, events = []) {
  const groups = connectedArtifactGroups(artifacts);
  const artifactEventIds = new Set(artifacts.flatMap((artifact) => artifact.sourceEventIds));
  const artifactOutcomes = groups.map((group) => buildOutcome(group, settlements, events));
  const settlementOutcomes = settlements.filter((settlement) => settlement.status === "succeeded" || settlement.status === "failed" || settlement.category === "durable-output").filter((settlement) => !settlement.sourceEventIds.some((eventId) => artifactEventIds.has(eventId))).map((settlement) => buildSettlementOutcome(settlement, events));
  return [...artifactOutcomes, ...settlementOutcomes].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
}
function connectedArtifactGroups(artifacts) {
  const buckets = /* @__PURE__ */ new Map();
  for (const artifact of artifacts) {
    const key = `${artifact.localDate}\0${artifact.projectKey}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(artifact);
    buckets.set(key, bucket);
  }
  const groups = [];
  for (const bucket of buckets.values()) {
    const remaining = new Set(bucket);
    while (remaining.size > 0) {
      const seed = remaining.values().next().value;
      const group = [];
      const queue = [seed];
      remaining.delete(seed);
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
          continue;
        }
        group.push(current);
        for (const candidate of remaining) {
          if (sameOutcome(current, candidate)) {
            remaining.delete(candidate);
            queue.push(candidate);
          }
        }
      }
      groups.push(group);
    }
  }
  return groups;
}
function sameOutcome(left, right) {
  if (left.taskKey && right.taskKey && left.taskKey === right.taskKey) {
    return true;
  }
  if (intersects(left.sourceEventIds, right.sourceEventIds)) {
    return true;
  }
  const leftAnchor = strongestAnchor(left);
  const rightAnchor = strongestAnchor(right);
  if (leftAnchor && rightAnchor && leftAnchor === rightAnchor) {
    return true;
  }
  if (normalizedTitle(left.title) === normalizedTitle(right.title)) {
    return true;
  }
  const leftFiles = changedFiles(left);
  const rightFiles = changedFiles(right);
  if (leftFiles.size === 0 || rightFiles.size === 0) {
    return false;
  }
  const overlap = [...leftFiles].filter((file) => rightFiles.has(file)).length;
  const smaller = Math.min(leftFiles.size, rightFiles.size);
  if (overlap >= 2 || smaller > 0 && overlap / smaller >= 0.6) {
    return titleTokens(left.title).some((token) => titleTokens(right.title).includes(token));
  }
  return false;
}
function buildOutcome(artifacts, settlements, events) {
  artifacts.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
  const sourceEventIds = unique2(artifacts.flatMap((artifact) => artifact.sourceEventIds));
  const matchedSettlements = settlements.filter((settlement2) => intersects(sourceEventIds, settlement2.sourceEventIds));
  const settlement = selectSettlement(matchedSettlements);
  const wikiPaths = unique2(matchedSettlements.flatMap((item) => item.wikiPaths));
  const memoryPath = settlement?.memoryPath ?? matchedSettlements.find((item) => item.memoryPath)?.memoryPath;
  const evidencePaths = unique2(matchedSettlements.flatMap(
    (item) => item.evidencePaths?.length ? item.evidencePaths : item.wikiPaths.filter((wikiPath) => wikiPath !== item.memoryPath)
  ));
  const wikiRefs = wikiPaths.map((wikiPath) => ({
    type: "wiki",
    label: fileTitle(wikiPath),
    path: wikiPath
  }));
  const titleArtifact = preferredTitleArtifact(artifacts);
  const identity2 = stableGroupIdentity(artifacts);
  const generatedId = `outcome:${(0, import_node_crypto3.createHash)("sha256").update(`${titleArtifact.localDate}\0${titleArtifact.projectKey}\0${identity2}`).digest("hex").slice(0, 20)}`;
  const id = settlement?.id || generatedId;
  const relatedTaskEvents = events.filter(
    (event) => event.localDate === titleArtifact.localDate && event.projectKey === titleArtifact.projectKey && Boolean(event.taskKey && artifacts.some((artifact) => artifact.taskKey === event.taskKey))
  );
  return {
    id,
    localDate: titleArtifact.localDate,
    occurredAt: artifacts.at(-1)?.occurredAt ?? titleArtifact.occurredAt,
    projectKey: titleArtifact.projectKey,
    projectLabel: titleArtifact.projectLabel,
    title: titleArtifact.title,
    problem: outcomeProblem(artifacts, relatedTaskEvents),
    summary: outcomeSummary(artifacts),
    proof: strongestProof(artifacts),
    taskKeys: unique2(artifacts.map((artifact) => artifact.taskKey).filter((value) => Boolean(value))),
    artifactIds: artifacts.map((artifact) => artifact.id),
    eventIds: sourceEventIds,
    sourceRefs: uniqueBy2(artifacts.flatMap((artifact) => artifact.sourceRefs), sourceKey2),
    wikiRefs,
    memoryRef: memoryPath ? wikiReference(memoryPath) : void 0,
    evidenceRefs: evidencePaths.map(wikiReference),
    knowledgeChanges: uniqueBy2(matchedSettlements.flatMap((item) => item.knowledgeChanges), (item) => `${item.action}:${item.path}`),
    digest: settlement?.digest ?? matchedSettlements.find((item) => item.digest)?.digest,
    settlement: {
      status: settlement?.status ?? defaultSettlementStatus(artifacts),
      updatedAt: settlement?.updatedAt,
      error: settlement?.lastError,
      reason: settlement?.reason,
      category: settlement?.category
    },
    reuseCount: unique2(matchedSettlements.flatMap((item) => item.reusedByOutcomeIds ?? [])).length
  };
}
function buildSettlementOutcome(settlement, events) {
  const relatedEvents = events.filter((event) => settlement.sourceEventIds.some((sourceId) => sourceIdMatchesEvent(sourceId, event))).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const representative = relatedEvents.at(-1);
  const firstKnowledge = settlement.knowledgeChanges[0];
  const title = settlement.title ?? (settlement.status === "failed" ? `\u77E5\u8BC6\u6C89\u6DC0\u5931\u8D25\uFF1A${representative?.title ?? firstKnowledge?.title ?? "\u5F85\u91CD\u8BD5\u4EFB\u52A1"}` : settlement.knowledgeChanges.length > 1 ? `\u6C89\u6DC0 ${firstKnowledge?.title ?? "\u957F\u671F\u77E5\u8BC6"}\u7B49 ${settlement.knowledgeChanges.length} \u9879\u7ECF\u9A8C` : firstKnowledge?.title ?? representative?.title ?? "\u957F\u671F\u77E5\u8BC6\u6C89\u6DC0");
  const wikiRefs = unique2(settlement.wikiPaths).map((wikiPath) => ({
    type: "wiki",
    label: fileTitle(wikiPath),
    path: wikiPath
  }));
  const occurredAt = representative?.observedAt ?? settlement.occurredAt ?? settlement.updatedAt;
  const projectLabel = representative?.projectLabel ?? settlement.projectLabel ?? "\u672A\u5F52\u5C5E";
  const dailyRefs = (settlement.dailyPaths ?? []).map((dailyPath) => ({
    type: "file",
    label: fileTitle(dailyPath),
    path: dailyPath
  }));
  return {
    id: settlement.id,
    localDate: representative?.localDate ?? settlement.localDate ?? toLocalDate(settlement.updatedAt),
    occurredAt,
    projectKey: representative?.projectKey ?? normalizedProjectKey(projectLabel),
    projectLabel,
    title,
    problem: relatedEvents.find((event) => event.kind === "task_started" || event.kind === "task_progress")?.summary,
    summary: settlement.reason ?? (settlement.status === "failed" ? settlement.lastError || "\u77E5\u8BC6\u5199\u5165\u5931\u8D25\uFF0C\u5DF2\u4FDD\u7559\u5F85\u91CD\u8BD5\u72B6\u6001\u3002" : settlement.knowledgeChanges.map((change) => `${change.action === "created" ? "\u65B0\u589E" : "\u66F4\u65B0"}\u300A${change.title}\u300B`).join("\uFF1B")),
    proof: settlement.status === "succeeded" ? "target-present" : "report-only",
    taskKeys: unique2(relatedEvents.map((event) => event.taskKey)),
    artifactIds: [],
    eventIds: settlement.sourceEventIds,
    sourceRefs: uniqueBy2([...relatedEvents.flatMap((event) => event.sourceRefs), ...dailyRefs], sourceKey2),
    wikiRefs,
    memoryRef: settlement.memoryPath ? wikiReference(settlement.memoryPath) : void 0,
    evidenceRefs: unique2(settlement.evidencePaths?.length ? settlement.evidencePaths : settlement.wikiPaths.filter((wikiPath) => wikiPath !== settlement.memoryPath)).map(wikiReference),
    knowledgeChanges: settlement.knowledgeChanges,
    digest: settlement.digest,
    settlement: {
      status: settlement.status,
      updatedAt: settlement.updatedAt,
      error: settlement.lastError,
      reason: settlement.reason,
      category: settlement.category
    },
    reuseCount: unique2(settlement.reusedByOutcomeIds ?? []).length
  };
}
function wikiReference(wikiPath) {
  return {
    type: "wiki",
    label: fileTitle(wikiPath),
    path: wikiPath
  };
}
function normalizedProjectKey(value) {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, "-") || "unassigned";
}
function preferredTitleArtifact(artifacts) {
  return [...artifacts].sort((left, right) => {
    const taskOrder = Number(Boolean(right.taskKey)) - Number(Boolean(left.taskKey));
    if (taskOrder !== 0) {
      return taskOrder;
    }
    const reportOrder = artifactTitlePriority(right) - artifactTitlePriority(left);
    return reportOrder || right.occurredAt.localeCompare(left.occurredAt);
  })[0];
}
function artifactTitlePriority(artifact) {
  if (artifact.kind === "completion-report" || artifact.kind === "file-deliverable") {
    return 3;
  }
  if (artifact.kind === "knowledge-note") {
    return 2;
  }
  return 1;
}
function outcomeSummary(artifacts) {
  const parts = unique2(artifacts.flatMap((artifact) => {
    const problem = artifact.problem?.split(/\r?\n/).find(Boolean);
    const result2 = artifact.result.split(/\r?\n/).find(Boolean);
    return [problem, result2].filter((value) => Boolean(value));
  }));
  return parts.slice(0, 6).join("\n").slice(0, 1600) || "\u5DF2\u5F62\u6210\u53EF\u8FFD\u6EAF\u7684\u5DE5\u4F5C\u6210\u679C\u3002";
}
function strongestProof(artifacts) {
  if (artifacts.some((artifact) => artifact.proof === "independent")) {
    return "independent";
  }
  if (artifacts.some((artifact) => artifact.proof === "target-present")) {
    return "target-present";
  }
  return "report-only";
}
function selectSettlement(settlements) {
  return [...settlements].sort((left, right) => {
    const timeOrder = right.updatedAt.localeCompare(left.updatedAt);
    return timeOrder || settlementPriority(right.status) - settlementPriority(left.status);
  })[0];
}
function settlementPriority(status) {
  switch (status) {
    case "failed":
      return 4;
    case "pending":
      return 3;
    case "succeeded":
      return 2;
    case "not-applicable":
      return 1;
  }
}
function changedFiles(artifact) {
  return new Set(artifact.sourceRefs.filter((source) => source.type === "file").map((source) => source.label.replace(/\\/g, "/").toLocaleLowerCase()));
}
function strongestAnchor(artifact) {
  if (artifact.taskKey) {
    return `task:${artifact.taskKey}`;
  }
  const searchable = [
    artifact.title,
    artifact.result,
    ...artifact.sourceRefs.flatMap((source) => [source.label, source.path, source.excerpt].filter(Boolean))
  ].join("\n").replace(/\\/g, "/");
  const taskFolder = searchable.match(/(?:^|\/)\.agent\/tasks\/([a-z0-9][a-z0-9._-]*)/i)?.[1];
  if (taskFolder) {
    return `agent-task:${taskFolder.toLocaleLowerCase()}`;
  }
  const issue = searchable.match(/\b(?:issue|议题|问题单)\s*#?(\d{1,8})\b/i)?.[1];
  return issue ? `issue:${issue}` : void 0;
}
function stableGroupIdentity(artifacts) {
  const anchors = unique2(artifacts.map(strongestAnchor)).sort();
  if (anchors[0]) {
    return anchors[0];
  }
  return normalizedTitle(preferredTitleArtifact([...artifacts]).title) || artifacts.map((artifact) => artifact.id).sort()[0] || "unknown";
}
function outcomeProblem(artifacts, events) {
  const explicit = unique2(artifacts.map((artifact) => artifact.problem).filter((value) => Boolean(value)));
  if (explicit.length > 0) {
    return explicit.slice(0, 3).join("\n").slice(0, 1200);
  }
  const taskSummary = events.find((event) => event.kind === "task_started" || event.kind === "task_progress")?.summary;
  return taskSummary?.trim() || void 0;
}
function defaultSettlementStatus(artifacts) {
  const hasTaskContext = artifacts.some((artifact) => Boolean(artifact.taskKey || artifact.problem));
  return artifacts.length > 1 || hasTaskContext ? "pending" : "not-applicable";
}
function titleTokens(value) {
  return normalizedTitle(value).split(/[^a-z0-9\u4e00-\u9fff]+/i).filter((token) => token.length >= 2).filter((token) => !/^(?:修复|完成|新增|更新|优化|调整|验证|fix|feat|docs|test|chore)$/i.test(token));
}
function normalizedTitle(value) {
  return value.normalize("NFKC").replace(/^(?:fix|feat|docs|test|chore|refactor|style|perf)(?:\([^)]*\))?\s*[:：]\s*/i, "").replace(/\s*\((?:[2-9]|\d{2,})\)\s*$/, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}
function fileTitle(value) {
  return import_node_path2.default.basename(value).replace(/\.md$/i, "") || "\u77E5\u8BC6\u7B14\u8BB0";
}
function sourceIdMatchesEvent(sourceId, event) {
  return Boolean(event.sessionId && event.turnId && sourceId.startsWith(`${event.sessionId}:${event.turnId}:`));
}
function intersects(left, right) {
  const values = new Set(left);
  return right.some((value) => values.has(value));
}
function sourceKey2(source) {
  return `${source.type}:${source.path ?? ""}:${source.url ?? ""}:${source.line ?? ""}`;
}
function unique2(values) {
  return [...new Set(values.filter((value) => Boolean(value)))];
}
function uniqueBy2(values, key) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((value) => {
    const itemKey = key(value);
    if (seen.has(itemKey)) {
      return false;
    }
    seen.add(itemKey);
    return true;
  });
}

// src/core/project.ts
var SYSTEM_PATH_PATTERNS = [
  /\\Program Files\\WindowsApps\\OpenAI\.Codex_/i,
  /\\Program Files\\Obsidian/i,
  /\\AppData\\Local\\Temp\\zhixing-workbench-fixture/i
];
function projectFromCwd(cwd) {
  const normalized = cwd.replace(/\//g, "\\").replace(/\\+$/, "");
  if (!normalized || normalized === "chatgpt.com" || SYSTEM_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }
  const codexWorktree = normalized.match(/\\\.codex\\worktrees\\[^\\]+\\([^\\]+)/i);
  if (codexWorktree?.[1]) {
    return identity(codexWorktree[1], true);
  }
  const nestedWorktree = normalized.match(/^(.+?)\\\.worktrees(?:\\|$)/i);
  if (nestedWorktree?.[1]) {
    const base = basename(nestedWorktree[1]);
    return identity(base, true);
  }
  const label = basename(normalized);
  if (!label || label === ".codex") {
    return null;
  }
  return identity(label, false);
}
function projectFromWikiPath(path13) {
  const segments = path13.replace(/\\/g, "/").split("/");
  const folder = segments.length >= 3 ? segments[1] : "\u901A\u7528";
  const label = folder === "\u8865\u5145" || folder?.startsWith("_") ? "\u77E5\u8BC6\u5E93" : folder ?? "\u77E5\u8BC6\u5E93";
  return identity(label, true);
}
function projectFromChatTitle(title) {
  void title;
  return identity("\u672A\u5F52\u5C5E", true);
}
function projectKeyFromLabel(label) {
  return identity(label, false).key;
}
function reconcileProjectLabels(events) {
  const preferred = /* @__PURE__ */ new Map();
  for (const event of events) {
    const candidate = {
      label: event.projectLabel,
      priority: projectLabelPriority(event.sourceRefs.map((source) => source.type))
    };
    const current = preferred.get(event.projectKey);
    if (!current || candidate.priority > current.priority) {
      preferred.set(event.projectKey, candidate);
    }
  }
  return events.map((event) => {
    const label = preferred.get(event.projectKey)?.label ?? event.projectLabel;
    return label === event.projectLabel ? event : { ...event, projectLabel: label };
  });
}
function identity(label, inferred) {
  return {
    key: label.toLocaleLowerCase().replace(/\s+/g, "-"),
    label,
    inferred
  };
}
function projectLabelPriority(sourceTypes) {
  if (sourceTypes.includes("codex")) {
    return 3;
  }
  if (sourceTypes.includes("feishu")) {
    return 2.5;
  }
  if (sourceTypes.includes("wiki")) {
    return 2;
  }
  if (sourceTypes.includes("git")) {
    return 1;
  }
  return 0;
}
function basename(path13) {
  const parts = path13.split("\\").filter(Boolean);
  return parts.at(-1) ?? path13;
}

// src/core/task-identity.ts
var TASK_KINDS2 = /* @__PURE__ */ new Set([
  "task_started",
  "task_progress",
  "task_completed",
  "task_blocked"
]);
var MAX_TASK_COPY_GAP_MS = 14 * 24 * 60 * 60 * 1e3;
function reconcileNumberedTaskCopies(events) {
  const sessions = sessionTasks(events);
  const identities = /* @__PURE__ */ new Map();
  for (const session of sessions) {
    const key = `${session.projectKey}\0${session.normalizedTitle}`;
    const group = identities.get(key) ?? [];
    group.push(session);
    identities.set(key, group);
  }
  const replacement = /* @__PURE__ */ new Map();
  for (const group of identities.values()) {
    group.sort((left, right) => left.firstAt.localeCompare(right.firstAt) || left.taskKey.localeCompare(right.taskKey));
    for (const cluster of contiguousTaskCopies(group)) {
      const sessionIds = new Set(cluster.flatMap((session) => session.events.map((event) => event.sessionId).filter(Boolean)));
      if (cluster.length < 2 || sessionIds.size < 2 || !cluster.some((session) => session.numbered)) {
        continue;
      }
      const canonical = cluster.find((session) => !session.numbered) ?? cluster[0];
      if (!canonical) {
        continue;
      }
      const mergedEvents = cluster.flatMap((session) => session.events).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
      const firstStartId = mergedEvents.find((event) => event.kind === "task_started")?.id;
      const canonicalSession = canonical.events.find((event) => event.sessionId)?.sessionId ?? canonical.taskKey;
      const taskKey = `codex:${canonical.projectKey}:${encodeURIComponent(canonical.normalizedTitle)}:${canonicalSession}`;
      for (const session of cluster) {
        replacement.set(session.taskKey, { taskKey, title: canonical.title, firstStartId });
      }
    }
  }
  return events.map((event) => {
    if (!event.taskKey || !TASK_KINDS2.has(event.kind)) {
      return event;
    }
    const merged = replacement.get(event.taskKey);
    if (!merged) {
      return event;
    }
    return {
      ...event,
      taskKey: merged.taskKey,
      title: merged.title,
      kind: event.kind === "task_started" && event.id !== merged.firstStartId ? "task_progress" : event.kind
    };
  });
}
function reconcileExplicitWorkIdentities(events) {
  const groups = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (!event.taskKey || !TASK_KINDS2.has(event.kind)) continue;
    const identifier3 = explicitWorkIdentifier(event);
    if (!identifier3) continue;
    const key = `${event.projectKey}:${identifier3}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const replacement = /* @__PURE__ */ new Map();
  for (const [identity2, group] of groups) {
    const taskKeys = new Set(group.map((event) => event.taskKey).filter((value) => Boolean(value)));
    const sourceTypes = new Set(group.flatMap((event) => event.sourceRefs.map((source) => source.type)));
    if (taskKeys.size < 2 || sourceTypes.size < 2) continue;
    group.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    const firstStartId = group.find((event) => event.kind === "task_started")?.id;
    const title = group.find((event) => event.sourceRefs.some((source) => source.type === "codex"))?.title ?? group[0]?.title ?? "\u672A\u547D\u540D\u4EFB\u52A1";
    for (const taskKey of taskKeys) replacement.set(taskKey, { taskKey: `work:${identity2}`, firstStartId, title });
  }
  return events.map((event) => {
    const merged = event.taskKey ? replacement.get(event.taskKey) : void 0;
    if (!merged) return event;
    return {
      ...event,
      taskKey: merged.taskKey,
      title: merged.title,
      kind: event.kind === "task_started" && event.id !== merged.firstStartId ? "task_progress" : event.kind
    };
  });
}
function explicitWorkIdentifier(event) {
  const text = [event.title, event.summary, ...event.sourceRefs.map((source) => `${source.url || ""} ${source.excerpt || ""}`)].join("\n");
  const issue = text.match(/(?:\bissue\s*#?|\/issues\/)(\d{1,8})\b/i)?.[1];
  if (issue) return `issue:${issue}`;
  const task = text.match(/(?:\b(?:task|任务|工单)\s*(?:id)?\s*[:：#]?|\/tasks\/)([a-z0-9][a-z0-9._-]{3,80})\b/i)?.[1];
  return task ? `task:${task.toLocaleLowerCase()}` : void 0;
}
function contiguousTaskCopies(group) {
  const clusters = [];
  for (const session of group) {
    const current = clusters.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous || timeGap(previous.firstAt, session.firstAt) > MAX_TASK_COPY_GAP_MS) {
      clusters.push([session]);
    } else {
      current.push(session);
    }
  }
  return clusters;
}
function timeGap(left, right) {
  const gap = Date.parse(right) - Date.parse(left);
  return Number.isFinite(gap) && gap >= 0 ? gap : Number.POSITIVE_INFINITY;
}
function stripTaskCopySuffix(title) {
  const normalized = title.normalize("NFKC").replace(/\s+/g, " ").trim();
  const stripped = normalized.replace(/\s*\((?:[2-9]|\d{2,})\)\s*$/, "").trim();
  return { title: stripped || normalized, numbered: stripped !== normalized };
}
function sessionTasks(events) {
  const grouped = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (!event.taskKey || !TASK_KINDS2.has(event.kind)) {
      continue;
    }
    const group = grouped.get(event.taskKey) ?? [];
    group.push(event);
    grouped.set(event.taskKey, group);
  }
  const sessions = [];
  for (const [taskKey, taskEvents] of grouped) {
    taskEvents.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    const first = taskEvents[0];
    if (!first) {
      continue;
    }
    const parsed = stripTaskCopySuffix(first.title);
    sessions.push({
      taskKey,
      projectKey: first.projectKey,
      title: parsed.title,
      normalizedTitle: parsed.title.toLocaleLowerCase(),
      numbered: parsed.numbered,
      firstAt: first.occurredAt,
      events: taskEvents
    });
  }
  return sessions;
}

// src/core/raw-events.ts
function parseJsonl(text, sourcePath) {
  const records = [];
  let malformedLines = 0;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    try {
      const value = JSON.parse(line);
      if (typeof value.event_id !== "string" || typeof value.captured_at !== "string" || Number.isNaN(Date.parse(value.captured_at)) || typeof value.session_id !== "string" || typeof value.turn_id !== "string" || typeof value.event !== "string" || typeof value.content !== "string") {
        malformedLines += 1;
        continue;
      }
      records.push({
        schema_version: typeof value.schema_version === "number" ? value.schema_version : 1,
        event_id: value.event_id,
        captured_at: value.captured_at,
        date: typeof value.date === "string" && isCalendarDate(value.date) ? value.date : toLocalDate(value.captured_at),
        source: typeof value.source === "string" ? value.source : "codex",
        event: value.event,
        session_id: value.session_id,
        turn_id: value.turn_id,
        cwd: typeof value.cwd === "string" ? value.cwd : "",
        content: value.content,
        conversation_id: typeof value.conversation_id === "string" ? value.conversation_id : void 0,
        title: typeof value.title === "string" ? value.title : void 0,
        url: typeof value.url === "string" ? value.url : void 0,
        occurred_at: typeof value.occurred_at === "string" ? value.occurred_at : void 0,
        updated_at: typeof value.updated_at === "string" ? value.updated_at : void 0,
        resource_type: typeof value.resource_type === "string" ? value.resource_type : void 0,
        resource_id: typeof value.resource_id === "string" ? value.resource_id : void 0,
        resource_version: typeof value.resource_version === "string" ? value.resource_version : void 0,
        resource_status: typeof value.resource_status === "string" ? value.resource_status : void 0,
        resource_url: typeof value.resource_url === "string" ? value.resource_url : void 0,
        project_hint: typeof value.project_hint === "string" ? value.project_hint : void 0,
        access_status: typeof value.access_status === "string" ? value.access_status : void 0,
        activity_kind: isActivityKind(value.activity_kind) ? value.activity_kind : void 0,
        identity_scope: typeof value.identity_scope === "string" ? value.identity_scope : void 0,
        untrusted_source: value.untrusted_source === true,
        sourcePath,
        sourceLine: index + 1
      });
    } catch {
      malformedLines += 1;
    }
  }
  return { records, malformedLines };
}
function buildRawActivityEvents(input, sessionTitles) {
  const deduped = /* @__PURE__ */ new Map();
  for (const record of input) {
    deduped.set(record.event_id, record);
  }
  const duplicateRecords = input.length - deduped.size;
  const groups = /* @__PURE__ */ new Map();
  for (const record of deduped.values()) {
    if (record.source === "feishu") {
      continue;
    }
    const key = `${record.source}:${record.session_id}:${record.turn_id}`;
    const records = groups.get(key) ?? [];
    records.push(record);
    groups.set(key, records);
  }
  const events = [];
  const codexSessions = /* @__PURE__ */ new Set();
  const chatgptConversations = /* @__PURE__ */ new Set();
  let excludedAutomations = 0;
  let excludedSupportingSessions = 0;
  const feishuRecords = [...deduped.values()].filter((record) => record.source === "feishu");
  for (const record of feishuRecords) {
    const event = feishuActivityEvent(record);
    if (event) events.push(event);
  }
  const orderedGroups = [...groups.values()].sort((left, right) => firstTime(left).localeCompare(firstTime(right)));
  const seenTaskKeys = /* @__PURE__ */ new Set();
  for (const group of orderedGroups) {
    group.sort((left, right) => left.captured_at.localeCompare(right.captured_at));
    const prompts = group.filter((record) => record.event === "UserPromptSubmit");
    const stops = group.filter((record) => record.event === "Stop");
    const lastStop = stops.at(-1);
    const isChatgpt = group[0]?.source === "chatgpt_web";
    if (prompts.some((record) => isAutomationPrompt(record.content))) {
      excludedAutomations += 1;
      continue;
    }
    const meaningful = prompts.map((record) => ({ record, content: extractMeaningfulPrompt(record.content) })).filter((entry) => Boolean(entry.content));
    if (meaningful.length === 0) {
      continue;
    }
    const firstPrompt = meaningful[0];
    if (!firstPrompt) {
      continue;
    }
    if (!isChatgpt && !sessionTitles.has(firstPrompt.record.session_id)) {
      excludedSupportingSessions += 1;
      continue;
    }
    const paired = Boolean(lastStop);
    const sourceType = isChatgpt ? "chatgpt" : "codex";
    const sessionId = isChatgpt ? firstPrompt.record.conversation_id ?? firstPrompt.record.session_id : firstPrompt.record.session_id;
    const sessionTitle = sessionTitles.get(firstPrompt.record.session_id)?.title;
    const title = sessionTitle ?? firstPrompt.record.title ?? conciseTitle(firstPrompt.content, sourceType === "codex" ? "Codex \u4EFB\u52A1" : "ChatGPT \u5BF9\u8BDD");
    const project = isChatgpt ? projectFromChatTitle(firstPrompt.record.title) : projectFromCwd(firstPrompt.record.cwd) ?? { key: "unassigned", label: "\u672A\u5F52\u5C5E", inferred: true };
    const taskKey = `${sourceType}:${project.key}:${sessionId}`;
    const dailyPath = dailySourcePath(sourceType, firstPrompt.record.date);
    const sourceRefs = [
      {
        type: sourceType,
        label: sourceType === "codex" ? "Codex \u6765\u6E90\u9875" : "ChatGPT \u6765\u6E90\u9875",
        path: dailyPath,
        excerpt: conciseSummary(firstPrompt.content)
      },
      {
        type: sourceType,
        label: "\u539F\u59CB\u4E8B\u4EF6",
        path: firstPrompt.record.sourcePath,
        line: firstPrompt.record.sourceLine,
        excerpt: conciseSummary(firstPrompt.content)
      }
    ];
    if (isChatgpt && firstPrompt.record.url) {
      sourceRefs.unshift({ type: "chatgpt", label: "\u6253\u5F00 ChatGPT \u5BF9\u8BDD", url: firstPrompt.record.url });
    }
    if (lastStop) {
      if (lastStop.date !== firstPrompt.record.date) {
        sourceRefs.push({
          type: sourceType,
          label: sourceType === "codex" ? "Codex \u7EC8\u6001\u6765\u6E90\u9875" : "ChatGPT \u56DE\u7B54\u6765\u6E90\u9875",
          path: dailySourcePath(sourceType, lastStop.date),
          excerpt: conciseSummary(lastStop.content)
        });
      }
      sourceRefs.push({
        type: sourceType,
        label: sourceType === "codex" ? "Codex Stop \u4E8B\u4EF6" : "ChatGPT \u56DE\u7B54\u4E8B\u4EF6",
        path: lastStop.sourcePath,
        line: lastStop.sourceLine,
        excerpt: conciseSummary(lastStop.content)
      });
    }
    const reportedStatus = classifyReportedStatus(lastStop?.content);
    const firstTaskTurn = !seenTaskKeys.has(taskKey);
    seenTaskKeys.add(taskKey);
    const occurredAt = firstPrompt.record.captured_at;
    const observedAt = lastStop?.captured_at ?? occurredAt;
    const promptSummary = meaningful.length > 1 ? `${conciseSummary(firstPrompt.content)}\uFF08\u540C\u4E00 turn \u5171 ${meaningful.length} \u6761\u6307\u4EE4\uFF09` : conciseSummary(firstPrompt.content);
    events.push({
      id: `turn:${sourceType}:${firstPrompt.record.session_id}:${firstPrompt.record.turn_id}`,
      kind: isChatgpt ? "research_activity" : firstTaskTurn ? "task_started" : "task_progress",
      occurredAt,
      observedAt,
      localDate: firstPrompt.record.date,
      timeBasis: "captured",
      title: conciseTitle(title, "\u672A\u547D\u540D\u6D3B\u52A8"),
      summary: promptSummary,
      projectKey: project.key,
      projectLabel: project.label,
      taskKey: isChatgpt ? void 0 : taskKey,
      sessionId,
      turnId: firstPrompt.record.turn_id,
      confidence: paired ? "observed" : "inferred",
      evidence: isChatgpt ? paired ? "\u5DF2\u6355\u83B7\u5B8C\u6574 ChatGPT \u95EE\u7B54" : "\u4EC5\u6355\u83B7\u5230\u7528\u6237\u6D88\u606F" : paired ? "\u5DF2\u6355\u83B7\u5B8C\u6574 Codex turn" : "\u4EC5\u6355\u83B7\u5230\u4EFB\u52A1\u6307\u4EE4\uFF0C\u672A\u53D1\u73B0 Stop \u4E8B\u4EF6",
      sourceRefs
    });
    if (!isChatgpt && lastStop && (reportedStatus === "blocked" || reportedStatus === "completed")) {
      events.push({
        id: `turn-outcome:${sourceType}:${firstPrompt.record.session_id}:${firstPrompt.record.turn_id}`,
        kind: reportedStatus === "blocked" ? "task_blocked" : "task_completed",
        occurredAt: lastStop.captured_at,
        observedAt: lastStop.captured_at,
        localDate: lastStop.date,
        timeBasis: "captured",
        title: conciseTitle(title, "\u672A\u547D\u540D\u6D3B\u52A8"),
        summary: conciseSummary(lastStop.content),
        projectKey: project.key,
        projectLabel: project.label,
        taskKey,
        sessionId,
        turnId: firstPrompt.record.turn_id,
        confidence: "reported",
        evidence: reportedStatus === "blocked" ? "Codex \u6700\u7EC8\u56DE\u7B54\u62A5\u544A\u4EFB\u52A1\u53D7\u963B" : "\u6700\u7EC8\u56DE\u7B54\u62A5\u544A\u5B8C\u6210\u5E76\u5305\u542B\u9A8C\u8BC1\u63CF\u8FF0\uFF0C\u5C1A\u672A\u4E0E\u72EC\u7ACB\u4EA7\u51FA\u7ED1\u5B9A",
        sourceRefs
      });
    }
    if (isChatgpt) {
      chatgptConversations.add(sessionId);
    } else {
      codexSessions.add(sessionId);
    }
  }
  return {
    events: reconcileExplicitWorkIdentities(reconcileNumberedTaskCopies(events)),
    duplicateRecords,
    excludedAutomations,
    excludedSupportingSessions,
    codexSessions: codexSessions.size,
    chatgptConversations: chatgptConversations.size,
    feishuRecords: feishuRecords.length
  };
}
function feishuActivityEvent(record) {
  if (!record.resource_type || !record.resource_id) return void 0;
  const occurredAt = validTime(record.occurred_at) ? record.occurred_at : record.captured_at;
  const observedAt = validTime(record.updated_at) ? record.updated_at : record.captured_at;
  const label = record.project_hint?.trim() || record.cwd.trim() || "\u98DE\u4E66";
  const projectKey = projectKeyFromLabel(label);
  const kind = record.activity_kind ?? inferFeishuKind(record.resource_type, record.resource_status);
  const isTask = kind === "task_started" || kind === "task_progress" || kind === "task_completed" || kind === "task_blocked";
  const dailyPath = `raw/feishu/daily/${record.date}.md`;
  const sourceRefs = [
    { type: "feishu", label: "\u98DE\u4E66\u6BCF\u65E5\u6765\u6E90", path: dailyPath, excerpt: conciseSummary(record.content) },
    { type: "feishu", label: "\u98DE\u4E66\u539F\u59CB\u4E8B\u4EF6", path: record.sourcePath, line: record.sourceLine, excerpt: conciseSummary(record.content) }
  ];
  if (record.resource_url) sourceRefs.unshift({ type: "feishu", label: "\u6253\u5F00\u98DE\u4E66\u6765\u6E90", url: record.resource_url });
  return {
    id: `feishu:${record.event_id}`,
    kind,
    occurredAt,
    observedAt,
    localDate: record.date,
    timeBasis: "source",
    title: conciseTitle(record.title || record.content, "\u98DE\u4E66\u6D3B\u52A8"),
    summary: conciseSummary(record.content),
    projectKey,
    projectLabel: label,
    taskKey: isTask ? `feishu:${projectKey}:${record.resource_type}:${record.resource_id}` : void 0,
    objectKey: `feishu:${record.resource_type}:${record.resource_id}`,
    sessionId: record.session_id,
    turnId: record.turn_id,
    confidence: record.access_status === "available" ? "observed" : "reported",
    evidence: record.access_status === "available" ? `\u98DE\u4E66\u53EA\u8BFB\u540C\u6B65\u5DF2\u6355\u83B7${feishuSourceLabel(record.resource_type)}\u53CA\u6765\u6E90\u7248\u672C` : "\u98DE\u4E66\u6765\u6E90\u5DF2\u5220\u9664\u6216\u8BBF\u95EE\u6743\u9650\u88AB\u64A4\u56DE\uFF0C\u5386\u53F2\u8BC1\u636E\u4EC5\u4F9B\u8FFD\u6EAF",
    sourceRefs
  };
}
function inferFeishuKind(resourceType, status) {
  const value = String(status || "");
  if (resourceType === "tasks" || resourceType === "base") {
    if (/完成|done|completed|closed/i.test(value)) return "task_completed";
    if (/阻塞|blocked|暂停/i.test(value)) return "task_blocked";
    return "task_progress";
  }
  if (resourceType === "minutes" || resourceType === "documents") return "knowledge_updated";
  if (resourceType === "approvals") return "output_created";
  return "research_activity";
}
function isActivityKind(value) {
  return typeof value === "string" && [
    "task_started",
    "task_progress",
    "task_completed",
    "task_blocked",
    "research_activity",
    "output_created",
    "knowledge_created",
    "knowledge_updated",
    "knowledge_reused"
  ].includes(value);
}
function validTime(value) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}
function feishuSourceLabel(value) {
  return {
    tasks: "\u4EFB\u52A1",
    calendar: "\u65E5\u7A0B",
    meetings: "\u4F1A\u8BAE",
    minutes: "\u4F1A\u8BAE\u7EAA\u8981",
    documents: "\u6587\u6863\u6216 Wiki",
    base: "Base \u8BB0\u5F55",
    approvals: "\u5BA1\u6279\u7ED3\u679C",
    messages: "\u9879\u76EE\u7FA4\u6D88\u606F"
  }[value] || "\u6D3B\u52A8";
}
function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function firstTime(records) {
  return records.reduce((earliest, record) => record.captured_at < earliest ? record.captured_at : earliest, records[0]?.captured_at ?? "");
}
function dailySourcePath(source, date) {
  return `raw/${source}/daily/${date}.md`;
}

// src/core/wiki-events.ts
var SOURCE_MARKER = /<!--\s*(?:codex-source|chatgpt-qna):\s*prompt=([^;\s]+);stop=([^\s]+)\s*-->/g;
var DAILY_LINK = /\((?:\.\.\/)*raw\/(codex|chatgpt)\/daily\/(\d{4}-\d{2}-\d{2})\.md\)/g;
function buildWikiEvents(documents, rawByEventId) {
  const events = [];
  for (const document of documents) {
    const title = titleFromDocument(document);
    const project = projectFromWikiPath(document.path);
    const contributions = collectContributions(document, rawByEventId);
    const orderedDates = [...contributions.keys()].sort();
    if (orderedDates.length === 0) {
      const createdIso = new Date(document.ctime).toISOString();
      const modifiedIso = new Date(document.mtime).toISOString();
      const createdDate = toLocalDate(createdIso);
      events.push(wikiEvent(document, title, project, createdDate, createdIso, "knowledge_created", [], "file-time"));
      const modifiedDate = toLocalDate(modifiedIso);
      if (modifiedDate !== createdDate) {
        events.push(wikiEvent(document, title, project, modifiedDate, modifiedIso, "knowledge_updated", [], "file-time"));
      }
      continue;
    }
    orderedDates.forEach((date, index) => {
      const records = contributions.get(date) ?? [];
      const occurredAt = records.map((record) => record.captured_at).sort()[0] ?? `${date}T12:00:00+08:00`;
      events.push(wikiEvent(
        document,
        title,
        project,
        date,
        occurredAt,
        index === 0 ? "knowledge_created" : "knowledge_updated",
        records,
        "source"
      ));
    });
  }
  return events;
}
function buildWikiReuseEvents(links, documentByPath) {
  const events = [];
  const seen = /* @__PURE__ */ new Set();
  for (const link of links) {
    if (!link.sourcePath.startsWith("wiki/") || !link.targetPath.startsWith("wiki/")) {
      continue;
    }
    const target = documentByPath.get(link.targetPath);
    const source = documentByPath.get(link.sourcePath);
    if (!target || !source) {
      continue;
    }
    const key = `${link.sourcePath}->${link.targetPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const occurredAt = new Date(link.sourceMtime).toISOString();
    const project = projectFromWikiPath(link.sourcePath);
    events.push({
      id: `wiki-reuse:${key}`,
      kind: "knowledge_reused",
      occurredAt,
      observedAt: occurredAt,
      localDate: toLocalDate(occurredAt),
      timeBasis: "file-time",
      title: `\u5F15\u7528 ${titleFromDocument(target)}`,
      summary: `${titleFromDocument(source)} \u663E\u5F0F\u94FE\u63A5\u5230\u5DF2\u6709\u77E5\u8BC6 ${titleFromDocument(target)}`,
      projectKey: project.key,
      projectLabel: project.label,
      objectKey: `wiki-link:${key}`,
      confidence: "inferred",
      evidence: "\u5F53\u524D\u5B58\u5728\u663E\u5F0F Wiki \u94FE\u63A5\uFF1B\u53D1\u751F\u65E5\u671F\u6309\u5F15\u7528\u7B14\u8BB0\u4FEE\u6539\u65F6\u95F4\u4F30\u7B97",
      sourceRefs: [
        { type: "wiki", label: "\u5F15\u7528\u7B14\u8BB0", path: link.sourcePath },
        { type: "wiki", label: "\u88AB\u5F15\u7528\u77E5\u8BC6", path: link.targetPath }
      ]
    });
  }
  return events;
}
function collectContributions(document, rawByEventId) {
  const byDate = /* @__PURE__ */ new Map();
  for (const marker of document.content.matchAll(SOURCE_MARKER)) {
    const promptId = marker[1];
    const stopId = marker[2];
    for (const eventId of [promptId, stopId]) {
      if (!eventId) {
        continue;
      }
      const record = rawByEventId.get(eventId);
      if (!record) {
        continue;
      }
      const date = toLocalDate(record.captured_at);
      const records = byDate.get(date) ?? [];
      if (!records.some((item) => item.event_id === record.event_id)) {
        records.push(record);
      }
      byDate.set(date, records);
    }
  }
  if (byDate.size === 0) {
    for (const link of document.content.matchAll(DAILY_LINK)) {
      const date = link[2];
      if (date) {
        byDate.set(date, []);
      }
    }
  }
  return byDate;
}
function wikiEvent(document, title, project, date, occurredAt, kind, records, timeBasis) {
  const sourceRefs = [{ type: "wiki", label: "\u77E5\u8BC6\u7B14\u8BB0", path: document.path }];
  const dailyPaths = /* @__PURE__ */ new Set();
  for (const record of records) {
    const source = record.source === "chatgpt_web" ? "chatgpt" : "codex";
    dailyPaths.add(`raw/${source}/daily/${toLocalDate(record.captured_at)}.md`);
  }
  for (const path13 of dailyPaths) {
    sourceRefs.push({
      type: path13.includes("/chatgpt/") ? "chatgpt" : "codex",
      label: "\u539F\u59CB\u6765\u6E90\u9875",
      path: path13
    });
  }
  return {
    id: `wiki:${kind}:${document.path}:${date}`,
    kind,
    occurredAt,
    observedAt: new Date(document.mtime).toISOString(),
    localDate: date,
    timeBasis,
    title,
    summary: kind === "knowledge_created" ? "\u5F62\u6210\u77E5\u8BC6\u7B14\u8BB0" : "\u8865\u5145\u6216\u66F4\u65B0\u77E5\u8BC6\u7B14\u8BB0",
    projectKey: project.key,
    projectLabel: project.label,
    objectKey: `wiki:${document.path}:${date}`,
    confidence: timeBasis === "source" ? "observed" : "inferred",
    evidence: timeBasis === "source" ? "Wiki \u5B58\u5728\u53EF\u56DE\u6EAF\u7684\u6765\u6E90\u6807\u8BB0" : "\u6839\u636E\u6587\u4EF6\u65F6\u95F4\u751F\u6210\uFF0C\u77E5\u8BC6\u53D1\u751F\u65F6\u95F4\u4EC5\u4F9B\u53C2\u8003",
    sourceRefs
  };
}
function titleFromDocument(document) {
  const heading = document.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const fallback = document.path.split("/").at(-1)?.replace(/\.md$/i, "") ?? "\u672A\u547D\u540D\u77E5\u8BC6";
  return truncate(heading || fallback, 72);
}

// src/sources/git-source.ts
var import_node_child_process = require("node:child_process");
var import_node_crypto4 = require("node:crypto");
var import_promises2 = require("node:fs/promises");
var import_node_path3 = __toESM(require("node:path"), 1);
var import_node_util = require("node:util");
var execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
var MAX_GIT_CANDIDATES = 32;
var MAX_GIT_DISCOVERY_ATTEMPTS = 64;
var MAX_CHILD_REPOSITORIES_PER_CANDIDATE = 16;
var MAX_GIT_REPOSITORIES = 12;
var IGNORED_CHILD_DIRECTORIES = /* @__PURE__ */ new Set(["node_modules", "dist", "build", "coverage", ".cache", ".git"]);
async function scanGitActivity(input, sinceDate) {
  const repositories = /* @__PURE__ */ new Map();
  const errors = [];
  const candidates = prioritizeGitCandidates(input);
  const direct = await resolveCandidates(candidates.map((candidate, index) => ({
    path: candidate.path,
    rank: index * 100
  })));
  direct.forEach((entry) => {
    if (entry) {
      keepBestRepository(repositories, entry);
    }
  });
  const children = [];
  const childSets = [];
  for (const candidate of candidates) {
    childSets.push(await listChildRepositoryCandidates(candidate.path, MAX_CHILD_REPOSITORIES_PER_CANDIDATE));
  }
  const childLimits = allocateChildDiscoveryLimits(candidates.length, childSets.map((paths) => paths.length));
  childSets.forEach((childPaths, index) => {
    childPaths.slice(0, childLimits[index] ?? 0).forEach((childPath, childIndex) => children.push({
      path: childPath,
      rank: index * 100 + 20 + childIndex
    }));
  });
  for (const entry of await resolveCandidates(children)) {
    if (entry) {
      keepBestRepository(repositories, entry);
    }
  }
  const selectedRepositories = [...repositories.values()].sort((left, right) => left.rank - right.rank || left.repository.root.localeCompare(right.repository.root)).slice(0, MAX_GIT_REPOSITORIES).map((entry) => entry.repository);
  const eventsByObject = /* @__PURE__ */ new Map();
  const scans = await Promise.all(selectedRepositories.map(async (repository) => {
    try {
      return { repository, commits: await readCommits(repository, sinceDate) };
    } catch (error) {
      return { repository, commits: [], error };
    }
  }));
  for (const scan of scans) {
    if (scan.error) {
      errors.push(`${scan.repository.label}: ${scan.error instanceof Error ? scan.error.message : String(scan.error)}`);
    }
    for (const event of scan.commits) {
      const key = event.objectKey ?? event.id;
      const existing = eventsByObject.get(key);
      if (!existing) {
        eventsByObject.set(key, event);
        continue;
      }
      eventsByObject.set(key, {
        ...existing,
        sourceRefs: uniqueBy3([...existing.sourceRefs, ...event.sourceRefs], (source) => source.type === "file" ? `git-file:${source.label.toLocaleLowerCase()}` : `${source.type}:${source.path ?? ""}:${source.url ?? ""}:${source.line ?? ""}`)
      });
    }
  }
  return {
    events: [...eventsByObject.values()].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    repositories: selectedRepositories.length,
    errors
  };
}
function prioritizeGitCandidates(input) {
  const byPath = /* @__PURE__ */ new Map();
  for (const candidate of input) {
    if (!candidate.path.trim()) {
      continue;
    }
    const normalized = import_node_path3.default.resolve(candidate.path).replace(/[\\/]+$/, "").toLocaleLowerCase();
    const current = byPath.get(normalized);
    if (!current || compareGitCandidates(candidate, current) < 0) {
      byPath.set(normalized, { ...candidate, path: import_node_path3.default.resolve(candidate.path) });
    }
  }
  return [...byPath.values()].sort(compareGitCandidates).slice(0, MAX_GIT_CANDIDATES);
}
function allocateChildDiscoveryLimits(candidateCount, availableChildren) {
  let remaining = Math.max(0, MAX_GIT_DISCOVERY_ATTEMPTS - Math.min(candidateCount, MAX_GIT_CANDIDATES));
  return availableChildren.slice(0, Math.min(candidateCount, MAX_GIT_CANDIDATES)).map((count2) => {
    const allocated = Math.min(MAX_CHILD_REPOSITORIES_PER_CANDIDATE, Math.max(0, count2), remaining);
    remaining -= allocated;
    return allocated;
  });
}
async function resolveCandidates(candidates) {
  const resolved = [];
  for (let index = 0; index < candidates.length; index += 8) {
    const batch = await Promise.all(candidates.slice(index, index + 8).map(async (candidate) => {
      try {
        return { repository: await resolveRepository(candidate.path), rank: candidate.rank };
      } catch {
        return null;
      }
    }));
    resolved.push(...batch);
  }
  return resolved;
}
async function listChildRepositoryCandidates(parentPath, limit) {
  try {
    const parent = await (0, import_promises2.stat)(parentPath);
    if (!parent.isDirectory()) {
      return [];
    }
    const entries = (await (0, import_promises2.readdir)(parentPath, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".") && !IGNORED_CHILD_DIRECTORIES.has(entry.name.toLocaleLowerCase()));
    const dated = await Promise.all(entries.map(async (entry) => {
      const childPath = import_node_path3.default.join(parentPath, entry.name);
      try {
        return { path: childPath, mtime: (await (0, import_promises2.stat)(childPath)).mtimeMs };
      } catch {
        return null;
      }
    }));
    return dated.filter((entry) => Boolean(entry)).sort((left, right) => right.mtime - left.mtime || left.path.localeCompare(right.path)).slice(0, limit).map((entry) => entry.path);
  } catch {
    return [];
  }
}
function keepBestRepository(repositories, candidate) {
  const current = repositories.get(candidate.repository.discoveryKey);
  if (!current || candidate.rank < current.rank) {
    repositories.set(candidate.repository.discoveryKey, candidate);
  }
}
function compareGitCandidates(left, right) {
  const timeOrder = right.observedAt.localeCompare(left.observedAt);
  if (timeOrder !== 0) {
    return timeOrder;
  }
  const kindOrder = Number(right.kind === "reported") - Number(left.kind === "reported");
  if (kindOrder !== 0) {
    return kindOrder;
  }
  return left.path.localeCompare(right.path);
}
async function resolveRepository(cwd) {
  const entry = await (0, import_promises2.stat)(cwd);
  const startPath = entry.isFile() ? import_node_path3.default.dirname(cwd) : cwd;
  const { stdout } = await runGit(startPath, ["rev-parse", "--show-toplevel", "--git-common-dir"]);
  const [rootLine, commonLine] = stdout.trim().split(/\r?\n/);
  if (!rootLine || !commonLine) {
    throw new Error("Not a Git repository");
  }
  const root = rootLine.trim();
  const remote = await optionalGit(root, ["remote", "get-url", "origin"]);
  const common = commonLine.trim();
  const key = repositoryIdentityKey(remote, startPath, common);
  const discoveryKey = `${key}:${import_node_path3.default.resolve(startPath, common).toLocaleLowerCase()}`;
  const label = remote ? repositoryName(redactRemoteCredentials(remote)) : root.split(/[\\/]/).filter(Boolean).at(-1) ?? "Git \u9879\u76EE";
  const email = await optionalGit(root, ["config", "user.email"]) || await optionalGit(root, ["config", "user.name"]);
  return { root, discoveryKey, key, label, identity: email };
}
function repositoryIdentityKey(remote, resolutionBase, commonDir) {
  if (remote) {
    const redacted = redactRemoteCredentials(remote);
    return `remote:${(0, import_node_crypto4.createHash)("sha256").update(redacted).digest("hex")}`;
  }
  return import_node_path3.default.resolve(resolutionBase, commonDir).toLocaleLowerCase();
}
async function readCommits(repository, sinceDate) {
  if (!repository.identity) {
    return [];
  }
  const args = [
    "log",
    "--all",
    `--since=${sinceDate}T00:00:00+08:00`,
    `--author=${repository.identity}`,
    "--pretty=format:%x1e%H%x1f%cI%x1f%s%x1f%an%x1f%ae",
    "--name-only"
  ];
  const { stdout } = await runGit(repository.root, args, 1e4);
  const projectKey = projectKeyFromLabel(repository.label);
  return stdout.split("").map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
    const [header = "", ...fileLines] = chunk.split(/\r?\n/);
    const parts = header.split("");
    const [hash = "", occurredAt = "", subject = "", author = "", email = ""] = parts;
    const changedFiles2 = fileLines.map((line) => line.trim()).filter(Boolean);
    const sourceRefs = [
      {
        type: "git",
        label: `${repository.label} ${hash.slice(0, 8)}`,
        path: repository.root,
        excerpt: subject
      },
      ...changedFiles2.slice(0, 24).map((filePath) => ({
        type: "file",
        label: filePath,
        path: import_node_path3.default.join(repository.root, filePath),
        excerpt: `Git \u63D0\u4EA4 ${hash.slice(0, 8)} \u4E2D\u7684\u53D8\u66F4\u6587\u4EF6`
      }))
    ];
    return {
      id: `git:${hash.toLowerCase()}`,
      kind: "output_created",
      occurredAt,
      observedAt: occurredAt,
      localDate: toLocalDate(occurredAt),
      timeBasis: "source",
      title: subject,
      summary: `${author} <${email}> \xB7 ${hash.slice(0, 8)}${changedFiles2.length ? ` \xB7 ${changedFiles2.length} \u4E2A\u6587\u4EF6` : ""}`,
      projectKey,
      projectLabel: repository.label,
      objectKey: `git:${hash.toLowerCase()}`,
      confidence: "verified",
      evidence: "Git \u5386\u53F2\u4E2D\u5B58\u5728\u5F53\u524D\u7528\u6237\u8EAB\u4EFD\u7684 commit",
      sourceRefs
    };
  }).filter((event) => Boolean(event.id && event.occurredAt));
}
async function optionalGit(cwd, args) {
  try {
    const { stdout } = await runGit(cwd, args);
    return stdout.trim();
  } catch {
    return "";
  }
}
async function runGit(cwd, args, timeout = 4e3) {
  return execFileAsync("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    windowsHide: true,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    encoding: "utf8"
  });
}
function repositoryName(remote) {
  const withoutSuffix = remote.replace(/[\\/]$/, "").replace(/\.git$/i, "");
  return withoutSuffix.split(/[\\/:]/).filter(Boolean).at(-1) ?? "Git \u9879\u76EE";
}
function redactRemoteCredentials(remote) {
  const trimmed = remote.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed.replace(/^[^@/\s]+@(?=[^:/\s]+[:/])/, "");
  }
}
function uniqueBy3(values, key) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((value) => {
    const itemKey = key(value);
    if (seen.has(itemKey)) {
      return false;
    }
    seen.add(itemKey);
    return true;
  });
}

// src/sources/session-index.ts
var import_promises3 = require("node:fs/promises");
var import_node_os = require("node:os");
var import_node_path4 = __toESM(require("node:path"), 1);
async function loadSessionTitles() {
  const filePath = import_node_path4.default.join((0, import_node_os.homedir)(), ".codex", "session_index.jsonl");
  let text;
  try {
    text = await (0, import_promises3.readFile)(filePath, "utf8");
  } catch {
    return { available: false, titles: /* @__PURE__ */ new Map() };
  }
  const titles = /* @__PURE__ */ new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const value = JSON.parse(line);
      if (typeof value.id !== "string" || typeof value.thread_name !== "string") {
        continue;
      }
      const candidate = {
        id: value.id,
        title: value.thread_name.trim(),
        updatedAt: typeof value.updated_at === "string" ? value.updated_at : ""
      };
      const existing = titles.get(candidate.id);
      if (!existing || candidate.updatedAt >= existing.updatedAt) {
        titles.set(candidate.id, candidate);
      }
    } catch {
    }
  }
  return { available: true, titles };
}

// src/sources/vault-source.ts
var import_obsidian2 = require("obsidian");

// src/core/ingest-history.ts
var import_node_path5 = __toESM(require("node:path"), 1);

// src/core/knowledge-digest.ts
var DIGEST_LABELS = {
  about: "\u8FD9\u662F\u4EC0\u4E48",
  problem: "\u89E3\u51B3\u4E86\u4EC0\u4E48",
  result: "\u5F97\u5230\u4EC0\u4E48",
  nextUse: "\u4EE5\u540E\u600E\u4E48\u7528"
};
function parseKnowledgeDigest(value) {
  if (!isRecord(value)) {
    return void 0;
  }
  const digest = {
    about: stringValue(value.about),
    problem: stringValue(value.problem),
    result: stringValue(value.result),
    nextUse: stringValue(value.next_use ?? value.nextUse)
  };
  return Object.values(digest).every(Boolean) ? digest : void 0;
}
function deriveKnowledgeDigest(content, title, reason) {
  const overview = sectionLines(content, "\u4E00\u773C\u770B\u61C2");
  const explicit = Object.fromEntries(Object.entries(DIGEST_LABELS).map(([key, label]) => [
    key,
    overview.map((line) => labelledValue(line, label)).find(Boolean) ?? ""
  ]));
  if (Object.values(explicit).every(Boolean)) {
    return explicit;
  }
  const problems = sectionLines(content, "\u95EE\u9898\u4E0E\u73B0\u8C61");
  const results = sectionLines(content, "\u9A8C\u8BC1\u65B9\u5F0F\u4E0E\u7ED3\u679C");
  const nextSteps = sectionLines(content, "\u53EF\u590D\u7528\u7684\u89E3\u51B3\u8DEF\u5F84");
  if (problems.length === 0 || results.length === 0 || nextSteps.length === 0) {
    return void 0;
  }
  const problem = joinLines(problems, 2);
  return {
    about: `\u8FD9\u662F\u65E7\u7248\u77E5\u8BC6\u8BB0\u5F55\uFF0C\u539F\u6587\u4ECE\u8FD9\u4E2A\u95EE\u9898\u5F00\u59CB\uFF1A${concise(problems[0], 240)}`,
    problem,
    result: joinLines(results, 2),
    nextUse: joinLines(nextSteps, 2)
  };
}
function sectionLines(content, heading) {
  const match2 = content.match(new RegExp(
    `^##\\s+${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`,
    "m"
  ));
  if (!match2?.[1]) {
    return [];
  }
  return match2[1].split(/\r?\n/).map(cleanLine).filter((line) => Boolean(line) && !/^本次来源事件$/i.test(line)).slice(0, 8);
}
function cleanLine(value) {
  return value.trim().replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/\*\*/g, "").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)]\([^)]+\)/g, "$1").replace(/\[\[([^|\]]+)(?:\|[^\]]+)?]]/g, "$1").trim();
}
function labelledValue(value, label) {
  const match2 = value.match(new RegExp(`^${escapeRegExp(label)}\\s*[\uFF1A:]\\s*(.+)$`));
  return match2?.[1]?.trim() ?? "";
}
function joinLines(lines, count2) {
  return concise(lines.slice(0, count2).join("\uFF1B"));
}
function concise(value, max = 320) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}\u2026`;
}
function stringValue(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/core/ingest-history.ts
var RUN_STATUSES = /* @__PURE__ */ new Set([
  "running",
  "idle",
  "succeeded",
  "partial",
  "failed",
  "unknown"
]);
function parseStructuredIngestHistory(text, sourcePath) {
  const value = parseObject(text);
  if (!value) {
    return { errors: [`${sourcePath} \u4E0D\u662F\u6709\u6548\u7684\u6574\u7406\u8BB0\u5F55 JSON`] };
  }
  const runId = stringValue2(value.run_id);
  const startedAt = stringValue2(value.started_at);
  const status = statusValue(value.status);
  if (!runId || !startedAt || !status) {
    return { errors: [`${sourcePath} \u7F3A\u5C11 run_id\u3001started_at \u6216\u6709\u6548 status`] };
  }
  return {
    run: {
      id: stringValue2(value.attempt_id) || `history:${sourcePath}`,
      runId,
      startedAt,
      finishedAt: optionalString(value.finished_at),
      status,
      trigger: value.trigger === "automatic" ? "automatic" : "manual",
      selectedTopics: numberValue(value.selected_topics),
      committedTopics: numberValue(value.committed),
      skippedTopics: numberValue(value.skipped),
      pendingTopics: numberValue(value.pending),
      failedTopics: numberValue(value.failed),
      systemPairs: numberValue(value.system_committed_pairs),
      remainingTopics: numberValue(value.remaining_topics),
      remainingPairs: numberValue(value.remaining_pairs),
      cycleId: optionalString(value.cycle_id),
      batchIndex: numberValue(value.batch_index),
      tokensUsed: numberValue(value.tokens_used),
      inputChars: numberValue(value.input_chars),
      durationMs: numberValue(value.duration_ms),
      attemptCount: Array.isArray(value.attempts) ? value.attempts.length : status === "running" ? 0 : 1,
      topicResults: topicResults(value.topic_results),
      error: optionalString(value.error),
      logPath: optionalString(value.log_path),
      source: "structured"
    },
    errors: []
  };
}
function parseLegacyIngestLog(text, sourcePath) {
  const headerText = text.split(/\r?\n(?:\r?\n|\[(?:commit|codex_stdout|codex_stderr)\]\r?\n)/i)[0] ?? "";
  const header = /* @__PURE__ */ new Map();
  for (const line of headerText.split(/\r?\n/)) {
    const match2 = line.match(/^([a-z_]+)=(.*)$/i);
    if (match2) {
      header.set(match2[1], match2[2].trim());
    }
  }
  const startedAt = header.get("started_at") || timeFromLogName(sourcePath);
  if (!startedAt) {
    return { errors: [`${sourcePath} \u65E0\u6CD5\u8BC6\u522B\u5F00\u59CB\u65F6\u95F4`] };
  }
  const commit = commitCounts(text);
  const verified = header.get("verified_status");
  const status = verified && RUN_STATUSES.has(verified) ? verified : "unknown";
  const runId = header.get("run_id") || `legacy:${import_node_path5.default.basename(sourcePath, ".log")}`;
  return {
    run: {
      id: `legacy:${sourcePath}`,
      runId,
      startedAt,
      finishedAt: header.get("finished_at"),
      status,
      trigger: header.get("trigger") === "automatic" || header.get("trigger") === "manual" ? header.get("trigger") : "legacy",
      selectedTopics: numericHeader(header, "selected_topics", commit.selected_topics),
      committedTopics: numberValue(commit.committed),
      skippedTopics: numberValue(commit.skipped),
      pendingTopics: numberValue(commit.pending),
      failedTopics: numberValue(commit.failed),
      systemPairs: numberValue(commit.system_committed_pairs),
      remainingTopics: numberValue(commit.remaining_topics),
      remainingPairs: numberValue(commit.remaining_pairs),
      cycleId: header.get("cycle_id"),
      batchIndex: numericHeader(header, "batch_index", commit.batch_index),
      tokensUsed: numericHeader(header, "tokens_used", commit.tokens_used),
      inputChars: numericHeader(header, "input_chars", commit.input_chars),
      durationMs: numericHeader(header, "duration_ms", commit.duration_ms),
      attemptCount: 1,
      topicResults: [],
      logPath: sourcePath,
      source: "legacy-log"
    },
    errors: []
  };
}
function parseCurrentIngestStatus(text) {
  const value = parseObject(text);
  if (!value) {
    return { errors: ["\u6700\u8FD1\u6574\u7406\u72B6\u6001\u4E0D\u662F\u6709\u6548 JSON"] };
  }
  const runId = stringValue2(value.run_id);
  const updatedAt = stringValue2(value.updated_at);
  const status = statusValue(value.status);
  if (!runId || !updatedAt || !status) {
    return { errors: ["\u6700\u8FD1\u6574\u7406\u72B6\u6001\u7F3A\u5C11 run_id\u3001updated_at \u6216\u6709\u6548 status"] };
  }
  return {
    run: {
      id: `current:${runId}:${updatedAt}`,
      runId,
      startedAt: updatedAt,
      status,
      trigger: automaticTime(updatedAt) ? "automatic" : "manual",
      selectedTopics: numberValue(value.selected_topics),
      committedTopics: numberValue(value.committed),
      skippedTopics: numberValue(value.skipped),
      pendingTopics: numberValue(value.pending),
      failedTopics: numberValue(value.failed),
      systemPairs: numberValue(value.system_committed_pairs),
      remainingTopics: numberValue(value.remaining_topics),
      remainingPairs: numberValue(value.remaining_pairs),
      cycleId: optionalString(value.cycle_id),
      batchIndex: numberValue(value.batch_index),
      tokensUsed: numberValue(value.tokens_used),
      inputChars: numberValue(value.input_chars),
      durationMs: numberValue(value.duration_ms),
      attemptCount: 1,
      topicResults: [],
      error: optionalString(value.error),
      source: "current-status"
    },
    errors: []
  };
}
function mergeIngestRuns(structured, legacy, current) {
  const structuredRunIds = new Set(structured.map((run) => run.runId));
  const merged = [
    ...structured,
    ...legacy.filter((run) => !structuredRunIds.has(run.runId))
  ];
  if (current && !structured.some(
    (run) => run.runId === current.runId && run.status === current.status && Math.abs(Date.parse(run.finishedAt || run.startedAt) - Date.parse(current.finishedAt || current.startedAt)) < 3e5
  )) {
    merged.push(current);
  }
  return merged.sort((left, right) => (right.finishedAt || right.startedAt).localeCompare(left.finishedAt || left.startedAt) || right.id.localeCompare(left.id)).slice(0, 80);
}
function topicResults(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord2(item)) {
      return [];
    }
    const id = stringValue2(item.id);
    const status = stringValue2(item.status);
    if (!id || !["succeeded", "pending", "failed", "not-applicable"].includes(status)) {
      return [];
    }
    return [{
      id,
      title: stringValue2(item.title) || "\u672A\u547D\u540D\u4E3B\u9898",
      status,
      reason: optionalString(item.reason),
      error: optionalString(item.error),
      wikiPaths: stringArray(item.wiki_paths),
      wikiChanges: wikiChanges(item.knowledge_changes),
      digest: parseKnowledgeDigest(item.digest),
      memoryPath: optionalString(item.memory_path),
      evidencePaths: stringArray(item.evidence_paths),
      dailyPaths: stringArray(item.daily_paths),
      sourceEventCount: numberValue(item.source_event_count)
    }];
  });
}
function wikiChanges(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord2(item) || item.action !== "created" && item.action !== "updated") {
      return [];
    }
    const changePath = stringValue2(item.path);
    if (!changePath) {
      return [];
    }
    return [{
      action: item.action,
      path: changePath,
      title: stringValue2(item.title) || import_node_path5.default.basename(changePath, ".md"),
      role: item.role === "memory" || item.role === "evidence" ? item.role : void 0
    }];
  });
}
function commitCounts(text) {
  const match2 = text.match(/\r?\n\[commit\]\r?\n(\{[^\r\n]*\})/i);
  if (!match2) {
    return {};
  }
  return parseObject(match2[1]) ?? {};
}
function timeFromLogName(sourcePath) {
  const match2 = import_node_path5.default.basename(sourcePath).match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return match2 ? `${match2[1]}-${match2[2]}-${match2[3]}T${match2[4]}:${match2[5]}:${match2[6]}+08:00` : void 0;
}
function automaticTime(value) {
  const time = value.match(/T(\d{2}):(\d{2})/)?.slice(1, 3).join(":");
  return Boolean(time && time >= "23:25" && time <= "23:35");
}
function numericHeader(header, key, fallback) {
  const value = Number(header.get(key));
  return Number.isFinite(value) && value >= 0 ? value : numberValue(fallback);
}
function statusValue(value) {
  const status = stringValue2(value);
  return RUN_STATUSES.has(status) ? status : void 0;
}
function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return isRecord2(value) ? value : void 0;
  } catch {
    return void 0;
  }
}
function stringArray(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string" && Boolean(item.trim())))] : [];
}
function optionalString(value) {
  const valueString = stringValue2(value);
  return valueString || void 0;
}
function stringValue2(value) {
  return typeof value === "string" ? value.trim() : "";
}
function numberValue(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/core/knowledge-ledger.ts
var STATUSES = /* @__PURE__ */ new Set(["succeeded", "pending", "failed", "not-applicable"]);
function parseKnowledgeLedger(text) {
  if (!text.trim()) {
    return { settlements: [], errors: [] };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { settlements: [], errors: ["\u77E5\u8BC6\u6C89\u6DC0\u8D26\u672C\u4E0D\u662F\u6709\u6548 JSON"] };
  }
  if (!isRecord3(value) || !Array.isArray(value.outcomes)) {
    return { settlements: [], errors: ["\u77E5\u8BC6\u6C89\u6DC0\u8D26\u672C\u7F3A\u5C11 outcomes \u6570\u7EC4"] };
  }
  const settlements = [];
  const errors = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [index, item] of value.outcomes.entries()) {
    if (!isRecord3(item)) {
      errors.push(`outcomes[${index}] \u4E0D\u662F\u5BF9\u8C61`);
      continue;
    }
    const id = stringValue3(item.id);
    const status = stringValue3(item.status);
    const sourceEventIds = stringArray2(item.source_event_ids);
    const wikiPaths = stringArray2(item.wiki_paths);
    const updatedAt = stringValue3(item.updated_at);
    if (!id || seen.has(id) || !STATUSES.has(status) || sourceEventIds.length === 0 || !updatedAt) {
      errors.push(`outcomes[${index}] \u7F3A\u5C11\u6709\u6548\u7684 id\u3001status\u3001source_event_ids \u6216 updated_at`);
      continue;
    }
    if (status === "succeeded" && wikiPaths.length === 0) {
      errors.push(`outcomes[${index}] \u5DF2\u6C89\u6DC0\u4F46\u6CA1\u6709 wiki_paths`);
      continue;
    }
    seen.add(id);
    settlements.push({
      id,
      status,
      sourceEventIds,
      wikiPaths,
      knowledgeChanges: knowledgeChanges(item.knowledge_changes),
      updatedAt,
      lastError: optionalString2(item.last_error),
      reason: optionalString2(item.reason),
      reusedByOutcomeIds: stringArray2(item.reused_by_outcome_ids),
      category: optionalString2(item.category),
      title: optionalString2(item.title),
      localDate: optionalString2(item.local_date),
      occurredAt: optionalString2(item.occurred_at),
      projectLabel: optionalString2(item.project_label),
      dailyPaths: stringArray2(item.daily_paths),
      digest: parseKnowledgeDigest(item.digest),
      memoryPath: optionalString2(item.memory_path),
      evidencePaths: stringArray2(item.evidence_paths)
    });
  }
  return { settlements, errors };
}
function parseKnowledgeQueueStatus(text) {
  if (!text.trim()) {
    return void 0;
  }
  try {
    const value = JSON.parse(text);
    if (!isRecord3(value)) {
      return void 0;
    }
    return {
      rawPendingPairs: numberValue2(value.raw_pending_pairs),
      candidatePairs: numberValue2(value.candidate_pairs),
      candidateTopics: numberValue2(value.candidate_topics),
      openTopics: numberValue2(value.open_topics),
      readyTopics: numberValue2(value.ready_topics, numberValue2(value.candidate_topics)),
      retryTopics: numberValue2(value.retry_topics),
      coolingRetryTopics: numberValue2(value.cooling_retry_topics),
      backlogTopics: numberValue2(value.backlog_topics),
      recentTopics: numberValue2(value.recent_topics),
      partialTopics: numberValue2(value.partial_topics),
      needsCompactionTopics: numberValue2(value.needs_compaction_topics),
      selectedTopics: numberValue2(value.selected_topics),
      selectedChars: numberValue2(value.selected_chars),
      deferredTopics: numberValue2(value.deferred_topics),
      noOpAutomationPairs: numberValue2(value.no_op_automation_pairs),
      substantiveAutomationPairs: numberValue2(value.substantive_automation_pairs),
      supportingPairs: numberValue2(value.supporting_pairs),
      remainingPairs: numberValue2(value.remaining_pairs, numberValue2(value.raw_pending_pairs)),
      remainingTopics: numberValue2(value.remaining_topics, numberValue2(value.candidate_topics))
    };
  } catch {
    return void 0;
  }
}
function knowledgeChanges(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord3(item)) {
      return [];
    }
    const action = stringValue3(item.action);
    const path13 = stringValue3(item.path);
    if (action !== "created" && action !== "updated" || !path13) {
      return [];
    }
    return [{
      action,
      path: path13,
      title: stringValue3(item.title) || fileTitle2(path13),
      role: item.role === "memory" || item.role === "evidence" ? item.role : void 0
    }];
  });
}
function fileTitle2(path13) {
  return path13.split(/[\\/]/).at(-1)?.replace(/\.md$/i, "") || "\u77E5\u8BC6\u7B14\u8BB0";
}
function stringArray2(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string" && Boolean(item.trim())))] : [];
}
function optionalString2(value) {
  const result2 = stringValue3(value);
  return result2 || void 0;
}
function stringValue3(value) {
  return typeof value === "string" ? value.trim() : "";
}
function numberValue2(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/sources/vault-source.ts
var VaultSource = class {
  constructor(app) {
    this.app = app;
  }
  app;
  rawCache = /* @__PURE__ */ new Map();
  wikiCache = /* @__PURE__ */ new Map();
  ingestHistoryCache = /* @__PURE__ */ new Map();
  async load() {
    const files = this.app.vault.getFiles();
    const rawFiles = files.filter((file) => /^raw\/(codex|chatgpt|feishu)\/events\/\d{4}-\d{2}-\d{2}\.jsonl$/i.test(file.path));
    const wikiFiles = files.filter((file) => file.path.startsWith("wiki/") && file.extension === "md" && !file.basename.startsWith("_tmp"));
    const settlementFile = files.find((file) => file.path === "raw/codex/knowledge-settlements.json");
    const statusFile = files.find((file) => file.path === "raw/codex/ingest-status.json");
    const historyFiles = files.filter((file) => /^raw\/codex\/ingest-history\/[^/]+\.json$/i.test(file.path));
    const legacyLogFiles = files.filter((file) => /^raw\/codex\/automation\/\d{4}-\d{2}-\d{2}-\d{6}.*\.log$/i.test(file.path)).sort((left, right) => right.path.localeCompare(left.path));
    this.evictRemoved(rawFiles, wikiFiles, [...historyFiles, ...legacyLogFiles]);
    const records = [];
    let malformedLines = 0;
    for (const file of rawFiles) {
      const cached = this.rawCache.get(file.path);
      if (cached?.mtime === file.stat.mtime) {
        records.push(...cached.records);
        malformedLines += cached.malformedLines;
        continue;
      }
      const parsed = parseJsonl(await this.app.vault.read(file), file.path);
      this.rawCache.set(file.path, { mtime: file.stat.mtime, ...parsed });
      records.push(...parsed.records);
      malformedLines += parsed.malformedLines;
    }
    const documents = [];
    for (const file of wikiFiles) {
      const cached = this.wikiCache.get(file.path);
      if (cached?.mtime === file.stat.mtime) {
        documents.push(cached.document);
        continue;
      }
      const document = {
        path: file.path,
        content: await this.app.vault.cachedRead(file),
        ctime: file.stat.ctime,
        mtime: file.stat.mtime
      };
      this.wikiCache.set(file.path, { mtime: file.stat.mtime, document });
      documents.push(document);
    }
    const parsedSettlements = settlementFile ? parseKnowledgeLedger(await this.app.vault.read(settlementFile)) : { settlements: [], errors: [] };
    const wikiByPath = new Map(documents.map((document) => [document.path, document]));
    const settlements = parsedSettlements.settlements.map((settlement) => {
      if (settlement.digest) {
        return settlement;
      }
      const wiki = settlement.wikiPaths.map((wikiPath) => wikiByPath.get(wikiPath)).find(Boolean);
      const digest = wiki ? deriveKnowledgeDigest(wiki.content, settlement.title ?? wiki.path.split("/").at(-1)?.replace(/\.md$/i, "") ?? "\u957F\u671F\u77E5\u8BC6", settlement.reason) : void 0;
      return digest ? { ...settlement, digest } : settlement;
    });
    const statusText = statusFile ? await this.app.vault.read(statusFile) : void 0;
    const historyResult = await this.loadIngestHistory(
      historyFiles,
      legacyLogFiles,
      statusText,
      wikiByPath
    );
    return {
      records,
      malformedLines,
      rawFiles: rawFiles.length,
      documents,
      wikiLinks: this.collectWikiLinks(wikiFiles),
      settlements,
      settlementFileAvailable: Boolean(settlementFile),
      settlementErrors: parsedSettlements.errors,
      ingestRuns: historyResult.runs,
      ingestHistoryErrors: historyResult.errors,
      knowledgeQueue: statusText ? parseKnowledgeQueueStatus(statusText) : void 0
    };
  }
  async loadIngestHistory(historyFiles, legacyLogFiles, statusText, wikiByPath) {
    const structured = [];
    const legacy = [];
    const errors = [];
    const retainedHistoryFiles = [...historyFiles].sort((left, right) => right.stat.mtime - left.stat.mtime).slice(0, 120);
    for (const file of retainedHistoryFiles) {
      const parsed = await this.cachedIngestHistory(file, "structured");
      if (parsed.run) {
        structured.push(parsed.run);
      }
      errors.push(...parsed.errors);
    }
    const earliestStructured = structured.map((run) => run.startedAt).sort()[0];
    const legacyCandidates = (historyFiles.length > retainedHistoryFiles.length ? [] : legacyLogFiles).filter((file) => !earliestStructured || Date.parse(legacyTimeFromPath(file.path)) < Date.parse(earliestStructured)).slice(0, 30);
    for (const file of legacyCandidates) {
      const parsed = await this.cachedIngestHistory(file, "legacy");
      if (parsed.run) {
        legacy.push(parsed.run);
      }
      errors.push(...parsed.errors);
    }
    const currentResult = statusText ? parseCurrentIngestStatus(statusText) : { errors: [] };
    errors.push(...currentResult.errors);
    return {
      runs: mergeIngestRuns(structured, legacy, currentResult.run).map((run) => ({
        ...run,
        topicResults: run.topicResults.map((topic) => {
          if (topic.digest) {
            return topic;
          }
          const wiki = topic.wikiPaths.map((wikiPath) => wikiByPath.get(wikiPath)).find(Boolean);
          const digest = wiki ? deriveKnowledgeDigest(wiki.content, topic.title, topic.reason) : void 0;
          return digest ? { ...topic, digest } : topic;
        })
      })),
      errors
    };
  }
  async cachedIngestHistory(file, kind) {
    const cached = this.ingestHistoryCache.get(file.path);
    if (cached?.mtime === file.stat.mtime) {
      return cached;
    }
    const text = kind === "legacy" && file.stat.size > 128 * 1024 ? "" : await this.app.vault.read(file);
    const parsed = kind === "structured" ? parseStructuredIngestHistory(text, file.path) : parseLegacyIngestLog(text, file.path);
    const entry = { mtime: file.stat.mtime, ...parsed };
    this.ingestHistoryCache.set(file.path, entry);
    return entry;
  }
  collectWikiLinks(wikiFiles) {
    const wikiPaths = new Set(wikiFiles.map((file) => file.path));
    const links = [];
    for (const [sourcePath, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      if (!wikiPaths.has(sourcePath)) {
        continue;
      }
      const source = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(source instanceof import_obsidian2.TFile)) {
        continue;
      }
      for (const targetPath of Object.keys(targets)) {
        if (wikiPaths.has(targetPath)) {
          links.push({ sourcePath, targetPath, sourceMtime: source.stat.mtime });
        }
      }
    }
    return links;
  }
  evictRemoved(rawFiles, wikiFiles, ingestHistoryFiles) {
    const rawPaths = new Set(rawFiles.map((file) => file.path));
    const wikiPaths = new Set(wikiFiles.map((file) => file.path));
    const ingestHistoryPaths = new Set(ingestHistoryFiles.map((file) => file.path));
    for (const path13 of this.rawCache.keys()) {
      if (!rawPaths.has(path13)) {
        this.rawCache.delete(path13);
      }
    }
    for (const path13 of this.wikiCache.keys()) {
      if (!wikiPaths.has(path13)) {
        this.wikiCache.delete(path13);
      }
    }
    for (const path13 of this.ingestHistoryCache.keys()) {
      if (!ingestHistoryPaths.has(path13)) {
        this.ingestHistoryCache.delete(path13);
      }
    }
  }
};
function legacyTimeFromPath(value) {
  const match2 = value.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return match2 ? `${match2[1]}-${match2[2]}-${match2[3]}T${match2[4]}:${match2[5]}:${match2[6]}+08:00` : "";
}

// src/activity-service.ts
var ActivityService = class {
  constructor(app) {
    this.app = app;
    this.vaultSource = new VaultSource(app);
    this.artifactWriter = new ArtifactWriter(app);
  }
  app;
  vaultSource;
  artifactWriter;
  listeners = /* @__PURE__ */ new Set();
  refreshPromise;
  debounceTimer;
  current;
  refreshQueued = false;
  destroyed = false;
  get snapshot() {
    return this.current;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    if (this.current) {
      listener(this.current);
    }
    return () => this.listeners.delete(listener);
  }
  scheduleRefresh() {
    if (this.destroyed) {
      return;
    }
    window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = void 0;
      void this.refresh().catch((error) => {
        console.error("Activity Ledger background refresh failed", error);
      });
    }, 450);
  }
  async refresh() {
    if (this.destroyed) {
      throw new Error("Activity Ledger service is closed");
    }
    if (this.refreshPromise) {
      this.refreshQueued = true;
      return this.refreshPromise;
    }
    this.refreshPromise = this.refreshUntilCurrent();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = void 0;
    }
  }
  destroy() {
    this.destroyed = true;
    window.clearTimeout(this.debounceTimer);
    this.debounceTimer = void 0;
    this.refreshQueued = false;
    this.listeners.clear();
  }
  async refreshUntilCurrent() {
    let snapshot;
    do {
      this.refreshQueued = false;
      snapshot = await this.buildSnapshot();
      if (!this.destroyed) {
        this.current = snapshot;
        for (const listener of this.listeners) {
          listener(snapshot);
        }
      }
    } while (this.refreshQueued && !this.destroyed);
    return snapshot;
  }
  async buildSnapshot() {
    const [vault, sessionIndex] = await Promise.all([
      this.vaultSource.load(),
      loadSessionTitles()
    ]);
    const sessionTitles = sessionIndex.titles;
    const raw = buildRawActivityEvents(vault.records, sessionTitles);
    const rawById = new Map(vault.records.map((record) => [record.event_id, record]));
    const wikiEvents = buildWikiEvents(vault.documents, rawById);
    const wikiByPath = new Map(vault.documents.map((document) => [document.path, document]));
    const reuseEvents = buildWikiReuseEvents(vault.wikiLinks, wikiByPath);
    const eligibleCodexRecords = vault.records.filter(
      (record) => record.source === "codex" && record.event === "UserPromptSubmit" && sessionTitles.has(record.session_id) && !isAutomationPrompt(record.content) && Boolean(extractMeaningfulPrompt(record.content))
    );
    const eligibleTurnKeys = new Set(eligibleCodexRecords.map(recordTurnKey));
    const eligibleStops = selectEligibleCodexStops(vault.records, eligibleTurnKeys);
    const gitCandidates = [
      ...eligibleStops.flatMap((record) => extractLocalPaths(record.content).map((targetPath) => ({
        path: targetPath,
        observedAt: record.captured_at,
        kind: "reported"
      }))),
      ...eligibleCodexRecords.filter((record) => Boolean(record.cwd)).map((record) => ({
        path: record.cwd,
        observedAt: record.captured_at,
        kind: "cwd"
      }))
    ];
    const sinceDate = vault.records.map((record) => record.date).filter(Boolean).sort()[0] ?? "1970-01-01";
    const git = await scanGitActivity(gitCandidates, sinceDate);
    const events = reconcileProjectLabels([...raw.events, ...wikiEvents, ...reuseEvents, ...git.events]).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    const artifactCandidates = await buildArtifacts({
      records: eligibleStops,
      events,
      wikiDocuments: vault.documents
    });
    const artifactSync = await this.artifactWriter.sync(artifactCandidates);
    const artifacts = artifactCandidates.filter((artifact) => artifactSync.persistedIds.has(artifact.id));
    const outcomes = aggregateOutcomes(artifacts, vault.settlements, events);
    const diagnostics = {
      rawFiles: vault.rawFiles,
      malformedLines: vault.malformedLines,
      duplicateRecords: raw.duplicateRecords,
      excludedAutomations: raw.excludedAutomations,
      excludedSupportingSessions: raw.excludedSupportingSessions,
      codexSessions: raw.codexSessions,
      chatgptConversations: raw.chatgptConversations,
      feishuRecords: raw.feishuRecords,
      wikiNotes: vault.documents.length,
      gitRepositories: git.repositories,
      gitErrors: git.errors,
      sessionIndexAvailable: sessionIndex.available,
      artifactNotes: artifacts.length,
      artifactWriteErrors: artifactSync.errors,
      settlementFileAvailable: vault.settlementFileAvailable,
      settlementErrors: vault.settlementErrors,
      ingestHistoryErrors: vault.ingestHistoryErrors,
      knowledgeQueue: vault.knowledgeQueue
    };
    return {
      events,
      tasks: aggregateTasks(events),
      artifacts,
      outcomes,
      ingestRuns: vault.ingestRuns,
      builtAt: (/* @__PURE__ */ new Date()).toISOString(),
      diagnostics
    };
  }
};
function selectEligibleCodexStops(records, eligibleTurnKeys) {
  return records.filter(
    (record) => record.source === "codex" && record.event === "Stop" && eligibleTurnKeys.has(recordTurnKey(record)) && isDirectCompletionReport(record.content) && classifyReportedStatus(record.content) === "completed"
  );
}
function recordTurnKey(record) {
  return `${record.session_id}:${record.turn_id}`;
}
function isActivityPath(path13) {
  return /^raw\/(codex|chatgpt|feishu)\/(events|daily)\//i.test(path13) || /^raw\/codex\/(ingest-history\/|automation\/.*\.log$|ingest-status\.json$|knowledge-settlements\.json$)/i.test(path13) || path13.startsWith("wiki/");
}

// src/graph-filter.ts
var ARTIFACT_GRAPH_FILTER = '-path:"\u6210\u679C/\u77E5\u884C\u53F0"';
function updateGraphConfigText(content, mode) {
  let parsed;
  try {
    parsed = JSON.parse(content || "{}");
  } catch {
    return { ok: false, changed: false, content, error: "\u5173\u7CFB\u56FE\u914D\u7F6E\u4E0D\u662F\u6709\u6548 JSON\uFF0C\u5DF2\u62D2\u7EDD\u8986\u76D6" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, changed: false, content, error: "\u5173\u7CFB\u56FE\u914D\u7F6E\u7ED3\u6784\u65E0\u6548\uFF0C\u5DF2\u62D2\u7EDD\u8986\u76D6" };
  }
  const config = parsed;
  const current = typeof config.search === "string" ? config.search.trim() : "";
  const search = mode === "enable" ? addFilter(current) : removeFilter(current);
  if (search === current && typeof config.search === "string") {
    return { ok: true, changed: false, content };
  }
  const updated = { ...config, search };
  return { ok: true, changed: true, content: `${JSON.stringify(updated, null, 2)}
` };
}
function addFilter(search) {
  if (search.includes(ARTIFACT_GRAPH_FILTER)) {
    return search;
  }
  return [search, ARTIFACT_GRAPH_FILTER].filter(Boolean).join(" ");
}
function removeFilter(search) {
  return search.split(ARTIFACT_GRAPH_FILTER).join(" ").replace(/\s+/g, " ").trim();
}

// src/view.ts
var import_electron = require("electron");
var import_obsidian4 = require("obsidian");

// src/health-view-model.ts
function factualHealthDisplay(health, labels) {
  const title = [
    `\u5DF2\u914D\u7F6E\uFF1A${health.configured ? "\u662F" : "\u5426"}`,
    `\u5F53\u524D\u7248\u672C\u652F\u6301\uFF1A${health.supported ? "\u662F" : "\u5426"}`,
    health.last_seen_at ? `\u6700\u540E\u63A2\u6D3B\uFF1A${formatHealthTime(health.last_seen_at)}` : "\u5C1A\u672A\u63A2\u6D3B",
    health.last_event_at ? `\u6700\u540E\u4E8B\u4EF6\uFF1A${formatHealthTime(health.last_event_at)}` : "\u5C1A\u672A\u6536\u5230\u4E8B\u4EF6",
    health.error
  ].filter(Boolean).join(" \xB7 ");
  if (!health.configured || !health.supported || health.error) {
    return { state: "unavailable", label: labels.unavailable, title };
  }
  if (!health.last_event_at) return { state: "starting", label: labels.waiting, title };
  if (health.stale) return { state: "starting", label: labels.stale, title };
  return { state: "ready", label: labels.ready, title };
}
function canRunKnowledgeNow(health) {
  return health.organizer.runtime.supported && health.organizer.executor.supported && !health.running && health.schedulerHost?.phase !== "processing";
}
function scheduleHealthLabel(health, formatTime) {
  if (health.schedulerHost.phase === "processing") {
    if (health.schedulerHost.owner_kind === "background") return "\u540E\u53F0\u6B63\u5728\u5904\u7406";
    if (health.schedulerHost.owner_kind === "manual") return "\u6B63\u5728\u624B\u52A8\u6574\u7406";
    return "Obsidian \u6B63\u5728\u5904\u7406";
  }
  if (health.schedule.status === "backoff") {
    return health.schedule.next_due ? `\u6574\u7406\u5931\u8D25\uFF0C${formatTime(health.schedule.next_due)} \u81EA\u52A8\u91CD\u8BD5` : "\u6574\u7406\u5931\u8D25\uFF0C\u7B49\u5F85\u81EA\u52A8\u91CD\u8BD5";
  }
  if (health.schedulerHost.phase === "error") return health.schedulerHost.error || "\u540E\u53F0\u8C03\u5EA6\u5931\u8D25";
  if (!health.schedulerHost.supported) {
    return health.schedulerHost.configured ? "\u540E\u53F0\u8C03\u5EA6\u7B49\u5F85\u767B\u5F55\u542F\u52A8 \xB7 \u6253\u5F00 Obsidian \u65F6\u4ECD\u4F1A\u8865\u8DD1" : "\u4EC5\u5728 Obsidian \u6253\u5F00\u65F6\u68C0\u67E5\u8865\u8DD1";
  }
  return health.schedule.next_due ? `\u540E\u53F0\u5B88\u5019 23:30 \xB7 \u4E0B\u6B21\u68C0\u67E5 ${formatTime(health.schedule.next_due)}` : "\u540E\u53F0\u5B88\u5019\u6BCF\u5929 23:30";
}
function formatHealthTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value;
}

// src/feishu-settings.ts
var import_obsidian3 = require("obsidian");

// src/feishu-base-picker.ts
function isFeishuUrl(value) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && /(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/i.test(url.hostname);
  } catch {
    return false;
  }
}
function parseBaseLookupPayload(payload) {
  const data = payload?.data ?? payload ?? {};
  const baseToken = identifier(data.base_token);
  const tableId = identifier(data.table_id || (data.block_type === "table" ? data.block_id : ""));
  const viewId = identifier(data.view_id);
  if (baseToken && tableId && viewId) {
    const baseTitle = display(data.title || "\u591A\u7EF4\u8868\u683C");
    const tableName = display(data.block_name || "\u6570\u636E\u8868");
    const viewName = display(data.view_name || "\u6240\u9009\u89C6\u56FE");
    return { kind: "resolved", selection: createBaseSelection({
      baseToken,
      tableId,
      viewId,
      label: readableSelectionLabel(baseTitle, tableName, viewName)
    }) };
  }
  const candidates = (Array.isArray(data.candidates) ? data.candidates : []).map((item) => ({
    baseToken: identifier(item?.base_token),
    title: display(item?.title || "\u672A\u547D\u540D\u591A\u7EF4\u8868\u683C"),
    ownerName: display(item?.owner_name || ""),
    url: safeUrl2(item?.url)
  })).filter((item) => item.baseToken).slice(0, 20);
  if (candidates.length === 0 && baseToken) {
    candidates.push({ baseToken, title: display(data.title || "\u591A\u7EF4\u8868\u683C"), ownerName: "", url: "" });
  }
  return { kind: "candidates", candidates };
}
function parseBaseTablesPayload(payload) {
  const data = payload?.data ?? payload ?? {};
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data.tables) ? data.tables : Array.isArray(data.blocks) ? data.blocks : [];
  return items.filter((item) => !item?.type || item.type === "table").map((item) => ({
    id: identifier(item?.table_id || item?.id),
    name: display(item?.name || item?.table_name || "\u672A\u547D\u540D\u6570\u636E\u8868")
  })).filter((item) => item.id).slice(0, 100);
}
function parseRecentBasesPayload(payload) {
  const data = payload?.data ?? payload ?? {};
  return (Array.isArray(data.results) ? data.results : []).map((item) => {
    const meta = item?.result_meta ?? {};
    const iconToken = parseIconToken(meta.icon_info);
    const url = safeUrl2(meta.url);
    return {
      baseToken: identifier(iconToken || baseTokenFromUrl(url) || meta.base_token),
      title: display(stripMarkup(item?.title_highlighted || meta.title || "\u672A\u547D\u540D\u591A\u7EF4\u8868\u683C")),
      ownerName: display(meta.owner_name || ""),
      url
    };
  }).filter((item) => item.baseToken).slice(0, 20);
}
function parseBaseViewsPayload(payload) {
  const data = payload?.data ?? payload ?? {};
  return (Array.isArray(data.views) ? data.views : []).map((item) => ({ id: identifier(item?.id), name: display(item?.name || "\u672A\u547D\u540D\u89C6\u56FE"), type: identifier(item?.type) })).filter((item) => item.id).slice(0, 200);
}
function createBaseSelection(input) {
  const baseToken = identifier(input.baseToken);
  const tableId = identifier(input.tableId);
  const viewId = identifier(input.viewId);
  if (!baseToken || !tableId || !viewId) throw new Error("\u8BF7\u9009\u62E9\u5B8C\u6574\u7684\u6570\u636E\u8868\u548C\u89C6\u56FE");
  return {
    selection_key: `${baseToken}:${tableId}:${viewId}`,
    base_token: baseToken,
    table_id: tableId,
    view_id: viewId,
    label: display(input.label || "\u5DF2\u9009 Base \u89C6\u56FE"),
    field_ids: []
  };
}
function readableSelectionLabel(base, table, view) {
  return [base, table, view].map(display).filter(Boolean).join(" / ") || "\u5DF2\u9009 Base \u89C6\u56FE";
}
function identifier(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 300);
}
function display(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
}
function safeUrl2(value) {
  const result2 = String(value || "").trim();
  return isFeishuUrl(result2) ? result2 : "";
}
function parseIconToken(value) {
  try {
    return identifier(JSON.parse(String(value || "{}"))?.token);
  } catch {
    return "";
  }
}
function baseTokenFromUrl(value) {
  try {
    const match2 = new URL(value).pathname.match(/\/(?:base|app)\/([A-Za-z0-9._:-]+)/i);
    return identifier(match2?.[1]);
  } catch {
    return "";
  }
}
function stripMarkup(value) {
  return String(value || "").replace(/<[^>]*>/g, "");
}

// src/feishu-chat-picker.ts
function parseChatCandidatesPayload(payload) {
  const data = payload?.data ?? payload ?? {};
  const chats = Array.isArray(data.chats) ? data.chats : Array.isArray(data.items) ? data.items : [];
  const results = chats.filter((item) => item?.chat_mode !== "p2p" && item?.chat_status !== "dissolved").map((item) => ({
    chatId: identifier2(item?.chat_id),
    name: display2(item?.name || "\u672A\u547D\u540D\u7FA4\u804A"),
    external: item?.external === true
  })).filter((item) => item.chatId && item.name);
  const unique3 = /* @__PURE__ */ new Map();
  for (const item of results) if (!unique3.has(item.chatId)) unique3.set(item.chatId, item);
  return [...unique3.values()].slice(0, 50);
}
function createChatSelection(candidate) {
  const chatId = identifier2(candidate.chatId);
  if (!chatId) throw new Error("\u8BF7\u9009\u62E9\u6709\u6548\u7684\u9879\u76EE\u7FA4");
  return {
    selection_key: chatId,
    chat_id: chatId,
    query: "",
    label: display2(candidate.name || "\u5DF2\u9009\u9879\u76EE\u7FA4"),
    type: "project_group"
  };
}
function identifier2(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 300);
}
function display2(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
}

// src/feishu-cli-result.ts
var FeishuCliError = class extends Error {
  constructor(message2, issue, actionUrl = "") {
    super(message2);
    this.issue = issue;
    this.actionUrl = actionUrl;
    this.name = "FeishuCliError";
  }
  issue;
  actionUrl;
};
function parseFeishuCliPayload(value) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end < start) throw new FeishuCliError("\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u53EF\u8BC6\u522B\u7684\u7ED3\u679C\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", "other");
  let payload;
  try {
    payload = JSON.parse(value.slice(start, end + 1));
  } catch {
    throw new FeishuCliError("\u98DE\u4E66\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u7ED3\u679C\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", "other");
  }
  if (payload?.ok === false) throw cliError(payload.error || {});
  return payload;
}
function readFeishuUserAuthorization(payload) {
  const data = payload?.data ?? payload ?? {};
  const user = data.identities?.user ?? payload?.identities?.user ?? data.user ?? {};
  const status = String(user.status || "").toLowerCase();
  const tokenStatus = String(user.tokenStatus || user.token_status || "").toLowerCase();
  const missing = /missing|expired|invalid|logged.?out/.test(`${status} ${tokenStatus}`);
  const ready = payload?.ok !== false && data.verified !== false && user.available !== false && !missing && (user.available === true || status === "ready" || Boolean(user.userName || user.name));
  const label = cleanLabel(user.userName || user.name || user.display_name);
  const scopeKnown = Object.prototype.hasOwnProperty.call(user, "scope") || Object.prototype.hasOwnProperty.call(user, "scopes");
  const rawScopes = user.scope ?? user.scopes ?? [];
  const grantedScopes = [...new Set((Array.isArray(rawScopes) ? rawScopes : String(rawScopes).split(/[\s,]+/)).map((scope) => String(scope || "").trim()).filter((scope) => /^[a-z][a-z0-9_.:-]{1,100}$/i.test(scope)))].sort();
  return {
    ready,
    ...label ? { label } : {},
    message: ready ? "\u4E2A\u4EBA\u6388\u6743\u53EF\u7528" : "\u9700\u8981\u5148\u5B8C\u6210\u4E2A\u4EBA\u6388\u6743\uFF0C\u624D\u80FD\u67E5\u627E\u7FA4\u804A\u548C\u591A\u7EF4\u8868\u683C",
    scopeKnown,
    grantedScopes
  };
}
function missingFeishuAuthorizationScopes(state, requiredScopes) {
  if (!state.ready || !state.scopeKnown) return [];
  const granted = new Set(state.grantedScopes);
  return [...new Set(requiredScopes)].filter((scope) => !granted.has(scope)).sort();
}
function isFeishuAuthorizationRequired(error) {
  return error instanceof FeishuCliError && error.issue === "authorization_required";
}
function feishuAppPermissionUrl(error) {
  return error instanceof FeishuCliError && error.issue === "app_permission_required" ? error.actionUrl : "";
}
function withFeishuAppPermissionScopes(error, scopes, message2) {
  if (!(error instanceof FeishuCliError) || error.issue !== "app_permission_required") return error;
  return new FeishuCliError(message2, error.issue, expandFeishuPermissionUrl(error.actionUrl, scopes));
}
function expandFeishuPermissionUrl(value, scopes) {
  const safe = safeFeishuPermissionUrl(value);
  if (!safe) return "";
  const url = new URL(safe);
  const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter((scope) => /^[a-z][a-z0-9_.:-]{1,100}$/i.test(scope)))];
  if (normalized.length > 0) url.searchParams.set("scopes", normalized.join(","));
  return url.toString();
}
function safeFeishuPermissionUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    if (!(/* @__PURE__ */ new Set(["open.feishu.cn", "open.larksuite.com"])).has(url.hostname.toLowerCase())) return "";
    if (url.pathname !== "/page/scope-apply") return "";
    return url.toString();
  } catch {
    return "";
  }
}
function cliError(error) {
  const type = String(error?.type || "").toLowerCase();
  const subtype = String(error?.subtype || "").toLowerCase();
  const message2 = String(error?.message || "").toLowerCase();
  const combined = `${type} ${subtype} ${message2}`;
  if (/app_scope_not_applied/.test(combined)) {
    return new FeishuCliError(
      "\u98DE\u4E66\u5E94\u7528\u5C1A\u672A\u5F00\u901A\u6240\u9009\u5185\u5BB9\u7684\u53EA\u8BFB\u6743\u9650",
      "app_permission_required",
      safeFeishuPermissionUrl(error?.console_url || error?.consoleUrl)
    );
  }
  if (/token_missing|need_user_authorization|missing_scope|authorization_required|user identity.*missing/.test(combined)) {
    return new FeishuCliError("\u9700\u8981\u5148\u6388\u6743\u98DE\u4E66\uFF0C\u624D\u80FD\u67E5\u627E\u7FA4\u804A\u548C\u591A\u7EF4\u8868\u683C", "authorization_required");
  }
  if (/authorization_pending|authorization.*pending|尚未.*授权|not.*authoriz/.test(combined)) {
    return new FeishuCliError("\u7F51\u9875\u6388\u6743\u5C1A\u672A\u5B8C\u6210\uFF0C\u8BF7\u5148\u5728\u98DE\u4E66\u9875\u9762\u540C\u610F\u6388\u6743", "authorization_pending");
  }
  if (/rate.?limit|too many requests|\b429\b/.test(combined)) {
    return new FeishuCliError("\u98DE\u4E66\u67E5\u8BE2\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5", "rate_limit");
  }
  if (/permission|forbidden|91403|2091005/.test(combined)) {
    return new FeishuCliError("\u5F53\u524D\u98DE\u4E66\u8D26\u53F7\u65E0\u6743\u8BFB\u53D6\u8FD9\u9879\u5185\u5BB9", "permission");
  }
  return new FeishuCliError("\u98DE\u4E66\u6682\u65F6\u65E0\u6CD5\u5B8C\u6210\u8FD9\u6B21\u53EA\u8BFB\u67E5\u8BE2\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", "other");
}
function cleanLabel(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 80);
}

// src/feishu-authorization-flow.ts
async function runFeishuAuthorizationFlow(input) {
  await input.begin();
  input.onWaiting();
  await input.complete();
  return input.readState();
}

// src/feishu-settings.ts
var MODULES = [
  ["tasks", "\u6211\u7684\u4EFB\u52A1", "\u5206\u914D\u7ED9\u6211\u7684\u4EFB\u52A1\u53CA\u72B6\u6001\u53D8\u5316"],
  ["calendar", "\u65E5\u7A0B", "\u6211\u53C2\u52A0\u7684\u65E5\u7A0B"],
  ["meetings", "\u4F1A\u8BAE", "\u6211\u53C2\u52A0\u8FC7\u7684\u4F1A\u8BAE\u548C\u7ED3\u679C"],
  ["minutes", "\u4F1A\u8BAE\u7EAA\u8981\u4E0E\u5999\u8BB0", "\u6709\u6743\u8BBF\u95EE\u7684\u603B\u7ED3\u3001\u5F85\u529E\u548C\u51B3\u7B56"],
  ["documents", "\u6587\u6863\u4E0E Wiki", "\u6211\u521B\u5EFA\u6216\u660E\u663E\u7F16\u8F91\u8FC7\u7684\u8D44\u6599"],
  ["base", "\u591A\u7EF4\u8868\u683C", "\u660E\u786E\u9009\u62E9\u7684 Base \u89C6\u56FE"],
  ["approvals", "\u5BA1\u6279\u7ED3\u679C", "\u4E0E\u6211\u6709\u5173\u7684\u5DF2\u529E\u548C\u5DF2\u53D1\u8D77\u7ED3\u679C"],
  ["messages", "\u9879\u76EE\u7FA4\u6D88\u606F", "\u660E\u786E\u9009\u62E9\u7684\u9879\u76EE\u7FA4\u4E2D\u7684\u5DE5\u4F5C\u7ED3\u8BBA"]
];
var FeishuSetupModal = class extends import_obsidian3.Modal {
  constructor(app, suite) {
    super(app);
    this.suite = suite;
  }
  suite;
  step = 0;
  config;
  authorizationStarted = false;
  authorizationReady = false;
  authorizationLabel = "";
  authorizationScopeKnown = false;
  authorizationScopes = [];
  busy = false;
  chatQuery = "";
  chatCandidates = [];
  chatLookupMessage = "";
  baseQuery = "";
  baseCandidates = [];
  baseTables = [];
  baseViews = [];
  pickerBase;
  selectedTableId = "";
  selectedViewId = "";
  baseLookupMessage = "";
  appPermissionUrl = "";
  onOpen() {
    this.modalEl.addClass("zhixing-feishu-modal");
    void this.load();
  }
  onClose() {
    this.contentEl.empty();
  }
  async load() {
    this.config = await this.suite.getFeishuConfig();
    await this.refreshAuthorization();
    this.render();
  }
  render() {
    const root = this.contentEl;
    root.empty();
    const heading = root.createDiv({ cls: "zhixing-feishu-heading" });
    const icon = heading.createSpan({ cls: "zhixing-feishu-icon" });
    (0, import_obsidian3.setIcon)(icon, "message-square-more");
    const title = heading.createDiv();
    title.createEl("h2", { text: "\u8FDE\u63A5\u98DE\u4E66" });
    title.createDiv({ cls: "zhixing-feishu-step-label", text: `${this.step + 1} / 5 \xB7 ${stepTitle(this.step)}` });
    const progress = root.createDiv({ cls: "zhixing-feishu-progress" });
    for (let index = 0; index < 5; index += 1) progress.createSpan({ cls: index <= this.step ? "is-active" : "" });
    const body = root.createDiv({ cls: "zhixing-feishu-body" });
    if (!this.config) {
      body.createDiv({ cls: "zhixing-feishu-loading", text: "\u6B63\u5728\u8BFB\u53D6\u8FDE\u63A5\u72B6\u6001\u2026" });
      return;
    }
    if (this.step === 0) this.renderConnect(body);
    else if (this.step === 1) this.renderModules(body);
    else if (this.step === 2) this.renderSelections(body);
    else if (this.step === 3) this.renderPreview(body);
    else this.renderConfirm(body);
    this.renderActions(root);
  }
  renderConnect(parent) {
    const health = this.suite.snapshot().feishu;
    const statusKind = health.cli === "missing" ? "unavailable" : this.authorizationReady ? "ready" : "attention";
    const status = parent.createDiv({ cls: `zhixing-feishu-status is-${statusKind}` });
    const statusIcon = status.createSpan();
    (0, import_obsidian3.setIcon)(statusIcon, health.cli === "missing" ? "triangle-alert" : this.authorizationReady ? "badge-check" : "shield-alert");
    const statusText = status.createDiv();
    statusText.createEl("strong", { text: health.cli === "missing" ? "\u672A\u68C0\u6D4B\u5230 lark-cli" : this.authorizationReady ? `${this.authorizationLabel || "\u98DE\u4E66"}\u5DF2\u6388\u6743` : "\u9700\u8981\u6388\u6743\u98DE\u4E66" });
    statusText.createSpan({ text: health.cli === "missing" ? "\u8BF7\u5148\u5B89\u88C5\u6700\u65B0\u7248 lark-cli\uFF0C\u518D\u56DE\u5230\u8FD9\u91CC\u68C0\u6D4B\u3002" : this.authorizationReady ? health.message : "\u9009\u62E9\u6A21\u5757\u540E\uFF0C\u53EF\u5728\u4E0B\u4E00\u6B65\u5B8C\u6210\u4E2A\u4EBA\u6388\u6743\u3002" });
    const refresh = parent.createEl("button", { text: "\u91CD\u65B0\u68C0\u6D4B" });
    refresh.disabled = this.busy;
    refresh.addEventListener("click", () => void this.refresh());
    if (health.enabled) {
      const pause = parent.createEl("button", { text: "\u6682\u505C\u98DE\u4E66\u540C\u6B65" });
      pause.addEventListener("click", () => void this.pause());
      const cache = parent.createEl("button", { cls: "mod-warning", text: "\u6E05\u7406\u98DE\u4E66\u672C\u5730\u7F13\u5B58" });
      cache.addEventListener("click", () => void this.clearCache());
    }
    parent.createDiv({ cls: "zhixing-feishu-privacy", text: "\u6388\u6743\u7531\u98DE\u4E66\u5B98\u65B9 CLI \u4FDD\u7BA1\u3002\u77E5\u884C\u53F0\u4E0D\u4FDD\u5B58 access token\uFF0C\u4E5F\u4E0D\u4F1A\u5411\u98DE\u4E66\u5199\u5165\u5185\u5BB9\u3002" });
  }
  renderModules(parent) {
    for (const [key, label, description] of MODULES) {
      new import_obsidian3.Setting(parent).setName(label).setDesc(description).addToggle((toggle) => toggle.setValue(Boolean(this.config?.modules[key])).onChange((value) => {
        if (this.config) this.config.modules[key] = value;
      }));
    }
  }
  renderSelections(parent) {
    if (!this.authorizationReady || this.missingAuthorizationScopes().length > 0) {
      this.renderAuthorizationGate(parent);
      this.renderAppPermissionAction(parent);
      parent.createDiv({ cls: "zhixing-feishu-privacy", text: "\u5B8C\u6210\u6388\u6743\u540E\uFF0C\u624D\u4F1A\u663E\u793A\u7FA4\u804A\u548C\u591A\u7EF4\u8868\u683C\u9009\u62E9\u3002\u79C1\u804A\u4E0E\u672A\u9009\u62E9\u7684\u5185\u5BB9\u4E0D\u4F1A\u8FDB\u5165\u77E5\u884C\u53F0\u3002" });
      return;
    }
    if (this.config?.modules.messages) {
      const group = parent.createDiv({ cls: "zhixing-feishu-selection" });
      group.createEl("h3", { text: "\u9879\u76EE\u7FA4" });
      group.createDiv({ text: "\u8F93\u5165\u7FA4\u540D\u67E5\u627E\uFF0C\u6216\u4ECE\u6700\u8FD1\u4F7F\u7528\u7684\u9879\u76EE\u7FA4\u4E2D\u76F4\u63A5\u9009\u62E9\u3002" });
      this.renderSelectedChats(group);
      const lookup = group.createDiv({ cls: "zhixing-feishu-chat-lookup" });
      const input = lookup.createEl("input", { type: "text", placeholder: "\u4F8B\u5982\uFF1AAI\u7814\u53D1\u5C0F\u7EC4" });
      input.value = this.chatQuery;
      input.disabled = this.busy || !this.authorizationReady;
      input.addEventListener("input", () => {
        this.chatQuery = input.value;
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.lookupChat();
        }
      });
      const search = lookup.createEl("button", { text: this.busy ? "\u6B63\u5728\u67E5\u627E" : "\u67E5\u627E" });
      search.disabled = this.busy || !this.authorizationReady;
      search.addEventListener("click", () => void this.lookupChat());
      const recent = lookup.createEl("button", { text: "\u6700\u8FD1\u4F7F\u7528" });
      recent.disabled = this.busy || !this.authorizationReady;
      recent.addEventListener("click", () => void this.browseRecentChats());
      this.renderChatCandidates(group);
      if (this.chatLookupMessage) group.createDiv({ cls: "zhixing-feishu-chat-message", text: this.chatLookupMessage });
    }
    if (this.config?.modules.base) {
      const base = parent.createDiv({ cls: "zhixing-feishu-selection" });
      base.createEl("h3", { text: "\u591A\u7EF4\u8868\u683C" });
      base.createDiv({ text: "\u8F93\u5165\u540D\u79F0\u67E5\u627E\uFF0C\u6216\u76F4\u63A5\u7C98\u8D34\u98DE\u4E66\u4E2D\u7684\u591A\u7EF4\u8868\u683C\u94FE\u63A5\u3002\u77E5\u8BC6\u5E93\u94FE\u63A5\u4E5F\u53EF\u4EE5\u3002" });
      this.renderSelectedBases(base);
      const lookup = base.createDiv({ cls: "zhixing-feishu-base-lookup" });
      const input = lookup.createEl("input", { type: "text", placeholder: "\u4F8B\u5982\uFF1AAI \u5F00\u53D1\u4EFB\u52A1\uFF1B\u4E5F\u53EF\u4EE5\u7C98\u8D34\u98DE\u4E66\u94FE\u63A5" });
      input.value = this.baseQuery;
      input.disabled = this.busy || !this.authorizationReady;
      input.addEventListener("input", () => {
        this.baseQuery = input.value;
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.lookupBase();
        }
      });
      const search = lookup.createEl("button", { text: this.busy ? "\u6B63\u5728\u67E5\u627E" : "\u67E5\u627E" });
      search.disabled = this.busy || !this.authorizationReady;
      search.addEventListener("click", () => void this.lookupBase());
      const recent = lookup.createEl("button", { text: "\u6700\u8FD1\u4F7F\u7528" });
      recent.disabled = this.busy || !this.authorizationReady;
      recent.addEventListener("click", () => void this.browseRecentBases());
      this.renderBaseCandidates(base);
      this.renderBasePicker(base);
      if (this.baseLookupMessage) base.createDiv({ cls: "zhixing-feishu-base-message", text: this.baseLookupMessage });
      this.renderAppPermissionAction(base, Boolean(this.pickerBase));
    }
    if (!this.config?.modules.messages && !this.config?.modules.base) {
      const empty = parent.createDiv({ cls: "zhixing-feishu-empty" });
      (0, import_obsidian3.setIcon)(empty.createSpan(), "list-checks");
      empty.createSpan({ text: "\u5F53\u524D\u6A21\u5757\u4E0D\u9700\u8981\u989D\u5916\u9009\u62E9\u8303\u56F4" });
    }
    parent.createDiv({ cls: "zhixing-feishu-privacy", text: "\u79C1\u804A\u3001\u672A\u9009\u62E9\u7684\u7FA4\u548C\u672A\u9009\u62E9\u7684 Base \u9ED8\u8BA4\u4E0D\u4F1A\u8FDB\u5165\u77E5\u884C\u53F0\u3002" });
  }
  renderPreview(parent) {
    const enabled = MODULES.filter(([key]) => this.config?.modules[key]);
    const summary = parent.createDiv({ cls: "zhixing-feishu-preview" });
    summary.createEl("h3", { text: `\u5C06\u5F00\u542F ${enabled.length} \u4E2A\u53EA\u8BFB\u6A21\u5757` });
    for (const [, label, description] of enabled) {
      const row = summary.createDiv();
      (0, import_obsidian3.setIcon)(row.createSpan(), "check");
      row.createDiv().createEl("strong", { text: label });
      row.createSpan({ text: description });
    }
    if (this.config?.modules.messages) {
      const policy = parent.createDiv({ cls: "zhixing-feishu-policy" });
      (0, import_obsidian3.setIcon)(policy.createSpan(), "shield-check");
      policy.createSpan({ text: "\u6D88\u606F\u53EA\u4FDD\u7559\u63D0\u53CA\u4F60\u3001\u4F60\u53D1\u51FA\u7684\u5DE5\u4F5C\u7ED3\u8BBA\uFF0C\u6216\u542B\u660E\u786E\u4EFB\u52A1\u3001\u51B3\u7B56\u3001\u95EE\u9898\u3001\u65B9\u6848\u4E0E\u4EA4\u4ED8\u94FE\u63A5\u7684\u5185\u5BB9\u3002" });
    }
    const health = this.suite.snapshot().feishu;
    if (health.cli !== "missing") {
      const missingScopes = this.missingAuthorizationScopes();
      if (this.authorizationReady && missingScopes.length === 0) {
        const ready = parent.createDiv({ cls: "zhixing-feishu-status is-ready" });
        (0, import_obsidian3.setIcon)(ready.createSpan(), "badge-check");
        const copy = ready.createDiv();
        copy.createEl("strong", { text: "\u6240\u9009\u6A21\u5757\u6743\u9650\u5DF2\u5C31\u7EEA" });
        copy.createSpan({ text: "\u65E0\u9700\u518D\u6B21\u6388\u6743\uFF0C\u53EF\u4EE5\u76F4\u63A5\u8FDB\u5165\u4E0B\u4E00\u6B65\u3002" });
      } else {
        const auth = parent.createEl("button", {
          cls: "mod-cta zhixing-feishu-primary",
          text: this.authorizationStarted ? "\u6B63\u5728\u7B49\u5F85\u98DE\u4E66\u6388\u6743" : this.authorizationReady ? "\u8865\u5145\u6240\u9009\u6A21\u5757\u6743\u9650" : "\u8FDE\u63A5\u98DE\u4E66"
        });
        auth.disabled = this.busy;
        auth.addEventListener("click", () => void this.authorize());
      }
    }
    this.renderAppPermissionAction(parent);
  }
  renderConfirm(parent) {
    const summary = parent.createDiv({ cls: "zhixing-feishu-confirm" });
    metric(summary, "\u6A21\u5757", String(Object.values(this.config?.modules || {}).filter(Boolean).length));
    metric(summary, "\u9879\u76EE\u7FA4", String(this.config?.selected_chats.length || 0));
    metric(summary, "Base \u89C6\u56FE", String(this.config?.selected_bases.length || 0));
    metric(summary, "\u540C\u6B65\u95F4\u9694", `${this.config?.sync_interval_minutes || 60} \u5206\u949F`);
    new import_obsidian3.Setting(parent).setName("\u5F00\u542F\u98DE\u4E66\u53EA\u8BFB\u540C\u6B65").setDesc("\u9519\u8FC7\u540C\u6B65\u540E\u4F1A\u5728 Obsidian \u4E0B\u6B21\u542F\u52A8\u65F6\u8865\u8DD1").addToggle((toggle) => toggle.setValue(Boolean(this.config?.enabled)).onChange((value) => {
      if (this.config) this.config.enabled = value;
    }));
    const interval = new import_obsidian3.Setting(parent).setName("\u540C\u6B65\u95F4\u9694");
    interval.addDropdown((dropdown) => dropdown.addOptions({ "30": "30 \u5206\u949F", "60": "1 \u5C0F\u65F6", "120": "2 \u5C0F\u65F6", "360": "6 \u5C0F\u65F6" }).setValue(String(this.config?.sync_interval_minutes || 60)).onChange((value) => {
      if (this.config) this.config.sync_interval_minutes = Number(value);
    }));
    if (!this.authorizationReady) parent.createDiv({ cls: "zhixing-feishu-warning", text: "\u5C1A\u672A\u5B8C\u6210\u4E2A\u4EBA\u6388\u6743\uFF0C\u98DE\u4E66\u540C\u6B65\u6682\u65F6\u4E0D\u4F1A\u542F\u52A8\u3002" });
  }
  renderActions(parent) {
    const actions = parent.createDiv({ cls: "zhixing-feishu-actions" });
    const close = actions.createEl("button", { text: "\u53D6\u6D88" });
    close.addEventListener("click", () => this.close());
    if (this.step > 0) {
      const back = actions.createEl("button", { text: "\u4E0A\u4E00\u6B65" });
      back.addEventListener("click", () => {
        this.step -= 1;
        this.render();
      });
    }
    const next = actions.createEl("button", { cls: "mod-cta", text: this.step === 4 ? "\u786E\u8BA4\u5F00\u542F" : "\u4E0B\u4E00\u6B65" });
    next.disabled = this.busy;
    next.addEventListener("click", () => void this.next());
  }
  async next() {
    if (!this.config) return;
    if (this.step === 1 && !Object.values(this.config.modules).some(Boolean)) {
      new import_obsidian3.Notice("\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u98DE\u4E66\u6A21\u5757");
      return;
    }
    if (this.step === 2) {
      if (this.config.modules.messages && this.config.selected_chats.length === 0) {
        new import_obsidian3.Notice("\u5DF2\u5F00\u542F\u9879\u76EE\u7FA4\u6D88\u606F\uFF0C\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u9879\u76EE\u7FA4");
        return;
      }
      if (this.config.modules.base && this.config.selected_bases.length === 0) {
        new import_obsidian3.Notice("\u5DF2\u5F00\u542F Base\uFF0C\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A Base \u89C6\u56FE");
        return;
      }
    }
    if (this.step < 4) {
      this.step += 1;
      if (this.step === 4) this.config.enabled = true;
      this.render();
      return;
    }
    this.busy = true;
    await this.suite.saveFeishuConfig(this.config);
    if (this.config.enabled) await this.suite.runFeishuSyncNow(true);
    this.close();
  }
  async authorize() {
    if (!this.config || this.busy) return;
    this.busy = true;
    this.appPermissionUrl = "";
    this.render();
    try {
      const status = await runFeishuAuthorizationFlow({
        begin: async () => {
          await this.suite.beginFeishuAuthorization(this.config);
        },
        onWaiting: () => {
          this.authorizationStarted = true;
          this.render();
          new import_obsidian3.Notice("\u8BF7\u5728\u98DE\u4E66\u5B98\u65B9\u9875\u9762\u786E\u8BA4\uFF0C\u5B8C\u6210\u540E\u8FD9\u91CC\u4F1A\u81EA\u52A8\u8FDE\u63A5");
        },
        complete: async () => {
          await this.suite.completeFeishuAuthorization();
        },
        readState: async () => this.suite.getFeishuUserAuthorization()
      });
      this.applyAuthorizationState(status);
      if (!this.authorizationReady) throw new Error("\u98DE\u4E66\u6CA1\u6709\u786E\u8BA4\u6388\u6743\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5");
      this.chatLookupMessage = "";
      this.baseLookupMessage = "";
      new import_obsidian3.Notice("\u98DE\u4E66\u5DF2\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u5F00\u59CB\u9009\u62E9\u5185\u5BB9");
    } catch (error) {
      const message2 = this.lookupError(error);
      new import_obsidian3.Notice(message2);
    } finally {
      this.authorizationStarted = false;
      this.busy = false;
      this.render();
    }
  }
  renderAuthorizationGate(parent) {
    const supplement = this.authorizationReady && this.missingAuthorizationScopes().length > 0;
    const gate = parent.createDiv({ cls: "zhixing-feishu-authorization-gate" });
    (0, import_obsidian3.setIcon)(gate.createSpan(), "shield-check");
    const copy = gate.createDiv();
    copy.createEl("strong", { text: this.authorizationStarted ? "\u7B49\u5F85\u98DE\u4E66\u786E\u8BA4" : supplement ? "\u8865\u5145\u6240\u9009\u6A21\u5757\u6743\u9650" : "\u8FDE\u63A5\u98DE\u4E66\u540E\u9009\u62E9\u5185\u5BB9" });
    copy.createSpan({ text: this.authorizationStarted ? "\u8BF7\u5728\u521A\u6253\u5F00\u7684\u98DE\u4E66\u5B98\u65B9\u9875\u9762\u540C\u610F\u6388\u6743\uFF0C\u5B8C\u6210\u540E\u8FD9\u91CC\u4F1A\u81EA\u52A8\u8FDE\u63A5\u3002" : supplement ? "\u5F53\u524D\u8D26\u53F7\u5DF2\u8FDE\u63A5\uFF0C\u4F46\u65B0\u9009\u62E9\u7684\u6A21\u5757\u8FD8\u7F3A\u5C11\u53EA\u8BFB\u6743\u9650\u3002\u8865\u5145\u5B8C\u6210\u540E\u4F1A\u81EA\u52A8\u7EE7\u7EED\u3002" : "\u70B9\u51FB\u4E00\u6B21\u5373\u53EF\u6253\u5F00\u98DE\u4E66\u5B98\u65B9\u6388\u6743\u9875\u3002\u6388\u6743\u5B8C\u6210\u540E\uFF0C\u7FA4\u804A\u548C\u591A\u7EF4\u8868\u683C\u9009\u62E9\u4F1A\u81EA\u52A8\u51FA\u73B0\u3002" });
    const button = gate.createEl("button", {
      cls: "mod-cta",
      text: this.authorizationStarted ? "\u6B63\u5728\u7B49\u5F85\u6388\u6743" : supplement ? "\u8865\u5145\u6743\u9650" : "\u8FDE\u63A5\u98DE\u4E66"
    });
    button.disabled = this.busy || this.authorizationStarted;
    button.addEventListener("click", () => void this.authorize());
  }
  async refreshAuthorization() {
    try {
      const status = await this.suite.getFeishuUserAuthorization();
      this.applyAuthorizationState(status);
    } catch {
      this.authorizationReady = false;
      this.authorizationLabel = "";
      this.authorizationScopeKnown = false;
      this.authorizationScopes = [];
    }
  }
  applyAuthorizationState(status) {
    this.authorizationReady = status.ready;
    this.authorizationLabel = status.label || "";
    this.authorizationScopeKnown = status.scopeKnown;
    this.authorizationScopes = status.grantedScopes;
  }
  missingAuthorizationScopes() {
    if (!this.config) return [];
    return missingFeishuAuthorizationScopes({
      ready: this.authorizationReady,
      label: this.authorizationLabel,
      message: "",
      scopeKnown: this.authorizationScopeKnown,
      grantedScopes: this.authorizationScopes
    }, this.suite.getRequiredFeishuScopes(this.config));
  }
  lookupError(error) {
    const permissionUrl = feishuAppPermissionUrl(error);
    if (permissionUrl) this.appPermissionUrl = permissionUrl;
    if (isFeishuAuthorizationRequired(error)) {
      this.authorizationReady = false;
      this.authorizationScopeKnown = false;
      this.authorizationScopes = [];
      return "\u9700\u8981\u5148\u6388\u6743\u98DE\u4E66\uFF0C\u624D\u80FD\u67E5\u627E\u7FA4\u804A\u548C\u591A\u7EF4\u8868\u683C";
    }
    return error instanceof Error ? error.message : "\u98DE\u4E66\u6682\u65F6\u65E0\u6CD5\u5B8C\u6210\u8FD9\u6B21\u53EA\u8BFB\u67E5\u8BE2\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
  }
  renderAppPermissionAction(parent, allowRetry = false) {
    if (!this.appPermissionUrl) return;
    const action = parent.createDiv({ cls: "zhixing-feishu-app-permission" });
    (0, import_obsidian3.setIcon)(action.createSpan(), "shield-alert");
    const copy = action.createDiv();
    copy.createEl("strong", { text: "\u9700\u8981\u5F00\u901A\u98DE\u4E66\u5E94\u7528\u6743\u9650" });
    copy.createSpan({ text: "\u5728\u98DE\u4E66\u5B98\u65B9\u9875\u9762\u4E00\u6B21\u5F00\u901A\u591A\u7EF4\u8868\u683C\u7684\u8868\u3001\u89C6\u56FE\u548C\u8BB0\u5F55\u53EA\u8BFB\u6743\u9650\u3002\u5B8C\u6210\u540E\u56DE\u5230\u8FD9\u91CC\u91CD\u65B0\u8BFB\u53D6\u3002" });
    const buttons = action.createDiv();
    const open3 = buttons.createEl("button", { cls: "mod-cta", text: "\u5728\u98DE\u4E66\u4E2D\u5F00\u901A" });
    open3.disabled = this.busy;
    open3.addEventListener("click", () => void this.openAppPermissionPage());
    if (allowRetry) {
      const retry = buttons.createEl("button", { text: "\u91CD\u65B0\u8BFB\u53D6" });
      retry.disabled = this.busy;
      retry.addEventListener("click", () => {
        if (this.pickerBase) void this.chooseBase(this.pickerBase);
      });
    }
  }
  async openAppPermissionPage() {
    try {
      await this.suite.openFeishuPermissionPage(this.appPermissionUrl);
      this.baseLookupMessage = "\u5DF2\u6253\u5F00\u98DE\u4E66\u5B98\u65B9\u6743\u9650\u9875\u9762\u3002\u5B8C\u6210\u5F00\u901A\u540E\uFF0C\u56DE\u5230\u8FD9\u91CC\u70B9\u51FB\u201C\u91CD\u65B0\u8BFB\u53D6\u201D\u3002";
      new import_obsidian3.Notice("\u5DF2\u6253\u5F00\u98DE\u4E66\u5B98\u65B9\u6743\u9650\u9875\u9762");
    } catch (error) {
      new import_obsidian3.Notice(error instanceof Error ? error.message : String(error));
    }
    this.render();
  }
  renderSelectedChats(parent) {
    if (!this.config?.selected_chats.length) return;
    const selected = parent.createDiv({ cls: "zhixing-feishu-chat-selected" });
    for (const item of this.config.selected_chats) {
      const row = selected.createDiv();
      (0, import_obsidian3.setIcon)(row.createSpan(), "messages-square");
      row.createSpan({ text: item.label });
      const remove = row.createEl("button", { attr: { "aria-label": `\u79FB\u9664 ${item.label}` } });
      (0, import_obsidian3.setIcon)(remove, "x");
      remove.addEventListener("click", () => {
        if (!this.config) return;
        this.config.selected_chats = this.config.selected_chats.filter((value) => value.selection_key !== item.selection_key);
        this.render();
      });
    }
  }
  renderChatCandidates(parent) {
    if (this.chatCandidates.length === 0) return;
    const results = parent.createDiv({ cls: "zhixing-feishu-chat-results" });
    results.createDiv({ cls: "zhixing-feishu-chat-caption", text: "\u9009\u62E9\u4E00\u4E2A\u9879\u76EE\u7FA4" });
    for (const candidate of this.chatCandidates.slice(0, 12)) {
      const row = results.createDiv();
      const copy = row.createDiv();
      copy.createEl("strong", { text: candidate.name });
      copy.createSpan({ text: candidate.external ? "\u5916\u90E8\u7FA4" : "\u5185\u90E8\u7FA4" });
      const choose = row.createEl("button", { text: this.isChatSelected(candidate.chatId) ? "\u5DF2\u9009\u62E9" : "\u9009\u62E9" });
      choose.disabled = this.busy || this.isChatSelected(candidate.chatId);
      choose.addEventListener("click", () => this.addChat(candidate));
    }
  }
  async lookupChat() {
    if (!this.chatQuery.trim()) {
      new import_obsidian3.Notice("\u8BF7\u8F93\u5165\u9879\u76EE\u7FA4\u540D\u79F0");
      return;
    }
    this.busy = true;
    this.chatCandidates = [];
    this.chatLookupMessage = "\u6B63\u5728\u98DE\u4E66\u4E2D\u67E5\u627E\u9879\u76EE\u7FA4\u2026";
    this.render();
    try {
      this.chatCandidates = await this.suite.findFeishuChats(this.chatQuery);
      this.chatLookupMessage = this.chatCandidates.length === 1 ? "\u627E\u5230 1 \u4E2A\u9879\u76EE\u7FA4\uFF0C\u8BF7\u9009\u62E9" : `\u627E\u5230 ${this.chatCandidates.length} \u4E2A\u9879\u76EE\u7FA4\uFF0C\u8BF7\u9009\u62E9`;
    } catch (error) {
      this.chatLookupMessage = this.lookupError(error);
      new import_obsidian3.Notice(this.chatLookupMessage);
    } finally {
      this.busy = false;
      this.render();
    }
  }
  async browseRecentChats() {
    this.busy = true;
    this.chatCandidates = [];
    this.chatLookupMessage = "\u6B63\u5728\u8BFB\u53D6\u6700\u8FD1\u4F7F\u7528\u7684\u9879\u76EE\u7FA4\u2026";
    this.render();
    try {
      this.chatCandidates = await this.suite.listRecentFeishuChats();
      this.chatLookupMessage = `\u627E\u5230 ${this.chatCandidates.length} \u4E2A\u6700\u8FD1\u4F7F\u7528\u7684\u9879\u76EE\u7FA4\uFF0C\u8BF7\u9009\u62E9`;
    } catch (error) {
      this.chatLookupMessage = this.lookupError(error);
      new import_obsidian3.Notice(this.chatLookupMessage);
    } finally {
      this.busy = false;
      this.render();
    }
  }
  addChat(candidate) {
    if (!this.config) return;
    const selection = createChatSelection(candidate);
    const values = this.config.selected_chats.filter((item) => item.selection_key !== selection.selection_key);
    this.config.selected_chats = [...values, selection];
    this.chatQuery = "";
    this.chatLookupMessage = `\u5DF2\u6DFB\u52A0\uFF1A${selection.label}`;
    this.render();
  }
  isChatSelected(chatId) {
    return Boolean(this.config?.selected_chats.some((item) => item.chat_id === chatId));
  }
  renderSelectedBases(parent) {
    if (!this.config?.selected_bases.length) return;
    const selected = parent.createDiv({ cls: "zhixing-feishu-base-selected" });
    for (const item of this.config.selected_bases) {
      const row = selected.createDiv();
      (0, import_obsidian3.setIcon)(row.createSpan(), "table-2");
      row.createSpan({ text: item.label });
      const remove = row.createEl("button", { attr: { "aria-label": `\u79FB\u9664 ${item.label}` } });
      (0, import_obsidian3.setIcon)(remove, "x");
      remove.addEventListener("click", () => {
        if (!this.config) return;
        this.config.selected_bases = this.config.selected_bases.filter((value) => value.selection_key !== item.selection_key);
        this.render();
      });
    }
  }
  renderBaseCandidates(parent) {
    if (this.baseCandidates.length === 0) return;
    const results = parent.createDiv({ cls: "zhixing-feishu-base-results" });
    results.createDiv({ cls: "zhixing-feishu-base-caption", text: "\u9009\u62E9\u4E00\u4E2A\u591A\u7EF4\u8868\u683C" });
    for (const candidate of this.baseCandidates.slice(0, 8)) {
      const row = results.createDiv();
      const copy = row.createDiv();
      copy.createEl("strong", { text: candidate.title });
      if (candidate.ownerName) copy.createSpan({ text: `\u6240\u6709\u8005\uFF1A${candidate.ownerName}` });
      const choose = row.createEl("button", { text: "\u9009\u62E9" });
      choose.disabled = this.busy;
      choose.addEventListener("click", () => void this.chooseBase(candidate));
    }
  }
  renderBasePicker(parent) {
    if (!this.pickerBase || this.baseTables.length === 0) return;
    const picker = parent.createDiv({ cls: "zhixing-feishu-base-picker" });
    picker.createEl("strong", { text: this.pickerBase.title });
    const controls = picker.createDiv();
    const table = controls.createEl("select", { attr: { "aria-label": "\u9009\u62E9\u6570\u636E\u8868" } });
    for (const item of this.baseTables) table.createEl("option", { text: item.name, value: item.id });
    table.value = this.selectedTableId;
    table.disabled = this.busy;
    table.addEventListener("change", () => void this.chooseTable(table.value));
    const view = controls.createEl("select", { attr: { "aria-label": "\u9009\u62E9\u89C6\u56FE" } });
    for (const item of this.baseViews) view.createEl("option", { text: item.name, value: item.id });
    view.value = this.selectedViewId;
    view.disabled = this.busy || this.baseViews.length === 0;
    view.addEventListener("change", () => {
      this.selectedViewId = view.value;
    });
    const add = picker.createEl("button", { cls: "mod-cta", text: "\u6DFB\u52A0\u8FD9\u4E2A\u89C6\u56FE" });
    add.disabled = this.busy || !this.selectedViewId;
    add.addEventListener("click", () => this.addPickedBase());
  }
  async lookupBase() {
    if (!this.baseQuery.trim()) {
      new import_obsidian3.Notice("\u8BF7\u8F93\u5165\u591A\u7EF4\u8868\u683C\u540D\u79F0\uFF0C\u6216\u7C98\u8D34\u98DE\u4E66\u94FE\u63A5");
      return;
    }
    this.busy = true;
    this.baseCandidates = [];
    this.pickerBase = void 0;
    this.baseTables = [];
    this.baseViews = [];
    this.baseLookupMessage = "\u6B63\u5728\u98DE\u4E66\u4E2D\u67E5\u627E\u2026";
    this.render();
    try {
      const result2 = await this.suite.findFeishuBases(this.baseQuery);
      if (result2.kind === "resolved") {
        this.addBaseSelection(result2.selection);
        this.baseQuery = "";
        this.baseLookupMessage = `\u5DF2\u6DFB\u52A0\uFF1A${result2.selection.label}`;
      } else {
        this.baseCandidates = result2.candidates;
        this.baseLookupMessage = result2.candidates.length === 1 ? "\u627E\u5230 1 \u4E2A\u7ED3\u679C\uFF0C\u8BF7\u9009\u62E9" : `\u627E\u5230 ${result2.candidates.length} \u4E2A\u7ED3\u679C\uFF0C\u8BF7\u9009\u62E9`;
      }
    } catch (error) {
      this.baseLookupMessage = this.lookupError(error);
      new import_obsidian3.Notice(this.baseLookupMessage);
    } finally {
      this.busy = false;
      this.render();
    }
  }
  async browseRecentBases() {
    this.busy = true;
    this.baseCandidates = [];
    this.pickerBase = void 0;
    this.baseTables = [];
    this.baseViews = [];
    this.baseLookupMessage = "\u6B63\u5728\u8BFB\u53D6\u6700\u8FD1\u4F7F\u7528\u7684\u591A\u7EF4\u8868\u683C\u2026";
    this.render();
    try {
      this.baseCandidates = await this.suite.listRecentFeishuBases();
      this.baseLookupMessage = `\u627E\u5230 ${this.baseCandidates.length} \u4E2A\u6700\u8FD1\u4F7F\u7528\u7684\u591A\u7EF4\u8868\u683C\uFF0C\u8BF7\u9009\u62E9`;
    } catch (error) {
      this.baseLookupMessage = this.lookupError(error);
      new import_obsidian3.Notice(this.baseLookupMessage);
    } finally {
      this.busy = false;
      this.render();
    }
  }
  async chooseBase(candidate) {
    this.busy = true;
    this.appPermissionUrl = "";
    this.pickerBase = candidate;
    this.baseCandidates = [];
    this.baseTables = [];
    this.baseViews = [];
    this.baseLookupMessage = "\u6B63\u5728\u8BFB\u53D6\u6570\u636E\u8868\u548C\u89C6\u56FE\u2026";
    this.render();
    try {
      this.baseTables = await this.suite.listFeishuBaseTables(candidate.baseToken);
      this.selectedTableId = this.baseTables[0]?.id || "";
      await this.loadViews();
      this.baseLookupMessage = "\u8BF7\u9009\u62E9\u6570\u636E\u8868\u548C\u89C6\u56FE\uFF0C\u7136\u540E\u6DFB\u52A0";
    } catch (error) {
      this.baseLookupMessage = this.lookupError(error);
      new import_obsidian3.Notice(this.baseLookupMessage);
    } finally {
      this.busy = false;
      this.render();
    }
  }
  async chooseTable(tableId) {
    this.selectedTableId = tableId;
    this.busy = true;
    this.baseViews = [];
    this.baseLookupMessage = "\u6B63\u5728\u8BFB\u53D6\u89C6\u56FE\u2026";
    this.render();
    try {
      await this.loadViews();
      this.baseLookupMessage = "\u8BF7\u9009\u62E9\u6570\u636E\u8868\u548C\u89C6\u56FE\uFF0C\u7136\u540E\u6DFB\u52A0";
    } catch (error) {
      this.baseLookupMessage = this.lookupError(error);
      new import_obsidian3.Notice(this.baseLookupMessage);
    } finally {
      this.busy = false;
      this.render();
    }
  }
  async loadViews() {
    if (!this.pickerBase || !this.selectedTableId) return;
    this.baseViews = await this.suite.listFeishuBaseViews(this.pickerBase.baseToken, this.selectedTableId);
    this.selectedViewId = this.baseViews[0]?.id || "";
  }
  addPickedBase() {
    if (!this.pickerBase) return;
    const table = this.baseTables.find((item) => item.id === this.selectedTableId);
    const view = this.baseViews.find((item) => item.id === this.selectedViewId);
    const selection = createBaseSelection({
      baseToken: this.pickerBase.baseToken,
      tableId: this.selectedTableId,
      viewId: this.selectedViewId,
      label: readableSelectionLabel(this.pickerBase.title, table?.name || "\u6570\u636E\u8868", view?.name || "\u89C6\u56FE")
    });
    this.addBaseSelection(selection);
    this.baseQuery = "";
    this.pickerBase = void 0;
    this.baseTables = [];
    this.baseViews = [];
    this.baseLookupMessage = `\u5DF2\u6DFB\u52A0\uFF1A${selection.label}`;
    this.render();
  }
  addBaseSelection(selection) {
    if (!this.config) return;
    const values = this.config.selected_bases.filter((item) => item.selection_key !== selection.selection_key);
    this.config.selected_bases = [...values, selection];
  }
  async refresh() {
    this.busy = true;
    await Promise.all([this.suite.refreshHealth(), this.refreshAuthorization()]);
    this.busy = false;
    this.render();
  }
  async clearCache() {
    if (!window.confirm("\u53EA\u6E05\u7406\u672C\u673A raw/feishu \u7F13\u5B58\u548C\u540C\u6B65\u72B6\u6001\u3002\u5DF2\u7ECF\u5F62\u6210\u7684\u957F\u671F Wiki \u4F1A\u4FDD\u7559\u3002\u786E\u8BA4\u7EE7\u7EED\uFF1F")) return;
    await this.suite.clearFeishuCache();
    this.render();
  }
  async pause() {
    if (!this.config) return;
    this.config.enabled = false;
    await this.suite.saveFeishuConfig(this.config);
    new import_obsidian3.Notice("\u98DE\u4E66\u81EA\u52A8\u540C\u6B65\u5DF2\u6682\u505C\uFF0C\u5DF2\u6709\u77E5\u8BC6\u548C\u539F\u59CB\u8BB0\u5F55\u4FDD\u6301\u4E0D\u53D8");
    this.render();
  }
};
function stepTitle(step) {
  return ["\u8FDE\u63A5\u98DE\u4E66", "\u9009\u62E9\u6A21\u5757", "\u9009\u62E9\u7FA4\u804A\u4E0E Base", "\u9884\u89C8\u91C7\u96C6\u8303\u56F4", "\u786E\u8BA4\u5F00\u542F"][step] || "\u8BBE\u7F6E";
}
function metric(parent, label, value) {
  const item = parent.createDiv();
  item.createSpan({ text: label });
  item.createEl("strong", { text: value });
}

// src/view.ts
var ACTIVITY_LEDGER_VIEW_TYPE = "activity-ledger-view";
var TAB_CONFIG = [
  { id: "calendar", label: "\u65E5\u5386", icon: "calendar-days" },
  { id: "artifacts", label: "\u6210\u679C", icon: "package-open" },
  { id: "tasks", label: "\u4EFB\u52A1\u8F68\u8FF9", icon: "list-checks" },
  { id: "metrics", label: "\u91CF\u5316\u5206\u6790", icon: "chart-no-axes-column-increasing" },
  { id: "history", label: "\u6574\u7406\u8BB0\u5F55", icon: "history" }
];
var CONFIDENCE_LABELS = {
  verified: "\u5DF2\u9A8C\u8BC1",
  observed: "\u5DF2\u89C2\u6D4B",
  reported: "\u62A5\u544A\u72B6\u6001",
  inferred: "\u63A8\u65AD"
};
var ARTIFACT_PROOF_LABELS = {
  independent: "\u72EC\u7ACB\u9A8C\u8BC1",
  "target-present": "\u76EE\u6807\u5B58\u5728",
  "report-only": "\u4EC5\u5B8C\u6210\u62A5\u544A"
};
var ActivityLedgerView = class extends import_obsidian4.ItemView {
  constructor(leaf, service, suite) {
    super(leaf);
    this.service = service;
    this.suite = suite;
  }
  service;
  suite;
  snapshot;
  activeTab = "calendar";
  calendarAnchor = /* @__PURE__ */ new Date();
  selectedDate = dateKey(/* @__PURE__ */ new Date());
  taskAnchor = /* @__PURE__ */ new Date();
  taskMode = "week";
  artifactAnchor = /* @__PURE__ */ new Date();
  artifactMode = "week";
  artifactProof = "all";
  selectedArtifactId;
  metricAnchor = /* @__PURE__ */ new Date();
  metricMode = "week";
  selectedMetric = "activity";
  selectedIngestRunId;
  filters = { projectKey: "all", confidence: "all" };
  loading = true;
  error;
  unsubscribe;
  unsubscribeSuite;
  suiteHealth;
  getViewType() {
    return ACTIVITY_LEDGER_VIEW_TYPE;
  }
  getDisplayText() {
    return "\u77E5\u884C\u53F0";
  }
  getIcon() {
    return "calendar-range";
  }
  async onOpen() {
    this.containerEl.addClass("activity-ledger-view");
    this.unsubscribe = this.service.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.loading = false;
      this.error = void 0;
      this.ensureSelectedDate();
      this.render();
    });
    this.unsubscribeSuite = this.suite.subscribe((health) => {
      this.suiteHealth = health;
      this.render();
    });
    this.render();
    try {
      await this.service.refresh();
    } catch (error) {
      this.loading = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }
  async onClose() {
    this.unsubscribe?.();
    this.unsubscribe = void 0;
    this.unsubscribeSuite?.();
    this.unsubscribeSuite = void 0;
  }
  render() {
    const root = this.containerEl.children[1];
    if (!root) {
      return;
    }
    root.empty();
    root.addClass("activity-ledger-root");
    root.dataset.testid = "activity-ledger-root";
    this.renderHeader(root);
    if (this.loading && !this.snapshot) {
      this.renderState(root, "loader-circle", "\u6B63\u5728\u8BFB\u53D6\u6D3B\u52A8\u8BC1\u636E\u2026", true);
      return;
    }
    if (this.error) {
      this.renderState(root, "circle-alert", this.error, false);
      return;
    }
    if (!this.snapshot) {
      this.renderState(root, "inbox", "\u6682\u65F6\u6CA1\u6709\u53EF\u663E\u793A\u7684\u6570\u636E", false);
      return;
    }
    const content = root.createDiv({ cls: "activity-ledger-content" });
    content.dataset.testid = `view-${this.activeTab}`;
    if (this.activeTab === "calendar") {
      this.renderCalendar(content);
    } else if (this.activeTab === "artifacts") {
      this.renderArtifacts(content);
    } else if (this.activeTab === "tasks") {
      this.renderTasks(content);
    } else if (this.activeTab === "metrics") {
      this.renderMetrics(content);
    } else {
      this.renderIngestHistory(content);
    }
    this.renderStatus(root);
  }
  renderHeader(root) {
    const header = root.createDiv({ cls: "activity-ledger-header" });
    const brand = header.createDiv({ cls: "activity-ledger-brand" });
    const brandIcon = brand.createSpan({ cls: "activity-ledger-brand-icon" });
    (0, import_obsidian4.setIcon)(brandIcon, "calendar-range");
    const brandText = brand.createDiv();
    brandText.createEl("h2", { text: "\u77E5\u884C\u53F0" });
    brandText.createDiv({ cls: "activity-ledger-subtitle", text: "\u5DE5\u4F5C\u4E0E\u77E5\u8BC6\u6D3B\u52A8\u8D26\u672C" });
    const tabs = header.createDiv({ cls: "activity-ledger-tabs", attr: { role: "tablist" } });
    for (const tab of TAB_CONFIG) {
      const button = this.iconTextButton(tabs, tab.icon, tab.label, `tab-${tab.id}`);
      button.addClass("activity-ledger-tab");
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(this.activeTab === tab.id));
      button.toggleClass("is-active", this.activeTab === tab.id);
      button.addEventListener("click", () => {
        this.activeTab = tab.id;
        this.render();
      });
    }
    const actions = header.createDiv({ cls: "activity-ledger-actions" });
    if (this.snapshot && this.activeTab !== "history") {
      this.renderProjectFilter(actions);
      if (this.activeTab === "artifacts") {
        this.renderArtifactProofFilter(actions);
      } else {
        this.renderConfidenceFilter(actions);
      }
    }
    const refresh = this.iconButton(actions, "refresh-cw", "\u5237\u65B0\u6570\u636E", "refresh-data");
    refresh.addEventListener("click", () => {
      this.loading = true;
      this.render();
      void this.service.refresh().catch((error) => {
        this.loading = false;
        this.error = error instanceof Error ? error.message : String(error);
        this.render();
      });
    });
  }
  renderProjectFilter(parent) {
    const select = parent.createEl("select", { cls: "activity-ledger-select" });
    select.setAttribute("aria-label", "\u6309\u9879\u76EE\u7B5B\u9009");
    select.dataset.testid = "project-filter";
    select.createEl("option", { text: "\u5168\u90E8\u9879\u76EE", value: "all" });
    for (const project of projectOptions(this.snapshot?.events ?? [])) {
      select.createEl("option", { text: project.label, value: project.key });
    }
    select.value = this.filters.projectKey;
    select.addEventListener("change", () => {
      this.filters.projectKey = select.value;
      this.render();
    });
  }
  renderConfidenceFilter(parent) {
    const select = parent.createEl("select", { cls: "activity-ledger-select" });
    select.setAttribute("aria-label", "\u6309\u53EF\u4FE1\u5EA6\u7B5B\u9009");
    select.dataset.testid = "confidence-filter";
    select.createEl("option", { text: "\u5168\u90E8\u53EF\u4FE1\u5EA6", value: "all" });
    for (const confidence of ["verified", "observed", "reported", "inferred"]) {
      select.createEl("option", { text: CONFIDENCE_LABELS[confidence], value: confidence });
    }
    select.value = this.filters.confidence;
    select.addEventListener("change", () => {
      this.filters.confidence = select.value;
      this.render();
    });
  }
  renderArtifactProofFilter(parent) {
    const select = parent.createEl("select", { cls: "activity-ledger-select" });
    select.setAttribute("aria-label", "\u6309\u6210\u679C\u53EF\u4FE1\u72B6\u6001\u7B5B\u9009");
    select.dataset.testid = "artifact-proof-filter";
    select.createEl("option", { text: "\u5168\u90E8\u6210\u679C\u72B6\u6001", value: "all" });
    for (const proof of ["independent", "target-present", "report-only"]) {
      select.createEl("option", { text: ARTIFACT_PROOF_LABELS[proof], value: proof });
    }
    select.value = this.artifactProof;
    select.addEventListener("change", () => {
      this.artifactProof = select.value;
      this.render();
    });
  }
  renderArtifacts(parent) {
    const toolbar = parent.createDiv({ cls: "activity-ledger-toolbar" });
    this.renderRangeMode(toolbar, this.artifactMode, (mode) => {
      this.artifactMode = mode;
      this.render();
    }, "artifacts");
    this.renderRangeNavigation(toolbar, this.artifactAnchor, this.artifactMode, (anchor) => {
      this.artifactAnchor = anchor;
      this.render();
    }, "artifacts");
    const range = this.artifactMode === "day" ? dayRange(this.artifactAnchor) : weekRange(this.artifactAnchor);
    const outcomes = this.filteredOutcomes(range);
    const settled = outcomes.filter((outcome) => outcome.settlement.status === "succeeded").length;
    const pending = outcomes.filter((outcome) => outcome.settlement.status === "pending").length;
    const failed = outcomes.filter((outcome) => outcome.settlement.status === "failed").length;
    const queue = this.snapshot?.diagnostics.knowledgeQueue;
    const created = outcomes.flatMap((outcome) => outcome.knowledgeChanges).filter((change) => change.action === "created").length;
    const updated = outcomes.flatMap((outcome) => outcome.knowledgeChanges).filter((change) => change.action === "updated").length;
    toolbar.createSpan({
      cls: "activity-artifact-range-summary",
      text: `\u771F\u5B9E\u6210\u679C ${outcomes.length} \xB7 \u65B0\u589E\u77E5\u8BC6 ${created} \xB7 \u66F4\u65B0\u77E5\u8BC6 ${updated} \xB7 \u5DF2\u6C89\u6DC0 ${settled} \xB7 \u5F85\u6C89\u6DC0 ${pending} \xB7 \u5931\u8D25 ${failed}${queue ? ` \xB7 \u6574\u7406\u961F\u5217 ${queue.remainingTopics} \u4E2A\u4E3B\u9898` : ""}`
    });
    const layout = parent.createDiv({ cls: "activity-artifacts-layout" });
    layout.dataset.testid = `artifacts-${this.artifactMode}`;
    const list = layout.createDiv({ cls: "activity-artifact-list" });
    const detail = layout.createDiv({ cls: "activity-artifact-detail" });
    if (outcomes.length === 0) {
      this.renderEmpty(list, "package-open", "\u5F53\u524D\u8303\u56F4\u6CA1\u6709\u771F\u5B9E\u6210\u679C");
      this.renderEmpty(detail, "file-search", "\u6210\u679C\u6309\u771F\u5B9E\u4EFB\u52A1\u5408\u5E76\uFF0C\u5E95\u5C42\u63D0\u4EA4\u548C\u5BF9\u8BDD\u4ECD\u53EF\u6838\u5BF9");
      return;
    }
    const availableIds = new Set(outcomes.map((outcome) => outcome.id));
    if (!this.selectedArtifactId || !availableIds.has(this.selectedArtifactId)) {
      this.selectedArtifactId = outcomes[0]?.id;
    }
    const byProject = /* @__PURE__ */ new Map();
    for (const outcome of outcomes) {
      const projectOutcomes = byProject.get(outcome.projectLabel) ?? [];
      projectOutcomes.push(outcome);
      byProject.set(outcome.projectLabel, projectOutcomes);
    }
    for (const [project, projectOutcomes] of byProject) {
      const group = list.createDiv({ cls: "activity-artifact-group" });
      const heading = group.createDiv({ cls: "activity-task-group-heading" });
      heading.createEl("h3", { text: project });
      heading.createSpan({ text: `${projectOutcomes.length} \u9879\u771F\u5B9E\u6210\u679C` });
      for (const outcome of projectOutcomes) {
        this.renderOutcomeRow(group, outcome);
      }
    }
    const selected = outcomes.find((outcome) => outcome.id === this.selectedArtifactId) ?? outcomes[0];
    if (selected) {
      this.renderOutcomeDetail(detail, selected);
    }
  }
  renderIngestHistory(parent) {
    const runs = this.snapshot?.ingestRuns ?? [];
    const queue = this.snapshot?.diagnostics.knowledgeQueue;
    const toolbar = parent.createDiv({ cls: "activity-ledger-toolbar activity-ingest-toolbar" });
    this.renderSuiteHealth(toolbar);
    const schedule = toolbar.createDiv({ cls: "activity-ingest-schedule" });
    const scheduleIcon = schedule.createSpan();
    (0, import_obsidian4.setIcon)(scheduleIcon, "clock-3");
    schedule.createSpan({ text: this.suiteHealth ? scheduleHealthLabel(this.suiteHealth, formatDateTime) : "\u7B49\u5F85\u8C03\u5EA6\u72B6\u6001" });
    toolbar.createSpan({
      cls: "activity-artifact-range-summary",
      text: queue ? `\u53EF\u6574\u7406 ${queue.readyTopics} \xB7 \u6536\u96C6\u4E2D ${queue.openTopics}${queue.coolingRetryTopics ? ` \xB7 \u51B7\u5374\u91CD\u8BD5 ${queue.coolingRetryTopics}` : ""}${queue.needsCompactionTopics ? ` \xB7 \u5F85\u538B\u7F29 ${queue.needsCompactionTopics}` : ""} \xB7 \u603B\u8BA1 ${queue.remainingTopics} \u4E2A\u4E3B\u9898` : "\u6574\u7406\u961F\u5217\u72B6\u6001\u5C1A\u672A\u5EFA\u7ACB"
    });
    const layout = parent.createDiv({ cls: "activity-ingest-layout" });
    layout.dataset.testid = "ingest-history";
    const list = layout.createDiv({ cls: "activity-ingest-list" });
    const detail = layout.createDiv({ cls: "activity-ingest-detail" });
    if (runs.length === 0) {
      this.renderEmpty(list, "history", "\u8FD8\u6CA1\u6709\u6574\u7406\u8BB0\u5F55");
      this.renderEmpty(detail, "book-dashed", "\u4E0B\u4E00\u6B21\u6574\u7406\u540E\u4F1A\u5728\u8FD9\u91CC\u7559\u4E0B\u53EF\u8FFD\u6EAF\u8BB0\u5F55");
      return;
    }
    const availableIds = new Set(runs.map((run) => run.id));
    if (!this.selectedIngestRunId || !availableIds.has(this.selectedIngestRunId)) {
      this.selectedIngestRunId = runs[0]?.id;
    }
    for (const run of runs) {
      this.renderIngestRunRow(list, run);
    }
    const selected = runs.find((run) => run.id === this.selectedIngestRunId) ?? runs[0];
    if (selected) {
      this.renderIngestRunDetail(detail, selected);
    }
  }
  renderSuiteHealth(parent) {
    const health = this.suiteHealth;
    if (!health) return;
    const panel = parent.createDiv({ cls: "zhixing-suite-health" });
    panel.createSpan({ cls: "zhixing-suite-version", text: `v${health.version}` });
    this.renderFactualHealthChip(panel, health.capture.desktop, "monitor-dot", {
      ready: "\u684C\u9762\u91C7\u96C6\u6B63\u5E38",
      waiting: "\u684C\u9762\u91C7\u96C6\u7B49\u5F85\u4E8B\u4EF6",
      stale: "\u684C\u9762\u91C7\u96C6\u5DF2\u4E45\u672A\u66F4\u65B0",
      unavailable: "\u684C\u9762\u91C7\u96C6\u5F02\u5E38"
    });
    this.renderFactualHealthChip(panel, health.capture.cliHook, "terminal", {
      ready: "CLI \u91C7\u96C6\u6B63\u5E38",
      waiting: "CLI Hook \u7B49\u5F85\u4E8B\u4EF6",
      stale: "CLI \u91C7\u96C6\u5DF2\u4E45\u672A\u66F4\u65B0",
      unavailable: "CLI \u91C7\u96C6\u672A\u5C31\u7EEA"
    });
    this.renderFactualHealthChip(panel, health.web, "radio-tower", {
      ready: "\u7F51\u9875\u91C7\u96C6\u6B63\u5E38",
      waiting: "\u7F51\u9875\u91C7\u96C6\u7B49\u5F85\u4E8B\u4EF6",
      stale: "\u7F51\u9875\u91C7\u96C6\u5DF2\u4E45\u672A\u66F4\u65B0",
      unavailable: "\u7F51\u9875\u91C7\u96C6\u5F02\u5E38"
    });
    this.renderFactualHealthChip(panel, health.organizer.runtime.supported ? health.organizer.executor : health.organizer.runtime, "brain-circuit", {
      ready: "\u77E5\u8BC6\u6574\u7406\u5C31\u7EEA",
      waiting: "\u77E5\u8BC6\u6574\u7406\u7B49\u5F85\u9996\u8F6E",
      stale: "\u77E5\u8BC6\u6574\u7406\u5DF2\u4E45\u672A\u8FD0\u884C",
      unavailable: "\u77E5\u8BC6\u6574\u7406\u4E0D\u53EF\u7528"
    });
    const feishu = panel.createSpan({ cls: `zhixing-health-chip is-${health.feishu.status === "ready" ? "ready" : health.feishu.status === "disabled" ? "starting" : "unavailable"}` });
    (0, import_obsidian4.setIcon)(feishu, health.feishu.status === "ready" ? "message-square-check" : health.feishu.status === "disabled" ? "message-square-dashed" : "message-square-warning");
    feishu.createSpan({ text: health.feishu.status === "ready" ? `\u98DE\u4E66\u6B63\u5E38${health.feishu.pending ? ` \xB7 \u5F85\u6574\u7406 ${health.feishu.pending}` : ""}` : health.feishu.status === "disabled" ? "\u98DE\u4E66\u672A\u8FDE\u63A5" : health.feishu.status === "unavailable" ? "\u98DE\u4E66\u4E0D\u53EF\u7528" : health.feishu.failedModules ? `\u98DE\u4E66\u5F85\u91CD\u8BD5 ${health.feishu.failedModules}` : !health.feishu.lastSync ? "\u98DE\u4E66\u7B49\u5F85\u9996\u6B21\u540C\u6B65" : "\u98DE\u4E66\u5DF2\u4E45\u672A\u540C\u6B65" });
    feishu.setAttribute("title", [
      health.feishu.message,
      health.feishu.identityLabel,
      health.feishu.lastSeenAt ? `\u6700\u540E\u63A2\u6D3B ${formatDateTime(health.feishu.lastSeenAt)}` : "",
      health.feishu.lastSync ? `\u6700\u540E\u540C\u6B65 ${formatDateTime(health.feishu.lastSync)}` : "",
      health.feishu.error,
      health.feishu.selectedChats ? `${health.feishu.selectedChats} \u4E2A\u9879\u76EE\u7FA4` : "",
      health.feishu.selectedBases ? `${health.feishu.selectedBases} \u4E2A Base \u89C6\u56FE` : ""
    ].filter(Boolean).join(" \xB7 "));
    const updateLabel = health.update === "available" ? `\u53EF\u66F4\u65B0 ${health.latestVersion}` : health.update === "current" ? "\u5DF2\u662F\u6700\u65B0\u7248" : "\u68C0\u67E5\u66F4\u65B0";
    const copy = this.iconButton(panel, "key-round", "\u590D\u5236\u6D4F\u89C8\u5668\u63A5\u6536\u5BC6\u94A5", "copy-receiver-token");
    copy.addEventListener("click", () => void this.suite.copyReceiverToken());
    const extension = this.iconButton(panel, "folder-open", "\u6253\u5F00\u6D4F\u89C8\u5668\u6269\u5C55\u76EE\u5F55", "open-browser-extension-folder");
    extension.addEventListener("click", () => void this.suite.openBrowserExtensionFolder());
    const run = this.iconButton(panel, health.running ? "loader-circle" : "sparkles", health.running ? "\u6B63\u5728\u6574\u7406" : "\u7ACB\u5373\u6574\u7406", "run-knowledge-now");
    run.disabled = !canRunKnowledgeNow(health);
    run.addEventListener("click", () => void this.suite.runKnowledgeNow());
    const sources = this.iconButton(panel, "database", "\u6570\u636E\u6765\u6E90\u8BBE\u7F6E", "open-data-sources");
    sources.addEventListener("click", () => new FeishuSetupModal(this.app, this.suite).open());
    if (health.feishu.enabled) {
      const sync = this.iconButton(panel, health.feishu.syncing ? "loader-circle" : "refresh-ccw", health.feishu.syncing ? "\u6B63\u5728\u540C\u6B65\u98DE\u4E66" : "\u7ACB\u5373\u540C\u6B65\u98DE\u4E66", "sync-feishu-now");
      sync.disabled = health.feishu.syncing || health.feishu.cli === "missing";
      sync.addEventListener("click", () => void this.suite.runFeishuSyncNow(true));
    }
    const update = this.iconTextButton(panel, "cloud-download", updateLabel, "check-suite-update");
    update.addEventListener("click", () => void this.suite.checkForUpdate());
  }
  renderFactualHealthChip(parent, health, icon, labels) {
    const display3 = factualHealthDisplay(health, labels);
    const chip = parent.createSpan({ cls: `zhixing-health-chip is-${display3.state}` });
    (0, import_obsidian4.setIcon)(chip, display3.state === "unavailable" ? "triangle-alert" : icon);
    chip.createSpan({ text: display3.label });
    chip.setAttribute("title", display3.title);
  }
  renderIngestRunRow(parent, run) {
    const display3 = ingestRunDisplay(run);
    const button = parent.createEl("button", {
      cls: "activity-ingest-row",
      attr: { type: "button", "aria-label": `\u67E5\u770B\u6574\u7406\u8BB0\u5F55\uFF1A${formatDateTime(run.startedAt)}` }
    });
    button.toggleClass("is-active", run.id === this.selectedIngestRunId);
    const marker = button.createSpan({ cls: `activity-ingest-marker is-${display3.key}` });
    (0, import_obsidian4.setIcon)(marker, display3.icon);
    const body = button.createDiv({ cls: "activity-ingest-row-body" });
    const top = body.createDiv({ cls: "activity-ingest-row-top" });
    top.createSpan({ cls: "activity-ingest-time", text: formatDateTime(run.startedAt) });
    top.createSpan({ cls: `activity-ingest-status is-${display3.key}`, text: display3.label });
    body.createDiv({
      cls: "activity-ingest-summary",
      text: run.source === "legacy-log" ? "\u65E7\u7248\u53EA\u4FDD\u7559\u8FD0\u884C\u6982\u8981\uFF0C\u5904\u7406\u7ED3\u679C\u4E0D\u53EF\u5B8C\u6574\u6838\u9A8C" : `\u9009\u4E2D ${run.selectedTopics} \u4E2A\u4E3B\u9898 \xB7 \u6210\u529F\u6C89\u6DC0 ${run.committedTopics} \u4E2A \xB7 \u5F85\u91CD\u8BD5/\u5931\u8D25 ${run.pendingTopics + run.failedTopics} \u4E2A \xB7 \u5269\u4F59 ${run.remainingTopics} \u4E2A`
    });
    body.createDiv({
      cls: "activity-ingest-meta",
      text: [
        ingestTriggerLabel(run),
        run.batchIndex ? `\u7B2C ${run.batchIndex} \u6279` : "",
        run.tokensUsed ? `${run.tokensUsed.toLocaleString("zh-CN")} tokens` : "",
        run.attemptCount > 1 ? `${run.attemptCount} \u6B21\u5C1D\u8BD5` : ""
      ].filter(Boolean).join(" \xB7 ")
    });
    button.addEventListener("click", () => {
      this.selectedIngestRunId = run.id;
      this.render();
    });
  }
  renderIngestRunDetail(parent, run) {
    const display3 = ingestRunDisplay(run);
    const heading = parent.createDiv({ cls: "activity-ingest-detail-heading" });
    const title = heading.createDiv();
    title.createEl("h3", { text: formatDateTime(run.startedAt) });
    title.createDiv({
      cls: "activity-artifact-detail-meta",
      text: `${ingestTriggerLabel(run)} \xB7 ${display3.label}${run.finishedAt ? ` \xB7 \u7528\u65F6 ${durationLabel(run.startedAt, run.finishedAt)}` : ""}`
    });
    if (run.logPath) {
      const openLog = this.iconTextButton(heading, "scroll-text", "\u67E5\u770B\u8FD0\u884C\u6765\u6E90", "open-ingest-log");
      openLog.addEventListener("click", () => new SourceEvidenceModal(this.app, {
        type: "codex",
        label: "\u6574\u7406\u8FD0\u884C\u6765\u6E90",
        path: run.logPath,
        excerpt: run.source === "legacy-log" ? "\u8FD9\u662F\u65E7\u7248\u8FD0\u884C\u65E5\u5FD7\u3002\u5B83\u53EA\u80FD\u8BC1\u660E\u4EFB\u52A1\u88AB\u89E6\u53D1\uFF0C\u4E0D\u80FD\u5355\u72EC\u8BC1\u660E Wiki \u5DF2\u6210\u529F\u5199\u5165\u3002" : `\u8FD0\u884C\u7F16\u53F7\uFF1A${run.runId}`
      }).open());
    }
    if (run.source === "legacy-log") {
      parent.createDiv({
        cls: "activity-artifact-attribution is-warning",
        text: "\u65E7\u7248\u8BB0\u5F55\u6CA1\u6709\u4E8B\u52A1\u7EA7\u9A8C\u8BC1\u4FE1\u606F\u3002\u8FD9\u91CC\u4E0D\u6839\u636E\u9000\u51FA\u7801\u63A8\u65AD\u6574\u7406\u6210\u529F\uFF0C\u7ED3\u679C\u8BF7\u4EE5\u6210\u679C\u548C Wiki \u5B9E\u9645\u5185\u5BB9\u4E3A\u51C6\u3002"
      });
    } else if (display3.key === "stalled") {
      parent.createDiv({
        cls: "activity-artifact-attribution is-warning",
        text: "\u8FD9\u6B21\u6574\u7406\u957F\u65F6\u95F4\u6CA1\u6709\u7ED3\u675F\u8BB0\u5F55\uFF0C\u53EF\u80FD\u88AB\u4E2D\u65AD\u3002\u672A\u6210\u529F\u5199\u5165\u7684\u5185\u5BB9\u4F1A\u4FDD\u7559\u5728\u961F\u5217\u4E2D\u7B49\u5F85\u91CD\u8BD5\u3002"
      });
    } else if (run.error) {
      parent.createDiv({
        cls: "activity-artifact-attribution is-warning",
        text: `\u672C\u6B21\u672A\u5B8C\u5168\u5B8C\u6210\uFF1A${run.error}`
      });
    }
    const counts = parent.createDiv({ cls: "activity-ingest-counts" });
    this.ingestCount(counts, "\u9009\u4E2D\u4E3B\u9898", run.selectedTopics);
    this.ingestCount(counts, "\u6210\u529F\u6C89\u6DC0", run.committedTopics);
    this.ingestCount(counts, "\u5F85\u91CD\u8BD5/\u5931\u8D25", run.pendingTopics + run.failedTopics);
    this.ingestCount(counts, "\u5269\u4F59\u4E3B\u9898", run.remainingTopics);
    this.ingestCount(counts, "\u4F8B\u884C\u5F52\u6863/\u8F85\u52A9\u8BC1\u636E", run.systemPairs);
    if (run.tokensUsed > 0) {
      this.ingestCount(counts, "\u672C\u6279 tokens", run.tokensUsed);
    }
    const section = parent.createDiv({ cls: "activity-ingest-topics" });
    const sectionHeading = section.createDiv({ cls: "activity-task-group-heading" });
    sectionHeading.createEl("h3", { text: "\u672C\u6B21\u5904\u7406\u5185\u5BB9" });
    sectionHeading.createSpan({ text: `${run.topicResults.length} \u4E2A\u53EF\u6838\u9A8C\u4E3B\u9898` });
    if (run.topicResults.length === 0) {
      this.renderEmpty(
        section,
        "list-minus",
        run.status === "idle" ? "\u672C\u6B21\u6CA1\u6709\u9700\u8981\u8BED\u4E49\u6574\u7406\u7684\u5185\u5BB9" : "\u8FD9\u6761\u8BB0\u5F55\u6CA1\u6709\u4FDD\u7559\u4E0B\u53EF\u5C55\u5F00\u7684\u4E3B\u9898\u660E\u7EC6"
      );
      return;
    }
    for (const topic of run.topicResults) {
      const item = section.createDiv({ cls: "activity-ingest-topic" });
      const topicMarker = item.createSpan({ cls: `activity-ingest-topic-marker is-${topic.status}` });
      (0, import_obsidian4.setIcon)(topicMarker, settlementIcon(topic.status));
      const body = item.createDiv({ cls: "activity-ingest-topic-body" });
      const top = body.createDiv({ cls: "activity-ingest-topic-top" });
      top.createSpan({ cls: "activity-ingest-topic-title", text: topic.title });
      top.createSpan({
        cls: `activity-artifact-proof is-${topic.status}`,
        text: settlementLabel(topic.status)
      });
      const explanation = topic.error || topic.reason;
      if (topic.digest) {
        this.renderKnowledgeDigest(body, topic.digest, true);
      } else if (explanation) {
        body.createDiv({ cls: "activity-ingest-topic-summary", text: explanation });
      }
      const created = topic.wikiChanges.filter((change) => change.action === "created").length;
      const updated = topic.wikiChanges.filter((change) => change.action === "updated").length;
      body.createDiv({
        cls: "activity-ingest-meta",
        text: `${topic.sourceEventCount} \u6761\u539F\u59CB\u8BC1\u636E${created ? ` \xB7 \u65B0\u589E Wiki ${created}` : ""}${updated ? ` \xB7 \u66F4\u65B0 Wiki ${updated}` : ""}`
      });
      const actions = item.createDiv({ cls: "activity-ingest-topic-actions" });
      if (topic.memoryPath) {
        const open3 = this.iconTextButton(actions, "book-open-text", "\u6253\u5F00\u6211\u7684\u7ECF\u5386");
        open3.addEventListener("click", () => void this.openSource({
          type: "wiki",
          label: topic.memoryPath,
          path: topic.memoryPath
        }));
      }
      const evidencePaths = topic.evidencePaths.length > 0 ? topic.evidencePaths : topic.wikiPaths.filter((wikiPath) => wikiPath !== topic.memoryPath);
      for (const wikiPath of evidencePaths.slice(0, topic.memoryPath ? 1 : 2)) {
        const change = topic.wikiChanges.find((item2) => item2.path === wikiPath);
        const wikiTitle = change?.title ?? wikiPath.split("/").at(-1)?.replace(/\.md$/i, "") ?? "\u6280\u672F\u8BC1\u636E";
        const open3 = this.iconTextButton(actions, "database", `\u67E5\u770B\u8BC1\u636E\u300A${wikiTitle}\u300B`);
        open3.addEventListener("click", () => void this.openSource({
          type: "wiki",
          label: wikiPath,
          path: wikiPath
        }));
      }
      for (const dailyPath of topic.dailyPaths.slice(0, 2)) {
        const open3 = this.iconButton(actions, "file-text", `\u6253\u5F00\u6BCF\u65E5\u6765\u6E90\uFF1A${dailyPath}`);
        open3.addEventListener("click", () => void this.openSource({
          type: "file",
          label: dailyPath,
          path: dailyPath
        }));
      }
    }
  }
  ingestCount(parent, label, value) {
    const item = parent.createDiv({ cls: "activity-ingest-count" });
    item.createSpan({ text: label });
    item.createEl("strong", { text: String(value) });
  }
  renderOutcomeRow(parent, outcome) {
    const button = parent.createEl("button", {
      cls: "activity-artifact-row",
      attr: { type: "button", "aria-label": `\u67E5\u770B\u6210\u679C\uFF1A${outcome.title}` }
    });
    button.dataset.artifactId = outcome.id;
    button.toggleClass("is-active", outcome.id === this.selectedArtifactId);
    const marker = button.createSpan({ cls: `activity-artifact-marker is-${outcome.proof}` });
    (0, import_obsidian4.setIcon)(marker, settlementIcon(outcome.settlement.status, outcome.settlement.category));
    const body = button.createDiv({ cls: "activity-artifact-body" });
    const top = body.createDiv({ cls: "activity-artifact-top" });
    top.createSpan({ cls: "activity-artifact-title", text: outcome.title });
    top.createSpan({
      cls: `activity-artifact-proof is-${outcome.settlement.status}`,
      text: settlementLabel(outcome.settlement.status, outcome.settlement.category)
    });
    body.createDiv({
      cls: "activity-artifact-summary",
      text: readableSummary(outcome.digest?.about ?? outcome.summary)
    });
    body.createDiv({
      cls: "activity-artifact-meta",
      text: `${dayLabel(outcome.localDate)} \xB7 ${outcome.artifactIds.length} \u6761\u5E95\u5C42\u8BC1\u636E \xB7 ${ARTIFACT_PROOF_LABELS[outcome.proof]}`
    });
    button.addEventListener("click", () => {
      this.selectedArtifactId = outcome.id;
      this.render();
    });
  }
  renderOutcomeDetail(parent, outcome) {
    const heading = parent.createDiv({ cls: "activity-artifact-detail-heading" });
    const title = heading.createDiv();
    title.createEl("h3", { text: outcome.title });
    title.createDiv({
      cls: "activity-artifact-detail-meta",
      text: `${outcome.projectLabel} \xB7 ${dayLabel(outcome.localDate)} \xB7 ${settlementLabel(outcome.settlement.status, outcome.settlement.category)} \xB7 ${outcome.artifactIds.length || outcome.eventIds.length / 2} \u6761\u5E95\u5C42\u8BC1\u636E`
    });
    if (outcome.memoryRef) {
      const openWiki = this.iconTextButton(heading, "book-open-text", "\u6253\u5F00\u6211\u7684\u7ECF\u5386", "open-outcome-wiki");
      openWiki.addEventListener("click", () => void this.openSource(outcome.memoryRef));
    } else if (outcome.wikiRefs[0]) {
      const openWiki = this.iconTextButton(heading, "book-open", "\u6253\u5F00\u65E7\u7248 Wiki", "open-outcome-wiki");
      openWiki.addEventListener("click", () => void this.openSource(outcome.wikiRefs[0]));
    } else {
      const firstArtifact = this.outcomeArtifacts(outcome)[0];
      if (firstArtifact) {
        const openNote = this.iconTextButton(heading, "file-text", "\u6253\u5F00\u6210\u679C\u8BC1\u636E", "open-artifact-note");
        openNote.addEventListener("click", () => void this.openArtifactNote(firstArtifact));
      }
    }
    if (outcome.settlement.status === "failed") {
      parent.createDiv({
        cls: "activity-artifact-attribution is-warning",
        text: `\u6C89\u6DC0\u5931\u8D25\uFF1A${outcome.settlement.error || "\u672A\u8BB0\u5F55\u539F\u56E0"}\u3002\u4E0B\u6B21\u6574\u7406\u4F1A\u81EA\u52A8\u91CD\u8BD5\u3002`
      });
    }
    if (outcome.digest) {
      this.renderKnowledgeDigest(parent, outcome.digest, false);
    }
    this.artifactSection(parent, "\u89E3\u51B3\u7684\u95EE\u9898", outcome.problem ?? "\u5E95\u5C42\u8BC1\u636E\u5C1A\u672A\u63D0\u4F9B\u660E\u786E\u7684\u95EE\u9898\u63CF\u8FF0\u3002");
    this.artifactSection(parent, "\u5F62\u6210\u7684\u6210\u679C", outcome.summary);
    const targets = parent.createDiv({ cls: "activity-artifact-section" });
    targets.createEl("h4", { text: "\u8FD9\u6B21\u7559\u4E0B\u7684\u8BB0\u5F55" });
    if (outcome.wikiRefs.length === 0) {
      targets.createDiv({
        cls: "activity-artifact-section-empty",
        text: outcome.settlement.category === "durable-output" ? outcome.settlement.reason || "\u771F\u5B9E\u81EA\u52A8\u5316\u4EA7\u51FA\u5DF2\u8BB0\u5F55\uFF0C\u5F53\u524D\u8BC1\u636E\u4E0D\u8DB3\u4EE5\u5F62\u6210\u5E38\u9752 Wiki\u3002" : outcome.settlement.status === "not-applicable" ? outcome.settlement.reason || "\u8FD9\u9879\u6210\u679C\u672A\u53D1\u73B0\u503C\u5F97\u5355\u72EC\u6C89\u6DC0\u7684\u957F\u671F\u7ECF\u9A8C\u3002" : "\u5C1A\u672A\u5F62\u6210\u957F\u671F Wiki\u3002"
      });
    } else {
      const actions = targets.createDiv({ cls: "activity-artifact-targets" });
      if (outcome.memoryRef) {
        const button = this.iconTextButton(actions, "book-open-text", `\u6211\u7684\u7ECF\u5386\uFF1A\u300A${outcome.memoryRef.label}\u300B`);
        button.addEventListener("click", () => void this.openSource(outcome.memoryRef));
      }
      for (const source of outcome.evidenceRefs ?? []) {
        const button = this.iconTextButton(actions, "database", `AI \u8BC1\u636E\uFF1A\u300A${source.label}\u300B`);
        button.addEventListener("click", () => void this.openSource(source));
      }
      if (!outcome.memoryRef && (outcome.evidenceRefs?.length ?? 0) === 0) {
        for (const source of outcome.wikiRefs) {
          const button = this.iconTextButton(actions, "book-open", source.label);
          button.addEventListener("click", () => void this.openSource(source));
        }
      }
    }
    const sources = parent.createDiv({ cls: "activity-artifact-section" });
    sources.createEl("h4", { text: `\u5E95\u5C42\u8BC1\u636E\uFF08${outcome.artifactIds.length}\uFF09` });
    const sourceActions = sources.createDiv({ cls: "activity-artifact-targets" });
    for (const source of this.availableSources(outcome.sourceRefs).slice(0, 12)) {
      this.sourceButton(sourceActions, source);
    }
    if (outcome.reuseCount > 0) {
      this.artifactSection(parent, "\u518D\u6B21\u590D\u7528", `\u8FD9\u7BC7\u77E5\u8BC6\u5DF2\u7ECF\u88AB\u540E\u7EED ${outcome.reuseCount} \u9879\u771F\u5B9E\u6210\u679C\u660E\u786E\u5F15\u7528\u3002`);
    }
  }
  artifactSection(parent, title, content) {
    const section = parent.createDiv({ cls: "activity-artifact-section" });
    section.createEl("h4", { text: title });
    const body = section.createDiv({ cls: "activity-artifact-section-body" });
    for (const paragraph of content.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      body.createEl("p", { text: paragraph });
    }
  }
  renderKnowledgeDigest(parent, digest, compact) {
    const section = parent.createDiv({ cls: `activity-knowledge-digest${compact ? " is-compact" : ""}` });
    if (!compact) {
      const heading = section.createDiv({ cls: "activity-knowledge-digest-heading" });
      const icon = heading.createSpan();
      (0, import_obsidian4.setIcon)(icon, "scan-eye");
      heading.createEl("h4", { text: "\u4E00\u773C\u770B\u61C2" });
    }
    for (const [label, value] of [
      ["\u8FD9\u662F\u4EC0\u4E48", digest.about],
      ["\u89E3\u51B3\u4E86\u4EC0\u4E48", digest.problem],
      ["\u5F97\u5230\u4EC0\u4E48", digest.result],
      ["\u4EE5\u540E\u600E\u4E48\u7528", digest.nextUse]
    ]) {
      const row = section.createDiv({ cls: "activity-knowledge-digest-row" });
      row.createSpan({ text: label });
      row.createDiv({ text: value });
    }
  }
  filteredOutcomes(range) {
    return (this.snapshot?.outcomes ?? []).filter((outcome) => outcome.localDate >= range.start && outcome.localDate <= range.end).filter((outcome) => this.filters.projectKey === "all" || outcome.projectKey === this.filters.projectKey).filter((outcome) => this.artifactProof === "all" || outcome.proof === this.artifactProof).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id));
  }
  outcomeArtifacts(outcome) {
    const ids = new Set(outcome.artifactIds);
    return (this.snapshot?.artifacts ?? []).filter((artifact) => ids.has(artifact.id));
  }
  outcomesForDate(date) {
    return (this.snapshot?.outcomes ?? []).filter(
      (outcome) => outcome.localDate === date && (this.filters.projectKey === "all" || outcome.projectKey === this.filters.projectKey)
    );
  }
  renderCalendar(parent) {
    const toolbar = parent.createDiv({ cls: "activity-ledger-toolbar" });
    const navigation = toolbar.createDiv({ cls: "activity-ledger-date-nav" });
    this.iconButton(navigation, "chevron-left", "\u4E0A\u4E2A\u6708", "calendar-previous").addEventListener("click", () => {
      this.calendarAnchor = moveMonth(this.calendarAnchor, -1);
      this.render();
    });
    navigation.createEl("h3", { text: monthLabel(this.calendarAnchor) });
    this.iconButton(navigation, "chevron-right", "\u4E0B\u4E2A\u6708", "calendar-next").addEventListener("click", () => {
      this.calendarAnchor = moveMonth(this.calendarAnchor, 1);
      this.render();
    });
    const today = this.iconTextButton(toolbar, "locate-fixed", "\u4ECA\u5929", "calendar-today");
    today.addEventListener("click", () => {
      this.calendarAnchor = /* @__PURE__ */ new Date();
      this.selectedDate = dateKey(/* @__PURE__ */ new Date());
      this.render();
    });
    const split = parent.createDiv({ cls: "activity-ledger-split" });
    const main = split.createDiv({ cls: "activity-ledger-main" });
    const calendar = main.createDiv({ cls: "activity-calendar" });
    calendar.dataset.testid = "calendar-grid";
    for (const weekday of ["\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u65E5"]) {
      calendar.createDiv({ cls: "activity-calendar-weekday", text: weekday });
    }
    const visibleEvents = this.filteredEventsForMonth();
    for (const day of monthGrid(this.calendarAnchor)) {
      const summary = summarizeCalendarDay(day.date, visibleEvents);
      summary.outputs = this.outcomesForDate(day.date).length;
      const button = calendar.createEl("button", {
        cls: "activity-calendar-day",
        attr: {
          type: "button",
          "aria-label": `${dayLabel(day.date)}\uFF0C${summary.tasks} \u4E2A\u4EFB\u52A1\uFF0C${summary.outputs} \u4E2A\u4EA7\u51FA\uFF0C${summary.knowledge} \u6761\u77E5\u8BC6`
        }
      });
      button.dataset.date = day.date;
      button.toggleClass("is-outside", !day.inMonth);
      button.toggleClass("is-selected", day.date === this.selectedDate);
      button.toggleClass("is-today", day.date === dateKey(/* @__PURE__ */ new Date()));
      button.createSpan({ cls: "activity-calendar-number", text: String(dateFromKey(day.date).getDate()) });
      const indicators = button.createDiv({ cls: "activity-calendar-indicators" });
      this.indicator(indicators, "task", "\u4EFB\u52A1", summary.tasks);
      this.indicator(indicators, "output", "\u4EA7\u51FA", summary.outputs);
      this.indicator(indicators, "knowledge", "\u77E5\u8BC6", summary.knowledge);
      button.addEventListener("click", () => {
        this.selectedDate = day.date;
        this.render();
      });
    }
    this.renderDayInspector(split, this.selectedDate);
  }
  renderDayInspector(parent, date) {
    const inspector = parent.createDiv({ cls: "activity-ledger-inspector" });
    inspector.dataset.testid = "day-inspector";
    const events = filterEvents(this.snapshot?.events ?? [], dayRange(dateFromKey(date)), this.filters).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const outcomes = this.outcomesForDate(date);
    const heading = inspector.createDiv({ cls: "activity-inspector-heading" });
    heading.createEl("h3", { text: dayLabel(date) });
    const actions = heading.createDiv({ cls: "activity-inspector-actions" });
    const settled = outcomes.filter((outcome) => outcome.settlement.status === "succeeded").length;
    const failed = outcomes.filter((outcome) => outcome.settlement.status === "failed").length;
    actions.createSpan({
      text: `${outcomes.length} \u9879\u771F\u5B9E\u6210\u679C \xB7 \u5DF2\u6C89\u6DC0 ${settled} \xB7 \u5931\u8D25 ${failed} \xB7 ${events.length} \u6761\u6D3B\u52A8\u8BC1\u636E`
    });
    if (outcomes.length > 0) {
      const openArtifacts = this.iconButton(actions, "package-open", "\u67E5\u770B\u5F53\u5929\u6210\u679C", "calendar-open-artifacts");
      openArtifacts.addEventListener("click", () => {
        this.activeTab = "artifacts";
        this.artifactMode = "day";
        this.artifactAnchor = dateFromKey(date);
        this.render();
      });
    }
    if (events.length === 0) {
      this.renderEmpty(inspector, "calendar-x", "\u5F53\u5929\u6CA1\u6709\u5DF2\u91C7\u96C6\u6D3B\u52A8");
      return;
    }
    const timeline = inspector.createDiv({ cls: "activity-timeline" });
    for (const event of events) {
      this.renderEventRow(timeline, event, true);
    }
  }
  renderTasks(parent) {
    const toolbar = parent.createDiv({ cls: "activity-ledger-toolbar" });
    this.renderRangeMode(toolbar, this.taskMode, (mode) => {
      this.taskMode = mode;
      this.render();
    }, "tasks");
    this.renderRangeNavigation(toolbar, this.taskAnchor, this.taskMode, (anchor) => {
      this.taskAnchor = anchor;
      this.render();
    }, "tasks");
    const range = this.taskMode === "day" ? dayRange(this.taskAnchor) : weekRange(this.taskAnchor);
    const events = filterEvents(this.snapshot?.events ?? [], range, this.filters);
    const taskEvents = events.filter((event) => event.taskKey && event.kind !== "research_activity");
    const tasks = aggregateTasks(taskEvents);
    const content = parent.createDiv({ cls: "activity-task-content" });
    content.dataset.testid = `tasks-${this.taskMode}`;
    if (tasks.length === 0) {
      this.renderEmpty(content, "list-x", "\u5F53\u524D\u8303\u56F4\u6CA1\u6709\u53EF\u5F52\u5C5E\u4EFB\u52A1");
      return;
    }
    if (this.taskMode === "day") {
      const ordered = taskEvents.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
      for (const event of ordered) {
        this.renderEventRow(content, event, false);
      }
      return;
    }
    const byProject = /* @__PURE__ */ new Map();
    for (const task of tasks) {
      const items = byProject.get(task.projectLabel) ?? [];
      items.push(task);
      byProject.set(task.projectLabel, items);
    }
    for (const [project, projectTasks] of byProject) {
      const group = content.createDiv({ cls: "activity-task-group" });
      const heading = group.createDiv({ cls: "activity-task-group-heading" });
      heading.createEl("h3", { text: project });
      heading.createSpan({ text: `${projectTasks.length} \u4E2A\u4EFB\u52A1` });
      for (const task of projectTasks) {
        this.renderTaskRow(group, task);
      }
    }
  }
  renderMetrics(parent) {
    const toolbar = parent.createDiv({ cls: "activity-ledger-toolbar" });
    this.renderRangeMode(toolbar, this.metricMode, (mode) => {
      this.metricMode = mode;
      this.render();
    }, "metrics");
    this.renderRangeNavigation(toolbar, this.metricAnchor, this.metricMode, (anchor) => {
      this.metricAnchor = anchor;
      this.render();
    }, "metrics");
    const range = this.metricMode === "day" ? dayRange(this.metricAnchor) : weekRange(this.metricAnchor);
    const metrics = metricsForRange(
      this.snapshot?.events ?? [],
      range,
      this.filters,
      this.snapshot?.outcomes ?? []
    );
    const strip = parent.createDiv({ cls: "activity-metric-strip" });
    strip.dataset.testid = "metric-strip";
    for (const metric2 of metrics) {
      const button = strip.createEl("button", { cls: "activity-metric", attr: { type: "button" } });
      button.dataset.dimension = metric2.dimension;
      button.toggleClass("is-active", metric2.dimension === this.selectedMetric);
      const label = button.createDiv({ cls: "activity-metric-label" });
      const icon = label.createSpan();
      (0, import_obsidian4.setIcon)(icon, metricIcon(metric2.dimension));
      label.createSpan({ text: metric2.label });
      button.createDiv({ cls: "activity-metric-value", text: String(metric2.value) });
      button.createDiv({ cls: "activity-metric-note", text: metric2.note });
      button.addEventListener("click", () => {
        this.selectedMetric = metric2.dimension;
        this.render();
      });
    }
    const layout = parent.createDiv({ cls: "activity-metrics-layout" });
    this.renderDailyDistribution(layout, range);
    const selected = metrics.find((metric2) => metric2.dimension === this.selectedMetric) ?? metrics[0];
    if (selected) {
      this.renderMetricEvidence(layout, selected);
    }
  }
  renderDailyDistribution(parent, range) {
    const panel = parent.createDiv({ cls: "activity-distribution" });
    panel.createEl("h3", { text: "\u6BCF\u65E5\u5206\u5E03" });
    const events = filterEvents(this.snapshot?.events ?? [], range, this.filters);
    const dates = [];
    for (let cursor = dateFromKey(range.start); dateKey(cursor) <= range.end; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
      dates.push(dateKey(cursor));
    }
    const summaries = dates.map((date) => {
      const summary = summarizeCalendarDay(date, events);
      summary.outputs = this.outcomesForDate(date).length;
      return summary;
    });
    const max = Math.max(1, ...summaries.flatMap((summary) => [summary.tasks, summary.outputs, summary.knowledge]));
    for (const summary of summaries) {
      const row = panel.createDiv({ cls: "activity-distribution-row" });
      row.createSpan({ cls: "activity-distribution-date", text: dayLabel(summary.date) });
      const bars = row.createDiv({ cls: "activity-distribution-bars" });
      this.progressBar(bars, "task", "\u4EFB\u52A1", summary.tasks, max);
      this.progressBar(bars, "output", "\u4EA7\u51FA", summary.outputs, max);
      this.progressBar(bars, "knowledge", "\u77E5\u8BC6", summary.knowledge, max);
    }
  }
  renderMetricEvidence(parent, metric2) {
    const panel = parent.createDiv({ cls: "activity-metric-evidence" });
    panel.dataset.testid = "metric-evidence";
    const heading = panel.createDiv({ cls: "activity-inspector-heading" });
    heading.createEl("h3", { text: `${metric2.label}\u6784\u6210` });
    heading.createSpan({ text: `${metric2.events.length} \u6761\u8BC1\u636E` });
    if (metric2.events.length === 0) {
      this.renderEmpty(panel, "search-x", metric2.note);
      return;
    }
    for (const event of metric2.events.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))) {
      this.renderEventRow(panel, event, true);
    }
  }
  renderTaskRow(parent, task) {
    const row = parent.createDiv({ cls: "activity-task-row" });
    row.dataset.taskKey = task.taskKey;
    const status = row.createSpan({ cls: `activity-task-status is-${task.status}` });
    (0, import_obsidian4.setIcon)(status, task.status === "completed" ? "circle-check" : task.status === "blocked" ? "circle-pause" : "circle-dot");
    const body = row.createDiv({ cls: "activity-task-body" });
    body.createDiv({ cls: "activity-task-title", text: task.title });
    body.createDiv({
      cls: "activity-task-meta",
      text: `${task.turnCount} \u6B21\u63A8\u8FDB \xB7 ${task.activeDates.length} \u4E2A\u6D3B\u8DC3\u65E5 \xB7 ${CONFIDENCE_LABELS[task.statusConfidence]}`
    });
    const dates = row.createDiv({ cls: "activity-task-dates" });
    for (const date of task.activeDates) {
      dates.createSpan({ text: date.slice(5) });
    }
    const firstSource = this.availableSources(task.sourceRefs)[0];
    if (firstSource) {
      this.sourceButton(row, firstSource);
    }
  }
  renderEventRow(parent, event, compact) {
    const row = parent.createDiv({ cls: `activity-event-row${compact ? " is-compact" : ""}` });
    row.dataset.eventId = event.id;
    const marker = row.createSpan({ cls: `activity-event-marker is-${eventDimension(event)}` });
    (0, import_obsidian4.setIcon)(marker, eventIcon(event));
    const body = row.createDiv({ cls: "activity-event-body" });
    const top = body.createDiv({ cls: "activity-event-top" });
    top.createSpan({ cls: "activity-event-time", text: timeLabel(event.occurredAt) });
    top.createSpan({ cls: "activity-event-title", text: event.title });
    const badges = top.createDiv({ cls: "activity-event-badges" });
    badges.createSpan({ cls: `activity-confidence is-${event.confidence}`, text: CONFIDENCE_LABELS[event.confidence] });
    if (!compact) {
      body.createDiv({ cls: "activity-event-summary", text: event.summary });
    }
    const meta = body.createDiv({ cls: "activity-event-meta" });
    meta.createSpan({ text: event.projectLabel });
    meta.createSpan({ text: event.evidence });
    const sources = row.createDiv({ cls: "activity-event-sources" });
    for (const source of this.availableSources(event.sourceRefs).slice(0, compact ? 1 : 2)) {
      this.sourceButton(sources, source);
    }
  }
  sourceButton(parent, source) {
    const button = this.iconButton(parent, source.url ? "external-link" : source.type === "git" ? "git-commit-horizontal" : "file-text", source.label);
    button.addClass("activity-source-button");
    button.addEventListener("click", () => void this.openSource(source));
  }
  async openSource(source) {
    if (source.url) {
      window.open(source.url, "_blank");
      return;
    }
    if (!source.path) {
      return;
    }
    const vaultFile = this.app.vault.getAbstractFileByPath(source.path);
    if (vaultFile instanceof import_obsidian4.TFile && vaultFile.extension === "md") {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(vaultFile);
      return;
    }
    if (source.type === "file" && isAbsolutePath(source.path)) {
      const error = await import_electron.shell.openPath(source.path);
      if (error) {
        new import_obsidian4.Notice(`\u65E0\u6CD5\u6253\u5F00\uFF1A${error}`);
      }
      return;
    }
    new SourceEvidenceModal(this.app, source).open();
  }
  async openArtifactNote(artifact) {
    const file = this.app.vault.getAbstractFileByPath(artifact.notePath);
    if (!(file instanceof import_obsidian4.TFile)) {
      new import_obsidian4.Notice("\u6210\u679C\u7B14\u8BB0\u5C1A\u672A\u5199\u5165\u6216\u5DF2\u88AB\u79FB\u52A8");
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: "markdown",
      active: true,
      state: { file: file.path, mode: "preview" }
    });
    await this.app.workspace.revealLeaf(leaf);
  }
  renderRangeMode(parent, value, onChange, prefix) {
    const segmented = parent.createDiv({ cls: "activity-range-mode" });
    for (const mode of ["day", "week"]) {
      const button = segmented.createEl("button", {
        text: mode === "day" ? "\u65E5" : "\u5468",
        cls: value === mode ? "is-active" : "",
        attr: { type: "button" }
      });
      button.dataset.testid = `${prefix}-mode-${mode}`;
      button.addEventListener("click", () => onChange(mode));
    }
  }
  renderRangeNavigation(parent, anchor, mode, onChange, prefix) {
    const navigation = parent.createDiv({ cls: "activity-ledger-date-nav" });
    this.iconButton(navigation, "chevron-left", "\u4E0A\u4E00\u8303\u56F4", `${prefix}-previous`).addEventListener("click", () => onChange(moveRangeAnchor(anchor, mode, -1)));
    navigation.createEl("h3", { text: mode === "day" ? dayLabel(dateKey(anchor)) : weekLabel(weekRange(anchor)) });
    this.iconButton(navigation, "chevron-right", "\u4E0B\u4E00\u8303\u56F4", `${prefix}-next`).addEventListener("click", () => onChange(moveRangeAnchor(anchor, mode, 1)));
    const today = this.iconTextButton(parent, "locate-fixed", "\u4ECA\u5929", `${prefix}-today`);
    today.addEventListener("click", () => onChange(/* @__PURE__ */ new Date()));
  }
  renderStatus(root) {
    const diagnostics = this.snapshot?.diagnostics;
    if (!diagnostics) {
      return;
    }
    const status = root.createDiv({ cls: "activity-ledger-status" });
    const outcomes = this.snapshot?.outcomes ?? [];
    const settled = outcomes.filter((outcome) => outcome.settlement.status === "succeeded").length;
    const pending = outcomes.filter((outcome) => outcome.settlement.status === "pending").length;
    const failed = outcomes.filter((outcome) => outcome.settlement.status === "failed").length;
    status.createSpan({ text: `Codex ${diagnostics.codexSessions} \u4E2A\u4EFB\u52A1` });
    status.createSpan({ text: `ChatGPT ${diagnostics.chatgptConversations} \u4E2A\u5BF9\u8BDD` });
    status.createSpan({ text: `\u98DE\u4E66 ${diagnostics.feishuRecords} \u6761\u6765\u6E90\u66F4\u65B0` });
    status.createSpan({ text: `Wiki ${diagnostics.wikiNotes} \u7BC7` });
    status.createSpan({ text: `Git ${diagnostics.gitRepositories} \u4E2A\u4ED3\u5E93` });
    status.createSpan({ text: `\u771F\u5B9E\u6210\u679C ${outcomes.length} \xB7 \u5DF2\u6C89\u6DC0 ${settled} \xB7 \u5F85\u6C89\u6DC0 ${pending} \xB7 \u5931\u8D25 ${failed}` });
    if (diagnostics.knowledgeQueue) {
      status.createSpan({
        text: `\u5F85\u6574\u7406 ${diagnostics.knowledgeQueue.remainingTopics} \u4E2A\u4E3B\u9898 \xB7 ${diagnostics.knowledgeQueue.remainingPairs} \u7EC4\u95EE\u7B54`
      });
      status.createSpan({
        text: `\u81EA\u52A8\u5316\u6709\u5185\u5BB9 ${diagnostics.knowledgeQueue.substantiveAutomationPairs} \u6B21 \xB7 \u7A7A\u8DD1\u5F52\u6863 ${diagnostics.knowledgeQueue.noOpAutomationPairs} \u6B21`
      });
    } else {
      status.createSpan({ text: `\u81EA\u52A8\u5316\u539F\u59CB\u8BB0\u5F55 ${diagnostics.excludedAutomations} \u6B21` });
    }
    if (!diagnostics.sessionIndexAvailable) {
      status.createSpan({ cls: "is-warning", text: "Codex \u4E3B\u7EBF\u7A0B\u7D22\u5F15\u4E0D\u53EF\u7528" });
    }
    if (diagnostics.malformedLines > 0) {
      status.createSpan({ cls: "is-warning", text: `\u8DF3\u8FC7\u574F\u884C ${diagnostics.malformedLines}` });
    }
    if (diagnostics.gitErrors.length > 0) {
      status.createSpan({
        cls: "is-warning",
        text: `Git \u8BFB\u53D6\u5F02\u5E38 ${diagnostics.gitErrors.length} \u9879`,
        attr: {
          title: diagnostics.gitErrors.join("\n"),
          "aria-label": `Git \u8BFB\u53D6\u5F02\u5E38\uFF1A${diagnostics.gitErrors.join("\uFF1B")}`
        }
      });
    }
    if (diagnostics.artifactWriteErrors.length > 0) {
      status.createSpan({
        cls: "is-warning",
        text: `\u6210\u679C\u5199\u5165\u5F02\u5E38 ${diagnostics.artifactWriteErrors.length} \u9879`,
        attr: {
          title: diagnostics.artifactWriteErrors.join("\n"),
          "aria-label": `\u6210\u679C\u5199\u5165\u5F02\u5E38\uFF1A${diagnostics.artifactWriteErrors.join("\uFF1B")}`
        }
      });
    }
    if (!diagnostics.settlementFileAvailable) {
      status.createSpan({ cls: "is-warning", text: "\u77E5\u8BC6\u6C89\u6DC0\u8D26\u672C\u5C1A\u672A\u5EFA\u7ACB" });
    }
    if (diagnostics.settlementErrors.length > 0) {
      status.createSpan({
        cls: "is-warning",
        text: `\u77E5\u8BC6\u6C89\u6DC0\u8D26\u672C\u5F02\u5E38 ${diagnostics.settlementErrors.length} \u9879`,
        attr: { title: diagnostics.settlementErrors.join("\n") }
      });
    }
    if (diagnostics.ingestHistoryErrors.length > 0) {
      status.createSpan({
        cls: "is-warning",
        text: `\u6574\u7406\u8BB0\u5F55\u5F02\u5E38 ${diagnostics.ingestHistoryErrors.length} \u9879`,
        attr: {
          title: diagnostics.ingestHistoryErrors.join("\n"),
          "aria-label": `\u6574\u7406\u8BB0\u5F55\u5F02\u5E38\uFF1A${diagnostics.ingestHistoryErrors.join("\uFF1B")}`
        }
      });
    }
  }
  renderState(parent, icon, message2, spinning) {
    const state = parent.createDiv({ cls: "activity-ledger-state" });
    const iconEl = state.createSpan({ cls: spinning ? "is-spinning" : "" });
    (0, import_obsidian4.setIcon)(iconEl, icon);
    state.createDiv({ text: message2 });
  }
  renderEmpty(parent, icon, message2) {
    const empty = parent.createDiv({ cls: "activity-empty" });
    const iconEl = empty.createSpan();
    (0, import_obsidian4.setIcon)(iconEl, icon);
    empty.createSpan({ text: message2 });
  }
  indicator(parent, kind, label, value) {
    const row = parent.createDiv({ cls: `activity-calendar-indicator is-${kind}` });
    row.createSpan({ cls: "activity-indicator-dot" });
    row.createSpan({ text: label });
    row.createSpan({ text: String(value) });
  }
  progressBar(parent, kind, label, value, max) {
    const item = parent.createDiv({ cls: `activity-progress is-${kind}` });
    item.createSpan({ text: label });
    const progress = item.createEl("progress", { attr: { max: String(max), value: String(value), "aria-label": `${label} ${value}` } });
    item.createSpan({ text: String(value) });
  }
  iconButton(parent, icon, label, testId) {
    const button = parent.createEl("button", {
      cls: "clickable-icon activity-icon-button",
      attr: { type: "button", "aria-label": label, title: label }
    });
    if (testId) {
      button.dataset.testid = testId;
    }
    (0, import_obsidian4.setIcon)(button, icon);
    return button;
  }
  iconTextButton(parent, icon, label, testId) {
    const button = parent.createEl("button", {
      cls: "activity-icon-text-button",
      attr: { type: "button", "aria-label": label }
    });
    if (testId) {
      button.dataset.testid = testId;
    }
    const iconEl = button.createSpan();
    (0, import_obsidian4.setIcon)(iconEl, icon);
    button.createSpan({ text: label });
    return button;
  }
  filteredEventsForMonth() {
    const grid = monthGrid(this.calendarAnchor);
    const start = grid[0]?.date ?? dateKey(this.calendarAnchor);
    const end = grid.at(-1)?.date ?? dateKey(this.calendarAnchor);
    return filterEvents(this.snapshot?.events ?? [], { start, end }, this.filters);
  }
  availableSources(sources) {
    return sources.filter(
      (source) => Boolean(source.url) || source.type === "git" || source.type === "file" || Boolean(source.path && this.app.vault.getAbstractFileByPath(source.path))
    );
  }
  ensureSelectedDate() {
    if (!this.snapshot || this.snapshot.events.some((event) => event.localDate === this.selectedDate)) {
      return;
    }
    const latest = this.snapshot.events.at(-1);
    if (latest) {
      this.selectedDate = latest.localDate;
      this.calendarAnchor = dateFromKey(latest.localDate);
    }
  }
};
var SourceEvidenceModal = class extends import_obsidian4.Modal {
  constructor(app, source) {
    super(app);
    this.source = source;
  }
  source;
  onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("activity-source-modal");
    this.contentEl.createEl("h2", { text: "\u539F\u59CB\u6765\u6E90" });
    this.contentEl.createDiv({ cls: "activity-source-label", text: this.source.label });
    if (this.source.path) {
      this.contentEl.createEl("code", {
        cls: "activity-source-path",
        text: `${this.source.path}${this.source.line ? `:${this.source.line}` : ""}`
      });
    }
    if (this.source.excerpt) {
      this.contentEl.createEl("pre", { cls: "activity-source-excerpt", text: this.source.excerpt });
    }
    const actions = this.contentEl.createDiv({ cls: "activity-source-actions" });
    const copy = actions.createEl("button", { text: "\u590D\u5236\u8DEF\u5F84", cls: "mod-cta" });
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(`${this.source.path ?? ""}${this.source.line ? `:${this.source.line}` : ""}`);
      new import_obsidian4.Notice("\u6765\u6E90\u8DEF\u5F84\u5DF2\u590D\u5236");
    });
    if (this.source.path && (this.source.type === "git" || this.source.type === "file")) {
      const open3 = actions.createEl("button", { text: "\u5728\u7CFB\u7EDF\u4E2D\u6253\u5F00" });
      open3.addEventListener("click", async () => {
        const error = await import_electron.shell.openPath(this.source.path ?? "");
        if (error) {
          new import_obsidian4.Notice(`\u65E0\u6CD5\u6253\u5F00\uFF1A${error}`);
        }
      });
    }
    const close = actions.createEl("button", { text: "\u5173\u95ED" });
    close.addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
};
function readableSummary(value) {
  const summary = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4).join(" ");
  return summary.length <= 320 ? summary : `${summary.slice(0, 319).trimEnd()}\u2026`;
}
function settlementLabel(status, category) {
  if (category === "durable-output" && status === "not-applicable") {
    return "\u5DF2\u8BB0\u5F55";
  }
  switch (status) {
    case "succeeded":
      return "\u5DF2\u6C89\u6DC0";
    case "pending":
      return "\u5F85\u6C89\u6DC0";
    case "failed":
      return "\u6C89\u6DC0\u5931\u8D25";
    case "not-applicable":
      return "\u65E0\u9700\u6C89\u6DC0";
  }
}
function settlementIcon(status, category) {
  if (category === "durable-output" && status === "not-applicable") {
    return "send";
  }
  switch (status) {
    case "succeeded":
      return "book-check";
    case "pending":
      return "clock-3";
    case "failed":
      return "circle-alert";
    case "not-applicable":
      return "minus";
  }
}
function eventIcon(event) {
  switch (event.kind) {
    case "task_completed":
      return "circle-check";
    case "task_blocked":
      return "circle-pause";
    case "task_started":
      return "play";
    case "task_progress":
      return "move-right";
    case "output_created":
      return "package-check";
    case "knowledge_created":
      return "book-plus";
    case "knowledge_updated":
      return "book-open-check";
    case "knowledge_reused":
      return "links";
    case "research_activity":
      return "messages-square";
  }
}
function metricIcon(dimension) {
  switch (dimension) {
    case "activity":
      return "activity";
    case "output":
      return "package-check";
    case "knowledge":
      return "book-open-check";
    case "reuse":
      return "links";
    case "focus":
      return "scan-eye";
  }
}
function ingestRunDisplay(run) {
  if (run.status === "running" && Date.now() - Date.parse(run.startedAt) > 6 * 60 * 60 * 1e3) {
    return { key: "stalled", label: "\u53EF\u80FD\u4E2D\u65AD", icon: "circle-alert" };
  }
  switch (run.status) {
    case "running":
      return { key: "running", label: "\u6574\u7406\u4E2D", icon: "loader-circle" };
    case "idle":
      return { key: "idle", label: "\u65E0\u9700\u5904\u7406", icon: "minus-circle" };
    case "succeeded":
      return { key: "succeeded", label: "\u5DF2\u5B8C\u6210", icon: "circle-check" };
    case "partial":
      return { key: "partial", label: "\u90E8\u5206\u5B8C\u6210", icon: "circle-dot-dashed" };
    case "failed":
      return { key: "failed", label: "\u5F85\u91CD\u8BD5", icon: "circle-alert" };
    case "unknown":
      return { key: "unknown", label: "\u65E7\u7248\u8BB0\u5F55", icon: "circle-help" };
  }
}
function ingestTriggerLabel(run) {
  if (run.source === "current-status") {
    return "\u6700\u8FD1\u786E\u8BA4\u7ED3\u679C";
  }
  if (run.trigger === "automatic") {
    return "\u591C\u95F4\u81EA\u52A8\u6574\u7406";
  }
  if (run.trigger === "manual") {
    return "\u624B\u52A8\u6574\u7406";
  }
  return "\u65E7\u7248\u8FD0\u884C";
}
function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
function durationLabel(start, end) {
  const duration = Math.max(0, Date.parse(end) - Date.parse(start));
  if (!Number.isFinite(duration)) {
    return "\u672A\u77E5";
  }
  if (duration < 6e4) {
    return `${Math.max(1, Math.round(duration / 1e3))} \u79D2`;
  }
  return `${Math.round(duration / 6e4)} \u5206\u949F`;
}
function isAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

// src/suite-service.ts
var import_node_crypto7 = require("node:crypto");
var import_node_child_process4 = require("node:child_process");
var import_promises9 = require("node:fs/promises");
var import_node_http = __toESM(require("node:http"), 1);
var import_node_os5 = require("node:os");
var import_node_path12 = __toESM(require("node:path"), 1);
var import_node_util4 = require("node:util");
var import_obsidian5 = require("obsidian");
var import_electron2 = require("electron");

// ../runtime/src/executable-discovery.mjs
var import_node_fs = require("node:fs");
var import_promises4 = require("node:fs/promises");
var import_node_os2 = require("node:os");
var import_node_path6 = __toESM(require("node:path"), 1);
var import_node_child_process2 = require("node:child_process");
var import_node_util2 = require("node:util");
var execFileAsync2 = (0, import_node_util2.promisify)(import_node_child_process2.execFile);
async function discoverExecutable(name, options = {}) {
  const platform = options.platform || process.platform;
  const home = options.home || (0, import_node_os2.homedir)();
  const env = options.env || process.env;
  const execute = options.execFile || execFileAsync2;
  const checkAccess = options.access || import_promises4.access;
  const readDirectory = options.readdir || import_promises4.readdir;
  const candidates = [];
  const configured = name === "codex" ? env.CODEX_BIN : env.LARK_CLI_BIN;
  if (configured) candidates.push({ path: configured, source: "configured" });
  for (const candidate of await locateFromPath(name, platform, env, execute)) {
    candidates.push({ path: candidate, source: "path" });
  }
  if (platform === "win32") {
    candidates.push(...await windowsCandidates(name, home, env, readDirectory));
  } else {
    const common = [
      ...splitPath(env.PATH, platform).map((directory) => import_node_path6.default.join(directory, name)),
      import_node_path6.default.join(home, ".local", "bin", name),
      import_node_path6.default.join(home, ".npm-global", "bin", name),
      import_node_path6.default.join(home, ".volta", "bin", name),
      import_node_path6.default.join(home, ".asdf", "shims", name),
      import_node_path6.default.join(home, ".local", "share", "mise", "shims", name),
      import_node_path6.default.join(home, ".bun", "bin", name),
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
      `/usr/bin/${name}`
    ];
    for (const directory of await nodeVersionBins(home, readDirectory)) common.push(import_node_path6.default.join(directory, name));
    candidates.push(...common.map((candidate) => ({ path: candidate, source: "common-location" })));
  }
  for (const candidate of uniqueCandidates(candidates)) {
    const resolved = await normalizeCandidate(name, candidate.path, platform, checkAccess);
    if (!resolved) continue;
    const probe = await probeExecutable(name, resolved, env, execute);
    if (probe.supported) return { path: resolved, source: candidate.source, version: probe.version };
  }
  return null;
}
async function probeCodexExecutor(executable, options = {}) {
  if (!executable) return { supported: false, error: "\u672A\u627E\u5230 Codex CLI" };
  const execute = options.execFile || execFileAsync2;
  try {
    const commandOptions = {
      env: options.env || process.env,
      timeout: options.timeout || 8e3,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    };
    await execute(executable, ["exec", "--help"], commandOptions);
    await execute(executable, ["login", "status"], commandOptions);
    return { supported: true, error: null };
  } catch (error) {
    return { supported: false, error: safeError(error, "Codex \u6574\u7406\u6267\u884C\u5668\u63A2\u6D3B\u5931\u8D25") };
  }
}
async function windowsCandidates(name, home, env, readDirectory) {
  const p = import_node_path6.default.win32;
  const localAppData = env.LOCALAPPDATA || p.join(home, "AppData", "Local");
  const appData = env.APPDATA || p.join(home, "AppData", "Roaming");
  const candidates = [];
  if (name === "codex") {
    const runtimeRoot = p.join(localAppData, "OpenAI", "Codex", "bin");
    try {
      const versions = (await readDirectory(runtimeRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
      for (const version of versions) {
        candidates.push({ path: p.join(runtimeRoot, version, "codex.exe"), source: "desktop-runtime" });
      }
    } catch {
    }
    candidates.push({ path: p.join(localAppData, "OpenAI", "Codex", "codex.exe"), source: "desktop-runtime" });
    for (const [packageName, vendor] of [
      ["codex-win32-x64", "x86_64-pc-windows-msvc"],
      ["codex-win32-arm64", "aarch64-pc-windows-msvc"]
    ]) {
      candidates.push({ path: p.join(
        appData,
        "npm",
        "node_modules",
        "@openai",
        "codex",
        "node_modules",
        "@openai",
        packageName,
        "vendor",
        vendor,
        "bin",
        "codex.exe"
      ), source: "common-location" });
    }
  }
  if (name === "lark-cli") {
    candidates.push({ path: p.join(appData, "npm", "node_modules", "@larksuite", "cli", "bin", "lark-cli.exe"), source: "common-location" });
  }
  return candidates;
}
async function locateFromPath(name, platform, env, execute) {
  const locator = platform === "win32" ? "where.exe" : "/usr/bin/which";
  try {
    const result2 = await execute(locator, [name], { env, timeout: 5e3, windowsHide: true });
    return String(result2.stdout || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
async function normalizeCandidate(name, candidate, platform, checkAccess) {
  const p = platform === "win32" ? import_node_path6.default.win32 : import_node_path6.default;
  if (platform === "win32" && name === "lark-cli" && /lark-cli\.cmd$/i.test(candidate)) {
    const native = p.join(p.dirname(candidate), "node_modules", "@larksuite", "cli", "bin", "lark-cli.exe");
    return await isExecutable(native, checkAccess, false) ? native : null;
  }
  if (platform === "win32" && name === "codex" && /codex\.cmd$/i.test(candidate)) {
    const native = p.join(
      p.dirname(candidate),
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      "codex-win32-x64",
      "vendor",
      "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe"
    );
    return await isExecutable(native, checkAccess, false) ? native : null;
  }
  if (platform === "win32" && /\.cmd$/i.test(candidate)) return null;
  return await isExecutable(candidate, checkAccess, platform !== "win32") ? candidate : null;
}
async function probeExecutable(name, candidate, env, execute) {
  try {
    const result2 = await execute(candidate, ["--version"], {
      env,
      timeout: 8e3,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    const output = `${result2.stdout || ""}
${result2.stderr || ""}`.trim();
    return { supported: true, version: output.split(/\r?\n/).find(Boolean)?.slice(0, 160) || null };
  } catch (error) {
    return { supported: false, version: null, error: safeError(error, `${name} --version \u63A2\u6D3B\u5931\u8D25`) };
  }
}
async function isExecutable(candidate, checkAccess, requireExecute = true) {
  try {
    await checkAccess(candidate, requireExecute ? import_node_fs.constants.X_OK : import_node_fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
async function nodeVersionBins(home, readDirectory) {
  const root = import_node_path6.default.join(home, ".nvm", "versions", "node");
  try {
    const versions = (await readDirectory(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
    return versions.map((version) => import_node_path6.default.join(root, version, "bin"));
  } catch {
    return [];
  }
}
function splitPath(value, platform) {
  return String(value || "").split(platform === "win32" ? ";" : ":").map((item) => item.trim()).filter(Boolean);
}
function uniqueCandidates(values) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((item) => {
    const key = String(item.path || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function safeError(error, fallback) {
  const value = error instanceof Error ? error.message : String(error || fallback);
  return value.replace(/[\r\n]+/g, " ").slice(0, 240) || fallback;
}

// ../runtime/src/codex-desktop-source.mjs
var import_promises6 = require("node:fs/promises");
var import_node_os4 = require("node:os");
var import_node_path8 = __toESM(require("node:path"), 1);

// ../runtime/src/common.mjs
var import_node_crypto5 = require("node:crypto");
var import_promises5 = require("node:fs/promises");
var import_node_os3 = require("node:os");
var import_node_path7 = __toESM(require("node:path"), 1);
function localDate(value = /* @__PURE__ */ new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function sha256(value) {
  return (0, import_node_crypto5.createHash)("sha256").update(value).digest("hex");
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function redactText(input) {
  let text = String(input || "");
  const rules = [
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, "[\u5DF2\u9690\u85CF\u79C1\u94A5]"],
    [/\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, "[\u5DF2\u9690\u85CF\u5BC6\u94A5]"],
    [/\b(?:ghp|github_pat|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{16,}\b/g, "[\u5DF2\u9690\u85CF GitHub \u51ED\u636E]"],
    [/\bAKIA[0-9A-Z]{16}\b/g, "[\u5DF2\u9690\u85CF\u4E91\u51ED\u636E]"],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[\u5DF2\u9690\u85CF\u4EE4\u724C]"],
    [/\b(authorization|api[_ -]?key|access[_ -]?token|password|passwd|secret)\s*[:=]\s*["']?[^\s,"']{6,}/gi, "$1=[\u5DF2\u9690\u85CF]"],
    [/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@/gi, "$1://[\u5DF2\u9690\u85CF]@"]
  ];
  for (const [pattern, replacement] of rules) text = text.replace(pattern, replacement);
  return text;
}
async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await (0, import_promises5.readFile)(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
async function atomicJson(filePath, value) {
  await (0, import_promises5.mkdir)(import_node_path7.default.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await (0, import_promises5.writeFile)(temporary, `${JSON.stringify(value, null, 2)}
`, "utf8");
  await (0, import_promises5.rename)(temporary, filePath);
}
async function appendJsonLine(filePath, value) {
  await (0, import_promises5.mkdir)(import_node_path7.default.dirname(filePath), { recursive: true });
  const handle = await (0, import_promises5.open)(filePath, "a");
  try {
    await handle.write(`${JSON.stringify(value)}
`, null, "utf8");
  } finally {
    await handle.close();
  }
}

// ../runtime/src/codex-desktop-source.mjs
var STATE_SCHEMA = 1;
var SOURCE_TYPE = "codex_desktop_sessions_v1";
var CAPTURE_SOURCE = "codex_desktop";
var DEFAULT_STALE_MS = 36 * 60 * 6e4;
var DEFAULT_BOOTSTRAP_LOOKBACK_MS = 24 * 60 * 6e4;
var VERIFIED_PRODUCER_MINORS = /* @__PURE__ */ new Set([144, 147]);
async function syncCodexDesktop(options) {
  const vault = import_node_path8.default.resolve(options.vault);
  const codexHome = import_node_path8.default.resolve(options.codexHome || process.env.CODEX_HOME || import_node_path8.default.join((0, import_node_os4.homedir)(), ".codex"));
  const sessionsRoot = import_node_path8.default.join(codexHome, "sessions");
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const nowIso = now.toISOString();
  const statePath = import_node_path8.default.join(vault, "raw", "codex", "sources", "desktop-state.json");
  const previous = normalizeState(await readJson(statePath, null));
  const state = { ...previous, checkpoints: { ...previous.checkpoints }, last_sync_at: nowIso };
  let files;
  try {
    files = (await listJsonlFiles(sessionsRoot, options.readdir || import_promises6.readdir)).slice(-500);
    state.configured = true;
  } catch (error) {
    const health = failureHealth(state, now, `\u65E0\u6CD5\u8BFB\u53D6 Codex Desktop \u4F1A\u8BDD\u76EE\u5F55\uFF1A${safeError2(error)}`);
    await atomicJson(statePath, health);
    return result(health, 0, 0, 0);
  }
  const knownIds = await readKnownEventIds(import_node_path8.default.join(vault, "raw", "codex", "events"));
  const rawLastEventAt = await readLastCodexEventAt(import_node_path8.default.join(vault, "raw", "codex", "events"));
  const bootstrapAfter = rawLastEventAt || new Date(now.getTime() - (options.bootstrapLookbackMs ?? DEFAULT_BOOTSTRAP_LOOKBACK_MS)).toISOString();
  const inspectedMetadata = await inspectNewestDesktopMetadata(sessionsRoot).catch(() => null);
  const appended = [];
  const errors = [];
  let supportedFiles = inspectedMetadata && supportedProducer(inspectedMetadata.producer_version) ? 1 : 0;
  let duplicates = 0;
  let completedTurns = 0;
  for (const file of files) {
    const relative = import_node_path8.default.relative(sessionsRoot, file).split(import_node_path8.default.sep).join("/");
    const previousCheckpoint = normalizeCheckpoint(state.checkpoints[relative]);
    try {
      const info = await (0, import_promises6.stat)(file);
      const startOffset = info.size < previousCheckpoint.offset ? 0 : Math.min(previousCheckpoint.offset, info.size);
      const bootstrapCutoff = Math.min(Date.parse(bootstrapAfter), now.getTime() - 5 * 6e4);
      if (previousCheckpoint.offset === 0 && !previousCheckpoint.session_id && info.mtimeMs <= bootstrapCutoff) {
        state.checkpoints[relative] = { ...previousCheckpoint, offset: info.size, size: info.size, mtime_ms: info.mtimeMs };
        continue;
      }
      if (startOffset === info.size) {
        state.checkpoints[relative] = { ...previousCheckpoint, size: info.size, mtime_ms: info.mtimeMs };
        if (previousCheckpoint.originator === "Codex Desktop" && supportedProducer(previousCheckpoint.producer_version)) supportedFiles += 1;
        continue;
      }
      let checkpoint = { ...previousCheckpoint };
      if (startOffset > 0 && !checkpoint.session_id) {
        const metadataRecords = parseLines((await readFileRange(file, 0, Math.min(info.size, 2 * 1024 * 1024))).toString("utf8"), true).records;
        checkpoint = normalizeDesktopRecords(metadataRecords, checkpoint).checkpoint;
      }
      const slice = await readFileRange(file, startOffset, info.size - startOffset);
      const lastNewline = slice.lastIndexOf(10);
      if (lastNewline < 0) continue;
      const completeBytes = slice.subarray(0, lastNewline + 1);
      checkpoint = { ...checkpoint, offset: startOffset + lastNewline + 1, size: info.size, mtime_ms: info.mtimeMs };
      const parsed = parseLines(completeBytes.toString("utf8"));
      if (parsed.invalid > 0) {
        errors.push(`${relative}: \u7ED3\u6784\u5316\u4E8B\u4EF6\u5305\u542B ${parsed.invalid} \u884C\u65E0\u6CD5\u89E3\u6790\uFF0C\u6E38\u6807\u672A\u63A8\u8FDB`);
        continue;
      }
      const records = parsed.records;
      const normalized = normalizeDesktopRecords(records, checkpoint, {
        bootstrapAfter: previousCheckpoint.offset > 0 ? null : bootstrapAfter
      });
      if (normalized.desktop && normalized.supported) supportedFiles += 1;
      if (normalized.error) {
        errors.push(`${relative}: ${normalized.error}\uFF0C\u6E38\u6807\u672A\u63A8\u8FDB`);
        continue;
      }
      state.checkpoints[relative] = normalized.checkpoint;
      for (const event of normalized.events) {
        if (knownIds.has(event.event_id)) {
          duplicates += 1;
          continue;
        }
        knownIds.add(event.event_id);
        appended.push(event);
        if (event.event === "Stop") completedTurns += 1;
      }
    } catch (error) {
      errors.push(`${relative}: ${safeError2(error)}`);
    }
  }
  appended.sort((left, right) => left.captured_at.localeCompare(right.captured_at));
  for (const event of appended) {
    await appendJsonLine(import_node_path8.default.join(vault, "raw", "codex", "events", `${event.date}.jsonl`), event);
  }
  const newest = appended.reduce((value, event) => maxIso(value, event.captured_at), state.last_event_at || null);
  state.supported = supportedFiles > 0;
  state.producer_versions = [...new Set([...Object.values(state.checkpoints).filter((item) => item?.originator === "Codex Desktop" && item?.producer_version).map((item) => item.producer_version), inspectedMetadata?.producer_version].filter(Boolean))].sort();
  state.last_seen_at = supportedFiles > 0 ? nowIso : state.last_seen_at;
  state.last_event_at = newest;
  state.error = errors.length > 0 ? errors.slice(0, 3).join("\uFF1B").slice(0, 600) : supportedFiles === 0 ? "\u5C1A\u672A\u53D1\u73B0\u53D7\u652F\u6301\u7684 Codex Desktop \u4F1A\u8BDD" : null;
  state.stale = isStale(state.last_event_at, now, options.staleAfterMs ?? DEFAULT_STALE_MS);
  await atomicJson(statePath, state);
  return result(state, appended.length, duplicates, completedTurns);
}
async function readCodexDesktopHealth(options) {
  const vault = import_node_path8.default.resolve(options.vault);
  const codexHome = import_node_path8.default.resolve(options.codexHome || process.env.CODEX_HOME || import_node_path8.default.join((0, import_node_os4.homedir)(), ".codex"));
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const state = normalizeState(await readJson(import_node_path8.default.join(vault, "raw", "codex", "sources", "desktop-state.json"), null));
  try {
    await (0, import_promises6.stat)(import_node_path8.default.join(codexHome, "sessions"));
    state.configured = true;
    const metadata = await inspectNewestDesktopMetadata(import_node_path8.default.join(codexHome, "sessions"));
    if (metadata) {
      state.supported = supportedProducer(metadata.producer_version);
      state.last_seen_at = now.toISOString();
      state.producer_versions = [metadata.producer_version].filter(Boolean);
      state.error = state.supported ? state.error?.startsWith("\u4E0D\u652F\u6301\u7684 Codex Desktop \u6570\u636E\u7248\u672C") ? null : state.error : `\u4E0D\u652F\u6301\u7684 Codex Desktop \u6570\u636E\u7248\u672C ${metadata.producer_version || "\u672A\u77E5"}`;
    } else if (!state.supported) {
      state.error = state.error || "\u5C1A\u672A\u53D1\u73B0\u53EF\u8BC6\u522B\u7684 Codex Desktop \u4F1A\u8BDD";
    }
  } catch {
    state.configured = false;
    state.supported = false;
    state.error = "\u672A\u627E\u5230 Codex Desktop \u4F1A\u8BDD\u76EE\u5F55";
  }
  state.stale = isStale(state.last_event_at, now, options.staleAfterMs ?? DEFAULT_STALE_MS);
  return publicHealth(state);
}
async function inspectNewestDesktopMetadata(sessionsRoot) {
  const files = (await listJsonlFiles(sessionsRoot, import_promises6.readdir)).slice(-30).reverse();
  for (const file of files) {
    let text;
    try {
      text = (await readFileRange(file, 0, 2 * 1024 * 1024)).toString("utf8");
    } catch {
      continue;
    }
    for (const record of parseLines(text, true).records.slice(0, 80)) {
      if (record?.type !== "session_meta") continue;
      if (record.payload?.originator === "Codex Desktop") {
        return { producer_version: stringValue4(record.payload?.cli_version) };
      }
      break;
    }
  }
  return null;
}
async function readFileRange(file, position, length) {
  if (length <= 0) return Buffer.alloc(0);
  const handle = await (0, import_promises6.open)(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
async function readLastCodexEventAt(eventsRoot, captureSource) {
  let names;
  try {
    names = (await (0, import_promises6.readdir)(eventsRoot)).filter((name) => name.endsWith(".jsonl")).sort().reverse();
  } catch {
    return null;
  }
  let latest = null;
  for (const name of names) {
    let text;
    try {
      text = await (0, import_promises6.readFile)(import_node_path8.default.join(eventsRoot, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      try {
        const item = JSON.parse(line);
        if (captureSource && item.capture_source !== captureSource) continue;
        if (typeof item.captured_at === "string") latest = maxIso(latest, item.captured_at);
      } catch {
      }
    }
    if (latest && !captureSource) break;
  }
  return latest;
}
function normalizeDesktopRecords(records, baseCheckpoint = {}, options = {}) {
  const checkpoint = normalizeCheckpoint(baseCheckpoint);
  const events = [];
  let activeTurnId = checkpoint.active_turn_id || null;
  let desktop = checkpoint.originator === "Codex Desktop";
  let supported = desktop && supportedProducer(checkpoint.producer_version);
  let error = null;
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    if (record.type === "session_meta") {
      const payload2 = record.payload || {};
      checkpoint.session_id = stringValue4(payload2.id || payload2.session_id);
      checkpoint.cwd = stringValue4(payload2.cwd);
      checkpoint.originator = stringValue4(payload2.originator);
      checkpoint.producer_version = stringValue4(payload2.cli_version);
      checkpoint.is_subagent = Boolean(payload2.source?.subagent);
      desktop = checkpoint.originator === "Codex Desktop";
      supported = desktop && supportedProducer(checkpoint.producer_version);
      if (desktop && !supported) error = `\u4E0D\u652F\u6301\u7684 Codex Desktop \u6570\u636E\u7248\u672C ${checkpoint.producer_version || "\u672A\u77E5"}`;
      continue;
    }
    if (!desktop || !supported || checkpoint.is_subagent) continue;
    if (!checkpoint.session_id) {
      error = "\u4F1A\u8BDD\u7F3A\u5C11 session_meta.id";
      continue;
    }
    const payload = record.payload || {};
    if (record.type === "event_msg" && payload.type === "task_started") {
      activeTurnId = stringValue4(payload.turn_id);
      checkpoint.active_turn_id = activeTurnId;
      continue;
    }
    if (record.type === "turn_context" && payload.turn_id) {
      activeTurnId = stringValue4(payload.turn_id);
      checkpoint.active_turn_id = activeTurnId;
      if (payload.cwd) checkpoint.cwd = stringValue4(payload.cwd);
      continue;
    }
    if (record.type !== "event_msg") continue;
    const capturedAt = validIso(record.timestamp) || validIso(payload.completed_at) || null;
    if (!capturedAt || options.bootstrapAfter && capturedAt <= options.bootstrapAfter) continue;
    if (payload.type === "user_message") {
      if (!activeTurnId) {
        error = "\u7528\u6237\u6D88\u606F\u7F3A\u5C11\u53EF\u5173\u8054\u7684 turn_id";
        continue;
      }
      const event = createEvent("UserPromptSubmit", capturedAt, checkpoint, activeTurnId, payload.message);
      if (event) events.push(event);
      continue;
    }
    if (payload.type === "task_complete" || payload.type === "turn_aborted") {
      const turnId = stringValue4(payload.turn_id || activeTurnId);
      if (!turnId) {
        error = "\u5B8C\u6210\u4E8B\u4EF6\u7F3A\u5C11 turn_id";
        continue;
      }
      const content = payload.type === "turn_aborted" ? "\u672C\u8F6E\u4EFB\u52A1\u5DF2\u4E2D\u6B62" : payload.last_agent_message;
      const event = createEvent("Stop", capturedAt, checkpoint, turnId, content);
      if (event) events.push(event);
      if (turnId === activeTurnId) {
        activeTurnId = null;
        checkpoint.active_turn_id = null;
      }
    }
  }
  return { desktop, supported, error, checkpoint, events };
}
function createEvent(event, capturedAt, checkpoint, turnId, content) {
  const safeContent = redactText(content).trim();
  if (!safeContent) return null;
  const record = {
    schema_version: 1,
    source: "codex",
    capture_source: CAPTURE_SOURCE,
    producer_version: checkpoint.producer_version,
    event,
    captured_at: capturedAt,
    date: localDate(new Date(capturedAt)),
    session_id: checkpoint.session_id,
    turn_id: turnId,
    cwd: checkpoint.cwd || void 0,
    content: safeContent
  };
  record.event_id = `codex:${sha256(canonicalJson({
    event: record.event,
    session_id: record.session_id,
    turn_id: record.turn_id,
    cwd: record.cwd,
    content: record.content
  })).slice(0, 32)}`;
  return record;
}
async function listJsonlFiles(root, readDirectory) {
  const files = [];
  async function visit(directory) {
    const entries = await readDirectory(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = import_node_path8.default.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(target);
    }
  }
  await visit(root);
  return files.sort();
}
async function readKnownEventIds(eventsRoot) {
  const ids = /* @__PURE__ */ new Set();
  let names;
  try {
    names = (await (0, import_promises6.readdir)(eventsRoot)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return ids;
  }
  for (const name of names) {
    let text;
    try {
      text = await (0, import_promises6.readFile)(import_node_path8.default.join(eventsRoot, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      try {
        const item = JSON.parse(line);
        if (item.event_id) ids.add(String(item.event_id));
      } catch {
      }
    }
  }
  return ids;
}
function parseLines(text, allowTrailingPartial = false) {
  const records = [];
  const lines = text.split(/\r?\n/);
  if (allowTrailingPartial && !/\r?\n$/.test(text)) lines.pop();
  let invalid = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      invalid += 1;
    }
  }
  return { records, invalid };
}
function supportedProducer(value) {
  const match2 = String(value || "").match(/^(\d+)\.(\d+)\./);
  if (!match2) return false;
  const major = Number(match2[1]);
  const minor = Number(match2[2]);
  return major === 0 && VERIFIED_PRODUCER_MINORS.has(minor);
}
function normalizeState(value) {
  return {
    schema_version: STATE_SCHEMA,
    source_type: SOURCE_TYPE,
    configured: Boolean(value?.configured),
    supported: Boolean(value?.supported),
    last_seen_at: validIso(value?.last_seen_at),
    last_event_at: validIso(value?.last_event_at),
    last_sync_at: validIso(value?.last_sync_at),
    stale: Boolean(value?.stale),
    error: typeof value?.error === "string" ? value.error : null,
    producer_versions: Array.isArray(value?.producer_versions) ? value.producer_versions.map(stringValue4).filter(Boolean) : [],
    checkpoints: value?.checkpoints && typeof value.checkpoints === "object" ? value.checkpoints : {}
  };
}
function normalizeCheckpoint(value) {
  return {
    offset: Math.max(0, Number(value?.offset || 0)),
    size: Math.max(0, Number(value?.size || 0)),
    mtime_ms: Math.max(0, Number(value?.mtime_ms || 0)),
    session_id: stringValue4(value?.session_id),
    cwd: stringValue4(value?.cwd),
    originator: stringValue4(value?.originator),
    producer_version: stringValue4(value?.producer_version),
    is_subagent: Boolean(value?.is_subagent),
    active_turn_id: stringValue4(value?.active_turn_id) || null
  };
}
function failureHealth(state, now, error) {
  return { ...state, configured: false, supported: false, last_sync_at: now.toISOString(), stale: true, error };
}
function result(state, accepted, duplicates, completedTurns) {
  return { ...publicHealth(state), accepted, duplicates, completed_turns: completedTurns };
}
function publicHealth(state) {
  return {
    source_type: SOURCE_TYPE,
    configured: Boolean(state.configured),
    supported: Boolean(state.supported),
    last_seen_at: state.last_seen_at || null,
    last_event_at: state.last_event_at || null,
    stale: Boolean(state.stale),
    error: state.error || null,
    producer_versions: state.producer_versions || []
  };
}
function isStale(value, now, threshold) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return !Number.isFinite(parsed) || now.getTime() - parsed > threshold;
}
function validIso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
function maxIso(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}
function stringValue4(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1e3) : "";
}
function safeError2(error) {
  return String(error instanceof Error ? error.message : error).replace(/[\r\n]+/g, " ").slice(0, 300);
}

// ../runtime/src/knowledge-scheduler.mjs
var import_node_path9 = __toESM(require("node:path"), 1);
var import_promises7 = require("node:fs/promises");
var STATE_SCHEMA2 = 1;
var BASE_RETRY_MS = 5 * 6e4;
var MAX_RETRY_MS = 6 * 60 * 6e4;
var LEGACY_RUNNING_STALE_MS = 90 * 6e4;
var ORPHAN_RUNNING_GRACE_MS = 2 * 6e4;
var ABSOLUTE_RUNNING_STALE_MS = 6 * 60 * 6e4;
async function readScheduleState(options) {
  const target = schedulePath(options.vault);
  const now = toDate2(options.now);
  const state = normalizeState2(await readJson(target, null), now);
  if (options.recoverStale === false) return state;
  if (state.status !== "running" || !options.recoverInterrupted && !staleRunning(state, now)) return state;
  const recovered = {
    ...state,
    status: "backoff",
    next_due: new Date(now.getTime() + BASE_RETRY_MS).toISOString(),
    error: "\u4E0A\u6B21\u6574\u7406\u8FDB\u7A0B\u5728\u8FD0\u884C\u4E2D\u4E2D\u65AD\uFF0C\u5C06\u81EA\u52A8\u91CD\u8BD5",
    failure_count: Math.max(1, Number(state.failure_count || 0) + 1),
    owner_pid: null
  };
  await atomicJson(target, recovered);
  return recovered;
}
async function runDueKnowledgeCycle(options) {
  const vault = import_node_path9.default.resolve(options.vault);
  const now = toDate2(options.now);
  let state = await readScheduleState({ vault, now, recoverInterrupted: options.recoverInterrupted });
  const [lastCycle, queue] = await Promise.all([
    readJson(import_node_path9.default.join(vault, "raw", "codex", "automation", "last-cycle.json"), null),
    readJson(import_node_path9.default.join(vault, "raw", "codex", "ingest-status.json"), null)
  ]);
  state = await repairLegacyFailedSchedule({ vault, state, lastCycle, queue, newActivity: options.newActivity, now });
  const decision = evaluateSchedule({
    now,
    state,
    lastCycle,
    queue,
    newActivity: options.newActivity,
    executorReady: options.executorReady
  });
  if (!decision.due) {
    if (decision.reason === "already-running") return { ran: false, ok: true, reason: decision.reason, state };
    state = await markScheduleIdle({ vault, state, now, nextDue: decision.next_due });
    return { ran: false, ok: true, reason: decision.reason, state };
  }
  state = await beginScheduleAttempt({ vault, state, now, trigger: decision.reason });
  try {
    await options.run(decision.reason);
    state = await finishScheduleAttempt({ vault, state, now: options.finishedAt || /* @__PURE__ */ new Date(), ok: true });
    return { ran: true, ok: true, reason: decision.reason, state };
  } catch (error) {
    state = await finishScheduleAttempt({ vault, state, now: options.finishedAt || /* @__PURE__ */ new Date(), ok: false, error });
    return { ran: true, ok: false, reason: decision.reason, state, error: safeError3(error) };
  }
}
function evaluateSchedule(options) {
  const now = toDate2(options.now);
  const state = normalizeState2(options.state, now);
  const lastSuccess = validIso2(state.last_success) || successfulCycleTime(options.lastCycle);
  const readyTopics = Math.max(0, Number(options.queue?.ready_topics ?? options.queue?.candidate_topics ?? 0));
  const hasWork = readyTopics > 0 || Boolean(options.newActivity);
  if (state.status === "running") return { due: false, reason: "already-running", next_due: state.next_due };
  if (!options.executorReady) return state.status === "backoff" ? { due: false, reason: "executor-unavailable", next_due: backoffProbeDue(state.next_due, now) } : { due: false, reason: "executor-unavailable", next_due: futureDue(state.next_due, now) };
  if (state.next_due && state.status === "backoff" && Date.parse(state.next_due) > now.getTime()) {
    return { due: false, reason: "backoff", next_due: state.next_due };
  }
  if (!hasWork) return { due: false, reason: "queue-empty", next_due: nextDailyDue(now).toISOString() };
  if (state.status === "backoff") return { due: true, reason: "retry-after-backoff", next_due: null };
  if (!lastSuccess) return { due: true, reason: options.newActivity ? "first-activity-catchup" : "first-startup-catchup", next_due: null };
  const today = localDate(now);
  const lastDate = localDate(new Date(lastSuccess));
  if (lastDate < today) return { due: true, reason: "missed-day-catchup", next_due: null };
  const dailyDue = dailyDueFor(now);
  if (now.getTime() >= dailyDue.getTime()) return { due: true, reason: "daily-2330", next_due: null };
  return { due: false, reason: "waiting-daily-time", next_due: dailyDue.toISOString() };
}
async function markScheduleIdle(options) {
  const now = toDate2(options.now);
  const state = normalizeState2(options.state, now);
  const requestedDue = validIso2(options.nextDue);
  const keepBackoff = state.status === "backoff" && Boolean(
    state.next_due && Date.parse(state.next_due) > now.getTime() || requestedDue && Date.parse(requestedDue) > now.getTime()
  );
  const nextDue = keepBackoff ? laterFutureDue(state.next_due, requestedDue, now) : requestedDue || nextDailyDue(now).toISOString();
  const updated = { ...state, status: keepBackoff ? "backoff" : "idle", next_due: nextDue };
  const target = schedulePath(options.vault);
  if (JSON.stringify(updated) !== JSON.stringify(state) || !await exists(target)) await atomicJson(target, updated);
  return updated;
}
async function beginScheduleAttempt(options) {
  const now = toDate2(options.now);
  const state = normalizeState2(options.state, now);
  const updated = {
    ...state,
    last_attempt: now.toISOString(),
    next_due: null,
    status: "running",
    error: null,
    trigger: String(options.trigger || "automatic").slice(0, 80),
    owner_pid: process.pid
  };
  await atomicJson(schedulePath(options.vault), updated);
  return updated;
}
async function finishScheduleAttempt(options) {
  const now = toDate2(options.now);
  const state = normalizeState2(options.state, now);
  if (options.ok) {
    const updated2 = {
      ...state,
      last_attempt: state.last_attempt || now.toISOString(),
      last_success: now.toISOString(),
      next_due: nextDailyDue(now).toISOString(),
      status: "succeeded",
      error: null,
      failure_count: 0,
      owner_pid: null
    };
    await atomicJson(schedulePath(options.vault), updated2);
    return updated2;
  }
  const failureCount = Math.max(1, Number(state.failure_count || 0) + 1);
  const delay = retryDelay(failureCount);
  const updated = {
    ...state,
    last_attempt: state.last_attempt || now.toISOString(),
    next_due: new Date(now.getTime() + delay).toISOString(),
    status: "backoff",
    error: safeError3(options.error),
    failure_count: failureCount,
    owner_pid: null
  };
  await atomicJson(schedulePath(options.vault), updated);
  return updated;
}
async function repairLegacyFailedSchedule(options) {
  const state = normalizeState2(options.state, options.now);
  const failure = failedCycleEvidence(options.lastCycle);
  const readyTopics = Math.max(0, Number(options.queue?.ready_topics ?? options.queue?.candidate_topics ?? 0));
  const lastSuccess = validIso2(state.last_success);
  const failureIsCovered = lastSuccess && Date.parse(lastSuccess) >= Date.parse(failure?.finished_at || "");
  if (!failure || failureIsCovered || state.status === "running" || state.status === "backoff" || readyTopics === 0 && !options.newActivity) return state;
  const failureCount = Math.max(1, Number(state.failure_count || 0));
  const attemptedAt = [validIso2(state.last_attempt), failure.finished_at].filter(Boolean).map((value) => Date.parse(value));
  const retryBase = attemptedAt.length > 0 ? Math.max(...attemptedAt) : toDate2(options.now).getTime();
  const updated = {
    ...state,
    status: "backoff",
    next_due: new Date(retryBase + retryDelay(failureCount)).toISOString(),
    error: state.error || `\u4E0A\u6B21\u6574\u7406\u72B6\u6001\u4E3A ${failure.status}\uFF0C\u5C06\u81EA\u52A8\u91CD\u8BD5`,
    failure_count: failureCount,
    owner_pid: null
  };
  await atomicJson(schedulePath(options.vault), updated);
  return updated;
}
function normalizeState2(value, now = /* @__PURE__ */ new Date()) {
  return {
    schema_version: STATE_SCHEMA2,
    last_attempt: validIso2(value?.last_attempt),
    last_success: validIso2(value?.last_success),
    next_due: validIso2(value?.next_due) || nextDailyDue(toDate2(now)).toISOString(),
    status: ["idle", "running", "succeeded", "backoff"].includes(value?.status) ? value.status : "idle",
    error: typeof value?.error === "string" && value.error ? value.error.slice(0, 500) : null,
    failure_count: Math.max(0, Number(value?.failure_count || 0)),
    trigger: typeof value?.trigger === "string" ? value.trigger.slice(0, 80) : null,
    owner_pid: Number.isInteger(value?.owner_pid) && value.owner_pid > 0 ? value.owner_pid : null
  };
}
function schedulePath(vault) {
  return import_node_path9.default.join(import_node_path9.default.resolve(vault), "raw", "codex", "automation", "schedule-state.json");
}
function dailyDueFor(now) {
  const due = new Date(now);
  due.setHours(23, 30, 0, 0);
  return due;
}
function nextDailyDue(now) {
  const due = dailyDueFor(now);
  if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1);
  return due;
}
function futureDue(value, now) {
  return value && Date.parse(value) > now.getTime() ? value : nextDailyDue(now).toISOString();
}
function backoffProbeDue(value, now) {
  return value && Date.parse(value) > now.getTime() ? value : new Date(now.getTime() + BASE_RETRY_MS).toISOString();
}
function laterFutureDue(current, requested, now) {
  const candidates = [validIso2(current), validIso2(requested)].filter((value) => value && Date.parse(value) > now.getTime());
  return candidates.sort((left, right) => Date.parse(right) - Date.parse(left))[0] || new Date(now.getTime() + BASE_RETRY_MS).toISOString();
}
function successfulCycleTime(lastCycle) {
  const finishedAt = validIso2(lastCycle?.finished_at);
  if (!finishedAt) return null;
  if (lastCycle?.status === "succeeded") return finishedAt;
  if (lastCycle?.status != null) return null;
  const batches = Array.isArray(lastCycle?.batches) ? lastCycle.batches : [];
  return batches.length > 0 && !lastCycle?.error && batches.every((batch) => batch?.status === "succeeded") ? finishedAt : null;
}
function failedCycleEvidence(lastCycle) {
  const status = String(lastCycle?.status || "");
  const finishedAt = validIso2(lastCycle?.finished_at);
  return finishedAt && ["partial", "failed", "budget-paused"].includes(status) ? { status, finished_at: finishedAt } : null;
}
function retryDelay(failureCount) {
  return Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(Math.max(1, failureCount) - 1, 8));
}
function staleRunning(state, now) {
  if (state.status !== "running") return false;
  const attempted = state.last_attempt ? Date.parse(state.last_attempt) : Number.NaN;
  if (!Number.isFinite(attempted)) return true;
  const age = now.getTime() - attempted;
  if (age >= ABSOLUTE_RUNNING_STALE_MS) return true;
  if (state.owner_pid) return age >= ORPHAN_RUNNING_GRACE_MS && !processAlive(state.owner_pid);
  return age >= LEGACY_RUNNING_STALE_MS;
}
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function toDate2(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date : /* @__PURE__ */ new Date();
}
function validIso2(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
function safeError3(error) {
  return String(error instanceof Error ? error.message : error || "\u6574\u7406\u5931\u8D25").replace(/[\r\n]+/g, " ").slice(0, 500);
}
async function exists(target) {
  try {
    await (0, import_promises7.stat)(target);
    return true;
  } catch {
    return false;
  }
}

// ../runtime/src/runtime-lock.mjs
var import_node_crypto6 = require("node:crypto");
var import_node_child_process3 = require("node:child_process");
var import_promises8 = require("node:fs/promises");
var import_node_path10 = __toESM(require("node:path"), 1);
var import_node_util3 = require("node:util");
var execFileAsync3 = (0, import_node_util3.promisify)(import_node_child_process3.execFile);
var DEFAULT_LEASE_MS = 3 * 6e4;
var DEFAULT_HEARTBEAT_MS = 3e4;
var UNKNOWN_IDENTITY_GRACE_MS = 10 * 6e4;
var SAME_PROCESS_MAX_STALE_MS = 24 * 60 * 6e4;
var selfIdentityPromise;
function runtimeLockPath(options) {
  const name = safeName(options.name || "automation");
  if (options.vault) return import_node_path10.default.join(import_node_path10.default.resolve(options.vault), "raw", "codex", "automation", "locks", `${name}.lock`);
  return import_node_path10.default.join(import_node_path10.default.resolve(options.root), "runtime", "locks", `${name}.lock`);
}
async function acquireVaultAutomationLock(options) {
  return acquireRuntimeLock({ ...options, name: "automation", lockPath: runtimeLockPath({ vault: options.vault, name: "automation" }) });
}
async function readVaultAutomationOwner(options) {
  return readActiveOwner(runtimeLockPath({ vault: options.vault, name: "automation" }), options);
}
async function acquireRuntimeLock(options) {
  const lockPath = import_node_path10.default.resolve(options.lockPath);
  const leaseMs = positive(options.leaseMs, DEFAULT_LEASE_MS);
  const heartbeatMs = positive(options.heartbeatMs, DEFAULT_HEARTBEAT_MS);
  const now = nowDate(options.now);
  const ownerId = (0, import_node_crypto6.randomUUID)();
  const processIdentity = await identifyProcess(process.pid, options);
  const owner = ownerRecord({ ownerId, ownerKind: options.ownerKind, now, leaseMs, processIdentity });
  await (0, import_promises8.mkdir)(import_node_path10.default.dirname(lockPath), { recursive: true });
  let recovered = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await (0, import_promises8.mkdir)(lockPath);
      await atomicJson(import_node_path10.default.join(lockPath, "owner.json"), owner);
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
        await (0, import_promises8.rename)(lockPath, stalePath);
        await (0, import_promises8.rm)(stalePath, { recursive: true, force: true });
        recovered = true;
      } catch (renameError) {
        if (!["ENOENT", "EEXIST", "EPERM", "EACCES"].includes(renameError?.code)) throw renameError;
      }
    }
  }
  return { acquired: false, recovered: false, owner: await readOwner(lockPath), lock_path: lockPath };
}
async function withLeaseHeartbeat(lease, work, options = {}) {
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
      const updated = {
        ...existing,
        heartbeat_at: now.toISOString(),
        lease_until: new Date(now.getTime() + options.leaseMs).toISOString()
      };
      await atomicJson(heartbeatPath(options.lockPath, options.owner.owner_id), heartbeatRecord(updated));
      this.owner = updated;
      return true;
    },
    async release() {
      const existing = await readOwner(options.lockPath);
      if (existing?.owner_id !== options.owner.owner_id) return false;
      await (0, import_promises8.rm)(options.lockPath, { recursive: true, force: true });
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
    const owner = JSON.parse(await (0, import_promises8.readFile)(import_node_path10.default.join(lockPath, "owner.json"), "utf8"));
    const heartbeat = await readHeartbeat(lockPath, owner.owner_id);
    return heartbeat?.owner_id === owner.owner_id ? {
      ...owner,
      heartbeat_at: heartbeat.heartbeat_at,
      lease_until: heartbeat.lease_until
    } : owner;
  } catch {
    return null;
  }
}
async function readHeartbeat(lockPath, ownerId) {
  try {
    return JSON.parse(await (0, import_promises8.readFile)(heartbeatPath(lockPath, ownerId), "utf8"));
  } catch {
    return null;
  }
}
async function newLockInProgress(lockPath, now, leaseMs) {
  try {
    return now.getTime() - (await (0, import_promises8.stat)(lockPath)).mtimeMs < leaseMs;
  } catch {
    return false;
  }
}
function heartbeatPath(lockPath, ownerId) {
  return import_node_path10.default.join(lockPath, `heartbeat-${safeName(ownerId)}.json`);
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
  if (!Number.isInteger(owner?.pid) || owner.pid <= 0 || !processAlive2(owner.pid)) return false;
  const heartbeatAt = Date.parse(owner.heartbeat_at || owner.acquired_at || "");
  const age = Number.isFinite(heartbeatAt) ? Math.max(0, now.getTime() - heartbeatAt) : Number.POSITIVE_INFINITY;
  const identity2 = await identifyProcess(owner.pid, options);
  if (owner.process_identity && identity2) {
    return owner.process_identity === identity2 && age < SAME_PROCESS_MAX_STALE_MS;
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
      const value = await (0, import_promises8.readFile)(`/proc/${pid}/stat`, "utf8");
      const fields = value.slice(value.lastIndexOf(")") + 2).trim().split(/\s+/);
      return fields[19] ? `linux:${fields[19]}` : null;
    }
    if (platform === "darwin") {
      const { stdout } = await execFileAsync3("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { timeout: 2e3 });
      return stdout.trim() ? `darwin:${stdout.trim()}` : null;
    }
    if (platform === "win32") {
      const command = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`;
      const { stdout } = await execFileAsync3(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { windowsHide: true, timeout: 3e3 }
      );
      return stdout.trim() ? `win32:${stdout.trim()}` : null;
    }
  } catch {
  }
  return null;
}
function processAlive2(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function expired(owner, now) {
  const leaseUntil = Date.parse(owner?.lease_until || "");
  return !Number.isFinite(leaseUntil) || leaseUntil <= now.getTime();
}
function nowDate(value) {
  const result2 = typeof value === "function" ? value() : value;
  const date = result2 instanceof Date ? new Date(result2) : new Date(result2 || Date.now());
  return Number.isFinite(date.getTime()) ? date : /* @__PURE__ */ new Date();
}
function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
function safeName(value) {
  return String(value).replace(/[^a-z0-9-]/gi, "-").slice(0, 60) || "runtime";
}

// ../runtime/src/automation-owner.mjs
async function runOwnedAutomationTick(options) {
  const lease = await acquireVaultAutomationLock({
    vault: options.vault,
    ownerKind: options.ownerKind,
    now: options.lockNow,
    leaseMs: options.leaseMs,
    heartbeatMs: options.heartbeatMs
  });
  if (!lease.acquired) return busyResult(lease);
  await options.onAcquired?.(lease.owner);
  return withLeaseHeartbeat(lease, async () => {
    const capture = options.syncDesktop ? await options.syncDesktop({ vault: options.vault, codexHome: options.codexHome, now: options.now }) : await syncCodexDesktop({ vault: options.vault, codexHome: options.codexHome, now: options.now });
    const scheduled = await runDueKnowledgeCycle({
      vault: options.vault,
      now: options.now,
      finishedAt: options.finishedAt,
      newActivity: Number(capture?.completed_turns || 0) > 0,
      executorReady: Boolean(options.executorReady),
      recoverInterrupted: lease.recovered,
      run: options.runKnowledge
    });
    return { acquired: true, owner: lease.owner, capture, ...scheduled };
  }, { onHeartbeat: options.onHeartbeat });
}
async function runOwnedManualKnowledge(options) {
  const lease = await acquireVaultAutomationLock({
    vault: options.vault,
    ownerKind: options.ownerKind || "manual",
    now: options.lockNow,
    leaseMs: options.leaseMs,
    heartbeatMs: options.heartbeatMs
  });
  if (!lease.acquired) return { ...busyResult(lease), ok: false };
  await options.onAcquired?.(lease.owner);
  return withLeaseHeartbeat(lease, async () => {
    let state = await readScheduleState({ vault: options.vault, now: options.now, recoverInterrupted: lease.recovered });
    state = await beginScheduleAttempt({ vault: options.vault, state, now: options.now, trigger: "manual" });
    try {
      await options.runKnowledge("manual");
      state = await finishScheduleAttempt({ vault: options.vault, state, now: options.finishedAt || /* @__PURE__ */ new Date(), ok: true });
      return { acquired: true, ran: true, ok: true, reason: "manual", state };
    } catch (error) {
      state = await finishScheduleAttempt({ vault: options.vault, state, now: options.finishedAt || /* @__PURE__ */ new Date(), ok: false, error });
      return {
        acquired: true,
        ran: true,
        ok: false,
        reason: "manual",
        state,
        error: String(error instanceof Error ? error.message : error || "\u6574\u7406\u5931\u8D25")
      };
    }
  }, { onHeartbeat: options.onHeartbeat });
}
function busyResult(lease) {
  return {
    acquired: false,
    ran: false,
    ok: true,
    reason: "owner-busy",
    owner: lease.owner,
    error: ownerMessage(lease.owner)
  };
}
function ownerMessage(owner) {
  if (owner?.owner_kind === "background") return "\u540E\u53F0\u6B63\u5728\u5904\u7406\u91C7\u96C6\u6216\u6574\u7406\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5";
  if (owner?.owner_kind === "obsidian") return "Obsidian \u6B63\u5728\u5904\u7406\u91C7\u96C6\u6216\u6574\u7406\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5";
  return "\u77E5\u884C\u53F0\u6B63\u5728\u5904\u7406\u91C7\u96C6\u6216\u6574\u7406\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5";
}

// ../runtime/src/source-health.mjs
var import_node_path11 = __toESM(require("node:path"), 1);
var DEFAULT_STALE_MS2 = 36 * 60 * 6e4;
async function readCodexCliHookHealth(options) {
  const now = toDate3(options.now);
  const configured = countHookEvents(options.hooks) === 2;
  const supported = configured && Boolean(options.codexExecutable);
  const lastEventAt = options.vault ? await readLastCodexEventAt(import_node_path11.default.join(import_node_path11.default.resolve(options.vault), "raw", "codex", "events"), "codex_cli_hook") : null;
  return {
    source_type: "codex_cli_hook_v1",
    configured,
    supported,
    last_seen_at: options.codexExecutable ? now.toISOString() : null,
    last_event_at: lastEventAt,
    stale: isStale2(lastEventAt, now, options.staleAfterMs ?? DEFAULT_STALE_MS2),
    error: !configured ? "\u672A\u914D\u7F6E Codex CLI Hook" : !options.codexExecutable ? "Codex CLI \u672A\u901A\u8FC7\u7248\u672C\u63A2\u6D3B" : null
  };
}
function countHookEvents(config) {
  const hooks = config?.hooks && typeof config.hooks === "object" ? config.hooks : {};
  return ["UserPromptSubmit", "Stop"].filter((eventName) => {
    const entries = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
    return entries.some((entry) => Array.isArray(entry?.hooks) && entry.hooks.some((hook) => typeof hook?.command === "string" && /(?:^|[\\/])capture-hook\.mjs(?:["'\s]|$)/i.test(hook.command)));
  }).length;
}
function isStale2(value, now, threshold) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return !Number.isFinite(parsed) || now.getTime() - parsed > threshold;
}
function toDate3(value) {
  const result2 = value instanceof Date ? new Date(value) : new Date(value || Date.now());
  return Number.isFinite(result2.getTime()) ? result2 : /* @__PURE__ */ new Date();
}

// src/feishu-sync-result.ts
function parseFeishuSyncResult(value) {
  const text = String(value || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const payload = JSON.parse(text.slice(start, end + 1));
    const status = String(payload?.status || "");
    if (!(/* @__PURE__ */ new Set(["succeeded", "partial", "failed", "backoff", "disabled"])).has(status)) return null;
    return {
      status,
      accepted: safeCount(payload?.accepted),
      duplicates: safeCount(payload?.duplicates),
      failedModules: safeCount(payload?.failed_modules)
    };
  } catch {
    return null;
  }
}
function feishuSyncNotice(result2) {
  if (result2.status === "partial") {
    return `\u98DE\u4E66\u5DF2\u540C\u6B65 ${result2.accepted} \u6761\uFF1B${result2.failedModules} \u4E2A\u6A21\u5757\u5F85\u91CD\u8BD5`;
  }
  if (result2.status === "succeeded") {
    return result2.accepted > 0 ? `\u98DE\u4E66\u540C\u6B65\u5B8C\u6210\uFF1A\u65B0\u589E ${result2.accepted} \u6761` : "\u98DE\u4E66\u540C\u6B65\u5B8C\u6210\uFF0C\u6CA1\u6709\u65B0\u589E\u5185\u5BB9";
  }
  if (result2.status === "disabled") return "\u98DE\u4E66\u540C\u6B65\u5C1A\u672A\u5F00\u542F";
  if (result2.status === "backoff") return "\u98DE\u4E66\u6B63\u5728\u7B49\u5F85\u81EA\u52A8\u91CD\u8BD5";
  return "\u98DE\u4E66\u540C\u6B65\u672A\u5B8C\u6210\uFF0C\u5DF2\u4FDD\u7559\u5931\u8D25\u72B6\u6001\u5E76\u7B49\u5F85\u91CD\u8BD5";
}
function safeCount(value) {
  const count2 = Number(value || 0);
  return Number.isFinite(count2) && count2 > 0 ? Math.floor(count2) : 0;
}

// src/suite-service.ts
var execFileAsync4 = (0, import_node_util4.promisify)(import_node_child_process4.execFile);
var RECEIVER_PORT = 43123;
var RELEASE_API = "https://api.github.com/repos/ZhiweiXiao98/zhixing-workbench/releases/latest";
var SuiteService = class {
  constructor(app, version) {
    this.app = app;
    this.version = version;
    this.health = {
      version,
      receiver: "starting",
      receiverMessage: "\u6B63\u5728\u542F\u52A8\u672C\u673A\u63A5\u6536\u5668",
      runtime: "unavailable",
      codex: "unavailable",
      web: emptyFactualHealth("chatgpt_web_receiver_v1"),
      capture: {
        cliHook: emptyFactualHealth("codex_cli_hook_v1"),
        desktop: emptyFactualHealth("codex_desktop_sessions_v1")
      },
      organizer: {
        runtime: emptyFactualHealth("knowledge_runtime_v1"),
        executor: emptyFactualHealth("codex_exec_v1")
      },
      schedulerHost: emptyFactualHealth("background_scheduler_v1"),
      schedule: emptyScheduleState(),
      update: "unchecked",
      running: false,
      feishu: emptyFeishuHealth()
    };
  }
  app;
  version;
  server;
  token = "";
  programRoot;
  listeners = /* @__PURE__ */ new Set();
  queue = Promise.resolve();
  health;
  scheduleTimer;
  feishuDeviceCode = "";
  codexExecutable;
  larkExecutable;
  scheduledWork;
  async start() {
    const device = await this.ensureDeviceConfig();
    this.token = device.receiver_token;
    await this.findProgramRoot();
    await this.startReceiver();
    await this.refreshHealth();
    this.scheduleTimer = window.setInterval(() => void this.runScheduledWork(), 6e4);
    window.setTimeout(() => void this.runScheduledWork(), 5e3);
  }
  async stop() {
    window.clearInterval(this.scheduleTimer);
    if (this.server) {
      await new Promise((resolve) => this.server?.close(() => resolve()));
      this.server = void 0;
    }
    this.listeners.clear();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.health);
    return () => this.listeners.delete(listener);
  }
  snapshot() {
    return this.health;
  }
  async copyReceiverToken() {
    await navigator.clipboard.writeText(this.token);
    new import_obsidian5.Notice("\u672C\u673A\u63A5\u6536\u5BC6\u94A5\u5DF2\u590D\u5236\uFF0C\u8BF7\u7C98\u8D34\u5230\u6D4F\u89C8\u5668\u6269\u5C55");
  }
  async openBrowserExtensionFolder() {
    const install = await readJson2(import_node_path12.default.join(configRoot(), "install.json"), null);
    const target = typeof install?.browser_extension_root === "string" ? install.browser_extension_root : import_node_path12.default.join(configRoot(), "browser-extension");
    const manifest = await readJson2(import_node_path12.default.join(target, "manifest.json"), null);
    if (!manifest?.version) {
      new import_obsidian5.Notice("\u6D4F\u89C8\u5668\u6269\u5C55\u5C1A\u672A\u5B89\u88C5\uFF0C\u8BF7\u5148\u91CD\u65B0\u8FD0\u884C\u77E5\u884C\u53F0\u5B89\u88C5\u5668");
      return;
    }
    const error = await import_electron2.shell.openPath(target);
    if (error) {
      console.error("Zhixing browser extension folder open failed", error);
      new import_obsidian5.Notice("\u6D4F\u89C8\u5668\u6269\u5C55\u76EE\u5F55\u65E0\u6CD5\u6253\u5F00\uFF0C\u8BF7\u5728\u8BCA\u65AD\u4FE1\u606F\u4E2D\u67E5\u770B\u8DEF\u5F84");
      return;
    }
    new import_obsidian5.Notice("\u5DF2\u6253\u5F00\u6D4F\u89C8\u5668\u6269\u5C55\u76EE\u5F55\uFF0C\u8BF7\u5728\u6D4F\u89C8\u5668\u4E2D\u9009\u62E9\u201C\u52A0\u8F7D\u5DF2\u89E3\u538B\u7684\u6269\u5C55\u201D");
  }
  async checkForUpdate() {
    try {
      const response = await (0, import_obsidian5.requestUrl)({ url: RELEASE_API, method: "GET" });
      const tag = String(response.json?.tag_name || "").replace(/^v/, "");
      if (!tag) throw new Error("\u53D1\u5E03\u4FE1\u606F\u7F3A\u5C11\u7248\u672C\u53F7");
      this.setHealth({
        latestVersion: tag,
        update: compareVersions(tag, this.version) > 0 ? "available" : "current"
      });
    } catch (error) {
      console.error("Zhixing update check failed", error);
      this.setHealth({ update: "error" });
    }
  }
  async runKnowledgeNow() {
    if (!this.programRoot || !this.health.organizer.executor.supported || this.health.running) {
      if (!this.health.running) new import_obsidian5.Notice("\u77E5\u8BC6\u6574\u7406\u6267\u884C\u5668\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u5728\u72B6\u6001\u63D0\u793A\u4E2D\u67E5\u770B\u539F\u56E0");
      return;
    }
    const vault = this.vaultBasePath();
    const runner = import_node_path12.default.join(this.programRoot, "runtime", "run-cycle.mjs");
    const result2 = await runOwnedManualKnowledge({
      vault,
      ownerKind: "manual",
      onAcquired: async () => this.setHealth({ running: true }),
      runKnowledge: async () => {
        await this.runFeishuSyncNow(false);
        await execFileAsync4(process.execPath, [runner, "--vault", vault, "--trigger", "manual"], {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            ZHIXING_CAPTURE_DISABLED: "1",
            ...this.codexExecutable ? { CODEX_BIN: this.codexExecutable } : {}
          },
          timeout: 6 * 60 * 6e4,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024
        });
      }
    });
    if (result2.reason === "owner-busy") {
      new import_obsidian5.Notice(result2.error || "\u77E5\u884C\u53F0\u6B63\u5728\u5904\u7406\u91C7\u96C6\u6216\u6574\u7406\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5");
    } else if (result2.ok) {
      new import_obsidian5.Notice("\u77E5\u884C\u53F0\u6574\u7406\u5B8C\u6210\uFF0C\u53EF\u5728\u201C\u6574\u7406\u8BB0\u5F55\u201D\u67E5\u770B\u7ED3\u679C");
    } else {
      console.error("Zhixing knowledge cycle failed", result2.error);
      new import_obsidian5.Notice("\u77E5\u884C\u53F0\u6574\u7406\u672A\u5B8C\u6210\uFF0C\u5185\u5BB9\u5DF2\u4FDD\u7559\u5728\u961F\u5217\u4E2D\u7B49\u5F85\u91CD\u8BD5");
    }
    this.setHealth({ running: false, ...result2.state ? { schedule: result2.state } : {} });
    await this.refreshHealth();
  }
  async refreshHealth() {
    await this.findProgramRoot();
    const [codex, lark] = await Promise.all([discoverExecutable("codex"), discoverExecutable("lark-cli")]);
    this.codexExecutable = codex?.path;
    this.larkExecutable = lark?.path;
    const vault = this.vaultBasePath();
    const codexHome = codexHomePath();
    const [lastCycle, schedule, hooks, desktop, executor, webLastEvent, installState, backgroundState, automationOwner] = await Promise.all([
      readJson2(import_node_path12.default.join(vault, "raw", "codex", "automation", "last-cycle.json"), null),
      readScheduleState({ vault, recoverStale: false }),
      readJson2(import_node_path12.default.join(codexHome, "hooks.json"), {}),
      readCodexDesktopHealth({ vault, codexHome }),
      probeCodexExecutor(codex?.path),
      readLastCodexEventAt(import_node_path12.default.join(vault, "raw", "chatgpt", "events")),
      readJson2(import_node_path12.default.join(configRoot(), "install.json"), null),
      readJson2(import_node_path12.default.join(vault, "raw", "codex", "automation", "background-state.json"), null),
      readVaultAutomationOwner({ vault })
    ]);
    const cliHook = await readCodexCliHookHealth({ vault, hooks, codexExecutable: codex?.path });
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const runtimeHealth = {
      source_type: "knowledge_runtime_v1",
      configured: Boolean(this.programRoot),
      supported: Boolean(this.programRoot),
      last_seen_at: this.programRoot ? now : null,
      last_event_at: typeof lastCycle?.finished_at === "string" ? lastCycle.finished_at : null,
      stale: false,
      error: this.programRoot ? null : "\u77E5\u884C\u53F0\u77E5\u8BC6\u8FD0\u884C\u65F6\u7F3A\u5931"
    };
    const executorHealth = {
      source_type: "codex_exec_v1",
      configured: Boolean(codex),
      supported: Boolean(codex && executor.supported),
      last_seen_at: codex && executor.supported ? now : null,
      last_event_at: typeof lastCycle?.finished_at === "string" ? lastCycle.finished_at : null,
      stale: false,
      error: executor.error
    };
    const web = {
      source_type: "chatgpt_web_receiver_v1",
      configured: Boolean(this.token),
      supported: this.health.receiver === "ready",
      last_seen_at: this.health.receiver === "ready" ? now : null,
      last_event_at: webLastEvent,
      stale: staleSince(webLastEvent),
      error: this.health.receiver === "ready" ? null : this.health.receiverMessage
    };
    const schedulerConfigured = Boolean(installState?.background_scheduler?.installed && !installState?.background_scheduler?.conflict);
    const backgroundOwnsAutomation = automationOwner?.owner_kind === "background";
    const schedulerRecent = backgroundOwnsAutomation || Boolean(backgroundState?.last_seen_at && Date.now() - Date.parse(backgroundState.last_seen_at) <= 3 * 6e4);
    const processing = Boolean(automationOwner);
    const schedulerHost = {
      source_type: "background_scheduler_v1",
      configured: schedulerConfigured,
      supported: schedulerConfigured && schedulerRecent && backgroundState?.supported === true,
      last_seen_at: typeof backgroundState?.last_seen_at === "string" ? backgroundState.last_seen_at : null,
      last_event_at: typeof backgroundState?.last_event_at === "string" ? backgroundState.last_event_at : null,
      stale: !schedulerRecent && !processing,
      phase: processing ? "processing" : backgroundState?.phase === "error" ? "error" : backgroundState?.phase === "waiting" ? "waiting" : "idle",
      owner_kind: automationOwner?.owner_kind || backgroundState?.owner_kind || null,
      error: processing ? null : installState?.background_scheduler?.error || backgroundState?.error || (schedulerConfigured && !schedulerRecent ? "\u540E\u53F0\u8C03\u5EA6\u7B49\u5F85\u672C\u6B21\u767B\u5F55\u542F\u52A8\u6216\u5FC3\u8DF3\u5DF2\u4E2D\u65AD" : schedulerConfigured ? null : "\u540E\u53F0\u8C03\u5EA6\u5C1A\u672A\u6CE8\u518C")
    };
    const feishu = await this.readFeishuHealth();
    this.setHealth({
      runtime: this.programRoot ? "ready" : "unavailable",
      codex: executorHealth.supported ? "ready" : "unavailable",
      web,
      capture: { cliHook, desktop },
      organizer: { runtime: runtimeHealth, executor: executorHealth },
      schedulerHost,
      schedule,
      lastCycle: typeof lastCycle?.finished_at === "string" ? lastCycle.finished_at : void 0,
      feishu
    });
  }
  async getFeishuConfig() {
    const target = ".zhixing/feishu-connector.json";
    try {
      return normalizeFeishuConfig(JSON.parse(await this.app.vault.adapter.read(target)));
    } catch {
      return normalizeFeishuConfig({});
    }
  }
  async getFeishuUserAuthorization() {
    const result2 = await executeLarkCli(["auth", "status", "--json", "--verify"], {
      timeout: 3e4,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      env: larkCliEnv()
    }, this.larkExecutable);
    return readFeishuUserAuthorization(parseFeishuCliPayload(`${result2.stdout}
${result2.stderr}`));
  }
  getRequiredFeishuScopes(config) {
    return feishuScopes(config);
  }
  async saveFeishuConfig(value) {
    const config = normalizeFeishuConfig(value);
    await this.ensureVaultDirectory(".zhixing");
    await this.app.vault.adapter.write(".zhixing/feishu-connector.json", `${JSON.stringify(config, null, 2)}
`);
    await this.refreshHealth();
    return config;
  }
  async findFeishuChats(value) {
    const query = value.trim();
    if (!query) throw new Error("\u8BF7\u8F93\u5165\u9879\u76EE\u7FA4\u540D\u79F0");
    const result2 = await executeLarkCli([
      "im",
      "+chat-search",
      "--as",
      "user",
      "--query",
      query.slice(0, 64),
      "--search-types",
      "private,public_joined,external",
      "--page-size",
      "20",
      "--json"
    ], feishuReadOptions(), this.larkExecutable);
    const candidates = parseChatCandidatesPayload(parseFeishuCliPayload(`${result2.stdout}
${result2.stderr}`));
    if (candidates.length === 0) throw new Error("\u6CA1\u6709\u627E\u5230\u5339\u914D\u7684\u9879\u76EE\u7FA4\uFF0C\u8BF7\u6362\u4E00\u4E2A\u66F4\u51C6\u786E\u7684\u540D\u79F0");
    return candidates;
  }
  async listRecentFeishuChats() {
    const result2 = await executeLarkCli([
      "im",
      "+chat-list",
      "--as",
      "user",
      "--sort",
      "active_time",
      "--page-size",
      "20",
      "--json"
    ], feishuReadOptions(), this.larkExecutable);
    const candidates = parseChatCandidatesPayload(parseFeishuCliPayload(`${result2.stdout}
${result2.stderr}`));
    if (candidates.length === 0) throw new Error("\u6CA1\u6709\u627E\u5230\u6700\u8FD1\u4F7F\u7528\u7684\u9879\u76EE\u7FA4\uFF0C\u53EF\u4EE5\u8F93\u5165\u7FA4\u540D\u7EE7\u7EED\u67E5\u627E");
    return candidates;
  }
  async findFeishuBases(value) {
    const query = value.trim();
    if (!query) throw new Error("\u8BF7\u8F93\u5165\u591A\u7EF4\u8868\u683C\u540D\u79F0\uFF0C\u6216\u7C98\u8D34\u98DE\u4E66\u94FE\u63A5");
    const args = isFeishuUrl(query) ? ["base", "+url-resolve", "--url", query, "--as", "user", "--json"] : ["base", "+title-resolve", "--title", query.slice(0, 30), "--as", "user", "--json"];
    const result2 = await executeLarkCli(args, feishuReadOptions(), this.larkExecutable);
    const lookup = parseBaseLookupPayload(parseFeishuCliPayload(`${result2.stdout}
${result2.stderr}`));
    if (lookup.kind === "resolved") {
      const views = await this.listFeishuBaseViews(lookup.selection.base_token, lookup.selection.table_id);
      const view = views.find((item) => item.id === lookup.selection.view_id);
      if (view) lookup.selection.label = lookup.selection.label.replace(/所选视图$/, view.name);
    }
    if (lookup.kind === "candidates" && lookup.candidates.length === 0) {
      throw new Error(isFeishuUrl(query) ? "\u8FD9\u4E2A\u94FE\u63A5\u6CA1\u6709\u89E3\u6790\u5230\u53EF\u9009\u62E9\u7684\u591A\u7EF4\u8868\u683C" : "\u6CA1\u6709\u627E\u5230\u5339\u914D\u7684\u591A\u7EF4\u8868\u683C\uFF0C\u8BF7\u6362\u4E00\u4E2A\u66F4\u51C6\u786E\u7684\u540D\u79F0");
    }
    return lookup;
  }
  async listRecentFeishuBases() {
    const result2 = await executeLarkCli([
      "drive",
      "+search",
      "--as",
      "user",
      "--query",
      "",
      "--doc-types",
      "bitable",
      "--sort",
      "edit_time",
      "--page-size",
      "20",
      "--json"
    ], feishuReadOptions(), this.larkExecutable);
    const candidates = parseRecentBasesPayload(parseFeishuCliPayload(`${result2.stdout}
${result2.stderr}`));
    if (candidates.length === 0) throw new Error("\u6CA1\u6709\u627E\u5230\u6700\u8FD1\u4F7F\u7528\u7684\u591A\u7EF4\u8868\u683C\uFF0C\u53EF\u4EE5\u8F93\u5165\u540D\u79F0\u7EE7\u7EED\u67E5\u627E");
    return candidates;
  }
  async listFeishuBaseTables(baseToken) {
    try {
      const result2 = await executeLarkCli([
        "base",
        "+table-list",
        "--base-token",
        baseToken,
        "--as",
        "user",
        "--json"
      ], feishuReadOptions(), this.larkExecutable);
      const tables = parseBaseTablesPayload(parseFeishuCliPayload(`${result2.stdout}
${result2.stderr}`));
      if (tables.length === 0) throw new Error("\u8FD9\u4E2A\u591A\u7EF4\u8868\u683C\u4E2D\u6CA1\u6709\u53EF\u9009\u62E9\u7684\u6570\u636E\u8868");
      return tables;
    } catch (error) {
      throw withFeishuAppPermissionScopes(error, baseReadScopes(), "\u98DE\u4E66\u5E94\u7528\u5C1A\u672A\u5F00\u901A\u591A\u7EF4\u8868\u683C\u53EA\u8BFB\u6743\u9650");
    }
  }
  async listFeishuBaseViews(baseToken, tableId) {
    try {
      const result2 = await executeLarkCli([
        "base",
        "+view-list",
        "--base-token",
        baseToken,
        "--table-id",
        tableId,
        "--as",
        "user",
        "--json"
      ], feishuReadOptions(), this.larkExecutable);
      const views = parseBaseViewsPayload(parseFeishuCliPayload(`${result2.stdout}
${result2.stderr}`));
      if (views.length === 0) throw new Error("\u8FD9\u4E2A\u6570\u636E\u8868\u4E2D\u6CA1\u6709\u53EF\u9009\u62E9\u7684\u89C6\u56FE");
      return views;
    } catch (error) {
      throw withFeishuAppPermissionScopes(error, baseReadScopes(), "\u98DE\u4E66\u5E94\u7528\u5C1A\u672A\u5F00\u901A\u591A\u7EF4\u8868\u683C\u53EA\u8BFB\u6743\u9650");
    }
  }
  async openFeishuPermissionPage(value) {
    const url = safeFeishuPermissionUrl(value);
    if (!url) throw new Error("\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u53EF\u7528\u7684\u5B98\u65B9\u6743\u9650\u9875\u9762");
    await import_electron2.shell.openExternal(url);
  }
  async beginFeishuAuthorization(config) {
    const scopes = feishuScopes(config);
    if (scopes.length === 0) throw new Error("\u8BF7\u5148\u9009\u62E9\u81F3\u5C11\u4E00\u4E2A\u98DE\u4E66\u6A21\u5757");
    this.feishuDeviceCode = "";
    const result2 = await executeLarkCli(["auth", "login", "--scope", scopes.join(" "), "--no-wait", "--json"], {
      timeout: 3e4,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      env: larkCliEnv()
    }, this.larkExecutable);
    const payload = parseFeishuCliPayload(`${result2.stdout}
${result2.stderr}`);
    const verificationUrl = String(payload.verification_url || payload.data?.verification_url || "");
    const deviceCode = String(payload.device_code || payload.data?.device_code || "");
    if (!verificationUrl || !deviceCode) throw new Error("\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u53EF\u7528\u7684\u6388\u6743\u5730\u5740");
    this.feishuDeviceCode = deviceCode;
    await import_electron2.shell.openExternal(verificationUrl);
    return { verificationUrl, deviceCode: "stored-in-memory" };
  }
  async completeFeishuAuthorization() {
    if (!this.feishuDeviceCode) throw new Error("\u8BF7\u5148\u5F00\u59CB\u98DE\u4E66\u6388\u6743");
    const deviceCode = this.feishuDeviceCode;
    try {
      await executeLarkCli(["auth", "login", "--device-code", deviceCode, "--json"], {
        timeout: 10 * 6e4,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        env: larkCliEnv()
      }, this.larkExecutable);
      await this.refreshHealth();
    } finally {
      this.feishuDeviceCode = "";
    }
  }
  async runFeishuSyncNow(notify = true) {
    if (!this.programRoot || this.health.feishu.syncing) return;
    const config = await this.getFeishuConfig();
    if (!config.enabled) return;
    const runner = import_node_path12.default.join(this.programRoot, "runtime", "feishu-cli.mjs");
    this.setHealth({ feishu: { ...this.health.feishu, syncing: true, message: "\u6B63\u5728\u540C\u6B65\u98DE\u4E66" } });
    let syncResult = null;
    try {
      const execution = await execFileAsync4(process.execPath, [runner, "--vault", this.vaultBasePath(), "--force"], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          ZHIXING_CAPTURE_DISABLED: "1",
          ...this.larkExecutable ? { LARK_CLI_BIN: this.larkExecutable } : {}
        },
        timeout: 30 * 6e4,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      });
      syncResult = parseFeishuSyncResult(execution.stdout);
    } catch (error) {
      syncResult = parseFeishuSyncResult(`${String(error?.stdout || "")}
${String(error?.stderr || "")}`);
      if (!syncResult || syncResult.status === "failed") {
        console.error("Zhixing Feishu sync failed", safeCommandError(error));
      }
    } finally {
      this.setHealth({ feishu: { ...this.health.feishu, syncing: false } });
      await this.refreshHealth();
    }
    if (notify) new import_obsidian5.Notice(syncResult ? feishuSyncNotice(syncResult) : "\u98DE\u4E66\u540C\u6B65\u672A\u5B8C\u6210\uFF0C\u5DF2\u4FDD\u7559\u5931\u8D25\u72B6\u6001\u5E76\u7B49\u5F85\u91CD\u8BD5");
  }
  async clearFeishuCache() {
    const target = "raw/feishu";
    if (await this.app.vault.adapter.exists(target)) await this.app.vault.adapter.rmdir(target, true);
    await this.ensureVaultDirectory("raw/feishu/events");
    await this.ensureVaultDirectory("raw/feishu/daily");
    await this.refreshHealth();
    new import_obsidian5.Notice("\u98DE\u4E66\u672C\u5730\u539F\u59CB\u7F13\u5B58\u5DF2\u6E05\u7406\uFF0C\u957F\u671F Wiki \u4FDD\u6301\u4E0D\u53D8");
  }
  async startReceiver() {
    this.server = import_node_http.default.createServer((request, response) => {
      this.queue = this.queue.then(() => this.handleRequest(request, response), () => this.handleRequest(request, response));
    });
    try {
      await new Promise((resolve, reject) => {
        this.server?.once("error", reject);
        this.server?.listen(RECEIVER_PORT, "127.0.0.1", () => resolve());
      });
      this.setHealth({ receiver: "ready", receiverMessage: `\u672C\u673A\u7AEF\u53E3 ${RECEIVER_PORT} \u5DF2\u5C31\u7EEA` });
    } catch (error) {
      this.server = void 0;
      if (error?.code === "EADDRINUSE" && await this.probeExistingReceiver()) {
        this.setHealth({ receiver: "ready", receiverMessage: `\u672C\u673A\u7AEF\u53E3 ${RECEIVER_PORT} \u5DF2\u6709\u77E5\u884C\u53F0\u63A5\u6536\u5668` });
        return;
      }
      const message2 = error?.code === "EADDRINUSE" ? `\u7AEF\u53E3 ${RECEIVER_PORT} \u5DF2\u88AB\u5360\u7528` : "\u672C\u673A\u63A5\u6536\u5668\u542F\u52A8\u5931\u8D25";
      this.setHealth({ receiver: "unavailable", receiverMessage: message2 });
    }
  }
  async probeExistingReceiver() {
    try {
      const response = await fetch(`http://127.0.0.1:${RECEIVER_PORT}/health`, {
        headers: { "X-Obsidian-Capture-Token": this.token }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  async handleRequest(request, response) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Obsidian-Capture-Token");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") return sendJson(response, 204, {});
    if (!secureEqual(request.headers["x-obsidian-capture-token"], this.token)) {
      return sendJson(response, 401, { ok: false });
    }
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, { ok: true, service: "zhixing-obsidian" });
    }
    if (request.method !== "POST" || request.url !== "/capture/v1/events") {
      return sendJson(response, 404, { ok: false });
    }
    try {
      const body = await requestJson(request);
      const result2 = await this.persistEvents(Array.isArray(body.events) ? body.events.slice(0, 100) : []);
      sendJson(response, 200, { ok: true, ...result2 });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: String(error).slice(0, 120) });
    }
  }
  async persistEvents(events) {
    const date = localDate2();
    const target = `raw/chatgpt/events/${date}.jsonl`;
    const exists2 = await this.app.vault.adapter.exists(target);
    const current = exists2 ? await this.app.vault.adapter.read(target) : "";
    const known = new Set(current.split(/\r?\n/).flatMap((line) => {
      try {
        const value = JSON.parse(line);
        return value.event_id ? [value.event_id] : [];
      } catch {
        return [];
      }
    }));
    const added = [];
    const ackKeys = [];
    let duplicates = 0;
    let rejected = 0;
    for (const raw of events) {
      if (!validEvent(raw)) {
        rejected += 1;
        continue;
      }
      ackKeys.push(eventKey(raw));
      const record = normalizeEvent(raw, date);
      if (known.has(record.event_id)) {
        duplicates += 1;
        continue;
      }
      known.add(record.event_id);
      added.push(JSON.stringify(record));
    }
    if (added.length > 0) {
      await this.ensureVaultDirectory("raw/chatgpt/events");
      const separator = current && !current.endsWith("\n") ? "\n" : "";
      await this.app.vault.adapter.write(target, `${current}${separator}${added.join("\n")}
`);
    }
    return { accepted: added.length, duplicates, rejected, ack_keys: ackKeys };
  }
  async ensureVaultDirectory(directory) {
    let current = "";
    for (const segment of directory.split("/")) {
      current = current ? `${current}/${segment}` : segment;
      if (!await this.app.vault.adapter.exists(current)) await this.app.vault.adapter.mkdir(current);
    }
  }
  async ensureDeviceConfig() {
    const root = configRoot();
    const target = import_node_path12.default.join(root, "device.json");
    const existing = await readJson2(target, null);
    if (existing?.receiver_token && String(existing.receiver_token).length >= 24) return existing;
    const created = {
      schema_version: 1,
      device_id: (0, import_node_crypto7.randomBytes)(16).toString("hex"),
      receiver_port: RECEIVER_PORT,
      receiver_token: (0, import_node_crypto7.randomBytes)(32).toString("base64url"),
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    await atomicJson2(target, created);
    return created;
  }
  async findProgramRoot() {
    const install = await readJson2(import_node_path12.default.join(configRoot(), "install.json"), null);
    if (typeof install?.program_root === "string") {
      const runner = import_node_path12.default.join(install.program_root, "runtime", "run-cycle.mjs");
      try {
        await (0, import_promises9.readFile)(runner, "utf8");
        this.programRoot = install.program_root;
        return;
      } catch {
      }
    }
    this.programRoot = void 0;
  }
  async runScheduledWork() {
    if (this.scheduledWork) return this.scheduledWork;
    this.scheduledWork = this.performScheduledWork();
    try {
      await this.scheduledWork;
    } finally {
      this.scheduledWork = void 0;
    }
  }
  async performScheduledWork() {
    const vault = this.vaultBasePath();
    await this.runFeishuIfDue();
    await this.refreshHealth();
    if (this.health.schedulerHost.supported) return;
    if (!this.programRoot || this.health.running) return;
    const result2 = await runOwnedAutomationTick({
      vault,
      codexHome: codexHomePath(),
      ownerKind: "obsidian",
      executorReady: this.health.organizer.runtime.supported && this.health.organizer.executor.supported,
      runKnowledge: async () => {
        if (!this.programRoot) throw new Error("\u77E5\u884C\u53F0\u77E5\u8BC6\u8FD0\u884C\u65F6\u7F3A\u5931");
        this.setHealth({ running: true });
        try {
          await execFileAsync4(process.execPath, [
            import_node_path12.default.join(this.programRoot, "runtime", "run-cycle.mjs"),
            "--vault",
            vault,
            "--trigger",
            "automatic"
          ], {
            env: {
              ...process.env,
              ELECTRON_RUN_AS_NODE: "1",
              ZHIXING_CAPTURE_DISABLED: "1",
              ...this.codexExecutable ? { CODEX_BIN: this.codexExecutable } : {}
            },
            timeout: 6 * 60 * 6e4,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024
          });
        } finally {
          this.setHealth({ running: false });
        }
      }
    });
    if (result2.state) this.setHealth({ schedule: result2.state });
    if (result2.ran && !result2.ok) console.error("Zhixing automatic knowledge cycle failed", result2.error);
    await this.refreshHealth();
  }
  async runFeishuIfDue() {
    const config = await this.getFeishuConfig();
    if (!config.enabled || this.health.feishu.syncing) return;
    const lastSync = this.health.feishu.lastSync ? Date.parse(this.health.feishu.lastSync) : 0;
    const interval = config.sync_interval_minutes * 6e4;
    if (Date.now() - lastSync >= interval) await this.runFeishuSyncNow(false);
  }
  async readFeishuHealth() {
    const config = await this.getFeishuConfig();
    const cli = Boolean(this.larkExecutable);
    const state = await readJson2(import_node_path12.default.join(this.vaultBasePath(), "raw", "feishu", "sync-state.json"), {});
    const enabledModules = Object.entries(config.modules).filter(([, enabled]) => enabled).map(([key]) => key);
    const pending = config.enabled ? await countPendingFeishu(this.vaultBasePath()) : 0;
    if (!config.enabled) {
      return {
        ...emptyFeishuHealth(),
        cli: cli ? "ready" : "missing",
        enabledModules,
        selectedChats: config.selected_chats.length,
        selectedBases: config.selected_bases.length
      };
    }
    const failedModules = Number(state.failed_modules || 0);
    const lastSuccess = typeof state.last_success === "string" ? state.last_success : void 0;
    const stale = staleSince(lastSuccess || null);
    const status = !cli || !this.programRoot ? "unavailable" : failedModules > 0 || state.status === "failed" || !lastSuccess || stale ? "attention" : "ready";
    const message2 = !cli ? "\u672A\u627E\u5230 lark-cli" : !this.programRoot ? "\u77E5\u884C\u53F0\u8FD0\u884C\u65F6\u7F3A\u5931" : failedModules > 0 ? `${failedModules} \u4E2A\u6A21\u5757\u7B49\u5F85\u91CD\u8BD5` : !lastSuccess ? "\u7B49\u5F85\u9996\u6B21\u540C\u6B65" : stale ? "\u98DE\u4E66\u5DF2\u4E45\u672A\u540C\u6B65" : "\u98DE\u4E66\u53EA\u8BFB\u540C\u6B65\u6B63\u5E38";
    return {
      status,
      enabled: true,
      cli: cli ? "ready" : "missing",
      identityLabel: typeof state.identity_label === "string" ? state.identity_label : void 0,
      enabledModules,
      selectedChats: config.selected_chats.length,
      selectedBases: config.selected_bases.length,
      lastSync: lastSuccess,
      pending,
      failedModules,
      retryAt: typeof state.retry_at === "string" ? state.retry_at : void 0,
      message: message2,
      syncing: this.health.feishu.syncing,
      configured: true,
      supported: cli && Boolean(this.programRoot),
      lastSeenAt: typeof state.last_attempt === "string" ? state.last_attempt : void 0,
      lastEventAt: lastSuccess,
      stale,
      error: typeof state.error === "string" ? state.error : failedModules > 0 ? `${failedModules} \u4E2A\u6A21\u5757\u540C\u6B65\u5931\u8D25` : void 0
    };
  }
  vaultBasePath() {
    const adapter = this.app.vault.adapter;
    if (!adapter.getBasePath) throw new Error("\u77E5\u884C\u53F0\u4EC5\u652F\u6301\u672C\u5730\u684C\u9762 Vault");
    return adapter.getBasePath();
  }
  setHealth(change) {
    this.health = { ...this.health, ...change };
    for (const listener of this.listeners) listener(this.health);
  }
};
function configRoot() {
  if (process.env.ZHIXING_CONFIG) return import_node_path12.default.resolve(process.env.ZHIXING_CONFIG);
  if (process.platform === "win32") return import_node_path12.default.join(process.env.APPDATA || import_node_path12.default.join((0, import_node_os5.homedir)(), "AppData", "Roaming"), "ZhixingWorkbench");
  if (process.platform === "darwin") return import_node_path12.default.join((0, import_node_os5.homedir)(), "Library", "Application Support", "ZhixingWorkbench");
  return import_node_path12.default.join(process.env.XDG_CONFIG_HOME || import_node_path12.default.join((0, import_node_os5.homedir)(), ".config"), "zhixing-workbench");
}
async function readJson2(target, fallback) {
  try {
    return JSON.parse(await (0, import_promises9.readFile)(target, "utf8"));
  } catch {
    return fallback;
  }
}
async function atomicJson2(target, value) {
  await (0, import_promises9.mkdir)(import_node_path12.default.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await (0, import_promises9.writeFile)(temporary, `${JSON.stringify(value, null, 2)}
`, "utf8");
  await (0, import_promises9.rename)(temporary, target);
}
function localDate2(value = /* @__PURE__ */ new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function secureEqual(value, expected) {
  if (typeof value !== "string") return false;
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && (0, import_node_crypto7.timingSafeEqual)(left, right);
}
function validEvent(value) {
  const item = value;
  return Boolean(item && ["UserPromptSubmit", "Stop"].includes(String(item.event)) && typeof item.conversation_id === "string" && item.conversation_id && typeof item.turn_id === "string" && item.turn_id && typeof item.content === "string" && item.content.trim());
}
function normalizeEvent(event, date) {
  const stable = JSON.stringify([event.conversation_id, event.turn_id, event.event, event.message_id || "", event.content]);
  return {
    schema_version: 1,
    source: "chatgpt_web",
    event: event.event,
    captured_at: (/* @__PURE__ */ new Date()).toISOString(),
    date,
    conversation_id: event.conversation_id,
    turn_id: event.turn_id,
    message_id: event.message_id || "",
    title: redact(event.title || "\u672A\u547D\u540D\u5BF9\u8BDD").slice(0, 300),
    url: /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(event.url || "") ? event.url || "" : "",
    content: redact(event.content).trim(),
    event_id: `chatgpt:${(0, import_node_crypto7.createHash)("sha256").update(stable).digest("hex").slice(0, 32)}`
  };
}
function redact(value) {
  return value.replace(/\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, "[\u5DF2\u9690\u85CF\u5BC6\u94A5]").replace(/\b(?:ghp|github_pat|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{16,}\b/g, "[\u5DF2\u9690\u85CF\u51ED\u636E]").replace(/\b(authorization|api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*[^\s,]{6,}/gi, "$1=[\u5DF2\u9690\u85CF]");
}
function eventKey(event) {
  return [event.conversation_id, event.turn_id, event.event, event.message_id || ""].join(":");
}
async function requestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 2 * 1024 * 1024) throw new Error("\u8BF7\u6C42\u5185\u5BB9\u8D85\u8FC7\u5B89\u5168\u4E0A\u9650");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(status === 204 ? void 0 : JSON.stringify(value));
}
function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}
var FEISHU_SCOPE_MAP = {
  tasks: ["task:task:read"],
  calendar: ["calendar:calendar.event:read"],
  meetings: ["vc:meeting.search:read", "vc:recording:read"],
  minutes: ["minutes:minutes.basic:read", "minutes:minutes.artifacts:read"],
  documents: ["search:docs:read", "docs:document.content:read", "docx:document:readonly"],
  base: ["search:docs:read", "base:table:read", "base:view:read", "base:record:read"],
  approvals: ["approval:task:read", "approval:instance:read"],
  messages: ["im:chat:read", "im:message:readonly"]
};
function emptyFeishuHealth() {
  return {
    status: "disabled",
    enabled: false,
    cli: "missing",
    enabledModules: [],
    selectedChats: 0,
    selectedBases: 0,
    pending: 0,
    failedModules: 0,
    message: "\u98DE\u4E66\u8FDE\u63A5\u5668\u672A\u5F00\u542F",
    syncing: false,
    configured: false,
    supported: false,
    stale: false
  };
}
function emptyFactualHealth(sourceType) {
  return {
    source_type: sourceType,
    configured: false,
    supported: false,
    last_seen_at: null,
    last_event_at: null,
    stale: true,
    error: null
  };
}
function emptyScheduleState() {
  return {
    schema_version: 1,
    last_attempt: null,
    last_success: null,
    next_due: null,
    status: "idle",
    error: null,
    failure_count: 0,
    trigger: null,
    owner_pid: null
  };
}
function staleSince(value, threshold = 36 * 60 * 6e4) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return !Number.isFinite(parsed) || Date.now() - parsed > threshold;
}
function codexHomePath() {
  return import_node_path12.default.resolve(process.env.CODEX_HOME || import_node_path12.default.join((0, import_node_os5.homedir)(), ".codex"));
}
function normalizeFeishuConfig(value) {
  const keys = Object.keys(FEISHU_SCOPE_MAP);
  const modules = Object.fromEntries(keys.map((key) => [key, Boolean(value?.modules?.[key])]));
  const chats = Array.isArray(value?.selected_chats) ? value.selected_chats : [];
  const bases = Array.isArray(value?.selected_bases) ? value.selected_bases : [];
  return {
    schema_version: 1,
    enabled: Boolean(value?.enabled),
    sync_interval_minutes: Math.min(1440, Math.max(15, Number(value?.sync_interval_minutes || 60))),
    modules,
    selected_chats: chats.map((item) => ({
      selection_key: safeIdentifier(item?.selection_key || item?.chat_id) || (0, import_node_crypto7.createHash)("sha256").update(String(item?.query || "")).digest("hex").slice(0, 20),
      chat_id: safeIdentifier(item?.chat_id),
      query: safeDisplay(item?.query || ""),
      label: safeDisplay(item?.label || "\u5DF2\u9009\u9879\u76EE\u7FA4"),
      type: "project_group"
    })).filter((item) => item.chat_id || item.query).slice(0, 100),
    selected_bases: bases.map((item) => ({
      selection_key: safeIdentifier(item?.selection_key || `${item?.base_token}:${item?.table_id}:${item?.view_id}`),
      base_token: safeIdentifier(item?.base_token),
      table_id: safeIdentifier(item?.table_id),
      view_id: safeIdentifier(item?.view_id),
      label: safeDisplay(item?.label || "\u5DF2\u9009 Base \u89C6\u56FE"),
      field_ids: (Array.isArray(item?.field_ids) ? item.field_ids : []).map(safeDisplay).filter(Boolean).slice(0, 40)
    })).filter((item) => item.base_token && item.table_id && item.view_id).slice(0, 100),
    minute_tokens: (Array.isArray(value?.minute_tokens) ? value.minute_tokens : []).map(safeIdentifier).filter(Boolean).slice(0, 200)
  };
}
function feishuScopes(config) {
  return [...new Set(Object.entries(config.modules).filter(([, enabled]) => enabled).flatMap(([module2]) => FEISHU_SCOPE_MAP[module2] || []))].sort();
}
function baseReadScopes() {
  return (FEISHU_SCOPE_MAP.base || []).filter((scope) => scope.startsWith("base:"));
}
async function countPendingFeishu(vault) {
  const processed = /* @__PURE__ */ new Set();
  const ingest = await readJson2(import_node_path12.default.join(vault, "raw", "codex", "ingest-state.json"), {});
  for (const id of Array.isArray(ingest.processed_event_ids) ? ingest.processed_event_ids : []) processed.add(String(id));
  const directory = import_node_path12.default.join(vault, "raw", "feishu", "events");
  let names = [];
  try {
    names = (await (0, import_promises9.readdir)(directory)).filter((name) => name.endsWith(".jsonl")).sort().slice(-45);
  } catch {
    return 0;
  }
  let pending = 0;
  for (const name of names) {
    const lines = (await (0, import_promises9.readFile)(import_node_path12.default.join(directory, name), "utf8")).split(/\r?\n/);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item.event_id && !processed.has(item.event_id)) pending += 1;
      } catch {
      }
    }
  }
  return pending;
}
function safeIdentifier(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 300);
}
function safeDisplay(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
}
function safeCommandError(error) {
  return String(error instanceof Error ? error.message : error).replace(/[\r\n]+/g, " ").slice(0, 300);
}
function larkCliEnv() {
  return { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" };
}
function feishuReadOptions() {
  return { timeout: 6e4, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: larkCliEnv() };
}
async function executeLarkCli(args, options, located) {
  const executable = located || (await discoverExecutable("lark-cli"))?.path;
  if (!executable) throw new Error("\u672A\u627E\u5230\u5B98\u65B9 lark-cli\uFF0C\u8BF7\u91CD\u65B0\u5B89\u88C5\u6700\u65B0\u7248 @larksuite/cli");
  try {
    const result2 = await execFileAsync4(executable, args, options);
    return { stdout: String(result2.stdout || ""), stderr: String(result2.stderr || "") };
  } catch (error) {
    const output = `${String(error?.stdout || "")}
${String(error?.stderr || "")}`;
    try {
      parseFeishuCliPayload(output);
    } catch (parsed) {
      if (parsed instanceof Error && parsed.message !== "\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u53EF\u8BC6\u522B\u7684\u7ED3\u679C\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5") throw parsed;
    }
    throw new Error("\u98DE\u4E66\u6682\u65F6\u65E0\u6CD5\u5B8C\u6210\u8FD9\u6B21\u53EA\u8BFB\u67E5\u8BE2\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
  }
}

// src/main.ts
var ActivityLedgerPlugin = class extends import_obsidian6.Plugin {
  service;
  suite;
  async onload() {
    this.service = new ActivityService(this.app);
    this.suite = new SuiteService(this.app, this.manifest.version);
    this.registerView(ACTIVITY_LEDGER_VIEW_TYPE, (leaf) => new ActivityLedgerView(leaf, this.service, this.suite));
    this.addRibbonIcon("calendar-range", "\u6253\u5F00\u77E5\u884C\u53F0", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-activity-ledger",
      name: "\u6253\u5F00\u77E5\u884C\u53F0",
      callback: () => void this.activateView()
    });
    this.addCommand({
      id: "refresh-activity-ledger",
      name: "\u5237\u65B0\u77E5\u884C\u53F0\u6570\u636E",
      callback: () => void this.service.refresh()
    });
    this.addCommand({
      id: "organize-activity-artifacts",
      name: "\u91CD\u65B0\u6574\u7406\u6210\u679C\u7B14\u8BB0",
      callback: () => void this.service.refresh()
    });
    this.addCommand({
      id: "simplify-global-graph",
      name: "\u7B80\u5316\u5173\u7CFB\u56FE\uFF08\u9690\u85CF\u81EA\u52A8\u6210\u679C\uFF09",
      callback: () => void this.setGraphDenoise("enable", true)
    });
    this.addCommand({
      id: "restore-global-graph",
      name: "\u6062\u590D\u5173\u7CFB\u56FE\u4E2D\u7684\u81EA\u52A8\u6210\u679C",
      callback: () => void this.setGraphDenoise("disable", true)
    });
    const schedule = (file) => {
      if (isActivityPath(file.path)) {
        this.service.scheduleRefresh();
      }
    };
    this.registerEvent(this.app.vault.on("create", schedule));
    this.registerEvent(this.app.vault.on("modify", schedule));
    this.registerEvent(this.app.vault.on("delete", schedule));
    this.registerEvent(this.app.vault.on("rename", schedule));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.service.scheduleRefresh()));
    this.registerInterval(window.setInterval(() => this.service.scheduleRefresh(), 5 * 60 * 1e3));
    const data = await this.loadData();
    if (!data?.graphDenoiseInitialized) {
      const applied = await this.setGraphDenoise("enable", false);
      if (applied) {
        await this.saveData({ ...data, graphDenoiseInitialized: true });
      }
    }
    void this.suite.start().catch((error) => console.error("Zhixing suite failed to start", error));
  }
  async onunload() {
    this.service.destroy();
    await this.suite.stop();
    this.app.workspace.detachLeavesOfType(ACTIVITY_LEDGER_VIEW_TYPE);
  }
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(ACTIVITY_LEDGER_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: ACTIVITY_LEDGER_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  async setGraphDenoise(mode, notify) {
    const graphPath = `${this.app.vault.configDir}/graph.json`;
    try {
      const exists2 = await this.app.vault.adapter.exists(graphPath);
      const current = exists2 ? await this.app.vault.adapter.read(graphPath) : "{}";
      const updated = updateGraphConfigText(current, mode);
      if (!updated.ok) {
        throw new Error(updated.error ?? "\u65E0\u6CD5\u66F4\u65B0\u5173\u7CFB\u56FE\u914D\u7F6E");
      }
      if (updated.changed) {
        await this.app.vault.adapter.write(graphPath, updated.content);
      }
      if (notify) {
        new import_obsidian6.Notice(mode === "enable" ? "\u5173\u7CFB\u56FE\u7B80\u6D01\u6A21\u5F0F\u5DF2\u5F00\u542F\uFF0C\u91CD\u65B0\u6253\u5F00\u5173\u7CFB\u56FE\u5373\u53EF\u67E5\u770B" : "\u5173\u7CFB\u56FE\u5DF2\u6062\u590D\u663E\u793A\u81EA\u52A8\u6210\u679C");
      }
      return true;
    } catch (error) {
      console.error("Activity Ledger graph filter update failed", error);
      if (notify) {
        new import_obsidian6.Notice(`\u5173\u7CFB\u56FE\u8BBE\u7F6E\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
      }
      return false;
    }
  }
};
