const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isTextInput,
  createSelectionSnapshot,
  isSnapshotFresh,
  buildReplacementValue,
} = require("../editor-adapters.js");

test("recognizes safe text-like inputs but not password inputs", () => {
  assert.equal(isTextInput({ tagName: "INPUT", type: "email", isContentEditable: false }), true);
  assert.equal(isTextInput({ tagName: "INPUT", type: "password", isContentEditable: false }), false);
  assert.equal(isTextInput({ tagName: "TEXTAREA", isContentEditable: false }), true);
});

test("input selection snapshot detects stale text", () => {
  const element = {
    tagName: "TEXTAREA",
    isContentEditable: false,
    selectionStart: 6,
    selectionEnd: 11,
    value: "hello world",
    isConnected: true,
  };

  const snapshot = createSelectionSnapshot(element, "world", null);
  assert.equal(isSnapshotFresh(snapshot), true);

  element.value = "hello there";
  assert.equal(isSnapshotFresh(snapshot), false);
});

test("replacement calculation only replaces the selected range", () => {
  assert.equal(buildReplacementValue("hello world!", 6, 11, "there"), "hello there!");
});

function fakeRange(text, ancestor) {
  return {
    text,
    commonAncestorContainer: ancestor,
    toString() { return this.text; },
    cloneRange() { return this; },
  };
}

test("multi-line contenteditable selection is fresh despite Selection/Range newline mismatch", () => {
  const element = { isContentEditable: true, isConnected: true, contains: () => true };
  // Selection#toString() adds "\n\n" between <p> blocks; Range#toString() does not.
  const range = fakeRange("first linesecond line", element);
  const snapshot = createSelectionSnapshot(element, "first line\n\nsecond line", range);

  assert.equal(snapshot.originalText, "first line\n\nsecond line");
  assert.equal(isSnapshotFresh(snapshot), true);

  range.text = "first linesecond lime";
  assert.equal(isSnapshotFresh(snapshot), false);
});

