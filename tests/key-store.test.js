const test = require("node:test");
const assert = require("node:assert/strict");
const { maskKey } = require("../key-store.js");

test("masked key never reveals the middle of the secret", () => {
  const key = "sk-ant-test-SECRETSECRETSECRET-abcd";
  const masked = maskKey(key);
  assert.equal(masked, "sk-ant-…abcd");
  assert.ok(!masked.includes("SECRET"));
});

