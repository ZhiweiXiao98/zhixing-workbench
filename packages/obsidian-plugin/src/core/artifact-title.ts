import type { ActivityEvent, ArtifactKind } from "./types";

const CONVENTIONAL_ACTIONS: Record<string, string> = {
  feat: "新增",
  fix: "修复",
  docs: "更新",
  test: "补充",
  style: "优化",
  refactor: "重构",
  perf: "优化",
  revert: "撤销",
  build: "更新",
  ci: "更新",
  chore: "更新"
};

const NATURAL_ACTION = /^(?:新增|增加|实现|支持|完成|修复|解决|恢复|优化|改进|调整|更新|升级|完善|补充|重构|整理|记录|沉淀|发布|部署|安装|验证|测试|删除|移除|统一|保持|切换|新增功能|功能：|体验：|样式：|文档：|测试：)/;

export function artifactDisplayTitle(event: ActivityEvent, kind: ArtifactKind): string {
  const parsed = parseTitle(event.title);
  if (kind === "git-commit") {
    return gitTitle(event, parsed);
  }
  if (kind === "knowledge-note") {
    return hasChinese(parsed.subject)
      ? naturalChineseTitle(parsed.subject, "整理")
      : `整理 ${event.projectLabel} 知识并形成笔记`;
  }
  const reportTitle = stripLocalPaths(parsed.subject);
  return hasChinese(reportTitle)
    ? naturalChineseTitle(reportTitle, "完成")
    : `完成 ${event.projectLabel} 任务并形成交付记录`;
}

function gitTitle(event: ActivityEvent, parsed: ParsedTitle): string {
  if (hasChinese(parsed.subject)) {
    const action = parsed.type ? CONVENTIONAL_ACTIONS[parsed.type] : undefined;
    return naturalChineseTitle(parsed.subject, action ?? "完成");
  }
  const action = parsed.type ? CONVENTIONAL_ACTIONS[parsed.type] ?? "完成" : "完成";
  const files = [...new Set(event.sourceRefs.filter((source) => source.type === "file").map((source) => source.label))];
  const area = changedArea(files);
  return files.length > 0
    ? `${action} ${event.projectLabel} ${area}，更新 ${files.length} 个文件`
    : `${action} ${event.projectLabel} ${area}并形成提交`;
}

function changedArea(files: string[]): string {
  if (files.length > 0 && files.every((file) => /(?:^|\/)(?:docs?|requirements?|wiki)(?:\/|$)|\.md$/i.test(file))) {
    return "文档";
  }
  if (files.some((file) => /\.(?:css|scss|sass|less|html|vue|tsx|jsx)$/i.test(file))) {
    return "界面";
  }
  if (files.some((file) => /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\./i.test(file))) {
    return "测试";
  }
  if (files.some((file) => /(?:package(?:-lock)?\.json|tsconfig|vite\.config|webpack|\.ya?ml)$/i.test(file))) {
    return "工程配置";
  }
  return "功能";
}

interface ParsedTitle {
  type?: string;
  subject: string;
}

function parseTitle(value: string): ParsedTitle {
  const cleaned = value.normalize("NFKC")
    .replace(/\s*\((?:[2-9]|\d{2,})\)\s*$/, "")
    .replace(/…+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const conventional = cleaned.match(/^([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/i);
  return conventional?.[2]
    ? { type: conventional[1]?.toLocaleLowerCase(), subject: conventional[2].trim() }
    : { subject: cleaned };
}

function naturalChineseTitle(subject: string, fallbackAction: string): string {
  const cleaned = subject.replace(/^[：:\-–—\s]+|[：:\-–—\s]+$/g, "").trim();
  if (!cleaned) {
    return `${fallbackAction}项目成果`;
  }
  return NATURAL_ACTION.test(cleaned) ? cleaned : `${fallbackAction}：${cleaned}`;
}

function stripLocalPaths(value: string): string {
  return value
    .replace(/[A-Za-z]:[\\/][^\r\n，。；：！？]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[，。；：！？\s]+|[，。；：！？\s]+$/g, "")
    .trim();
}

function hasChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}
