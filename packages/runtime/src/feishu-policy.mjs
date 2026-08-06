const SUBSTANTIVE_PATTERN =
  /(?:决定|结论|确认|通过|拒绝|完成|交付|发布|上线|修复|问题|原因|方案|解决|待办|负责人|截止|阻塞|风险|验收|反馈|需求|任务|链接|文档|提交|commit|issue|todo|blocked)/i;
const CHATTER_PATTERN = /^(?:好的?|收到|明白|谢谢|辛苦了|ok|okay|嗯+|哈+|赞|1|已阅)[。.!！~～\s]*$/i;
const BROADCAST_PATTERN = /(?:系统通知|机器人通知|自动播报|例行提醒|打卡提醒|会议即将开始)/i;

export function shouldCaptureFeishuMessage(message, context = {}) {
  if (!context.selectedProjectGroup) return false;
  const type = String(message.chat_type || message.chatType || context.chatType || "").toLowerCase();
  if (type === "p2p" || type === "private") return false;
  const senderType = String(message.sender_type || message.sender?.sender_type || message.sender?.type || "").toLowerCase();
  if (senderType === "bot" || senderType === "app" || String(message.msg_type || "").toLowerCase() === "system") {
    return false;
  }
  const text = messageText(message).trim();
  if (!text || CHATTER_PATTERN.test(text) || BROADCAST_PATTERN.test(text)) return false;
  const currentId = String(context.currentUserId || "");
  const senderId = String(message.sender_id || message.sender?.id || message.sender?.sender_id || "");
  const mentioned = mentions(message).some((value) => value === currentId || value === "all-current-user");
  const ownConclusion = Boolean(currentId && senderId === currentId && SUBSTANTIVE_PATTERN.test(text));
  return mentioned || ownConclusion || SUBSTANTIVE_PATTERN.test(text);
}

export function selectFeishuMessages(messages, context = {}) {
  const selected = new Set();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!shouldCaptureFeishuMessage(message, context)) continue;
    selected.add(index);
    if (mentionsCurrent(message, context.currentUserId)) {
      if (safeContextMessage(messages[index - 1], context)) selected.add(index - 1);
      if (safeContextMessage(messages[index + 1], context)) selected.add(index + 1);
    }
  }
  return [...selected].sort((left, right) => left - right).map((index) => ({
    ...messages[index],
    zhixing_context_only: !shouldCaptureFeishuMessage(messages[index], context)
  }));
}

export function messageText(message) {
  const direct = message.text || message.content || message.body?.content || message.body?.text || "";
  if (typeof direct !== "string") return flattenText(direct);
  try {
    return flattenText(JSON.parse(direct));
  } catch {
    return direct;
  }
}

function mentions(message) {
  const values = message.mentions || message.body?.mentions || [];
  return Array.isArray(values) ? values.flatMap((item) => {
    if (typeof item === "string") return [item];
    const id = item?.id || item?.key || item?.open_id || item?.user_id;
    return id ? [String(id)] : [];
  }) : [];
}

function mentionsCurrent(message, currentUserId) {
  return Boolean(currentUserId && mentions(message).some((value) => value === currentUserId || value === "all-current-user"));
}

function safeContextMessage(message, context) {
  if (!message || !context.selectedProjectGroup) return false;
  const type = String(message.chat_type || message.chatType || context.chatType || "").toLowerCase();
  const senderType = String(message.sender_type || message.sender?.sender_type || message.sender?.type || "").toLowerCase();
  return type !== "p2p" && type !== "private" && senderType !== "bot" && senderType !== "app" &&
    String(message.msg_type || "").toLowerCase() !== "system" && Boolean(messageText(message).trim());
}

function flattenText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join(" ");
  if (!value || typeof value !== "object") return "";
  return Object.entries(value)
    .filter(([key]) => !/(?:token|secret|password|authorization)/i.test(key))
    .map(([, item]) => flattenText(item))
    .filter(Boolean)
    .join(" ");
}
