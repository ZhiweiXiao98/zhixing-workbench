import { describe, expect, it, vi } from "vitest";
import { runFeishuAuthorizationFlow } from "../src/feishu-authorization-flow";

describe("飞书一键授权流程", () => {
  it("一次操作依次发起、等待、完成并读取个人授权", async () => {
    const events: string[] = [];
    const result = await runFeishuAuthorizationFlow({
      begin: vi.fn(async () => { events.push("begin"); }),
      onWaiting: vi.fn(() => { events.push("waiting"); }),
      complete: vi.fn(async () => { events.push("complete"); }),
      readState: vi.fn(async () => {
        events.push("read");
        return { ready: true, label: "测试用户", message: "个人授权可用", scopeKnown: true, grantedScopes: ["base:table:read"] };
      })
    });

    expect(events).toEqual(["begin", "waiting", "complete", "read"]);
    expect(result.ready).toBe(true);
  });

  it("完成失败时不会把未授权状态误判为成功", async () => {
    const readState = vi.fn();
    await expect(runFeishuAuthorizationFlow({
      begin: async () => undefined,
      onWaiting: () => undefined,
      complete: async () => { throw new Error("授权未完成"); },
      readState
    })).rejects.toThrow("授权未完成");
    expect(readState).not.toHaveBeenCalled();
  });
});
