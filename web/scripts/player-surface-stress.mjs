import { chromium } from "@playwright/test";

const endpoint = process.argv[2];
const mediaUrl = process.argv[3];
const cycles = Number.parseInt(process.argv[4] ?? "20", 10);
if (!endpoint || !mediaUrl || !Number.isInteger(cycles) || cycles < 1) {
  throw new Error("Usage: player-surface-stress.mjs <cdp-endpoint> <media-url> [cycles]");
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
  async () => (await window.JStremio.stremio.getCurrentMediaTarget())?.key === "series:tt2741602:4:22",
  undefined,
  { timeout: 20_000 },
);
await page.waitForFunction(() => {
  const snapshot = window.JStremio.player.getSnapshot();
  return Boolean(snapshot && snapshot.durationMs >= 10_000);
}, undefined, { timeout: 20_000 });
await page.evaluate(async () => window.JStremio.player.setPaused(false));
await page.waitForFunction(() => {
  const snapshot = window.JStremio.player.getSnapshot();
  return Boolean(snapshot && snapshot.positionMs >= 500 && snapshot.paused === false);
}, undefined, { timeout: 20_000 });
await page.waitForFunction(() =>
  document.querySelectorAll('[data-jstremio-control="player-dock"] [data-jstremio-control="player"]').length === 2,
undefined, { timeout: 10_000 });

await page.evaluate(async () => window.JStremio.player.setPaused(true));
const windowedViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
const observations = [];

for (let cycle = 1; cycle <= cycles; cycle += 1) {
  await toggleFullscreen(page, true);
  await page.waitForFunction(
    ({ width, height }) => innerWidth !== width || innerHeight !== height,
    windowedViewport,
    { timeout: 10_000 },
  );
  observations.push(await surfaceState(page, cycle, "fullscreen"));

  await toggleFullscreen(page, false);
  await page.waitForFunction(
    ({ width, height }) => Math.abs(innerWidth - width) < 4 && Math.abs(innerHeight - height) < 4,
    windowedViewport,
    { timeout: 10_000 },
  );
  observations.push(await surfaceState(page, cycle, "windowed"));
}

const beforeRecovery = await page.evaluate(() => window.JStremio.player.getSnapshot()?.positionMs ?? 0);
await page.evaluate(async () => {
  window.chrome.webview.postMessage(JSON.stringify({
    id: 2_900_001,
    args: ["mpv-recover-playback", true],
  }));
  await window.JStremio.player.setPaused(false);
});
await page.waitForFunction(
  (position) => (window.JStremio.player.getSnapshot()?.positionMs ?? 0) >= position + 1_000,
  beforeRecovery,
  { timeout: 20_000 },
);
const afterRecovery = await page.evaluate(() => window.JStremio.player.getSnapshot()?.positionMs ?? 0);
const finalState = await surfaceState(page, cycles, "final");

const failedStates = observations.filter((state) =>
  !state.playerRoute || !state.navigationHidden || !state.controlsVisible || !state.viewportFilled,
);
const result = {
  cycles,
  transitions: observations.length,
  windowedViewport,
  failedStates,
  playbackAdvancedAfterRecovery: afterRecovery >= beforeRecovery + 1_000,
  finalState,
};
console.log(JSON.stringify(result));
if (failedStates.length || !result.playbackAdvancedAfterRecovery || !finalState.controlsVisible) {
  throw new Error(`Player surface stress failed: ${JSON.stringify(result)}`);
}
await browser.close();

async function toggleFullscreen(target, fullscreen) {
  await target.evaluate((value) => {
    window.chrome.webview.postMessage(JSON.stringify({
      id: 0,
      type: 6,
      args: ["win-set-visibility", { fullscreen: value }],
    }));
  }, fullscreen);
}

async function surfaceState(target, cycle, mode) {
  return target.evaluate(({ cycle, mode }) => {
    const controls = Array.from(document.querySelectorAll(
      '[data-jstremio-control="player-dock"] [data-jstremio-control="player"]',
    ));
    const navigation = Array.from(document.querySelectorAll('[data-jstremio-control="navigation"]'));
    return {
      cycle,
      mode,
      width: innerWidth,
      height: innerHeight,
      playerRoute: document.documentElement.hasAttribute("data-jstremio-player-route"),
      viewportFilled:
        Math.abs(document.documentElement.getBoundingClientRect().width - innerWidth) < 1 &&
        Math.abs(document.documentElement.getBoundingClientRect().height - innerHeight) < 1,
      navigationHidden: navigation.every((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display === "none" && rect.width === 0 && rect.height === 0;
      }),
      controlsVisible: controls.length === 2 && controls.every((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width >= 40 && rect.height >= 40;
      }),
    };
  }, { cycle, mode });
}
