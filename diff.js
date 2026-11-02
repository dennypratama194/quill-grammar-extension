(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.QuillDiff = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DIFF_ADDED_STYLE = "background:rgba(20,196,122,0.18);color:#14c47a;border-radius:3px;padding:0 2px;font-weight:700;";
  const DIFF_DELETED_STYLE = "color:#7d8590;text-decoration:line-through;opacity:0.8;";
  const MAX_LCS_CELLS = 4_000_000;

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Words and punctuation are separate tokens, so adding a comma highlights the
  // comma instead of the whole word. Each token remembers whether whitespace
  // followed it so the rendered diff keeps the original spacing.
  const TOKEN_PATTERN = /\n|[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*|[^\s]/gu;

  function tokenizeWithSpacing(text) {
    const source = String(text);
    const tokens = [];
    for (const match of source.matchAll(TOKEN_PATTERN)) {
      const value = match[0];
      const next = source[match.index + value.length];
      tokens.push({ value, space: value !== "\n" && next !== undefined && /[^\S\n]/.test(next) });
    }
    return tokens;
  }

  function tokenizeForDiff(text) {
    return tokenizeWithSpacing(text).map((token) => token.value);
  }

  function renderPlainRefined(refined) {
    return String(refined)
      .split("\n")
      .map((line) =>
        line
          .split(/\s+/)
          .filter(Boolean)
          .map((word) => `<span>${escapeHTML(word)} </span>`)
          .join("")
      )
      .join("<br>");
  }

  function buildDiffHTML(original, refined) {
    const aTokens = tokenizeWithSpacing(original);
    const bTokens = tokenizeWithSpacing(refined);
    const a = aTokens.map((token) => token.value);
    const b = bTokens.map((token) => token.value);
    const n = a.length;
    const m = b.length;

    if (n * m > MAX_LCS_CELLS) {
      return renderPlainRefined(refined);
    }

    const lcs = [];
    for (let i = 0; i <= n; i += 1) lcs.push(new Int32Array(m + 1));

    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        lcs[i][j] = a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }

    let html = "";
    const emit = (token, kind) => {
      if (token.value === "\n") {
        if (kind !== "del") html += "<br>";
        return;
      }

      const text = escapeHTML(token.value);
      const space = token.space ? " " : "";
      if (kind === "same") {
        html += `<span>${text}${space}</span>`;
      } else if (kind === "add") {
        html += `<span style="${DIFF_ADDED_STYLE}">${text}</span>${space}`;
      } else {
        html += `<span style="${DIFF_DELETED_STYLE}">${text}</span>${space}`;
      }
    };

    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        emit(bTokens[j], "same");
        i += 1;
        j += 1;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        emit(aTokens[i], "del");
        i += 1;
      } else {
        emit(bTokens[j], "add");
        j += 1;
      }
    }

    while (i < n) emit(aTokens[i++], "del");
    while (j < m) emit(bTokens[j++], "add");
    return html;
  }

  return Object.freeze({
    escapeHTML,
    tokenizeForDiff,
    buildDiffHTML,
  });
});

