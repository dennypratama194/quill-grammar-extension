const {
  DEFAULT_MODEL,
  DEFAULT_MODE,
  MAX_SELECTION_CHARS,
  normalizeModel,
  normalizeMode,
} = QuillConfig;

let fixButtonHost = null;
let suggestionHost = null;
let lastSelectionSnapshot = null;
let lastSelectionRect = null;
let returnFocusTo = null;
let siteDisabled = false;
let currentModel = DEFAULT_MODEL;
let defaultMode = DEFAULT_MODE;
let activeRequest = null;
let pointerDownInQuillUI = false;

initializeSettings();

// Every listener ignores synthetic events (isTrusted === false). Otherwise any
// page could script a selection and a click and spend the user's API credits.

// Remember whether a click started on Quill's own UI so the matching mouseup
// doesn't re-show the Fix button after Dismiss/Accept removed the box.
document.addEventListener("mousedown", (event) => {
  if (!event.isTrusted) return;
  pointerDownInQuillUI = isQuillUIEvent(event);
}, true);
document.addEventListener("mouseup", handleSelection, true);
document.addEventListener("keyup", handleSelection, true);
document.addEventListener("keydown", (event) => {
  if (!event.isTrusted) return;
  if (event.key === "Escape") {
    removeFixButton();
    if (activeRequest) activeRequest.cancel();
    removeSuggestion();
  }
}, true);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "quill-command") runKeyboardCommand(message.mode);
});

function runKeyboardCommand(mode) {
  // The shortcut is sent to every frame; only the focused one acts.
  if (siteDisabled || activeRequest || !document.hasFocus()) return;

  const selection = readActiveSelection();
  if (!selection || !selection.text.trim()) return;

  const snapshot = QuillEditors.createSelectionSnapshot(selection.element, selection.text, selection.range);
  if (!snapshot) return;

  removeFixButton();
  checkGrammar(snapshot, normalizeMode(mode), { anchorRect: selection.rect, fromKeyboard: true });
}

// Popup settings are per top-level site, so frames use the tab's hostname.
function siteHostname() {
  if (window === window.top) return window.location.hostname;
  const origins = window.location.ancestorOrigins;
  if (origins && origins.length) {
    try {
      return new URL(origins[origins.length - 1]).hostname;
    } catch (_) {}
  }
  return window.location.hostname;
}

function initializeSettings() {
  if (!chrome?.storage?.sync) return;

  chrome.storage.sync.get(["disabledSites", "model", "defaultMode"], ({ disabledSites, model, defaultMode: storedMode }) => {
    const sites = Array.isArray(disabledSites) ? disabledSites : [];
    siteDisabled = sites.includes(siteHostname());
    currentModel = normalizeModel(model);
    defaultMode = normalizeMode(storedMode);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;

    if (changes.disabledSites) {
      const sites = Array.isArray(changes.disabledSites.newValue)
        ? changes.disabledSites.newValue
        : [];
      siteDisabled = sites.includes(siteHostname());
      if (siteDisabled) {
        removeFixButton();
        if (activeRequest) activeRequest.cancel();
        removeSuggestion();
      }
    }

    if (changes.model) currentModel = normalizeModel(changes.model.newValue);
    if (changes.defaultMode) defaultMode = normalizeMode(changes.defaultMode.newValue);
  });
}

function isQuillUIEvent(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
  return path.some((node) => node && (node === fixButtonHost || node === suggestionHost));
}

function handleSelection(event) {
  if (!event?.isTrusted) return;
  if (event.type === "mouseup" && pointerDownInQuillUI) {
    pointerDownInQuillUI = false;
    return;
  }
  // Escape is handled on keydown; its keyup must not bring the button back.
  if (event.type === "keyup" && event.key === "Escape") return;
  if (siteDisabled || activeRequest) return;

  const selection = readActiveSelection();
  if (!selection || selection.text.trim().length <= 5) {
    removeFixButton();
    return;
  }

  lastSelectionSnapshot = QuillEditors.createSelectionSnapshot(
    selection.element,
    selection.text,
    selection.range
  );

  if (!lastSelectionSnapshot) {
    removeFixButton();
    return;
  }

  lastSelectionRect = selection.rect;
  showFixButton(selection.rect);
}

