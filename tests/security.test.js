const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("content script never reads or sends the Anthropic API key", () => {
  const content = read("content.js");
  assert.doesNotMatch(content, /anthropicKey/);
  assert.doesNotMatch(content, /x-api-key/i);
  assert.doesNotMatch(content, /api\.anthropic\.com/i);
});

test("background worker owns Anthropic transport", () => {
  const background = read("background.js");
  assert.match(background, /chrome\.storage\.local/);
  assert.match(background, /x-api-key/);
  assert.match(background, /api\.anthropic\.com/);
  assert.match(background, /TRUSTED_CONTEXTS/);
});

test("manifest registers the background worker and helper content scripts", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.host_permissions, ["https://api.anthropic.com/*"]);
  assert.deepEqual(
    manifest.content_scripts[0].js,
    ["config.js", "diff.js", "editor-adapters.js", "content.js"]
  );
});

test("page scripts cannot reach or drive Quill's UI", () => {
  const content = read("content.js");
  assert.match(content, /attachShadow\(\{ mode: "closed" \}\)/);
  assert.doesNotMatch(content, /mode: "open"/);
  assert.match(content, /if \(!event\?\.isTrusted\) return;/);
});

