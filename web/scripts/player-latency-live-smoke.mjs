import { chromium } from "@playwright/test";

const endpoint = process.env.JSTREMIO_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const mediaUrl = process.argv[2];
if (!mediaUrl) throw new Error("Usage: player-latency-live-smoke.mjs <media-url>");

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
  () => {
    const snapshot = window.JStremio.player.getSnapshot();
    return Boolean(snapshot && snapshot.durationMs >= 10_000);
  },
  undefined,
  { timeout: 20_000 },
);
await page.evaluate(async () => {
  if (window.JStremio.player.getSnapshot()?.paused !== false) {
    await window.JStremio.player.setPaused(false);
  }
});
await page.waitForFunction(
  () => {
    const snapshot = window.JStremio.player.getSnapshot();
    return Boolean(snapshot?.paused === false && snapshot.positionMs !== null && snapshot.positionMs >= 500);
  },
  undefined,
  { timeout: 15_000 },
);

const stateLatenciesMs = [];
for (let cycle = 0; cycle < 3; cycle += 1) {
  stateLatenciesMs.push(await clickPlaybackControlAndWait(true));
  stateLatenciesMs.push(await clickPlaybackControlAndWait(false));
}

const samples = await page.evaluate(async () => {
  const values = [];
  const started = performance.now();
  while (performance.now() - started < 3_500) {
    const snapshot = window.JStremio.player.getSnapshot();
    values.push({ at: performance.now(), positionMs: snapshot?.positionMs ?? null });
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return values;
});
const changes = samples.filter((sample, index) => index === 0 || sample.positionMs !== samples[index - 1].positionMs);
const updateGapsMs = changes.slice(1).map((sample, index) => sample.at - changes[index].at);
const maxStateLatencyMs = Math.max(...stateLatenciesMs);
const maxUpdateGapMs = Math.max(0, ...updateGapsMs);
const result = {
  stateLatenciesMs: stateLatenciesMs.map((value) => Math.round(value)),
  maxStateLatencyMs: Math.round(maxStateLatencyMs),
  observedPositionChanges: changes.length,
  maxUpdateGapMs: Math.round(maxUpdateGapMs),
};
console.log(JSON.stringify(result));
if (maxStateLatencyMs >= 1_000) throw new Error(`Play/pause acknowledgement took ${maxStateLatencyMs.toFixed(0)} ms`);
if (changes.length < 3 || maxUpdateGapMs >= 1_500) {
  throw new Error(`Playback position updates stalled for ${maxUpdateGapMs.toFixed(0)} ms`);
}
await page.evaluate(async () => {
  if (window.JStremio.player.getSnapshot()?.paused === false) {
    await window.JStremio.player.setPaused(true);
  }
});
await browser.close();

async function clickPlaybackControlAndWait(paused) {
  const bounds = await page.evaluate(() => {
    const bar = document.querySelector('[class*="control-bar-buttons-container"]');
    const control = bar
      ? Array.from(bar.querySelectorAll("[title]")).find((element) =>
        /\b(?:play|pause)\b/i.test(element.getAttribute("title") ?? ""),
      )
      : null;
    if (!(control instanceof HTMLElement)) return null;
    const rect = control.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  if (!bounds) throw new Error("The official Stremio play/pause control was not found");
  const started = performance.now();
  await page.mouse.click(bounds.x, bounds.y);
  await page.waitForFunction(
    (expected) => window.JStremio.player.getSnapshot()?.paused === expected,
    paused,
    { timeout: 5_000 },
  );
  return performance.now() - started;
}
