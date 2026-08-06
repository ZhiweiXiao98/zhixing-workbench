import { describe, expect, it } from "vitest";
import { deriveKnowledgeDigest, parseKnowledgeDigest } from "../src/core/knowledge-digest";

describe("knowledge digest", () => {
  it("读取新版一眼看懂结构", () => {
    expect(parseKnowledgeDigest({
      about: "这篇记录解释自动处理为什么需要服务端再次确认授权。",
      problem: "只相信客户端确认，会让已经撤销的授权继续被使用。",
      result: "系统现在会在执行前重新核对授权、目标和证据。",
      next_use: "下次增加自动操作时，先检查服务端是否保留最终决定权。"
    })).toEqual({
      about: "这篇记录解释自动处理为什么需要服务端再次确认授权。",
      problem: "只相信客户端确认，会让已经撤销的授权继续被使用。",
      result: "系统现在会在执行前重新核对授权、目标和证据。",
      nextUse: "下次增加自动操作时，先检查服务端是否保留最终决定权。"
    });
  });

  it("从旧 Wiki 的固定章节提取兼容摘要，不根据文件名猜结果", () => {
    const digest = deriveKnowledgeDigest([
      "# 自动处理授权",
      "",
      "## 问题与现象",
      "- 客户端的一次确认可能被长期误用。",
      "- 授权撤销后仍可能继续执行。",
      "",
      "## 验证方式与结果",
      "- 服务端执行前会重新核对授权。",
      "- 撤销后的授权无法再次使用。",
      "",
      "## 可复用的解决路径",
      "1. 先确认授权仍然有效。",
      "2. 再检查目标和证据是否变化。"
    ].join("\n"), "自动处理授权", "把自动处理的授权过程整理成可复用经验。");

    expect(digest).toMatchObject({
      problem: "客户端的一次确认可能被长期误用。；授权撤销后仍可能继续执行。",
      result: "服务端执行前会重新核对授权。；撤销后的授权无法再次使用。",
      nextUse: "先确认授权仍然有效。；再检查目标和证据是否变化。"
    });
  });

  it("证据章节不足时不生成看似可信的摘要", () => {
    expect(deriveKnowledgeDigest("## 问题与现象\n只有问题", "空页面")).toBeUndefined();
  });
});
