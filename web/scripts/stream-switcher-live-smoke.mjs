import { chromium } from "@playwright/test";

const endpoint = process.env.JSTREMIO_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes("web.stremio.com"));
if (!page) throw new Error("JStremio WebView page was not found");

await page.waitForFunction(() => Boolean(window.JStremio));
await page.evaluate(async () => {
  const entries = await window.JStremio.bridge.request("last-played", "list");
  const newest = [...entries].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
  if (!newest?.playerDeepLink) throw new Error("LastPlayed has no saved player route");
  location.hash = newest.playerDeepLink;
});

const control = page.locator('[data-jstremio-testid="stream-switcher"]');
await control.waitFor({ state: "visible", timeout: 15_000 });
const placement = await page.evaluate(() => {
  const button = document.querySelector('[data-jstremio-testid="stream-switcher"]');
  const bar = document.querySelector('[class*="control-bar-buttons-container"]');
  const next = bar ? Array.from(bar.querySelectorAll("[title]")).find((node) => /next\s+video/i.test(node.getAttribute("title") ?? "")) : null;
  return {
    inPlayerBar: Boolean(button && bar && button.parentElement === bar),
    immediatelyBeforeNext: Boolean(button && next && button.nextElementSibling === next),
    title: button?.getAttribute("title") ?? null,
  };
});

await control.evaluate((element) => element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
const picker = page.getByRole("dialog", { name: "Choose a stream" });
await picker.waitFor({ state: "visible", timeout: 5_000 });
await page.waitForFunction(() => document.querySelectorAll(".stream-switcher-option").length > 0, null, { timeout: 15_000 });
const pickerResult = await page.evaluate(() => {
  const picker = document.querySelector(".stream-switcher-menu");
  return {
    optionCount: document.querySelectorAll(".stream-switcher-option").length,
    currentCount: document.querySelectorAll(".stream-switcher-option[data-current]").length,
    background: picker ? getComputedStyle(picker).backgroundColor : null,
    color: picker ? getComputedStyle(picker).color : null,
  };
});

const result = { placement, picker: pickerResult };
console.log(JSON.stringify(result));
if (!placement.inPlayerBar || !placement.immediatelyBeforeNext) {
  throw new Error("Stream Switcher is not immediately before Next Video in the live player bar");
}
if (pickerResult.optionCount < 1 || pickerResult.currentCount !== 1) {
  throw new Error("The live stream picker did not load or identify the active stream");
}
