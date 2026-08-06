"use strict";

const enabledInput = document.querySelector("#enabled");
const receiverDot = document.querySelector("#receiver-dot");
const receiverLabel = document.querySelector("#receiver-label");
const conversationTitle = document.querySelector("#conversation-title");
const conversationToggle = document.querySelector("#conversation-toggle");
const pageStatusLabel = document.querySelector("#page-status");
const captureNowButton = document.querySelector("#capture-now");
const captureResult = document.querySelector("#capture-result");
const saveLabel = document.querySelector("#save-label");
const queueLabel = document.querySelector("#queue-label");
const retryButton = document.querySelector("#retry");
const connectionSettings = document.querySelector("#connection-settings");
const receiverTokenInput = document.querySelector("#receiver-token");
const saveConnectionButton = document.querySelector("#save-connection");
const connectionResult = document.querySelector("#connection-result");

let activeTabId = null;
let activeConversationId = null;
let pausedConversationIds = [];

function renderReceiver(status) {
  const online = Boolean(status && status.online);
  const pending = Number(status && status.pending ? status.pending : 0);
  const accepted = Number(status && status.lastAccepted ? status.lastAccepted : 0);
  const duplicates = Number(status && status.lastDuplicates ? status.lastDuplicates : 0);
  receiverDot.className = `status-dot ${online ? "online" : "offline"}`;
  receiverLabel.textContent = online
    ? "本地接收器已连接"
    : status && status.setupRequired
      ? "需要填写本机接收密钥"
      : "本地接收器未连接，记录会排队";
  if (status && status.setupRequired) connectionSettings.open = true;
  queueLabel.textContent = pending > 0 ? `待发送 ${pending} 条` : "已全部发送";

  if (status && status.lastDeliveredAt) {
    const time = new Date(status.lastDeliveredAt).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    const pairCount = Math.ceil((accepted + duplicates) / 2);
    saveLabel.textContent = accepted > 0
      ? `最后写入 ${time} · ${pairCount} 组`
      : `最后确认 ${time} · 已存在 ${pairCount} 组`;
  } else {
    saveLabel.textContent = "尚无写入记录";
  }
}

function renderPageStatus(status) {
  if (!status || (status.conversationId && status.conversationId !== activeConversationId)) {
    pageStatusLabel.textContent = activeConversationId ? "正在读取当前页面" : "等待已保存的对话";
    return;
  }

  const pairCount = Number(status.pairCount || 0);
  const labels = {
    disabled: "自动记录已关闭",
    "conversation-paused": "当前对话已暂停",
    "page-error": "读取页面时发生错误",
    "selector-error": "页面结构已变化，暂未读取到问答",
    streaming: `回答生成中 · 已识别 ${pairCount} 组`,
    "waiting-for-saved-chat": "对话尚未保存",
    watching: `已识别 ${pairCount} 组完整问答`
  };
  pageStatusLabel.textContent = labels[status.state] || `已识别 ${pairCount} 组完整问答`;
}

function renderConversation() {
  const paused = activeConversationId && pausedConversationIds.includes(activeConversationId);
  conversationToggle.disabled = !activeConversationId;
  captureNowButton.disabled = !activeConversationId;
  conversationToggle.textContent = paused ? "恢复本对话" : "暂停本对话";
}

async function readCurrentConversation() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || typeof tab.id !== "number" || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url || "")) {
    conversationTitle.textContent = "当前页面不是已保存的 ChatGPT 对话";
    renderPageStatus(null);
    renderConversation();
    return;
  }

  activeTabId = tab.id;
  try {
    const state = await chrome.tabs.sendMessage(tab.id, { type: "getConversationState" });
    activeConversationId = state && state.conversationId ? state.conversationId : null;
    conversationTitle.textContent = activeConversationId
      ? String(state.title || activeConversationId).slice(0, 160)
      : "对话尚未保存，生成回答后会自动识别";
    renderPageStatus({
      conversationId: activeConversationId,
      pairCount: Number(state && state.pairCount ? state.pairCount : 0),
      state: !activeConversationId
        ? "waiting-for-saved-chat"
        : state && state.streaming ? "streaming" : "watching"
    });
  } catch {
    conversationTitle.textContent = "刷新 ChatGPT 页面后即可开始记录";
    pageStatusLabel.textContent = "扩展尚未连接到当前页面";
  }
  renderConversation();
}

