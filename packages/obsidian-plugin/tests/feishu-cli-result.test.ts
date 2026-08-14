import { describe, expect, it } from "vitest";
import {
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
});
