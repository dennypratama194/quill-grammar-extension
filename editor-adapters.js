(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.QuillEditors = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel"]);

  // document.activeElement stops at a shadow host. Walk into open shadow roots
  // so editors built as web components are found too.
  function getDeepActiveElement(doc = globalThis.document) {
    let element = doc?.activeElement || null;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  }

  // Chromium only exposes selections inside a shadow root through that root.
  function getSelectionFor(element) {
    const root = element?.getRootNode?.();
    if (root && root.nodeType === 11 && typeof root.getSelection === "function") {
      return root.getSelection();
    }
    return globalThis.getSelection?.() || null;
  }

  function isTextInput(element) {
    if (!element || !element.tagName) return false;
    if (element.tagName === "TEXTAREA") return true;
    if (element.tagName === "INPUT") return TEXT_INPUT_TYPES.has((element.type || "text").toLowerCase());
    return Boolean(element.isContentEditable);
  }

  function createSelectionSnapshot(element, selectedText, range) {
    if (!element || !selectedText) return null;

    if (element.isContentEditable) {
      const snapshotRange = range ? range.cloneRange() : null;
      return {
        kind: "contenteditable",
        element,
        originalText: selectedText,
        range: snapshotRange,
        // Selection#toString() inserts "\n" between block elements (one <p> per
        // line in WhatsApp/Lexical), but Range#toString() only joins text nodes.
        // Compare like with like, or every multi-line selection looks stale.
        rangeText: snapshotRange ? snapshotRange.toString() : null,
      };
    }

    const start = Number.isInteger(element.selectionStart) ? element.selectionStart : 0;
    const end = Number.isInteger(element.selectionEnd) ? element.selectionEnd : start;
    return {
      kind: "input",
      element,
      originalText: selectedText,
      start,
      end,
    };
  }

  function isSnapshotFresh(snapshot) {
    if (!snapshot || !snapshot.element || snapshot.element.isConnected === false) return false;

    if (snapshot.kind === "input") {
      const value = String(snapshot.element.value ?? "");
      return value.slice(snapshot.start, snapshot.end) === snapshot.originalText;
    }

    if (snapshot.kind === "contenteditable") {
      const range = snapshot.range;
      if (!range) return false;
      try {
        const ancestor = range.commonAncestorContainer;
        const element = snapshot.element;
        const containsRange = ancestor === element || element.contains(ancestor);
        const expected = snapshot.rangeText ?? snapshot.originalText;
        return containsRange && range.toString() === expected;
      } catch (_) {
        return false;
      }
    }

    return false;
  }

  function buildReplacementValue(value, start, end, refined) {
    return String(value).slice(0, start) + refined + String(value).slice(end);
  }

  function setNativeValue(element, value) {
    const prototype = element.tagName === "TEXTAREA"
      ? globalThis.HTMLTextAreaElement?.prototype
      : globalThis.HTMLInputElement?.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function dispatchInput(element, refined, inputType = "insertText") {
    try {
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType,
        data: refined,
      }));
    } catch (_) {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // execCommand goes through the browser's editing pipeline, so the change lands
  // on the undo stack (Ctrl+Z reverts it) and frameworks see a real input event.
  function tryInsertTextCommand(element, start, end, refined) {
    const before = String(element.value);
    try {
      element.focus({ preventScroll: true });
      element.setSelectionRange(start, end);
      if (!document.execCommand("insertText", false, refined)) return false;
    } catch (_) {
      return false;
    }
    return String(element.value) !== before || before.slice(start, end) === refined;
  }

  function applyToInput(snapshot, refined) {
    const element = snapshot.element;
    if (tryInsertTextCommand(element, snapshot.start, snapshot.end, refined)) return true;

    const nextValue = buildReplacementValue(element.value, snapshot.start, snapshot.end, refined);
    setNativeValue(element, nextValue);
    const caret = snapshot.start + refined.length;
    try {
      element.setSelectionRange(caret, caret);
    } catch (_) {
      element.selectionStart = caret;
      element.selectionEnd = caret;
    }
    dispatchInput(element, refined, "insertReplacementText");
    return true;
  }

  function restoreRange(snapshot) {
    const selection = getSelectionFor(snapshot.element);
    if (!selection || !snapshot.range) return false;
    snapshot.element.focus({ preventScroll: true });
    selection.removeAllRanges();
    try {
      selection.addRange(snapshot.range);
      return true;
    } catch (_) {
      return false;
    }
  }

  function isLexicalEditor(element) {
    if (!element?.closest) return false;
    return Boolean(element.closest('[data-lexical-editor="true"]'));
  }

  function tryLexicalPaste(element, refined) {
    if (!isLexicalEditor(element) || typeof DataTransfer === "undefined" || typeof ClipboardEvent === "undefined") {
      return false;
    }

    try {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", refined);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });
      return element.dispatchEvent(event) === false;
    } catch (_) {
      return false;
    }
  }

  // Raw "\n" inside a text node collapses to a space in normal HTML, so line
  // breaks become <br> elements.
  function buildTextFragment(text) {
    const fragment = document.createDocumentFragment();
    String(text).split("\n").forEach((line, index) => {
      if (index > 0) fragment.appendChild(document.createElement("br"));
      if (line) fragment.appendChild(document.createTextNode(line));
    });
    return fragment;
  }

  function applyToContentEditable(snapshot, refined) {
    if (!restoreRange(snapshot)) return false;
    const element = snapshot.element;

    if (tryLexicalPaste(element, refined)) return true;

    try {
      if (document.execCommand("insertText", false, refined)) return true;
    } catch (_) {}

    const selection = getSelectionFor(element);
    if (!selection || selection.rangeCount === 0) return false;

    try {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const fragment = buildTextFragment(refined);
      const lastNode = fragment.lastChild;
      range.insertNode(fragment);
      if (lastNode) range.setStartAfter(lastNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      dispatchInput(element, refined, "insertReplacementText");
      return true;
    } catch (_) {
      return false;
    }
  }

  function applyRefinedText(snapshot, refined) {
    if (!isSnapshotFresh(snapshot)) {
      return { ok: false, reason: "stale" };
    }

    const ok = snapshot.kind === "input"
      ? applyToInput(snapshot, refined)
      : applyToContentEditable(snapshot, refined);

    return ok ? { ok: true } : { ok: false, reason: "unsupported" };
  }

  return Object.freeze({
    getDeepActiveElement,
    getSelectionFor,
    isTextInput,
    createSelectionSnapshot,
    isSnapshotFresh,
    buildReplacementValue,
    applyRefinedText,
  });
});

