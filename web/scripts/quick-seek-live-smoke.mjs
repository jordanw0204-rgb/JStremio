import { chromium } from "@playwright/test";

const endpoint = process.env.JSTREMIO_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0].pages().find((candidate) =>
  candidate.url().includes("web.stremio.com"),
);
if (!page) throw new Error("JStremio WebView page was not found");

await page.waitForFunction(() => Boolean(window.JStremio));
await page.evaluate(async () => {
  const entries = await window.JStremio.bridge.request("last-played", "list");
  const newest = [...entries].sort((left, right) =>
    String(right.updatedAt).localeCompare(String(left.updatedAt)),
  )[0];
  if (!newest?.playerDeepLink) throw new Error("LastPlayed has no saved player route");
  location.hash = newest.playerDeepLink;
});

let firstPlacement = null;
let result = null;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const snapshot = await page.evaluate(() => {
    const bar = document.querySelector('[class*="control-bar-buttons-container"]');
    const back = document.querySelector('[data-jstremio-control="quick-seek-bar-back"]');
    const forward = document.querySelector('[data-jstremio-control="quick-seek-bar-forward"]');
    const play = bar
      ? Array.from(bar.querySelectorAll("[title]")).find((element) =>
        /\b(?:play|pause)\b/i.test(element.getAttribute("title") ?? ""),
      )
      : null;
    const details = (element) => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        parentClass: element.parentElement?.className ?? "",
        width: bounds.width,
        height: bounds.height,
        opacity: getComputedStyle(element).opacity,
      };
    };
    return {
      barClass: bar?.className ?? null,
      back: details(back),
      forward: details(forward),
      correctParent: Boolean(bar && back?.parentElement === bar && forward?.parentElement === bar),
      exactOrder: Boolean(back?.nextElementSibling === play && play?.nextElementSibling === forward),
      order: bar
        ? Array.from(bar.children).slice(0, 6).map((element) =>
          element.getAttribute("data-jstremio-control")
          ?? element.getAttribute("title")
          ?? element.className,
        )
        : [],
    };
  });
  if (!firstPlacement && snapshot.back) firstPlacement = { attempt, ...snapshot };
  if (
    snapshot.correctParent
    && snapshot.exactOrder
    && snapshot.back?.width > 0
    && snapshot.forward?.width > 0
  ) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    const stable = await page.evaluate(() => {
      const bar = document.querySelector('[class*="control-bar-buttons-container"]');
      const back = document.querySelector('[data-jstremio-control="quick-seek-bar-back"]');
      const forward = document.querySelector('[data-jstremio-control="quick-seek-bar-forward"]');
      const play = bar
        ? Array.from(bar.querySelectorAll("[title]")).find((element) =>
          /\b(?:play|pause)\b/i.test(element.getAttribute("title") ?? ""),
        )
        : null;
      return {
        connected: Boolean(back?.isConnected && forward?.isConnected),
        correctParent: Boolean(bar && back?.parentElement === bar && forward?.parentElement === bar),
        exactOrder: Boolean(back?.nextElementSibling === play && play?.nextElementSibling === forward),
        backWidth: back?.getBoundingClientRect().width ?? 0,
        forwardWidth: forward?.getBoundingClientRect().width ?? 0,
      };
    });
    result = { firstPlacement, bottomPlacement: { attempt, ...snapshot }, stable };
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

console.log(JSON.stringify(result ?? { firstPlacement, bottomPlacement: null }));
if (!result?.stable.connected || !result.stable.correctParent || !result.stable.exactOrder) {
  throw new Error("Quick Seek did not remain around Play in the live Stremio player bar");
}