function readActiveSelection() {
  const element = QuillEditors.getDeepActiveElement(document);
  if (!QuillEditors.isTextInput(element)) return null;

  if (element.isContentEditable) {
    const selection = QuillEditors.getSelectionFor(element);
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    const range = selection.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    if (!(ancestor === element || element.contains(ancestor))) return null;

    const text = selection.toString();
    if (!text) return null;

    const rect = range.getBoundingClientRect();
    return {
      element,
      text,
      range,
      rect: normalizeRect(rect, element.getBoundingClientRect()),
    };
  }

  const start = Number.isInteger(element.selectionStart) ? element.selectionStart : 0;
  const end = Number.isInteger(element.selectionEnd) ? element.selectionEnd : start;
  if (end <= start) return null;

  const text = element.value.slice(start, end);
  if (!text) return null;

  return {
    element,
    text,
    range: null,
    rect: element.getBoundingClientRect(),
  };
}

function normalizeRect(primary, fallback) {
  if (primary && (primary.width > 0 || primary.height > 0)) return primary;
  return fallback;
}

function showFixButton(rect) {
  removeFixButton();
  if (!rect) return;

  const { host, root } = createShadowHost("quill-fix-host");
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";

  root.appendChild(baseResetStyle());

  const container = document.createElement("div");
  container.style.cssText = `
    display:flex;
    gap:6px;
    align-items:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  `;

  const grammarPill = makePill("✦ Fix", "grammar", defaultMode === "grammar");
  const rewritePill = makePill("✨ Rewrite", "rewrite", defaultMode === "rewrite");

  if (defaultMode === "rewrite") {
    container.append(rewritePill, grammarPill);
  } else {
    container.append(grammarPill, rewritePill);
  }

  root.appendChild(container);
  document.documentElement.appendChild(host);
  fixButtonHost = host;

  const desiredTop = rect.top - 44;
  host.style.top = `${desiredTop >= 8 ? desiredTop : Math.min(window.innerHeight - 44, rect.bottom + 8)}px`;
  host.style.left = `${Math.max(8, rect.left)}px`;

  const hostRect = host.getBoundingClientRect();
  if (hostRect.right > window.innerWidth - 8) {
    host.style.left = `${Math.max(8, window.innerWidth - hostRect.width - 8)}px`;
  }

  setTimeout(() => document.addEventListener("mousedown", removeFixButtonOnOutsideClick, true), 0);
  window.addEventListener("scroll", removeFixButton, true);
  window.addEventListener("resize", removeFixButton, true);
}

function makePill(label, mode, primary) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("aria-label", mode === "rewrite" ? "Rewrite selected text" : "Fix grammar in selected text");
  button.style.cssText = primary
    ? `
      appearance:none;border:0;background:#14c47a;color:#08090e;
      padding:6px 14px;border-radius:20px;font-size:12px;font-weight:700;
      cursor:pointer;box-shadow:0 2px 12px rgba(20,196,122,.4);white-space:nowrap;
    `
    : `
      appearance:none;background:#08090e;color:#14c47a;
      padding:6px 14px;border-radius:20px;font-size:12px;font-weight:700;
      cursor:pointer;border:1px solid rgba(20,196,122,.4);
      box-shadow:0 2px 12px rgba(0,0,0,.4);white-space:nowrap;
    `;

  // mousedown is cancelled so the editor keeps its selection; the action runs on
  // click so Enter and Space work too.
  button.addEventListener("mousedown", (event) => {
    event.stopPropagation();
    event.preventDefault();
  });

  button.addEventListener("mouseup", (event) => {
    event.stopPropagation();
    event.preventDefault();
  });

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (!event.isTrusted) return;
    const snapshot = lastSelectionSnapshot;
    const anchorRect = lastSelectionRect;
    removeFixButton();
    if (snapshot) checkGrammar(snapshot, mode, { anchorRect });
  });

  return button;
}

function removeFixButtonOnOutsideClick(event) {
  if (fixButtonHost && !fixButtonHost.contains(event.target)) removeFixButton();
}

