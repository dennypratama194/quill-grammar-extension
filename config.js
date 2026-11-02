(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.QuillConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MODELS = Object.freeze([
    Object.freeze({
      id: "claude-haiku-5-5",
      label: "Haiku 5.5 (fastest, cheapest)",
      description: "Fast and cheap, but more likely to reword text that was already correct.",
    }),
    Object.freeze({
      id: "claude-sonnet-5-5",
      label: "Sonnet 5.5 (recommended)",
      description: "Best quality for rewrites and nuanced grammar fixes.",
    }),
  ]);

  const DEFAULT_MODEL = "claude-sonnet-5-5";
  const DEFAULT_MODE = "grammar";
  const MAX_SELECTION_CHARS = 8000;
  const REQUEST_TIMEOUT_MS = 60000;
  const MAX_RETRIES = 2;
  // Guards the API key against runaway loops or a bug firing requests repeatedly.
  const REQUEST_BUDGET = Object.freeze({ perMinute: 10, perDay: 300 });

  const LEGACY_MODEL_MAP = Object.freeze({
    "claude-sonnet-4-6": "claude-sonnet-5-5",
    "claude-sonnet-5": "claude-sonnet-5-5",
    "claude-haiku-4-5-20251001": "claude-haiku-5-5",
  });

  const MODEL_IDS = new Set(MODELS.map((model) => model.id));

  function normalizeModel(model) {
    const mapped = LEGACY_MODEL_MAP[model] || model;
    return MODEL_IDS.has(mapped) ? mapped : DEFAULT_MODEL;
  }

  function normalizeMode(mode) {
    return mode === "rewrite" ? "rewrite" : DEFAULT_MODE;
  }

  return Object.freeze({
    MODELS,
    DEFAULT_MODEL,
    DEFAULT_MODE,
    MAX_SELECTION_CHARS,
    REQUEST_TIMEOUT_MS,
    MAX_RETRIES,
    REQUEST_BUDGET,
    normalizeModel,
    normalizeMode,
  });
});

