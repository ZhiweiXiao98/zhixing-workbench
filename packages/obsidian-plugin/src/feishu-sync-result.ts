export interface FeishuSyncResult {
  status: "succeeded" | "partial" | "failed" | "backoff" | "disabled";
  accepted: number;
  duplicates: number;
  failedModules: number;
}

export function parseFeishuSyncResult(value: unknown): FeishuSyncResult | null {
  const text = String(value || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const payload = JSON.parse(text.slice(start, end + 1));
    const status = String(payload?.status || "");
    if (!new Set(["succeeded", "partial", "failed", "backoff", "disabled"]).has(status)) return null;
    return {
      status: status as FeishuSyncResult["status"],
      accepted: safeCount(payload?.accepted),
      duplicates: safeCount(payload?.duplicates),
      failedModules: safeCount(payload?.failed_modules)
    };
  } catch {
    return null;
  }
}

export function feishuSyncNotice(result: FeishuSyncResult): string {
  if (result.status === "partial") {
    return `飞书已同步 ${result.accepted} 条；${result.failedModules} 个模块待重试`;
  }
  if (result.status === "succeeded") {
    return result.accepted > 0
      ? `飞书同步完成：新增 ${result.accepted} 条`
      : "飞书同步完成，没有新增内容";
  }
  if (result.status === "disabled") return "飞书同步尚未开启";
  if (result.status === "backoff") return "飞书正在等待自动重试";
  return "飞书同步未完成，已保留失败状态并等待重试";
}

function safeCount(value: unknown): number {
  const count = Number(value || 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}
