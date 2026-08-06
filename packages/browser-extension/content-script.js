(function startChatGptCapture() {
  "use strict";

  const core = globalThis.ChatGPTCaptureCore;
  const stableAnswers = new Map();
  const submittedPairs = new Set();
  let scanTimer = null;
  let currentUrl = location.href;

  function hasStreamingAnswer() {
    return Boolean(document.querySelector(
      'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="停止生成"]'
    ));
  }

  async function readSettings() {
    const stored = await chrome.storage.local.get({
      enabled: true,
      pausedConversationIds: []
    });
    return {
      enabled: stored.enabled !== false,
      pausedConversationIds: Array.isArray(stored.pausedConversationIds)
        ? stored.pausedConversationIds
        : []
    };
  }

  async function writePageStatus(status) {
    await chrome.storage.local.set({
      pageStatus: {
        ...status,
        observedAt: new Date().toISOString()
      }
    });
  }

  function buildEvents(conversationId, pair) {
    const common = {
      conversation_id: conversationId,
      title: document.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, "").trim().slice(0, 300),
      turn_id: pair.turnId,
      url: location.href
    };

    return [
      {
        ...common,
        content: pair.user.content,
        event: "UserPromptSubmit",
        message_id: pair.user.messageId
      },
      {
        ...common,
        content: pair.assistant.content,
        event: "Stop",
        message_id: pair.assistant.messageId
      }
    ];
  }

  async function scan({ force = false } = {}) {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      stableAnswers.clear();
      submittedPairs.clear();
    }

    const settings = await readSettings();
    const conversationId = core.conversationIdFromUrl(location.href);
    if (!settings.enabled) {
      await writePageStatus({ state: "disabled", conversationId });
      return { conversationId, ok: false, state: "disabled" };
    }
    if (!conversationId) {
      await writePageStatus({ state: "waiting-for-saved-chat", conversationId: null });
      return { conversationId: null, ok: false, state: "waiting-for-saved-chat" };
    }
    if (settings.pausedConversationIds.includes(conversationId)) {
      await writePageStatus({ state: "conversation-paused", conversationId });
      return { conversationId, ok: false, state: "conversation-paused" };
    }

    const pairs = core.scanDocument(document);
    const turnCount = document.querySelectorAll('article[data-testid^="conversation-turn-"]').length;
    const roleCount = document.querySelectorAll("[data-message-author-role]").length;
    if (turnCount > 0 && roleCount === 0) {
      await writePageStatus({ conversationId, state: "selector-error", turnCount });
      return { conversationId, ok: false, pairCount: 0, state: "selector-error" };
    }
    const streaming = hasStreamingAnswer();
    if (force && streaming) {
      const status = {
        conversationId,
        pairCount: pairs.length,
        state: "streaming",
        title: document.title
      };
      await writePageStatus(status);
      return { ...status, ok: false };
    }

    let submitted = 0;
    let confirmed = 0;
    let queued = 0;
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    const now = Date.now();

    for (const pair of pairs) {
      const pairKey = `${conversationId}:${pair.turnId}`;
      if (!force && submittedPairs.has(pairKey)) {
        continue;
      }
      if (pair.user.content.toLowerCase().includes("[no-obsidian]")) {
        submittedPairs.add(pairKey);
        continue;
      }

      if (!force) {
        const previous = stableAnswers.get(pairKey);
        if (!previous || previous.content !== pair.assistant.content) {
          stableAnswers.set(pairKey, { content: pair.assistant.content, since: now });
          continue;
        }
        if (streaming || now - previous.since < 4500) {
          continue;
        }
      }

      const response = await chrome.runtime.sendMessage({
        events: buildEvents(conversationId, pair),
        type: "captureEvents"
      });
      if (response && response.ok) {
        submittedPairs.add(pairKey);
        submitted += 1;
        accepted += Number(response.accepted || 0);
        duplicates += Number(response.duplicates || 0);
        rejected += Number(response.rejected || 0);
        if (response.online && Number(response.accepted || 0) + Number(response.duplicates || 0) === 2) {
          confirmed += 1;
        } else if (!response.online) {
          queued += 1;
        }
      }
    }

    const status = {
      accepted,
      confirmed,
      conversationId,
      duplicates,
      pairCount: pairs.length,
      queued,
      rejected,
      state: streaming ? "streaming" : "watching",
      submitted,
      title: document.title
    };
    await writePageStatus(status);
    return { ...status, ok: true };
  }

  function scheduleScan(delay = 700) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scan().catch(async (error) => {
        await writePageStatus({
          message: String(error && error.message ? error.message : error).slice(0, 300),
          state: "page-error"
        });
      });
    }, delay);
  }

  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "getConversationState") {
      sendResponse({
        conversationId: core.conversationIdFromUrl(location.href),
        pairCount: core.scanDocument(document).length,
        streaming: hasStreamingAnswer(),
        title: document.title
      });
      return false;
    }
    if (message && message.type === "rescan") {
      scheduleScan(0);
      sendResponse({ ok: true });
      return false;
    }
    if (message && message.type === "captureNow") {
      clearTimeout(scanTimer);
      scan({ force: true }).then(sendResponse, (error) => sendResponse({
        message: String(error && error.message ? error.message : error).slice(0, 300),
        ok: false,
        state: "page-error"
      }));
      return true;
    }
    return false;
  });

  setInterval(() => scheduleScan(0), 5000);
  scheduleScan(0);
})();
