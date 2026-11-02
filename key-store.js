(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.QuillKeyStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const KEY_NAME = "anthropicKey";

  // Older Quill versions stored the key in chrome.storage.sync. Move it to
  // local storage, which never leaves this browser profile.
  async function migrateLegacyKey() {
    const local = await chrome.storage.local.get(KEY_NAME);
    if (local[KEY_NAME]) {
      await chrome.storage.sync.remove(KEY_NAME);
      return local[KEY_NAME];
    }

    const legacy = await chrome.storage.sync.get(KEY_NAME);
    if (!legacy[KEY_NAME]) return null;

    await chrome.storage.local.set({ [KEY_NAME]: legacy[KEY_NAME] });
    await chrome.storage.sync.remove(KEY_NAME);
    return legacy[KEY_NAME];
  }

  async function getKey() {
    const local = await chrome.storage.local.get(KEY_NAME);
    return local[KEY_NAME] || migrateLegacyKey();
  }

  async function saveKey(key) {
    await chrome.storage.local.set({ [KEY_NAME]: key });
    await chrome.storage.sync.remove(KEY_NAME);
  }

  async function removeKey() {
    await chrome.storage.local.remove(KEY_NAME);
    await chrome.storage.sync.remove(KEY_NAME);
  }

  function maskKey(key) {
    const value = String(key || "");
    if (value.length < 12) return "saved";
    return `${value.slice(0, 7)}…${value.slice(-4)}`;
  }

  return Object.freeze({ migrateLegacyKey, getKey, saveKey, removeKey, maskKey });
});

