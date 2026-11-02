importScripts("config.js", "prompts.js", "key-store.js", "budget.js");

const {
  MAX_SELECTION_CHARS,
  REQUEST_TIMEOUT_MS,
  MAX_RETRIES,
  REQUEST_BUDGET,
  normalizeModel,
  normalizeMode,
} = QuillConfig;

const activeRequests = new Map();

const BUDGET_STORAGE_KEY = "requestBudget";
let budgetQueue = Promise.resolve();

lockDownLocalStorage();
QuillKeyStore.migrateLegacyKey().catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  lockDownLocalStorage();
  QuillKeyStore.migrateLegacyKey().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  lockDownLocalStorage();
  QuillKeyStore.migrateLegacyKey().catch(() => {});
});

chrome.commands.onCommand.addListener((command, tab) => {
  runCommand(command, tab);
});

// Keyboard shortcuts run on whatever text is selected in the focused frame.
// Every frame receives the message; only the one holding focus acts on it.
function runCommand(command, tab) {
  const mode = command === "quill-rewrite" ? "rewrite" : command === "quill-fix" ? "grammar" : null;
  if (!mode || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "quill-command", mode }).catch(() => {});
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "quill-api") return;

  const requestIds = new Set();

  port.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "cancel" && message.requestId) {
      cancelRequest(message.requestId, "cancelled");
      return;
    }

    if (message.type !== "check" || !message.requestId) return;

    requestIds.add(message.requestId);
    handleGrammarRequest(port, message)
      .catch((error) => {
        if (error?.name !== "AbortError") {
          safePost(port, {
            type: "error",
            requestId: message.requestId,
            message: friendlyError(error),
          });
        }
      })
      .finally(() => {
        requestIds.delete(message.requestId);
        activeRequests.delete(message.requestId);
      });
  });

  port.onDisconnect.addListener(() => {
    for (const requestId of requestIds) cancelRequest(requestId, "disconnected");
    requestIds.clear();
  });
});

async function lockDownLocalStorage() {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch (_) {
    // Older Chromium builds may not expose setAccessLevel. The key still remains
    // isolated from page JavaScript because extension content scripts run in an
    // isolated world, but current Chrome will apply the stricter access level.
  }
}

// Serialized so two requests arriving together can't both read the same count.
function consumeBudget() {
  const run = budgetQueue.then(async () => {
    const stored = await chrome.storage.local.get(BUDGET_STORAGE_KEY);
    const result = QuillBudget.consume(stored[BUDGET_STORAGE_KEY], Date.now(), REQUEST_BUDGET);
    await chrome.storage.local.set({ [BUDGET_STORAGE_KEY]: result.state });
    return result;
  });
  budgetQueue = run.catch(() => {});
  return run;
}

function cancelRequest(requestId, reason) {
  const active = activeRequests.get(requestId);
  if (!active) return;
  try {
    active.controller.abort(reason);
  } catch (_) {}
}

