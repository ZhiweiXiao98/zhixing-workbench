import { describe, expect, it } from "vitest";
import {
  expandFeishuPermissionUrl,
  feishuAppPermissionUrl,
  isFeishuAuthorizationRequired,
  parseFeishuCliPayload,
  readFeishuUserAuthorization
} from "../src/feishu-cli-result";

describe("飞书命令结果", () => {
  it("把缺少个人授权翻译成人类可读提示并隐藏用户标识", () => {
    let received: unknown;
    try {
      parseFeishuCliPayload(JSON.stringify({
        ok: false,
        error: {
          type: "authentication",
          subtype: "token_missing",
          message: "need_user_authorization (user: ou_private_identifier)"
        }
      }));
    } catch (error) {
      received = error;
    }
    expect(isFeishuAuthorizationRequired(received)).toBe(true);
    expect((received as Error).message).toBe("需要先授权飞书，才能查找群聊和多维表格");
    expect((received as Error).message).not.toContain("ou_");
  });

  it("识别可用和缺失的个人授权", () => {
    expect(readFeishuUserAuthorization({ verified: true, identities: { user: {
      status: "ready", available: true, userName: "肖志伟"
    } } })).toEqual({ ready: true, label: "肖志伟", message: "个人授权可用" });
    expect(readFeishuUserAuthorization({ verified: true, identities: { user: {
      status: "missing", available: false, userName: "肖志伟", openId: "ou_private"
    } } })).toEqual({ ready: false, label: "肖志伟", message: "需要先完成个人授权，才能查找群聊和多维表格" });
  });

  it("不会把未知飞书错误原样暴露到界面", () => {
    expect(() => parseFeishuCliPayload(JSON.stringify({
      ok: false,
      error: { type: "unexpected", message: "internal user ou_private and token detail" }
    }))).toThrow("飞书暂时无法完成这次只读查询，请稍后重试");
  });

  it("把未开通的应用权限变成安全的飞书官方操作入口", () => {
    let received: unknown;
    try {
      parseFeishuCliPayload(JSON.stringify({
        ok: false,
        error: {
          type: "authorization",
          subtype: "app_scope_not_applied",
          message: "app private_id has not applied scope base:table:read",
          console_url: "https://open.feishu.cn/page/scope-apply?clientID=private_id&scopes=base%3Atable%3Aread"
        }
      }));
    } catch (error) {
      received = error;
    }
    expect((received as Error).message).toBe("飞书应用尚未开通所选内容的只读权限");
    expect(feishuAppPermissionUrl(received)).toContain("https://open.feishu.cn/page/scope-apply?");
    const expanded = expandFeishuPermissionUrl(feishuAppPermissionUrl(received), [
      "base:table:read", "base:view:read", "base:record:read"
    ]);
    expect(new URL(expanded).searchParams.get("scopes")).toBe("base:table:read,base:view:read,base:record:read");
  });

  it("拒绝把非飞书官方网址作为权限入口", () => {
    expect(expandFeishuPermissionUrl("https://example.com/page/scope-apply?clientID=x", ["base:table:read"]))
      .toBe("");
  });
});
