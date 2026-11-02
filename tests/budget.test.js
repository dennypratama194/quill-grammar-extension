const test = require("node:test");
const assert = require("node:assert/strict");
const { consume } = require("../budget.js");

const limits = { perMinute: 2, perDay: 3 };
const noon = new Date(2026, 9, 20, 12, 0, 0).getTime();

test("allows requests until the per-minute limit, then recovers after a minute", () => {
  let result = consume(undefined, noon, limits);
  assert.equal(result.ok, true);
  result = consume(result.state, noon + 1000, limits);
  assert.equal(result.ok, true);
  const blocked = consume(result.state, noon + 2000, limits);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /per minute/);
  assert.equal(consume(blocked.state, noon + 61_000, limits).ok, true);
});

test("enforces the daily cap and resets on a new day", () => {
  let state;
  for (let i = 0; i < 3; i += 1) state = consume(state, noon + i * 61_000, limits).state;
  const blocked = consume(state, noon + 10 * 61_000, limits);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /daily limit/);
  assert.equal(consume(blocked.state, noon + 24 * 3600_000, limits).ok, true);
});