function removeFixButton() {
  if (fixButtonHost) {
    fixButtonHost.remove();
    fixButtonHost = null;
  }
  document.removeEventListener("mousedown", removeFixButtonOnOutsideClick, true);
  window.removeEventListener("scroll", removeFixButton, true);
  window.removeEventListener("resize", removeFixButton, true);
}

async function checkGrammar(snapshot, mode = DEFAULT_MODE, { anchorRect = null, fromKeyboard = false } = {}) {
  if (activeRequest) return;
  returnFocusTo = fromKeyboard ? snapshot.element : null;

  if (!chrome?.runtime?.connect) {
    showErrorBox("Extension context lost. Refresh this page and try again.");
    return;
  }

  if (!QuillEditors.isSnapshotFresh(snapshot)) {
    showErrorBox("The selected text changed. Select it again before running Quill.");
    return;
  }

  const text = snapshot.originalText;
  if (text.length > MAX_SELECTION_CHARS) {
    showErrorBox(`Selection is too long. Please keep it under ${MAX_SELECTION_CHARS.toLocaleString()} characters.`);
    return;
  }

  let streamingText = "";
  const loading = showLoadingBox(mode, () => {
    if (activeRequest) activeRequest.cancel();
  }, anchorRect);

  try {
    activeRequest = createApiRequest({
      text,
      mode,
      model: currentModel,
      onChunk(chunk) {
        streamingText += chunk;
        if (loading.preview) {
          loading.preview.style.display = "block";
          loading.preview.textContent = streamingText;
        }
      },
    });

    const refined = await activeRequest.promise;
    showSuggestionBox(text, refined, () => {
      const result = QuillEditors.applyRefinedText(snapshot, refined);
      if (!result.ok && result.reason === "stale") {
        showErrorBox("The text changed while Quill was working. Nothing was replaced. Select the text again.");
        return false;
      }
      if (!result.ok) {
        showErrorBox("This editor did not accept the replacement safely. Your original text was left unchanged.");
        return false;
      }
      lastSelectionSnapshot = null;
      returnFocusTo = null;
      return true;
    }, mode, { anchorRect, focusAccept: fromKeyboard });
  } catch (error) {
    if (error?.code === "cancelled") {
      removeSuggestion();
    } else {
      showErrorBox(error?.message || "Something went wrong. Please try again.");
    }
  } finally {
    activeRequest = null;
  }
}

function createApiRequest({ text, mode, model, onChunk }) {
  const requestId = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  let port;
  let settled = false;
  let rejectPromise;

  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;

    try {
      port = chrome.runtime.connect({ name: "quill-api" });
    } catch (_) {
      reject(new Error("Extension context lost. Refresh this page and try again."));
      return;
    }

    port.onMessage.addListener((message) => {
      if (!message || message.requestId !== requestId || settled) return;

      if (message.type === "chunk") {
        onChunk(message.text || "");
        return;
      }

      if (message.type === "done") {
        settled = true;
        resolve(message.text || "");
        safeDisconnect(port);
        return;
      }

      if (message.type === "cancelled") {
        settled = true;
        const error = new Error("Cancelled");
        error.code = "cancelled";
        reject(error);
        safeDisconnect(port);
        return;
      }

      if (message.type === "error") {
        settled = true;
        const error = new Error(message.message || "Anthropic request failed.");
        error.code = message.code || "api_error";
        reject(error);
        safeDisconnect(port);
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Quill lost connection to the extension. Refresh the page and try again."));
    });

    port.postMessage({
      type: "check",
      requestId,
      text,
      mode: normalizeMode(mode),
      model: normalizeModel(model),
    });
  });

  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      try {
        port?.postMessage({ type: "cancel", requestId });
      } catch (_) {}
      safeDisconnect(port);
      const error = new Error("Cancelled");
      error.code = "cancelled";
      rejectPromise?.(error);
    },
  };
}

function safeDisconnect(port) {
  try {
    port?.disconnect();
  } catch (_) {}
}

