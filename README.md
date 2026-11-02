# Quill

**Fix grammar and rewrite text directly where you type.**

Quill is a lightweight Chrome extension that helps you polish selected text inside supported web editors. Select a sentence, choose **Fix** or **Rewrite**, review the suggested changes, and decide whether to apply them.

Quill uses Anthropic's API with **your own API key**. There is no Quill account, hosted Quill backend, or subscription required by this project. Anthropic usage is billed to your own API account.

## What it does

- **Fix grammar:** Correct mistakes and awkward English while preserving your meaning and tone.
- **Rewrite:** Improve clarity, flow, and wording without changing your intent.
- **Review before applying:** See highlighted additions and deletions; accept or dismiss each suggestion.
- **Works where you type:** Supports ordinary text inputs, textareas, contenteditable editors, and certain rich-text editors.
- **Keyboard shortcuts:** Fix with `Alt+Shift+F`; rewrite with `Alt+Shift+R` (configurable in Chrome).
- **Model choice:** Choose between the supported Anthropic models in the extension popup.
- **Per-site control:** Turn Quill off on individual sites.

## Install from source

1. Download or clone this repository.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the repository folder.
5. Open the Quill popup and save an API key from [Anthropic Console](https://console.anthropic.com/).
6. Open a supported web editor, select text, then choose **Fix** or **Rewrite**.

After pulling updates, click **Reload** on the extension card and refresh your open tabs.

> **Bring your own API key:** Anthropic may charge for API usage. Quill includes basic per-minute and daily request limits, but these are not a spending guarantee. Monitor your usage and billing limits in your Anthropic account.

## Privacy and permissions

Quill injects a content script into websites so it can offer actions inside supported editors. This requires the `<all_urls>` content-script match in `manifest.json`. It does **not** automatically send all page content to Anthropic.

- Only the selected text you explicitly submit through **Fix**, **Rewrite**, or a keyboard shortcut is sent to Anthropic for processing.
- Your Anthropic API key is saved in `chrome.storage.local`, not Chrome Sync. API calls are made by the extension's background service worker.
- There is no Quill-operated backend or analytics service in this repository.
- You can disable Quill for a particular site using its popup.
- Do not submit passwords, private credentials, or other sensitive text to an AI provider.

See `manifest.json`, `background.js`, and `key-store.js` for the implementation. Anthropic's own privacy and data-handling terms apply to submitted text.

## Supported editors and limitations

Quill supports normal `<input>`, `<textarea>`, and `contenteditable` elements, plus some rich-text implementations. Compatibility varies between websites. Some editors ignore synthetic replacement events; Quill attempts to leave your original text unchanged if a safe replacement cannot be made.

Canvas-based editors such as Google Docs are not supported by this approach. Chrome also restricts extensions on internal pages such as `chrome://extensions`.

Password inputs are not supported. The extension is designed for Chrome / Chromium with Manifest V3, not mobile browsers.

## Development

Requires Node.js 20+.

```bash
npm ci
npm run verify
npx playwright install chromium
npm run test:e2e
```

`npm run verify` runs JavaScript syntax checks and the Node test suite. End-to-end tests load the extension in Chromium and stub API responses, so the tests do not require a live API key.

The extension has no runtime npm dependencies. The code is organized into small, framework-free modules for the background worker, editor adapters, diff rendering, request budgets, prompts, and settings.

## Contributing and reporting issues

Bug reports, compatibility reports, and pull requests are welcome once the repository is publicly released. Please include the affected site/editor type, Chrome version, expected behavior, and steps to reproduce. **Do not paste API keys, private text, or account details into issues.**

For security concerns, contact the maintainer privately rather than publishing exploit details or credentials in a GitHub issue.

## Project status

Quill is under active development. Compatibility with third-party web editors is best-effort, and AI suggestions should be reviewed before accepting them.

