import { chromium } from "@playwright/test";

const endpoint = process.env.JSTREMIO_CDP_ENDPOINT ?? process.argv[2];
const mediaUrl = process.env.JSTREMIO_CDP_ENDPOINT ? process.argv[2] : process.argv[3];
if (!endpoint || !mediaUrl) {
  throw new Error("Usage: next-video-plugins-live-smoke.mjs <cdp-endpoint> <media-url>");
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
await page.waitForFunction(() => Boolean(window.JStremio && window.core), undefined, { timeout: 30_000 });
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
  if (!stream) throw new Error("The HTTP stream route has no encoded stream segment");
  const transport = encodeURIComponent("https://v3-cinemeta.strem.io/manifest.json");
  location.hash = `#/player/${stream}/${transport}/${transport}/series/tt2741602/${encodeURIComponent("tt2741602:4:22")}`;
});
await page.waitForFunction(
  async () => (await window.JStremio.stremio.getCurrentMediaTarget())?.key === "series:tt2741602:4:22",
  undefined,
  { timeout: 30_000 },
);
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("jstremio-review-settings-changed", { detail: { autoOpenAtEnd: true } }));
  window.dispatchEvent(new CustomEvent("jstremio-no-spoilers-settings-changed", {
    detail: { blurSummary: true, blurArtwork: true, titleMaskPercent: 70, guardSeeks: true, maxSkipMinutes: 10 },
  }));
  document.body.insertAdjacentHTML("beforeend", `
    <section class="next-video-popup-container_live-smoke" style="position:fixed;left:220px;top:120px;width:620px;height:210px;background:#000">
      <div class="info-container_live-smoke">
        <div class="details-container_live-smoke">
          <div class="name_live-smoke"><span>Next on</span> The Blacklist</div>
          <div class="title_live-smoke">General Shiro (S6E7)</div>
        </div>
        <div class="buttons-container_live-smoke">
          <div class="button-container_live-smoke" tabindex="0"><span>Dismiss</span></div>
          <div class="button-container_live-smoke" tabindex="0"><span>Watch now</span></div>
        </div>
      </div>
    </section>`);
});

const title = page.locator(".title_live-smoke");
await title.waitFor({ state: "visible" });
await page.waitForFunction(() => document.querySelector(".title_live-smoke")?.textContent === "Gene*** ***** (S6E7)");
const reviewDialog = page.getByRole("dialog", { name: /(?:add|update) review/i });
await reviewDialog.waitFor({ state: "visible", timeout: 10_000 });
const masked = await title.textContent();
await reviewDialog.getByRole("button", { name: "Cancel" }).click();
await title.click();
await page.getByRole("heading", { name: "Reveal episode name?" }).waitFor({ state: "visible" });
await page.getByRole("button", { name: "Reveal episode name" }).click();
const revealed = await title.textContent();

await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("jstremio-review-settings-changed", { detail: { autoOpenAtEnd: false } }));
  document.querySelector('[class*="next-video-popup-container"]')?.remove();
  document.body.append(document.createElement("span"));
});
await page.waitForTimeout(100);
await page.evaluate(() => {
  document.body.insertAdjacentHTML("beforeend", `
    <section class="next-video-popup-container_second-smoke" style="position:fixed;width:620px;height:210px">
      <div class="details-container_second-smoke"><div class="title_second-smoke">The Corsican (S6E2)</div></div>
      <div tabindex="0">Dismiss</div><div tabindex="0">Watch now</div>
    </section>`);
});
await page.waitForTimeout(350);
const disabledStayedClosed = await reviewDialog.count() === 0;
const result = { masked, revealed, reviewOpened: true, disabledStayedClosed };
console.log(JSON.stringify(result));
if (
  masked !== "Gene*** ***** (S6E7)"
  || revealed !== "General Shiro (S6E7)"
  || !disabledStayedClosed
) {
  throw new Error("Next-video plugin live smoke did not satisfy every assertion");
}
await page.evaluate(async () => {
  if (window.JStremio.player.getSnapshot()?.paused === false) await window.JStremio.player.setPaused(true);
});
await browser.close();
