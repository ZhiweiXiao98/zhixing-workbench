import { describe, expect, it } from "vitest";
import { canRunKnowledgeNow, factualHealthDisplay, scheduleHealthLabel } from "../src/health-view-model";
import type { SuiteHealth } from "../src/suite-service";

const labels = { ready: "正常", waiting: "等待", stale: "久未更新", unavailable: "不可用" };

describe("知行台事实型健康状态", () => {
  it("配置存在但没有事件时显示等待，不显示正常", () => {
    const display = factualHealthDisplay({
      source_type: "fixture",
      configured: true,
      supported: true,
      last_seen_at: "2026-08-13T08:00:00.000Z",
      last_event_at: null,
      stale: true,
      error: null
    }, labels);
    expect(display.state).toBe("starting");
    expect(display.label).toBe("等待");
    expect(display.title).toContain("尚未收到事件");
  });

  it("采集断流不阻止已有队列手动整理", () => {
    const health = {
      running: false,
      capture: {
        desktop: { supported: false },
        cliHook: { supported: false }
      },
      organizer: {
        runtime: { supported: true },
        executor: { supported: true }
      }
    } as SuiteHealth;
    expect(canRunKnowledgeNow(health)).toBe(true);
    health.running = true;
    expect(canRunKnowledgeNow(health)).toBe(false);
  });

  it("后台处理中与失败退避使用不同提示且都阻止重复手动整理", () => {
    const health = {
      running: false,
      schedulerHost: { configured: true, supported: true, phase: "processing", owner_kind: "background" },
      schedule: { status: "running", next_due: null },
      organizer: { runtime: { supported: true }, executor: { supported: true } }
    } as SuiteHealth;
    expect(scheduleHealthLabel(health, (value) => value)).toBe("后台正在处理");
    expect(canRunKnowledgeNow(health)).toBe(false);
    health.schedulerHost.phase = "error";
    health.schedule.status = "backoff";
    health.schedule.next_due = "2026-08-13T10:05:00.000Z";
    expect(scheduleHealthLabel(health, (value) => value)).toContain("整理失败");
  });
});
