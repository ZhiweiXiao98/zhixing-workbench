const RECEIVER_ENDPOINT = "http://127.0.0.1:43123";
const RETRY_ALARM = "chatgpt-obsidian-retry";
let operationChain = Promise.resolve();

function eventKey(event) {
  return [event.conversation_id, event.turn_id, event.event, event.message_id || ""].join(":");
}

async function ensureDefaults() {
  const current = await chrome.storage.local.get(["enabled", "pausedConversationIds", "pendingEvents", "receiverToken"]);
  const updates = {};
  if (typeof current.enabled !== "boolean") {
    updates.enabled = true;
  }
  if (!Array.isArray(current.pausedConversationIds)) {
    updates.pausedConversationIds = [];
  }
  if (!Array.isArray(current.pendingEvents)) {
    updates.pendingEvents = [];
  }
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

async function receiverToken() {
  const stored = await chrome.storage.local.get({ receiverToken: "" });
  return typeof stored.receiverToken === "string" ? stored.receiverToken.trim() : "";
}

async function saveReceiverStatus(status) {
  const stored = await chrome.storage.local.get({ receiverStatus: {} });
  const previous = stored.receiverStatus && typeof stored.receiverStatus === "object"
    ? stored.receiverStatus
    : {};
  const next = {
    ...previous,
    ...status,
    checkedAt: new Date().toISOString()
  };
  if (status.online === true && !("error" in status)) {
    delete next.error;
  }
  await chrome.storage.local.set({
    receiverStatus: next
  });
}

async function enqueueEvents(events) {
  const stored = await chrome.storage.local.get({ pendingEvents: [] });
  const pending = new Map(
    (Array.isArray(stored.pendingEvents) ? stored.pendingEvents : [])
      .map((event) => [eventKey(event), event])
  );

  for (const event of events) {
    if (!event || !event.conversation_id || !event.turn_id || !event.event || !event.content) {
      continue;
    }
    pending.set(eventKey(event), event);
  }

  const bounded = [];
  let characters = 0;
  for (const event of Array.from(pending.values()).reverse()) {
    const size = JSON.stringify(event).length;
    if (bounded.length >= 2000 || characters + size > 4_000_000) break;
    bounded.push(event);
    characters += size;
  }
  bounded.reverse();
  await chrome.storage.local.set({ pendingEvents: bounded });
  return bounded.length;
}

async function flushPending() {
  const stored = await chrome.storage.local.get({ pendingEvents: [] });
  const pending = Array.isArray(stored.pendingEvents) ? stored.pendingEvents : [];
  const token = await receiverToken();
  if (!token) {
    await saveReceiverStatus({ online: false, pending: pending.length, setupRequired: true });
    return { accepted: 0, duplicates: 0, ok: false, pending: pending.length, rejected: 0 };
  }
  if (pending.length === 0) {
    return healthCheck();
  }

  const batch = pending.slice(0, 100);
  try {
    const response = await fetch(`${RECEIVER_ENDPOINT}/capture/v1/events`, {
      body: JSON.stringify({ events: batch }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Obsidian-Capture-Token": token
      },
      method: "POST"
    });
    if (!response.ok) {
      throw new Error(`receiver-http-${response.status}`);
    }

    const result = await response.json();
    const accepted = Number(result.accepted || 0);
    const duplicates = Number(result.duplicates || 0);
    const rejected = Number(result.rejected || 0);
    const acknowledged = new Set(Array.isArray(result.ack_keys) ? result.ack_keys : []);
    if (acknowledged.size === 0) {
      throw new Error("receiver-missing-ack");
    }
    const remaining = pending.filter((event) => !acknowledged.has(eventKey(event)));
    await chrome.storage.local.set({ pendingEvents: remaining });
    const deliveryStatus = {
      lastAccepted: accepted,
      lastDuplicates: duplicates,
      lastRejected: rejected,
      online: true,
      setupRequired: false,
      pending: remaining.length
    };
    if (accepted + duplicates > 0) {
      deliveryStatus.lastDeliveredAt = new Date().toISOString();
    }
    await saveReceiverStatus(deliveryStatus);
    return { accepted, duplicates, ok: true, pending: remaining.length, rejected };
  } catch (error) {
    await saveReceiverStatus({
      error: String(error && error.message ? error.message : error).slice(0, 200),
      online: false,
      pending: pending.length
    });
    return { accepted: 0, duplicates: 0, ok: false, pending: pending.length, rejected: 0 };
  }
}

function serialized(operation) {
  operationChain = operationChain.then(operation, operation);
  return operationChain;
}

async function healthCheck() {
  const token = await receiverToken();
  if (!token) {
    const stored = await chrome.storage.local.get({ pendingEvents: [] });
    const pending = Array.isArray(stored.pendingEvents) ? stored.pendingEvents.length : 0;
    await saveReceiverStatus({ online: false, pending, setupRequired: true });
    return { ok: false, pending, setupRequired: true };
  }
  try {
    const response = await fetch(`${RECEIVER_ENDPOINT}/health`, {
      cache: "no-store",
      headers: { "X-Obsidian-Capture-Token": token }
    });
    if (!response.ok) {
      throw new Error(`receiver-http-${response.status}`);
    }
    const stored = await chrome.storage.local.get({ pendingEvents: [] });
    const pending = Array.isArray(stored.pendingEvents) ? stored.pendingEvents.length : 0;
    await saveReceiverStatus({ online: true, pending, setupRequired: false });
    return { ok: true, pending };
  } catch (error) {
    const stored = await chrome.storage.local.get({ pendingEvents: [] });
    const pending = Array.isArray(stored.pendingEvents) ? stored.pendingEvents.length : 0;
    await saveReceiverStatus({
      error: String(error && error.message ? error.message : error).slice(0, 200),
      online: false,
      pending
    });
    return { ok: false, pending };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  serialized(async () => {
    await ensureDefaults();
    await chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
    await healthCheck();
  });
});

chrome.runtime.onStartup.addListener(() => {
  serialized(async () => {
    await ensureDefaults();
    await chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
    await flushPending();
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) {
    serialized(flushPending);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "captureEvents") {
    serialized(async () => {
      await ensureDefaults();
      const pending = await enqueueEvents(Array.isArray(message.events) ? message.events : []);
      const result = await flushPending();
      return {
        accepted: result.accepted || 0,
        duplicates: result.duplicates || 0,
        ok: true,
        online: result.ok,
        pending: result.pending ?? pending,
        rejected: result.rejected || 0
      };
    }).then(sendResponse, (error) => sendResponse({
      error: String(error && error.message ? error.message : error).slice(0, 200),
      ok: false
    }));
    return true;
  }

  if (message.type === "healthCheck") {
    serialized(healthCheck).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "flushPending") {
    serialized(flushPending).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }

  return false;
});

ensureDefaults().then(() => chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 }));