function showLoadingBox(mode = DEFAULT_MODE, onCancel, anchorRect = null) {
  removeSuggestion();
  const { host, root, box } = createSuggestionShell(anchorRect);
  box.appendChild(makeLabel());

  const message = document.createElement("div");
  message.style.cssText = "color:#eaeef4;font-size:13px;display:flex;align-items:center;";

  const text = document.createElement("span");
  text.textContent = mode === "rewrite" ? "✨ Rewriting your text" : "✨ Checking your grammar";
  message.appendChild(text);

  const dots = document.createElement("span");
  dots.className = "quill-dots";
  dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
  message.appendChild(dots);
  box.appendChild(message);

  const preview = document.createElement("div");
  preview.style.cssText = `
    display:none;background:#0f1117;border-radius:8px;padding:10px;margin-top:10px;
    line-height:1.7;font-size:13px;white-space:pre-wrap;max-height:180px;overflow-y:auto;
  `;
  box.appendChild(preview);

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.style.cssText = secondaryButtonStyle("margin-top:10px;width:100%;");
  cancelButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.isTrusted) return;
    onCancel?.();
  });
  box.appendChild(cancelButton);

  root.appendChild(loadingAnimationStyle());
  suggestionHost = host;
  return { preview };
}

function showErrorBox(message) {
  const anchorRect = suggestionHost?._quillAnchorRect || null;
  removeSuggestion();
  const { host, box } = createSuggestionShell(anchorRect);
  box.appendChild(makeLabel());

  const text = document.createElement("div");
  text.style.cssText = "color:#f05454;font-size:13px;";
  text.textContent = `❌ ${message}`;
  box.appendChild(text);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "✕ Close";
  closeButton.style.cssText = secondaryButtonStyle("margin-top:10px;width:100%;color:#f05454;border-color:rgba(240,84,84,.4);");
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.isTrusted) return;
    removeSuggestion();
  });
  box.appendChild(closeButton);

  suggestionHost = host;
  if (returnFocusTo) closeButton.focus({ preventScroll: true });
}

function showSuggestionBox(original, refined, onAccept, mode = DEFAULT_MODE, { anchorRect = null, focusAccept = false } = {}) {
  removeSuggestion();
  const { host, box } = createSuggestionShell(anchorRect);
  box.appendChild(makeLabel());

  const diffLabel = document.createElement("div");
  diffLabel.style.cssText = `
    font-size:10px;color:#7d8590;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px;
  `;
  diffLabel.textContent = mode === "rewrite"
    ? "Rewritten (green = added · struck = removed)"
    : "Suggested (green = added · struck = removed)";
  box.appendChild(diffLabel);

  const diff = document.createElement("div");
  diff.style.cssText = `
    background:#0f1117;border-radius:8px;padding:10px;margin-bottom:10px;line-height:1.7;
    font-size:13px;max-height:min(45vh,400px);overflow-y:auto;overscroll-behavior:contain;
  `;
  diff.innerHTML = QuillDiff.buildDiffHTML(original, refined);
  box.appendChild(diff);

  const buttonRow = document.createElement("div");
  buttonRow.style.cssText = "display:flex;gap:8px;";

  const acceptButton = document.createElement("button");
  acceptButton.type = "button";
  acceptButton.textContent = "✅ Accept";
  acceptButton.style.cssText = `
    appearance:none;background:#14c47a;color:#08090e;border:0;border-radius:6px;
    padding:6px 14px;cursor:pointer;font-weight:700;font-size:12px;flex:1;
  `;

  acceptButton.addEventListener("mousedown", (event) => {
    event.stopPropagation();
    event.preventDefault();
  });
  acceptButton.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (!event.isTrusted) return;
    // onAccept shows an error box itself when the replacement is refused.
    if (onAccept() !== false) removeSuggestion();
  });

  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.textContent = "✕ Dismiss";
  dismissButton.style.cssText = secondaryButtonStyle("flex:1;");
  dismissButton.addEventListener("mousedown", (event) => {
    event.stopPropagation();
    event.preventDefault();
  });
  dismissButton.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (!event.isTrusted) return;
    removeSuggestion();
  });

  buttonRow.append(acceptButton, dismissButton);
  box.appendChild(buttonRow);
  suggestionHost = host;
  if (focusAccept) acceptButton.focus({ preventScroll: true });
}

