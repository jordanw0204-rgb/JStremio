import { chromium } from "@playwright/test";

const endpoint = process.argv[2];
const outputPrefix = process.argv[3];
if (!endpoint || !outputPrefix) {
  throw new Error("Usage: appearance-live-smoke.mjs <cdp-endpoint> <output-prefix>");
}

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
await page.waitForURL((url) => url.origin === "https://web.stremio.com", { timeout: 30_000 });
await page.waitForFunction(
  () => Boolean(window.JStremio) && document.querySelectorAll('[data-jstremio-testid="themes-navigation"]').length === 1,
  undefined,
  { timeout: 20_000 },
);

const originalTheme = await page.evaluate(async () => {
  if (!window.JStremio) throw new Error("JStremio runtime is unavailable");
  return window.JStremio.bridge.request("themes", "get");
});
const branded = await page.evaluate(() => {
  const images = Array.from(document.querySelectorAll("[data-jstremio-brand-logo]"));
  const image = images[0];
  const rect = image?.getBoundingClientRect();
  return {
    count: images.length,
    embedded: image instanceof HTMLImageElement && image.src.startsWith("data:image/png;base64,"),
    visible: Boolean(rect && rect.width > 0 && rect.height > 0),
    officialRemaining: Array.from(document.images).filter((candidate) => {
      try { return new URL(candidate.src, location.href).pathname.endsWith("/images/stremio_symbol.png"); }
      catch { return false; }
    }).length,
  };
});

await page.locator('[data-jstremio-testid="themes-navigation"]').click();
await page.getByRole("heading", { name: "Themes" }).waitFor({ state: "visible" });
const accent = page.getByLabel("Accent hex color");
await accent.fill("#1687FF");
await page.waitForFunction(
  () => document.documentElement.style.getPropertyValue("--primary-accent-color") === "#1687FF",
  undefined,
  { timeout: 5_000 },
);
await page.screenshot({ path: `${outputPrefix}-themes.png`, fullPage: true });
await page.getByRole("button", { name: "Close Themes" }).click();
await page.waitForFunction(
  (expected) => document.documentElement.style.getPropertyValue("--primary-accent-color") === expected,
  originalTheme.accent,
  { timeout: 5_000 },
);

await page.evaluate(() => { location.hash = "#/"; });
await page.waitForTimeout(2_000);
const cards = page.locator("[data-jstremio-last-played-card]");
const cardCount = await cards.count();
let lastPlayed = { count: cardCount, detailsVisible: false, detailsLength: 0, withinViewport: false };
if (cardCount > 0) {
  const first = cards.first();
  // The card action intentionally ignores pointer events until its poster is
  // hovered, matching how Stremio reveals its own contextual poster controls.
  await first.locator("xpath=..").hover();
  await first.locator("button").hover();
  const details = page.locator('[data-jstremio-last-played-details][data-open]').first();
  await details.waitFor({ state: "visible" });
  const box = await details.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  lastPlayed = {
    count: cardCount,
    detailsVisible: await details.isVisible(),
    detailsLength: (await details.textContent())?.length ?? 0,
    withinViewport: Boolean(
      box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
    ),
  };
  await page.screenshot({ path: `${outputPrefix}-lastplayed.png`, fullPage: true });
}

console.log(JSON.stringify({ branded, originalTheme, previewReverted: true, lastPlayed }));
await browser.close();
