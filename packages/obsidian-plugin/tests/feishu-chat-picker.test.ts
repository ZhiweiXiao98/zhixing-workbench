import { describe, expect, it } from "vitest";
import { createChatSelection, parseChatCandidatesPayload } from "../src/feishu-chat-picker";

describe("飞书项目群选择器", () => {
  it("把可见群聊变成人类可读的候选项", () => {
    expect(parseChatCandidatesPayload({ data: { chats: [
      { chat_id: "oc_ai", name: "AI研发小组", description: "研发项目沟通", external: false, chat_mode: "group", chat_status: "normal" },
      { chat_id: "oc_partner", name: "合作项目", external: true, chat_mode: "topic", chat_status: "normal" }
    ] } })).toEqual([
      { chatId: "oc_ai", name: "AI研发小组", external: false },
      { chatId: "oc_partner", name: "合作项目", external: true }
    ]);
  });

  it("过滤私聊、已解散群和重复结果", () => {
    expect(parseChatCandidatesPayload({ data: { chats: [
      { chat_id: "oc_one", name: "项目一", chat_mode: "group", chat_status: "normal" },
      { chat_id: "oc_one", name: "项目一重复", chat_mode: "group", chat_status: "normal" },
      { chat_id: "ou_person", name: "某人", chat_mode: "p2p", chat_status: "normal" },
      { chat_id: "oc_old", name: "旧群", chat_mode: "group", chat_status: "dissolved" },
      { chat_id: "", name: "无效群", chat_mode: "group", chat_status: "normal" }
    ] } })).toEqual([{ chatId: "oc_one", name: "项目一", external: false }]);
  });

  it("选择后只保存稳定群 ID 和群名", () => {
    expect(createChatSelection({ chatId: "oc_ai", name: "AI研发小组", external: false })).toEqual({
      selection_key: "oc_ai",
      chat_id: "oc_ai",
      query: "",
      label: "AI研发小组",
      type: "project_group"
    });
  });
});