const SUGGESTION_MIN_SPACE = 220;

// Places the box next to the selected text when there is room above or below
// it, and falls back to the bottom-right corner otherwise.
function suggestionPlacement(anchorRect) {
  const width = Math.min(380, window.innerWidth - 32);
  const fallback = { css: "bottom:24px;right:24px;", maxHeight: window.innerHeight - 48 };
  if (!anchorRect) return fallback;

  const left = Math.min(Math.max(8, anchorRect.left), Math.max(8, window.innerWidth - width - 8));
  const spaceBelow = window.innerHeight - anchorRect.bottom - 16;
  const spaceAbove = anchorRect.top - 16;

  if (spaceBelow >= SUGGESTION_MIN_SPACE) {
    return { css: `top:${anchorRect.bottom + 8}px;left:${left}px;`, maxHeight: spaceBelow };
  }
  if (spaceAbove >= SUGGESTION_MIN_SPACE) {
    return { css: `bottom:${window.innerHeight - anchorRect.top + 8}px;left:${left}px;`, maxHeight: spaceAbove };
  }
  return fallback;
}

function createSuggestionShell(anchorRect = null) {
  const { host, root } = createShadowHost("quill-suggestion-host");
  const placement = suggestionPlacement(anchorRect);
  host.style.cssText = `
    all:initial;position:fixed;z-index:2147483647;${placement.css}
    width:min(380px,calc(100vw - 32px));max-height:${placement.maxHeight}px;
  `;
  host._quillAnchorRect = anchorRect;

  root.appendChild(baseResetStyle());

  const box = document.createElement("div");
  box.style.cssText = `
    box-sizing:border-box;background:#08090e;color:#eaeef4;border:1px solid rgba(20,196,122,.25);
    border-radius:12px;padding:14px 16px;font-size:13px;width:100%;max-height:${placement.maxHeight}px;
    overflow-y:auto;box-shadow:0 4px 24px rgba(0,0,0,.5);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;line-height:1.6;
  `;

  root.appendChild(box);
  document.documentElement.appendChild(host);
  return { host, root, box };
}

// Closed shadow roots keep page scripts from reaching Quill's buttons.
function createShadowHost(id) {
  const host = document.createElement("div");
  host.id = id;
  host.style.all = "initial";
  const root = host.attachShadow({ mode: "closed" });
  return { host, root };
}

function baseResetStyle() {
  const style = document.createElement("style");
  style.textContent = `
    *,*::before,*::after{box-sizing:border-box}
    button{font-family:inherit}
    button:focus-visible{outline:2px solid #eaeef4;outline-offset:2px}
  `;
  return style;
}

function loadingAnimationStyle() {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes quillDotPulse{0%,80%,100%{opacity:.2;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}
    .quill-dots{display:inline-flex;gap:4px;margin-left:6px;align-items:center}
    .quill-dots span{width:5px;height:5px;background:#14c47a;border-radius:50%;animation:quillDotPulse 1.2s ease-in-out infinite}
    .quill-dots span:nth-child(2){animation-delay:.15s}.quill-dots span:nth-child(3){animation-delay:.3s}
  `;
  return style;
}

function secondaryButtonStyle(extra = "") {
  return `
    appearance:none;background:transparent;color:#7d8590;border:1px solid rgba(255,255,255,.1);
    border-radius:6px;padding:6px 14px;cursor:pointer;font-size:12px;${extra}
  `;
}

function makeLabel() {
  const label = document.createElement("div");
  label.style.cssText = `
    font-size:11px;color:#14c47a;margin-bottom:8px;font-weight:700;letter-spacing:.5px;
  `;
  label.textContent = "✦ Quill";
  return label;
}

function removeSuggestion() {
  if (!suggestionHost) return;
  const hadFocus = document.activeElement === suggestionHost;
  suggestionHost.remove();
  suggestionHost = null;
  // Keyboard users go back to the editor instead of losing focus to <body>.
  if (hadFocus && returnFocusTo?.isConnected) returnFocusTo.focus({ preventScroll: true });
}

