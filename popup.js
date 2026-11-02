const apiKeyInput = document.getElementById("apiKeyInput");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");
const savedKeyRow = document.getElementById("savedKeyRow");
const savedKeyMask = document.getElementById("savedKeyMask");
const removeKeyBtn = document.getElementById("removeKeyBtn");
const modelSelect = document.getElementById("modelSelect");
const defaultModeSelect = document.getElementById("defaultModeSelect");
const disableToggle = document.getElementById("disableSiteToggle");
const hostLabel = document.getElementById("hostLabel");
const settingsStatus = document.getElementById("settingsStatus");

let currentHostname = "";

initialize().catch((error) => {
  flashStatus(statusEl, error?.message || "Could not load Quill settings.", "error");
});

async function initialize() {
  populateModels();

  const [savedKey, syncSettings] = await Promise.all([
    QuillKeyStore.getKey(),
    chrome.storage.sync.get(["model", "defaultMode"]),
  ]);

  showSavedKey(savedKey);

  const normalizedModel = QuillConfig.normalizeModel(syncSettings.model);
  modelSelect.value = normalizedModel;
  defaultModeSelect.value = QuillConfig.normalizeMode(syncSettings.defaultMode);

  if (syncSettings.model && syncSettings.model !== normalizedModel) {
    await chrome.storage.sync.set({ model: normalizedModel });
  }

  loadCurrentSite();
}

function populateModels() {
  modelSelect.textContent = "";
  for (const model of QuillConfig.MODELS) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    option.title = model.description;
    modelSelect.appendChild(option);
  }
}

// The saved key is never put back into the input; only a masked preview is shown.
function showSavedKey(key) {
  savedKeyRow.classList.toggle("visible", Boolean(key));
  savedKeyMask.textContent = key ? QuillKeyStore.maskKey(key) : "";
  apiKeyInput.value = "";
  apiKeyInput.placeholder = key ? "Paste a new key to replace it" : "sk-ant-...";
  saveBtn.textContent = key ? "Replace Key" : "Save Key";
}

function loadCurrentSite() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url || "";
    try {
      currentHostname = new URL(url).hostname;
    } catch (_) {
      currentHostname = "";
    }

    if (!currentHostname || /^(chrome|chrome-extension|edge|about):/.test(url)) {
      hostLabel.textContent = "this site";
      disableToggle.disabled = true;
      return;
    }

    hostLabel.textContent = currentHostname;

    chrome.storage.sync.get("disabledSites", ({ disabledSites }) => {
      const sites = Array.isArray(disabledSites) ? disabledSites : [];
      disableToggle.checked = sites.includes(currentHostname);
    });
  });
}

function flashStatus(element, message, kind) {
  element.className = "status " + (kind || "success");
  element.textContent = message;
  clearTimeout(element._flashTimer);
  if (kind !== "error") {
    element._flashTimer = setTimeout(() => {
      element.className = "status";
      element.textContent = "";
    }, 1800);
  }
}

saveBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();

  if (!key.startsWith("sk-ant-")) {
    flashStatus(statusEl, "That doesn't look like an Anthropic key. It should start with sk-ant-.", "error");
    return;
  }

  try {
    await QuillKeyStore.saveKey(key);
    showSavedKey(key);
    flashStatus(statusEl, "✅ Key saved on this device.");
  } catch (error) {
    flashStatus(statusEl, "Could not save the API key: " + error.message, "error");
  }
});

removeKeyBtn.addEventListener("click", async () => {
  try {
    await QuillKeyStore.removeKey();
    showSavedKey(null);
    flashStatus(statusEl, "✅ Key removed from this device.");
  } catch (error) {
    flashStatus(statusEl, "Could not remove the API key: " + error.message, "error");
  }
});

modelSelect.addEventListener("change", async () => {
  const model = QuillConfig.normalizeModel(modelSelect.value);
  await chrome.storage.sync.set({ model });
  flashStatus(settingsStatus, "✅ Model updated.");
});

defaultModeSelect.addEventListener("change", async () => {
  const defaultMode = QuillConfig.normalizeMode(defaultModeSelect.value);
  await chrome.storage.sync.set({ defaultMode });
  flashStatus(settingsStatus, "✅ Default mode updated.");
});

disableToggle.addEventListener("change", () => {
  if (!currentHostname) return;

  chrome.storage.sync.get("disabledSites", ({ disabledSites }) => {
    const sites = new Set(Array.isArray(disabledSites) ? disabledSites : []);
    if (disableToggle.checked) {
      sites.add(currentHostname);
    } else {
      sites.delete(currentHostname);
    }

    chrome.storage.sync.set({ disabledSites: [...sites] }, () => {
      flashStatus(
        settingsStatus,
        disableToggle.checked
          ? `✅ Disabled on ${currentHostname}.`
          : `✅ Re-enabled on ${currentHostname}.`
      );
    });
  });
});

