import { chromium } from "@playwright/test";

const endpoint = process.argv[2] ?? process.env.JSTREMIO_CDP_ENDPOINT;
if (!endpoint) throw new Error("Usage: no-spoilers-live-smoke.mjs <cdp-endpoint>");

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
await page.evaluate(() => {
  location.hash = "#/detail/series/tt2741602/tt2741602%3A6%3A13";
});
await page.waitForURL((url) => url.hash.startsWith("#/detail/series/tt2741602/"), { timeout: 30_000 });
await page.locator('[class*="episode-title"]').waitFor({ state: "visible", timeout: 60_000 });
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("jstremio-no-spoilers-settings-changed", {
    detail: {
      blurSummary: true,
      blurArtwork: true,
      titleMaskPercent: 70,
      guardSeeks: true,
      maxSkipMinutes: 10,
    },
  }));
});
await page.waitForTimeout(500);

const detail = await page.evaluate(() => {
  const descriptions = Array.from(document.querySelectorAll('[class*="description-container"]'));
  const summary = descriptions.find((container) => Array.from(container.children)
    .some((child) => /^\s*summary\s*$/i.test(child.textContent ?? "")));
  const summaryBody = Array.from(summary?.children ?? []).find((child) => !/^\s*summary\s*$/i.test(child.textContent ?? ""));
  const episodeTitle = document.querySelector('[class*="episode-title"]');
  const seriesLogo = document.querySelector('img[class*="logo"][title]');
  const background = document.querySelector('[class*="background-image"]');
  return {
    episodeTitle: episodeTitle?.textContent?.trim() ?? null,
    summaryBlurred: summaryBody?.classList.contains("no-spoilers-blur") ?? false,
    backgroundBlurred: background?.classList.contains("no-spoilers-blur") ?? false,
    seriesLogoTitle: seriesLogo?.getAttribute("title") ?? null,
    seriesLogoVisible: Boolean(seriesLogo && !seriesLogo.classList.contains("no-spoilers-logo-hidden")),
    replacementCount: document.querySelectorAll(".no-spoilers-masked-logo").length,
  };
});

await page.locator(".no-spoilers-summary-protected").first().click();
await page.getByRole("heading", { name: "Reveal summary?" }).waitFor({ state: "visible" });
await page.getByRole("button", { name: "Reveal summary" }).click();
await page.waitForTimeout(250);
detail.summaryRevealed = await page.locator(".no-spoilers-summary-protected").count() === 0;

await page.locator('[class*="episode-title"]').evaluate((element) => {
  const back = element.parentElement?.querySelector('[class*="back-button-container"]');
  if (!(back instanceof HTMLElement)) throw new Error("Episode-list back button was not found");
  back.click();
});
await page.waitForURL((url) => url.hash.includes("?season=6"), { timeout: 30_000 });
await page.locator('[class*="videos-list"] [class*="title-container"]').first().waitFor({ state: "visible", timeout: 30_000 });
await page.waitForTimeout(500);

const list = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[class*="videos-list"] [class*="video-container"]'));
  const titles = rows.map((row) => row.querySelector('[class*="title-container"]')?.textContent?.trim() ?? "");
  const thumbnails = rows.flatMap((row) => Array.from(row.querySelectorAll('[class*="thumbnail-container"] img, img[class*="thumbnail"]')));
  return {
    rowCount: rows.length,
    maskedTitles: titles.filter((title) => /^\d+\.\s+/.test(title) && title.includes("*")).length,
    maskedTooltips: rows.filter((row) => row.getAttribute("title")?.includes("*")).length,
    thumbnailCount: thumbnails.length,
    blurredThumbnails: thumbnails.filter((image) => image.classList.contains("no-spoilers-blur")).length,
    samples: titles.slice(0, 4),
  };
});

await page.evaluate(() => { location.hash = "#/"; });
await page.waitForURL((url) => url.hash === "#/" || url.hash === "", { timeout: 30_000 });
await page.waitForTimeout(2_000);
const home = await page.evaluate(() => ({
  artworkCount: document.querySelectorAll('img[class*="poster"], [class*="poster-container"] img').length,
  blurredArtwork: document.querySelectorAll('img.no-spoilers-blur[class*="poster"], [class*="poster-container"] img.no-spoilers-blur').length,
}));

const result = { detail, list, home };
console.log(JSON.stringify(result));
if (
  detail.episodeTitle !== "S6E13 Robe** *****" || !detail.summaryBlurred || !detail.summaryRevealed || !detail.backgroundBlurred ||
  detail.seriesLogoTitle !== "The Blacklist" || !detail.seriesLogoVisible || detail.replacementCount !== 0 ||
  list.rowCount < 10 || list.maskedTitles !== list.rowCount || list.maskedTooltips !== list.rowCount ||
  list.thumbnailCount < 10 || list.blurredThumbnails !== list.thumbnailCount ||
  home.artworkCount < 1 || home.blurredArtwork !== 0
) {
  throw new Error("No Spoilers live smoke did not satisfy every assertion");
}
await browser.close();
