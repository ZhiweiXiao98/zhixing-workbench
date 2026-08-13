export interface FeishuChatCandidate {
  chatId: string;
  name: string;
  external: boolean;
}

export interface FeishuChatSelection {
  selection_key: string;
  chat_id: string;
  query?: string;
  label: string;
  type: "project_group";
}

export function parseChatCandidatesPayload(payload: any): FeishuChatCandidate[] {
  const data = payload?.data ?? payload ?? {};
  const chats = Array.isArray(data.chats) ? data.chats : Array.isArray(data.items) ? data.items : [];
  const results = chats
    .filter((item: any) => item?.chat_mode !== "p2p" && item?.chat_status !== "dissolved")
    .map((item: any) => ({
      chatId: identifier(item?.chat_id),
      name: display(item?.name || "未命名群聊"),
      external: item?.external === true
    }))
    .filter((item: FeishuChatCandidate) => item.chatId && item.name);
  const unique = new Map<string, FeishuChatCandidate>();
  for (const item of results) if (!unique.has(item.chatId)) unique.set(item.chatId, item);
  return [...unique.values()].slice(0, 50);
}

export function createChatSelection(candidate: FeishuChatCandidate): FeishuChatSelection {
  const chatId = identifier(candidate.chatId);
  if (!chatId) throw new Error("请选择有效的项目群");
  return {
    selection_key: chatId,
    chat_id: chatId,
    query: "",
    label: display(candidate.name || "已选项目群"),
    type: "project_group"
  };
}

function identifier(value: unknown): string {
  return String(value || "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 300);
}

function display(value: unknown): string {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
}
