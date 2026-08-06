(function attachCaptureCore(root) {
  "use strict";

  const ROLE_SELECTOR = "[data-message-author-role]";
  const TURN_SELECTOR = 'article[data-testid^="conversation-turn-"]';

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function conversationIdFromUrl(value) {
    try {
      const url = new URL(value);
      if (url.hostname !== "chatgpt.com" && url.hostname !== "chat.openai.com") {
        return null;
      }

      const segments = url.pathname.split("/").filter(Boolean);
      const conversationMarker = segments.lastIndexOf("c");
      if (conversationMarker < 0 || conversationMarker + 1 >= segments.length) {
        return null;
      }

      const conversationId = decodeURIComponent(segments[conversationMarker + 1]);
      return /^[A-Za-z0-9._-]{6,160}$/.test(conversationId) ? conversationId : null;
    } catch {
      return null;
    }
  }

  function contentRootFor(roleNode, role) {
    const selectors = role === "assistant"
      ? [".markdown", "[data-message-content]", ".prose"]
      : [".whitespace-pre-wrap", "[data-message-content]"];

    for (const selector of selectors) {
      const match = roleNode.querySelector(selector);
      if (match) {
        return match;
      }
    }

    return roleNode;
  }

  function extractTurn(turnNode, index) {
    const roleNode = turnNode.matches(ROLE_SELECTOR)
      ? turnNode
      : turnNode.querySelector(ROLE_SELECTOR);
    if (!roleNode) {
      return null;
    }

    const role = roleNode.getAttribute("data-message-author-role");
    if (role !== "user" && role !== "assistant") {
      return null;
    }

    const contentRoot = contentRootFor(roleNode, role);
    const content = normalizeText(contentRoot.innerText || contentRoot.textContent);
    if (!content) {
      return null;
    }

    const testId = turnNode.getAttribute("data-testid") || "";
    const messageId = roleNode.getAttribute("data-message-id")
      || turnNode.getAttribute("data-message-id")
      || testId.replace(/^conversation-turn-/, "")
      || `index-${index}`;

    return {
      content,
      index,
      messageId: String(messageId).slice(0, 180),
      role,
      turnNode
    };
  }

  function pairMessages(messages) {
    const pairs = [];
    for (let index = 0; index < messages.length; index += 1) {
      const user = messages[index];
      if (!user || user.role !== "user") {
        continue;
      }

      let assistant = null;
      for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
        const candidate = messages[nextIndex];
        if (!candidate) {
          continue;
        }
        if (candidate.role === "user") {
          break;
        }
        if (candidate.role === "assistant") {
          assistant = candidate;
          break;
        }
      }

      if (!assistant) {
        continue;
      }

      const turnId = `${user.messageId}--${assistant.messageId}`
        .replace(/[^A-Za-z0-9._:-]/g, "-")
        .slice(0, 300);
      pairs.push({ assistant, turnId, user });
    }
    return pairs;
  }

  function collectTurnNodes(documentObject) {
    const preferred = Array.from(documentObject.querySelectorAll(TURN_SELECTOR));
    if (preferred.length > 0) {
      return preferred;
    }

    const seen = new Set();
    const fallback = [];
    for (const roleNode of documentObject.querySelectorAll(ROLE_SELECTOR)) {
      const turnNode = roleNode.closest("article") || roleNode;
      if (!seen.has(turnNode)) {
        seen.add(turnNode);
        fallback.push(turnNode);
      }
    }
    return fallback;
  }

  function scanDocument(documentObject) {
    const messages = collectTurnNodes(documentObject)
      .map((turnNode, index) => extractTurn(turnNode, index))
      .filter(Boolean);
    return pairMessages(messages);
  }

  root.ChatGPTCaptureCore = Object.freeze({
    conversationIdFromUrl,
    normalizeText,
    pairMessages,
    scanDocument
  });
})(globalThis);
