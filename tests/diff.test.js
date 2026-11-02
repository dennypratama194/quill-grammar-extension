const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHTML, buildDiffHTML, tokenizeForDiff } = require("../diff.js");

test("escapeHTML escapes markup-sensitive characters", () => {
  assert.equal(
    escapeHTML(`<script a="b">'&</script>`),
    "&lt;script a=&quot;b&quot;&gt;&#039;&amp;&lt;/script&gt;"
  );
});

test("diff output never injects raw user markup", () => {
  const html = buildDiffHTML("safe text", "<img src=x onerror=alert(1)> text");
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;/);
});

test("tokenizer preserves explicit line breaks", () => {
  assert.deepEqual(tokenizeForDiff("one\ntwo"), ["one", "\n", "two"]);
});

test("punctuation changes highlight only the punctuation", () => {
  assert.deepEqual(tokenizeForDiff("Hi there, you?"), ["Hi", "there", ",", "you", "?"]);
  const html = buildDiffHTML("Hi there how are you", "Hi there, how are you");
  assert.match(html, /<span>there<\/span><span style="[^"]+">,<\/span> <span>how /);
});

