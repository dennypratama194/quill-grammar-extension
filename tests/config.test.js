const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../config.js");

test("current model defaults to Sonnet 5.5", () => {
  assert.equal(config.DEFAULT_MODEL, "claude-sonnet-5-5");
  assert.ok(config.MODELS.some((model) => model.id === "claude-haiku-5-5"));
  assert.ok(config.MODELS.some((model) => model.id === "claude-sonnet-5-5"));
});

test("legacy Haiku 4.5 setting migrates to Haiku 5.5", () => {
  assert.equal(config.normalizeModel("claude-haiku-4-5-20251001"), "claude-haiku-5-5");
});

test("legacy Sonnet settings migrate to Sonnet 5.5", () => {
  assert.equal(config.normalizeModel("claude-sonnet-4-6"), "claude-sonnet-5-5");
  assert.equal(config.normalizeModel("claude-sonnet-5"), "claude-sonnet-5-5");
});

test("unknown models fail closed to the configured default", () => {
  assert.equal(config.normalizeModel("made-up-model"), config.DEFAULT_MODEL);
});

test("mode normalization only permits grammar or rewrite", () => {
  assert.equal(config.normalizeMode("rewrite"), "rewrite");
  assert.equal(config.normalizeMode("anything-else"), "grammar");
});

