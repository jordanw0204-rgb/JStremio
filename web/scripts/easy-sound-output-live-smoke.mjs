import { chromium } from "@playwright/test";

const endpoint = process.env.JSTREMIO_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const mediaUrl = process.argv[2];
if (!mediaUrl) throw new Error("Usage: easy-sound-output-live-smoke.mjs <media-url>");

let browser;
let lastError;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    browser = await chromium.connectOverCDP(endpoint);
    break;
  } catch (error) {
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
if (!browser) throw lastError ?? new Error("WebView2 CDP did not become available");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => candidate.url().includes("web.stremio.com")) ?? pages[0];
if (!page) throw new Error("WebView2 exposed no page");
await page.waitForFunction(() => Boolean(window.JStremio && window.core), undefined, { timeout: 20_000 });
await page.evaluate(() => { location.hash = "#/search"; });
const input = page.locator('input[type="text"]');
await input.waitFor({ state: "visible", timeout: 20_000 });
await input.evaluate((element, url) => {
  const transfer = new DataTransfer();
  transfer.setData("text/plain", url);
  element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
}, mediaUrl);
await page.waitForURL((url) => url.hash.startsWith("#/player/"), { timeout: 30_000 });

const devices = await page.evaluate(() => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("MPV did not publish audio-device-list")), 15_000);
  let unsubscribe = () => undefined;
  unsubscribe = window.JStremio.player.observeProperty("audio-device-list", (value) => {
    if (!Array.isArray(value) || !value.length) return;
    clearTimeout(timer);
    unsubscribe();
    resolve(value);
  });
}));
const sound = page.locator('[class*="control-bar-buttons-container"] [title*="Right-click"]');
await sound.waitFor({ state: "attached", timeout: 15_000 });
await sound.evaluate((element) => element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
const rows = page.locator('.easy-sound-device');
if (await rows.count() !== devices.length) {
  throw new Error(`Device menu rendered ${await rows.count()} rows for ${devices.length} MPV devices`);
}
await page.waitForTimeout(300);
const menuStyle = await page.locator('.easy-sound-menu').last().evaluate((element) => {
  const style = getComputedStyle(element);
  return { connected: element.isConnected, background: style.backgroundColor, color: style.color, border: style.borderColor };
});
if (!menuStyle.background || menuStyle.background === "rgba(0, 0, 0, 0)") throw new Error("The audio-device menu did not receive themed surface styling");
console.log(JSON.stringify({ devices, menuStyle }));
await browser.close();
