import { chromium } from "@playwright/test";

const endpoint = process.argv[2] ?? process.env.JSTREMIO_CDP_ENDPOINT;
if (!endpoint) throw new Error("Usage: no-spoilers-player-live-smoke.mjs <cdp-endpoint>");

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
await page.waitForFunction(() => Boolean(window.JStremio && window.core), undefined, { timeout: 30_000 });
const entry = await page.evaluate(async () => {
  const entries = await window.JStremio.bridge.request("last-played", "list");
  if (!Array.isArray(entries)) return null;
  return entries.find((item) => item?.mediaType === "series" && item?.name === "The Blacklist" && typeof item?.playerDeepLink === "string") ?? null;
});
if (!entry) throw new Error("A saved Blacklist stream was not found");
await page.evaluate((route) => { location.hash = route.slice(1); }, entry.playerDeepLink);
await page.waitForURL((url) => url.hash.startsWith("#/player/"), { timeout: 30_000 });
const playerTitle = page.locator('span[class*="player-title"]');
await playerTitle.waitFor({ state: "visible", timeout: 45_000 });
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("jstremio-no-spoilers-settings-changed", {
    detail: { blurSummary: true, blurArtwork: true, titleMaskPercent: 70, guardSeeks: true, maxSkipMinutes: 10 },
  }));
});
await page.waitForTimeout(250);
const masked = (await playerTitle.textContent())?.trim() ?? null;
await playerTitle.click();
await page.getByRole("heading", { name: "Reveal episode name?" }).waitFor({ state: "visible" });
await page.getByRole("button", { name: "Reveal episode name" }).click();
await page.waitForTimeout(250);
const revealed = (await playerTitle.textContent())?.trim() ?? null;
const result = { masked, revealed };
console.log(JSON.stringify(result));
if (masked !== "The Blacklist - Robe** ***** (6x13)" || revealed !== "The Blacklist - Robert Vesco (6x13)") {
  throw new Error("No Spoilers player-title live smoke did not satisfy every assertion");
}
await page.evaluate(async () => {
  if (window.JStremio.player.getSnapshot()?.paused === false) await window.JStremio.player.setPaused(true);
});
await browser.close();
