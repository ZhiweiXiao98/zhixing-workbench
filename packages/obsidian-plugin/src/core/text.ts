const COMPLETION_EVIDENCE_PATTERN = /(?:\b[0-9a-f]{7,40}\b|测试.{0,12}通过|构建.{0,12}通过|验证.{0,12}通过|\b(?:build|test|check)\b.{0,24}(?:通过|成功)|HTTP\s*200|截图|commit|提交|安装位置|已写入)/i;

export function isAutomationPrompt(content: string): boolean {
  return /<heartbeat>|<automation_id>|Automation ID:/i.test(content);
}

export function extractMeaningfulPrompt(content: string): string | null {
  const trimmed = content.trim();
  if (isAutomationPrompt(trimmed) || trimmed.startsWith("# Overview\nGenerate 0 to 3 hyperpersonalized suggestions")) {
    return null;
  }

  const delegated = content.match(/<codex_delegation>[\s\S]*?<input>([\s\S]*?)<\/input>[\s\S]*?<\/codex_delegation>/i);
  if (delegated?.[1]?.trim()) {
    return delegated[1].trim();
  }

  if (trimmed.startsWith("# Browser comments:")) {
    const comments = [...trimmed.matchAll(/^Comment:\s*\r?\n([\s\S]*?)(?=^## Comment|^<in-app-browser-context|^## My request for Codex:|\s*$)/gim)]
      .map((match) => match[1]?.trim())
      .filter((comment): comment is string => Boolean(comment));
    if (comments.length > 0) {
      return comments.join("；");
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

  const cleaned = trimmed
    .replace(/<in-app-browser-context[\s\S]*?<\/in-app-browser-context>/gi, "")
    .replace(/^# Files mentioned by the user:[\s\S]*?## My request for Codex:/im, "")
    .trim();
  return cleaned || null;
}

export function conciseTitle(content: string, fallback: string): string {
  const lines = content
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:#{1,6}|[-*]|\d+\.)\s*/, "").trim())
    .filter(Boolean);
  const first = lines[0] ?? fallback;
  return truncate(first.replace(/\s+/g, " "), 72);
}

export function conciseSummary(content: string): string {
  return truncate(content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), 180);
}

export function classifyReportedStatus(stopContent?: string): "completed" | "blocked" | "progress" {
  if (!stopContent) {
    return "progress";
  }
  if (hasDirectBlockedAssertion(stopContent)) {
    return "blocked";
  }
  const completionSection = directCompletionSection(stopContent).join("\n");
  if (
    completionSection &&
    COMPLETION_EVIDENCE_PATTERN.test(completionSection)
  ) {
    return "completed";
  }
  return "progress";
}

export function hasDirectCompletionAssertion(content: string): boolean {
  const units = statusUnits(content).slice(0, 4);
  const completionIndex = units.findIndex((line) =>
    isDirectCompletionLine(line)
  );
  if (completionIndex < 0) {
    return false;
  }
  return !units.slice(0, completionIndex + 1).some((line) =>
    isStatusBoundary(line)
  );
}

function hasDirectBlockedAssertion(content: string): boolean {
  const units = statusUnits(content).slice(0, 4);
  const blockedIndex = units.findIndex((line) =>
    /^(?:(?:本次|这次)(?:工作|任务)?|当前|任务)?\s*(?:无法完成|未能完成|仍然受阻|需要用户|等待用户|缺少权限|blocked|无法继续)/i.test(line)
  );
  return blockedIndex >= 0 && !units.slice(0, blockedIndex + 1).some((line) => isStatusBoundary(line));
}

function directCompletionSection(content: string): string[] {
  const units = statusUnits(content);
  const completionIndex = units.findIndex((line) => isDirectCompletionLine(line));
  if (completionIndex < 0 || completionIndex >= 4 || units.slice(0, completionIndex + 1).some((line) => isStatusBoundary(line))) {
    return [];
  }
  const section: string[] = [];
  for (const line of units.slice(completionIndex, completionIndex + 20)) {
    if (section.length > 0 && isStatusBoundary(line)) {
      break;
    }
    section.push(line);
  }
  return section;
}

function statusUnits(content: string): string[] {
  return content
    .slice(0, 4_000)
    .replace(/<[^>]*>/g, " ")
    .split(/\r?\n|(?<=[。！？])\s*/)
    .map((line) => line
      .replace(/^\s*(?:#{1,6}|[-*+]\s+|\d+\.\s+)/, "")
      .trim()
      .replace(/^(?:\*\*|__)(?=\S)/, "")
      .replace(/(?:\*\*|__)$/, ""))
    .filter(Boolean);
}

export function isDirectCompletionLine(line: string): boolean {
  if (/(?:并|，)\s*(?:将|会|需|需要)?继续(?:推进|处理|开发|完善|工作|优化|收口)?|后续(?:还要|将|会|需|需要)?继续/i.test(line)) {
    return false;
  }
  return /^(?:(?:你[^。！？]{0,32}(?:所以|因此)[，,]?\s*)|(?:(?:本次|这次)(?:工作|任务)?)?\s*)(?:我\s*)?(?:已完成|已经完成|已继续完成|已修复|已实现|已安装|已恢复|已提交|已全部处理|已定位并修复|已补上|已整理|整理完成|修复完成|实现完成|安装完成|已经改成|已改成|已经改为|已改为|已经做完|已做完)/i.test(line);
}

function isStatusBoundary(line: string): boolean {
  return /^(?:把下面.*发给|(?:以下|这是)?.*提示词|验收标准|请(?:你|将|按|完成|实现|开发|修复)|建议(?:你|先|改为|采用)?|(?:这就清楚了[。！]?\s*)?你需要的(?:不是|是)|目标(?:是|：|:)|如果|可以(?:用|把|让)|下一步|后续(?:建议|计划)?|模板(?:是|：|:))/i.test(line);
}

export function truncate(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, Math.max(0, length - 1)).trimEnd()}…`;
}
