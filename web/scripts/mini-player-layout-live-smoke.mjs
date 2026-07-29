import { chromium } from "@playwright/test";

const endpoint = process.env.JSTREMIO_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const mediaUrl = process.argv[2];
if (!mediaUrl) throw new Error("Usage: mini-player-layout-live-smoke.mjs <media-url>");

const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0]?.pages().find((candidate) => candidate.url().includes("web.stremio.com"));
if (!page) throw new Error("JStremio WebView page was not found");

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
await page.evaluate(() => {
  const stream = location.hash.split("/")[2];
  if (!stream) throw new Error("The HTTP stream route has no encoded stream segment");
  const transport = encodeURIComponent("https://v3-cinemeta.strem.io/manifest.json");
  location.hash = `#/player/${stream}/${transport}/${transport}/series/tt2741602/${encodeURIComponent("tt2741602:4:22")}`;
});
await page.waitForFunction(
  () => Boolean(window.JStremio.player.getSnapshot()?.durationMs),
  undefined,
  { timeout: 20_000 },
);

const normal = await inspectLayout();
const miniButton = page.locator('[data-jstremio-extension="mini-player"][data-jstremio-control="player"]');
await miniButton.waitFor({ state: "visible", timeout: 10_000 });
await miniButton.click();
await page.waitForFunction(() => document.documentElement.hasAttribute("data-jstremio-mini-player"), undefined, {
  timeout: 10_000,
});
await page.waitForTimeout(500);
const mini = await inspectLayout();
const nativeState = await page.evaluate(() => window.JStremio.bridge.request("mini-player", "get"));

const clientRatio = mini.viewport.width / mini.viewport.height;
const frameWidth = nativeState.bounds.width - mini.viewport.width;
const frameHeight = nativeState.bounds.height - mini.viewport.height;
const result = {
  normal,
  mini,
  nativeBounds: nativeState.bounds,
  clientRatio: Number(clientRatio.toFixed(4)),
  nativeFrame: { width: frameWidth, height: frameHeight },
};
console.log(JSON.stringify(result, null, 2));
if (!mini.miniPlayerActive) throw new Error("The mini-player UI state did not remain active");
if (mini.viewport.width >= normal.viewport.width * 0.85) {
  throw new Error(`The mini-player remained too large (${mini.viewport.width}px wide)`);
}
if (Math.abs(clientRatio - 16 / 9) > 0.015) {
  throw new Error(`The mini-player client ratio was ${clientRatio.toFixed(4)}, not 16:9`);
}
if (frameHeight > 24 || frameHeight < 0 || frameWidth > 24 || frameWidth < 0) {
  throw new Error(`The mini-player still has a visible native frame (${frameWidth}x${frameHeight}px)`);
}

await page.evaluate(() => document.querySelector('[data-jstremio-control="mini-player-restore"]')?.click());
await page.waitForFunction(() => !document.documentElement.hasAttribute("data-jstremio-mini-player"), undefined, {
  timeout: 10_000,
});
await browser.close();

async function inspectLayout() {
  return page.evaluate(() => {
    const viewport = { width: innerWidth, height: innerHeight };
    const visible = Array.from(document.querySelectorAll("body *"))
      .filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > innerWidth * 0.7
          && rect.height >= 24
          && rect.height <= innerHeight * 0.35
          && style.display !== "none"
          && style.visibility !== "hidden";
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === "string" ? element.className : "",
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          height: Math.round(rect.height),
          background: style.backgroundColor,
          position: style.position,
        };
      })
      .filter((entry, index, entries) => index === entries.findIndex((candidate) =>
        candidate.className === entry.className
        && candidate.top === entry.top
        && candidate.height === entry.height
        && candidate.background === entry.background,
      ));
    return {
      viewport,
      miniPlayerActive: document.documentElement.hasAttribute("data-jstremio-mini-player"),
      fullscreenElement: Boolean(document.fullscreenElement),
      rootClass: document.documentElement.className,
      bodyClass: document.body.className,
      visible,
    };
  });
}
