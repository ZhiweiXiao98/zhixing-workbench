export type FeishuCliIssue = "authorization_required" | "authorization_pending" | "permission" | "rate_limit" | "other";

export class FeishuCliError extends Error {
  constructor(message: string, readonly issue: FeishuCliIssue) {
    super(message);
    this.name = "FeishuCliError";
  }
}

export interface FeishuUserAuthorizationState {
  ready: boolean;
  label?: string;
  message: string;
}

export function parseFeishuCliPayload(value: string): any {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end < start) throw new FeishuCliError("飞书没有返回可识别的结果，请稍后重试", "other");
  let payload: any;
  try {
    payload = JSON.parse(value.slice(start, end + 1));
  } catch {
    throw new FeishuCliError("飞书返回了无法识别的结果，请稍后重试", "other");
  }
  if (payload?.ok === false) throw cliError(payload.error || {});
  return payload;
}

export function readFeishuUserAuthorization(payload: any): FeishuUserAuthorizationState {
  const data = payload?.data ?? payload ?? {};
  const user = data.identities?.user ?? payload?.identities?.user ?? data.user ?? {};
  const status = String(user.status || "").toLowerCase();
  const tokenStatus = String(user.tokenStatus || user.token_status || "").toLowerCase();
  const missing = /missing|expired|invalid|logged.?out/.test(`${status} ${tokenStatus}`);
  const ready = payload?.ok !== false && data.verified !== false && user.available !== false && !missing
    && (user.available === true || status === "ready" || Boolean(user.userName || user.name));
  const label = cleanLabel(user.userName || user.name || user.display_name);
  return {
    ready,
    ...(label ? { label } : {}),
    message: ready ? "个人授权可用" : "需要先完成个人授权，才能查找群聊和多维表格"
  };
}

export function isFeishuAuthorizationRequired(error: unknown): boolean {
  return error instanceof FeishuCliError && error.issue === "authorization_required";
}

function cliError(error: any): FeishuCliError {
  const type = String(error?.type || "").toLowerCase();
  const subtype = String(error?.subtype || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  const combined = `${type} ${subtype} ${message}`;
  if (/token_missing|need_user_authorization|missing_scope|authorization_required|user identity.*missing/.test(combined)) {
    return new FeishuCliError("需要先授权飞书，才能查找群聊和多维表格", "authorization_required");
  }
  if (/authorization_pending|authorization.*pending|尚未.*授权|not.*authoriz/.test(combined)) {
    return new FeishuCliError("网页授权尚未完成，请先在飞书页面同意授权", "authorization_pending");
  }
  if (/rate.?limit|too many requests|\b429\b/.test(combined)) {
    return new FeishuCliError("飞书查询过于频繁，请稍后再试", "rate_limit");
  }
  if (/permission|forbidden|91403|2091005/.test(combined)) {
    return new FeishuCliError("当前飞书账号无权读取这项内容", "permission");
  }
  return new FeishuCliError("飞书暂时无法完成这次只读查询，请稍后重试", "other");
}

function cleanLabel(value: unknown): string {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 80);
}