async function handleGrammarRequest(port, message) {
  const requestId = String(message.requestId);
  const text = typeof message.text === "string" ? message.text : "";
  const mode = normalizeMode(message.mode);
  const model = normalizeModel(message.model);

  if (!text.trim()) {
    safePost(port, { type: "error", requestId, message: "No text was selected." });
    return;
  }

  if (text.length > MAX_SELECTION_CHARS) {
    safePost(port, {
      type: "error",
      requestId,
      message: `Selection is too long. Please keep it under ${MAX_SELECTION_CHARS.toLocaleString()} characters.`,
    });
    return;
  }

  const apiKey = await QuillKeyStore.getKey();
  if (!apiKey) {
    safePost(port, {
      type: "error",
      requestId,
      message: "No API key found. Open Quill and save your Anthropic key first.",
      code: "missing_key",
    });
    return;
  }

  const budget = await consumeBudget();
  if (!budget.ok) {
    safePost(port, { type: "error", requestId, message: budget.reason, code: "budget" });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);
  activeRequests.set(requestId, { controller, timeoutId });

  try {
    const refined = await callAnthropic({
      apiKey,
      model,
      mode,
      text,
      signal: controller.signal,
      onChunk(chunk) {
        safePost(port, { type: "chunk", requestId, text: chunk });
      },
    });

    safePost(port, {
      type: "done",
      requestId,
      text: refined,
      model,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      if (reason === "cancelled" || reason === "disconnected") {
        safePost(port, { type: "cancelled", requestId });
        return;
      }
      if (reason === "timeout") {
        safePost(port, {
          type: "error",
          requestId,
          message: "The request took too long. Please try again.",
          code: "timeout",
        });
        return;
      }
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callAnthropic({ apiKey, model, mode, text, signal, onChunk }) {
  const prompt = QuillPrompts.buildPrompt(mode, text);
  const payload = {
    model,
    max_tokens: Math.min(4096, Math.max(1024, Math.ceil(text.length / 2))),
    stream: true,
    // Grammar fixes don't benefit from extended reasoning, and thinking tokens
    // would delay the first streamed words and count against max_tokens.
    // The 5.5 models reject "disabled"; "between_tools" is how they turn it off.
    thinking: { type: "between_tools" },
    system: prompt.system,
    messages: [
      {
        role: "user",
        content: prompt.user,
      },
    ],
  };

  let response;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      if (signal.aborted || attempt >= MAX_RETRIES) throw error;
      await delay(backoffMs(attempt), signal);
      continue;
    }

    if (response.ok) break;

    if (isTransientStatus(response.status) && attempt < MAX_RETRIES) {
      const retryDelay = retryAfterMs(response.headers.get("retry-after")) ?? backoffMs(attempt);
      try {
        await response.text();
      } catch (_) {}
      await delay(retryDelay, signal);
      continue;
    }

    const details = await readApiError(response);
    const error = new Error(details || `Anthropic API returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }

  if (!response?.ok) throw new Error("Anthropic API request failed.");
  if (!response.body) throw new Error("Anthropic API returned an empty response stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let refined = "";
  let stopReason = null;

  const consumeEvent = (event) => {
    for (const line of event.split("\n")) {
      if (!line.startsWith("data: ")) continue;

      let payloadEvent;
      try {
        payloadEvent = JSON.parse(line.slice(6));
      } catch (_) {
        continue;
      }

      if (payloadEvent.type === "content_block_delta" && payloadEvent.delta?.type === "text_delta") {
        const chunk = payloadEvent.delta.text || "";
        refined += chunk;
        if (chunk) onChunk(chunk);
      } else if (payloadEvent.type === "message_delta") {
        stopReason = payloadEvent.delta?.stop_reason || stopReason;
      } else if (payloadEvent.type === "error") {
        throw new Error(payloadEvent.error?.message || "Anthropic stream error.");
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const event of events) consumeEvent(event);
  }

  buffer += decoder.decode();
  if (buffer.trim()) consumeEvent(buffer);

  if (stopReason === "max_tokens") {
    throw new Error("The result was cut off because the selection is too long. Try a shorter selection.");
  }

  refined = QuillPrompts.stripTextTags(refined).trim();
  if (!refined) throw new Error("Anthropic returned an empty response. Please try again.");
  return refined;
}

function isTransientStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function backoffMs(attempt) {
  return Math.min(4000, 600 * (2 ** attempt));
}

function retryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(10000, Math.max(0, seconds * 1000));
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.min(10000, Math.max(0, date - Date.now()));
  return null;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function readApiError(response) {
  try {
    const payload = await response.json();
    return payload?.error?.message || payload?.message || null;
  } catch (_) {
    return null;
  }
}

function friendlyError(error) {
  const status = error?.status;
  if (status === 401) return "Anthropic rejected the API key. Check the key in Quill settings.";
  if (status === 403) return "Anthropic refused this request. Check your API account permissions.";
  if (status === 429) return "Anthropic is rate limiting requests. Please try again shortly.";
  if (status >= 500) return "Anthropic is temporarily unavailable. Please try again.";
  return error?.message || "Something went wrong while contacting Anthropic.";
}

function safePost(port, message) {
  try {
    port.postMessage(message);
  } catch (_) {
    // The tab or frame disappeared while a request was in flight.
  }
}

