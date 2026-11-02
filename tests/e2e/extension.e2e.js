// End-to-end tests: load the unpacked extension in Chromium and drive real pages.
// The Anthropic call is stubbed inside the service worker, so no key or network is needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

const EXTENSION_PATH = path.resolve(__dirname, "../..");

const PAGES = {
  "/textarea": `<textarea id="field" rows="4" cols="60">this sentense has a eror</textarea>`,
  "/editable": `<div id="field" contenteditable="true" style="min-height:60px">first line has eror</div>`,
  "/iframe": `<iframe id="frame" width="500" height="200" srcdoc="<textarea id='field'>this sentense has a eror</textarea>"></iframe>`,
};

let context;
let worker;

test.before(async () => {
  context = await chromium.launchPersistentContext("", {
    // Extensions need full Chromium; the default headless shell can't load them.
    channel: "chromium",
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await context.route("https://quill.test/**", (route) => {
    const body = PAGES[new URL(route.request().url()).pathname] || "<p>missing</p>";
    return route.fulfill({ contentType: "text/html", body: `<!doctype html><body>${body}</body>` });
  });
});

test.after(async () => {
  await context?.close();
});

async function stubAnthropic(reply) {
  await worker.evaluate(async (replyText) => {
    await chrome.storage.local.set({ anthropicKey: "sk-ant-test-key-0000", requestBudget: null });
    self.__quillCalls = [];
    self.fetch = async (url, init) => {
      self.__quillCalls.push(JSON.parse(init.body));
      const events = [
        { type: "content_block_delta", delta: { type: "text_delta", text: replyText } },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
      ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
      return new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
  }, reply);
}

const apiCalls = () => worker.evaluate(() => self.__quillCalls.length);

async function openPage(name) {
  const page = await context.newPage();
  await page.goto(`https://quill.test/${name}`);
  await page.waitForTimeout(300);
  return page;
}

async function selectAllIn(locator) {
  await locator.click();
  await locator.press("Control+A");
}

async function waitForHost(page, id) {
  await page.waitForFunction((hostId) => {
    const host = document.getElementById(hostId);
    return host && host.getBoundingClientRect().height > 0;
  }, id);
  return page.locator(`#${id}`);
}

// Quill's UI lives in a closed shadow root, so tests click by position like a user.
async function clickPrimaryPill(page) {
  const box = await (await waitForHost(page, "quill-fix-host")).boundingBox();
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
}

async function clickAccept(page) {
  await page.waitForTimeout(300);
  const box = await (await waitForHost(page, "quill-suggestion-host")).boundingBox();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height - 26);
}

test("fixes a textarea and Ctrl+Z restores the original", async () => {
  await stubAnthropic("this sentence has an error");
  const page = await openPage("textarea");
  const field = page.locator("#field");

  await selectAllIn(field);
  await clickPrimaryPill(page);
  await page.waitForFunction(() => !document.getElementById("quill-fix-host"));
  assert.equal(await apiCalls(), 1);

  await clickAccept(page);
  assert.equal(await field.inputValue(), "this sentence has an error");

  await field.press("Control+Z");
  assert.equal(await field.inputValue(), "this sentense has a eror");
  await page.close();
});

test("page scripts cannot trigger a request with the user's key", async () => {
  await stubAnthropic("unused");
  const page = await openPage("textarea");

  const reachedButton = await page.evaluate(async () => {
    const field = document.getElementById("field");
    field.focus();
    field.setSelectionRange(0, field.value.length);
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const host = document.getElementById("quill-fix-host");
    if (host) {
      host.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
      host.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    }
    return Boolean(host?.shadowRoot);
  });

  await page.waitForTimeout(500);
  assert.equal(reachedButton, false);
  assert.equal(await apiCalls(), 0);
  await page.close();
});

test("keyboard shortcut runs a fix and Enter accepts it", async () => {
  await stubAnthropic("this sentence has an error");
  const page = await openPage("textarea");
  const field = page.locator("#field");
  await selectAllIn(field);

  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    runCommand("quill-fix", tab);
  });
  await waitForHost(page, "quill-suggestion-host");
  await page.waitForTimeout(300);
  assert.equal(await apiCalls(), 1);

  await page.keyboard.press("Enter");
  assert.equal(await field.inputValue(), "this sentence has an error");
  await page.close();
});

test("keeps line breaks when replacing contenteditable text", async () => {
  await stubAnthropic("First line has an error.\nSecond line.");
  const page = await openPage("editable");
  const field = page.locator("#field");

  await selectAllIn(field);
  await clickPrimaryPill(page);
  await clickAccept(page);

  const text = await field.evaluate((element) => element.innerText);
  assert.equal(text.replace(/\n+/g, "\n").trim(), "First line has an error.\nSecond line.");
  await page.close();
});

test("refuses to replace text that changed while the model was working", async () => {
  await stubAnthropic("this sentence has an error");
  const page = await openPage("textarea");
  const field = page.locator("#field");

  await selectAllIn(field);
  await clickPrimaryPill(page);
  await waitForHost(page, "quill-suggestion-host");
  await field.evaluate((element) => { element.value = "something else entirely"; });
  await clickAccept(page);

  assert.equal(await field.inputValue(), "something else entirely");
  await page.close();
});

test("works inside iframes", async () => {
  await stubAnthropic("this sentence has an error");
  const page = await openPage("iframe");
  const frame = page.frameLocator("#frame");
  const field = frame.locator("#field");

  await selectAllIn(field);
  const pill = await page.frames()[1].waitForSelector("#quill-fix-host", { state: "attached" });
  assert.ok(pill);
  await page.close();
});

