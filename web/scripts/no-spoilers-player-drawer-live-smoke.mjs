import { chromium } from "@playwright/test";

const endpoint = process.env.JSTREMIO_CDP_ENDPOINT;
const mediaUrl = process.argv[2];
if (!endpoint || !mediaUrl) throw new Error("CDP endpoint and media URL are required");

const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts().flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes("web.stremio.com"));
  if (!page) throw new Error("JStremio WebView page was not found");
  await page.waitForFunction(() => Boolean(window.JStremio && window.core));
  await page.evaluate(() => { location.hash = "#/search"; });
  const input = page.locator('input[type="text"]');
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await input.evaluate((element, url) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", url);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
  }, mediaUrl);
  await page.waitForURL((url) => url.hash.startsWith("#/player/"), { timeout: 30_000 });
  await page.evaluate(() => {
    const stream = location.hash.split("/")[2];
    if (!stream) throw new Error("The local stream route was not created");
    const transport = encodeURIComponent("https://v3-cinemeta.strem.io/manifest.json");
    location.hash = `#/player/${stream}/${transport}/${transport}/series/tt2741602/${encodeURIComponent("tt2741602:4:22")}`;
  });
  await page.waitForFunction(
    async () => (await window.JStremio?.stremio.getCurrentMediaTarget())?.key === "series:tt2741602:4:22",
    null,
    { timeout: 30_000 },
  );
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("jstremio-no-spoilers-settings-changed", {
    detail: { blurSummary: true, blurArtwork: true, titleMaskPercent: 70, guardSeeks: true, maxSkipMinutes: 10 },
  })));
  await page.locator('[class*="side-drawer-button"]').click();
  const drawer = page.locator('[class*="side-drawer"]').filter({ has: page.locator('[class*="video-container"]') });
  await drawer.locator('[class*="video-container"]').first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(500);

  const result = await drawer.evaluate((element) => {
    const rows = Array.from(element.querySelectorAll('[class*="video-container"]'));
    const titles = rows.map((row) => row.querySelector('[class*="title-container"]')?.textContent?.trim() ?? "");
    const thumbnails = rows.flatMap((row) => Array.from(row.querySelectorAll('[class*="thumbnail-container"] img, img[class*="thumbnail"]')));
    const descriptions = Array.from(element.querySelectorAll('[class*="description-container"]'));
    return {
      rowCount: rows.length,
      maskedTitles: titles.filter((title) => /^\d+\.\s+/.test(title) && title.includes("*")).length,
      thumbnailCount: thumbnails.length,
      blurredThumbnails: thumbnails.filter((image) => image.classList.contains("no-spoilers-blur")).length,
      summaryProtected: descriptions.some((description) => description.querySelector(".no-spoilers-blur") || description.classList.contains("no-spoilers-blur")),
      samples: titles.slice(0, 3),
    };
  });
  console.log(JSON.stringify(result));
  if (
    result.rowCount < 5
    || result.maskedTitles !== result.rowCount
    || result.thumbnailCount < 5
    || result.blurredThumbnails !== result.thumbnailCount
    || !result.summaryProtected
  ) {
    throw new Error("No Spoilers did not protect every player side-drawer episode");
  }
  await page.evaluate(async () => {
    if (window.JStremio?.player.getSnapshot()?.paused === false) await window.JStremio.player.setPaused(true);
  });
} finally {
  await browser.close();
}
