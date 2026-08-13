import type { FactualHealth, SuiteHealth } from "./suite-service";

export interface HealthDisplay {
  state: "ready" | "starting" | "unavailable";
  label: string;
  title: string;
}

export function factualHealthDisplay(health: FactualHealth, labels: {
  ready: string; waiting: string; stale: string; unavailable: string;
}): HealthDisplay {
  const title = [
    `已配置：${health.configured ? "是" : "否"}`,
    `当前版本支持：${health.supported ? "是" : "否"}`,
    health.last_seen_at ? `最后探活：${formatHealthTime(health.last_seen_at)}` : "尚未探活",
    health.last_event_at ? `最后事件：${formatHealthTime(health.last_event_at)}` : "尚未收到事件",
    health.error
  ].filter(Boolean).join(" · ");
  if (!health.configured || !health.supported || health.error) {
    return { state: "unavailable", label: labels.unavailable, title };
  }
  if (!health.last_event_at) return { state: "starting", label: labels.waiting, title };
  if (health.stale) return { state: "starting", label: labels.stale, title };
  return { state: "ready", label: labels.ready, title };
}

export function canRunKnowledgeNow(health: SuiteHealth): boolean {
  return health.organizer.runtime.supported && health.organizer.executor.supported && !health.running &&
    health.schedulerHost?.phase !== "processing";
}

export function scheduleHealthLabel(health: SuiteHealth, formatTime: (value: string) => string): string {
  if (health.schedulerHost.phase === "processing") {
    if (health.schedulerHost.owner_kind === "background") return "后台正在处理";
    if (health.schedulerHost.owner_kind === "manual") return "正在手动整理";
    return "Obsidian 正在处理";
  }
  if (health.schedule.status === "backoff") {
    return health.schedule.next_due ? `整理失败，${formatTime(health.schedule.next_due)} 自动重试` : "整理失败，等待自动重试";
  }
  if (health.schedulerHost.phase === "error") return health.schedulerHost.error || "后台调度失败";
  if (!health.schedulerHost.supported) {
    return health.schedulerHost.configured
      ? "后台调度等待登录启动 · 打开 Obsidian 时仍会补跑"
      : "仅在 Obsidian 打开时检查补跑";
  }
  return health.schedule.next_due ? `后台守候 23:30 · 下次检查 ${formatTime(health.schedule.next_due)}` : "后台守候每天 23:30";
}

function formatHealthTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value;
}
