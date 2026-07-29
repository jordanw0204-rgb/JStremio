import { chromium } from "@playwright/test";

const endpoint = process.env.JSTREMIO_CDP_ENDPOINT ?? "http://127.0.0.1:9333";
const durationMs = Number(process.argv[2] ?? 10_000);
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0]?.pages().find((candidate) => candidate.url().includes("web.stremio.com"));
if (!page) throw new Error("JStremio WebView page was not found");

await page.waitForFunction(() => Boolean(window.JStremio), undefined, { timeout: 20_000 });
const result = await page.evaluate(async (duration) => {
  const nativeEvents = {};
  const nativeEventSamples = [];
  const frameGaps = [];
  const longTasks = [];
  let mutations = 0;
  const onMessage = (event) => {
    let raw = event.data;
    for (let depth = 0; depth < 2 && typeof raw === "string"; depth += 1) {
      try { raw = JSON.parse(raw); } catch { break; }
    }
    const args = Array.isArray(raw) ? raw : raw?.args;
    const name = Array.isArray(args) && typeof args[0] === "string" ? args[0] : "unknown";
    nativeEvents[name] = (nativeEvents[name] ?? 0) + 1;
    if (nativeEventSamples.length < 8) nativeEventSamples.push(raw);
  };
  window.chrome?.webview?.addEventListener("message", onMessage);
  const mutationObserver = new MutationObserver((records) => { mutations += records.length; });
  mutationObserver.observe(document.documentElement, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  const taskObserver = typeof PerformanceObserver === "function"
    ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      })
    : null;
  try { taskObserver?.observe({ type: "longtask", buffered: false }); } catch {}

  let previousFrame = performance.now();
  let running = true;
  const onFrame = (now) => {
    frameGaps.push(now - previousFrame);
    previousFrame = now;
    if (running) requestAnimationFrame(onFrame);
  };
  requestAnimationFrame(onFrame);
  await new Promise((resolve) => setTimeout(resolve, duration));
  running = false;
  mutationObserver.disconnect();
  taskObserver?.disconnect();
  window.chrome?.webview?.removeEventListener("message", onMessage);

  const sorted = [...frameGaps].sort((left, right) => left - right);
  const percentile = (value) => sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)] ?? 0;
  return {
    url: location.href,
    nativeEvents,
    nativeEventSamples,
    mutations,
    frames: frameGaps.length,
    frameGapMilliseconds: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      maximum: Math.max(0, ...frameGaps),
      over33ms: frameGaps.filter((value) => value > 33.333).length,
    },
    longTasks: longTasks.length,
    longestTaskMilliseconds: Math.max(0, ...longTasks),
  };
}, durationMs);

console.log(JSON.stringify(result));
await browser.close();
