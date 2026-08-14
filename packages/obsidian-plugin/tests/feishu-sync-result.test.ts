import { describe, expect, it } from "vitest";
import { feishuSyncNotice, parseFeishuSyncResult } from "../src/feishu-sync-result";

describe("飞书同步结果", () => {
  it("部分成功会显示真实新增数和待重试模块", () => {
    const result = parseFeishuSyncResult('日志\n{"status":"partial","accepted":153,"duplicates":0,"failed_modules":2}');
    expect(result).toEqual({ status: "partial", accepted: 153, duplicates: 0, failedModules: 2 });
    expect(feishuSyncNotice(result!)).toBe("飞书已同步 153 条；2 个模块待重试");
  });

  it("完整成功且没有新增内容时不会误报失败", () => {
    const result = parseFeishuSyncResult('{"status":"succeeded","accepted":0,"duplicates":153,"failed_modules":0}');
    expect(feishuSyncNotice(result!)).toBe("飞书同步完成，没有新增内容");
  });
});
