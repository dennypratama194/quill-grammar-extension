(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.QuillBudget = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MINUTE_MS = 60 * 1000;

  function dayKey(now) {
    const date = new Date(now);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  // Pure check so it can be unit tested. `state` is { minute: number[], day, dayCount }.
  // Returns the next state and, when the request is refused, a user-facing reason.
  function consume(state, now, limits) {
    const minute = (Array.isArray(state?.minute) ? state.minute : []).filter((t) => now - t < MINUTE_MS);
    const today = dayKey(now);
    const dayCount = state?.day === today ? Number(state.dayCount) || 0 : 0;

    if (minute.length >= limits.perMinute) {
      return {
        ok: false,
        reason: `Quill is limited to ${limits.perMinute} requests per minute. Wait a moment and try again.`,
        state: { minute, day: today, dayCount },
      };
    }

    if (dayCount >= limits.perDay) {
      return {
        ok: false,
        reason: `Quill reached its daily limit of ${limits.perDay} requests. It resets tomorrow.`,
        state: { minute, day: today, dayCount },
      };
    }

    return { ok: true, state: { minute: [...minute, now], day: today, dayCount: dayCount + 1 } };
  }

  return Object.freeze({ consume, dayKey });
});