async function initialize() {
  const stored = await chrome.storage.local.get({
    enabled: true,
    pausedConversationIds: [],
    pageStatus: null,
    receiverStatus: { online: false, pending: 0 },
    receiverToken: ""
  });
  receiverTokenInput.value = stored.receiverToken || "";
  enabledInput.checked = stored.enabled !== false;
  pausedConversationIds = Array.isArray(stored.pausedConversationIds)
    ? stored.pausedConversationIds
    : [];
  renderReceiver(stored.receiverStatus);
  await readCurrentConversation();
  if (stored.pageStatus && stored.pageStatus.conversationId === activeConversationId) {
    renderPageStatus(stored.pageStatus);
  }
  const health = await chrome.runtime.sendMessage({ type: "healthCheck" });
  const refreshed = await chrome.storage.local.get({ receiverStatus: health });
  renderReceiver(refreshed.receiverStatus);
}

enabledInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ enabled: enabledInput.checked });
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { type: "rescan" }).catch(() => {});
  }
});

conversationToggle.addEventListener("click", async () => {
  if (!activeConversationId) {
    return;
  }
  const paused = pausedConversationIds.includes(activeConversationId);
  pausedConversationIds = paused
    ? pausedConversationIds.filter((id) => id !== activeConversationId)
    : [...pausedConversationIds, activeConversationId].slice(-500);
  await chrome.storage.local.set({ pausedConversationIds });
  renderConversation();
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { type: "rescan" }).catch(() => {});
  }
});

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  await chrome.runtime.sendMessage({ type: "flushPending" });
  const stored = await chrome.storage.local.get({ receiverStatus: { online: false, pending: 0 } });
  renderReceiver(stored.receiverStatus);
  retryButton.disabled = false;
});

saveConnectionButton.addEventListener("click", async () => {
  const token = receiverTokenInput.value.trim();
  if (token.length < 24) {
    connectionResult.textContent = "请填写完整接收密钥";
    return;
  }
  saveConnectionButton.disabled = true;
  await chrome.storage.local.set({ receiverToken: token });
  const result = await chrome.runtime.sendMessage({ type: "healthCheck" });
  const stored = await chrome.storage.local.get({ receiverStatus: result });
  renderReceiver(stored.receiverStatus);
  connectionResult.textContent = result && result.ok ? "连接成功" : "暂未连接，请先打开 Obsidian";
  saveConnectionButton.disabled = false;
});

captureNowButton.addEventListener("click", async () => {
  if (!activeTabId || !activeConversationId) {
    return;
  }

  captureNowButton.disabled = true;
  captureResult.textContent = "正在读取当前页面";
  try {
    const result = await chrome.tabs.sendMessage(activeTabId, { type: "captureNow" });
    renderPageStatus(result);
    if (result && result.state === "streaming") {
      captureResult.textContent = "回答仍在生成，完成后再采集";
    } else if (!result || !result.ok) {
      captureResult.textContent = "当前页面暂时无法采集";
    } else if (Number(result.pairCount || 0) === 0) {
      captureResult.textContent = "当前还没有完整问答";
    } else if (Number(result.rejected || 0) > 0) {
      captureResult.textContent = `有 ${Number(result.rejected)} 条内容未写入`;
    } else if (Number(result.queued || 0) > 0) {
      captureResult.textContent = `已排队 ${Number(result.queued)} 组问答`;
    } else {
      captureResult.textContent = `已确认 ${Number(result.confirmed || 0)} 组问答`;
    }

    const stored = await chrome.storage.local.get({ receiverStatus: { online: false, pending: 0 } });
    renderReceiver(stored.receiverStatus);
  } catch {
    captureResult.textContent = "刷新 ChatGPT 页面后再试";
  }
  renderConversation();
});

initialize().catch(() => renderReceiver({ online: false, pending: 0 }));
