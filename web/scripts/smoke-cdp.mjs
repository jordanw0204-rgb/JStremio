import { chromium } from "@playwright/test";

const endpoint = process.argv[2];
const expectRuntime = process.argv[3] === "true";
const action = process.argv[4] ?? "inspect";
if (!endpoint) throw new Error("CDP endpoint is required");

let browser;
let lastError;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    browser = await chromium.connectOverCDP(endpoint);
    break;
  } catch (error) {
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
if (!browser) throw lastError ?? new Error("WebView2 CDP did not become available");

const contexts = browser.contexts();
const pages = contexts.flatMap((context) => context.pages());
const page = pages.find((candidate) => candidate.url().includes("web.stremio.com")) ?? pages[0];
if (!page) throw new Error("WebView2 exposed no page");
await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.waitForFunction(
  (expected) => Boolean(window.JStremio) === expected,
  expectRuntime,
  { timeout: 15_000 },
);
const result = await page.evaluate(() => ({
  url: location.href,
  runtime: Boolean(window.JStremio),
  frozen: window.JStremio ? Object.isFrozen(window.JStremio) : null,
  reviewNavigation: document.querySelectorAll('[data-jstremio-testid="reviews-navigation"]').length,
  notesNavigation: document.querySelectorAll('[data-jstremio-testid="timestamp-notes-navigation"]').length,
  title: document.title,
}));
if (expectRuntime && action === "write") {
  const requests = [];
  page.on("request", (request) => requests.push(`${request.url()} ${request.postData() ?? ""}`));
  result.crud = await page.evaluate(async () => {
    const runtime = window.JStremio;
    if (!runtime) throw new Error("Runtime disappeared");
    const media = {
      videoId: "jstremio-smoke-video",
      metaId: "jstremio-smoke-meta",
      mediaType: "movie",
      name: "JStremio smoke fixture",
      title: null,
      season: null,
      episode: null,
      poster: null,
    };
    await runtime.bridge.request("reviews", "upsert", {
      ...media,
      rating: 5,
      text: "jstremio-private-network-sentinel",
    });
    await runtime.bridge.request("timestamp-notes", "create", {
      ...media,
      timestampMs: 12_345,
      durationMsAtCreation: 100_000,
      text: "jstremio-private-note-sentinel",
    });
    const reviews = await runtime.bridge.request("reviews", "list");
    const notes = await runtime.bridge.request("timestamp-notes", "listAll");
    return {
      reviews: Array.isArray(reviews) ? reviews.length : -1,
      notes: Array.isArray(notes) ? notes.length : -1,
    };
  });
  result.privateTextInNetwork = requests.some((request) =>
    /jstremio-private-(network|note)-sentinel/.test(request),
  );
}
if (expectRuntime && action === "read") {
  result.crud = await page.evaluate(async () => {
    const runtime = window.JStremio;
    if (!runtime) throw new Error("Runtime disappeared");
    const reviews = await runtime.bridge.request("reviews", "list");
    const notes = await runtime.bridge.request("timestamp-notes", "listAll");
    return {
      reviews: Array.isArray(reviews) ? reviews.length : -1,
      notes: Array.isArray(notes) ? notes.length : -1,
    };
  });
}
console.log(JSON.stringify(result));
await browser.close();
