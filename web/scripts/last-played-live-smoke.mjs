import { chromium } from "@playwright/test";

const endpoint = process.argv[2];
if (!endpoint) throw new Error("Usage: last-played-live-smoke.mjs <cdp-endpoint>");

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
if (!page.url().includes("web.stremio.com")) {
  await page.waitForURL((url) => url.origin === "https://web.stremio.com", { timeout: 30_000 });
}
await page.waitForFunction(() => Boolean(window.JStremio && window.core), undefined, { timeout: 20_000 });

const entry = await page.evaluate(async () => {
  const entries = await window.JStremio.bridge.request("last-played", "list");
  if (!Array.isArray(entries) || !entries.length) throw new Error("LastPlayed has no saved entries");
  return entries
    .filter((item) => item && typeof item === "object" && typeof item.playerDeepLink === "string")
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
});
if (!entry) throw new Error("LastPlayed has no valid saved entry");

await page.evaluate((saved) => {
  location.hash = `#/detail/${encodeURIComponent(saved.mediaType)}/${encodeURIComponent(saved.metaId)}/${encodeURIComponent(saved.videoId)}`;
}, entry);
await page.waitForURL((url) => url.hash.startsWith("#/detail/"), { timeout: 30_000 });

const resume = page.locator("[data-jstremio-last-played-resume]");
await resume.waitFor({ state: "visible", timeout: 60_000 });
const layout = await resume.evaluate((button) => {
  const control = button.closest("[data-jstremio-last-played-stream-control]");
  const buttonRect = button.getBoundingClientRect();
  const controlRect = control?.getBoundingClientRect();
  return {
    buttonWidth: Math.round(buttonRect.width),
    buttonHeight: Math.round(buttonRect.height),
    controlWidth: Math.round(controlRect?.width ?? 0),
    controlHeight: Math.round(controlRect?.height ?? 0),
    compact: buttonRect.width > 0 && buttonRect.height > 0 && buttonRect.height < 80 && buttonRect.width < innerWidth * 0.8,
  };
});
const matched = await page.evaluate((saved) => {
  const badge = document.querySelector("[data-jstremio-last-played-badge]");
  const anchor = badge?.closest('a[href*="/player/"]');
  if (!(anchor instanceof HTMLAnchorElement)) throw new Error("LastPlayed did not identify a stream row");
  const descriptionParts = String(saved.streamDescription || "").split(/\r?\n/)
    .map((value) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim())
    .filter((value) => value.length >= 12).slice(0, 2);
  const rowText = (anchor.textContent || "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return {
    playerRoute: new URL(anchor.href, location.href).hash,
    fingerprintMatches: descriptionParts.length > 0 && descriptionParts.every((part) => rowText.includes(part)),
  };
}, entry);

await resume.click();
await page.waitForFunction(
  (expected) => {
    try { return decodeURIComponent(location.hash) === decodeURIComponent(expected); }
    catch { return false; }
  },
  matched.playerRoute,
  { timeout: 20_000 },
);
const routeMatchesSelectedRow = true;

await page.waitForFunction(() => {
  const snapshot = window.JStremio.player.getSnapshot();
  return Boolean(snapshot && snapshot.durationMs && snapshot.durationMs > 0 && snapshot.positionMs !== null);
}, undefined, { timeout: 45_000 });
const firstPosition = await page.evaluate(() => window.JStremio.player.getSnapshot()?.positionMs ?? null);
await page.waitForFunction(
  (first) => {
    const snapshot = window.JStremio.player.getSnapshot();
    return Boolean(
      snapshot && snapshot.paused === false && snapshot.positionMs !== null &&
      typeof first === "number" && snapshot.positionMs >= first + 1_000
    );
  },
  firstPosition,
  { timeout: 20_000 },
);
const finalSnapshot = await page.evaluate(() => window.JStremio.player.getSnapshot());
await page.waitForTimeout(3_000);
const persistence = await page.evaluate(async ({ id, playerRoute }) => {
  const entries = await window.JStremio.bridge.request("last-played", "list");
  const saved = Array.isArray(entries) ? entries.find((item) => item?.id === id) : null;
  const target = await window.JStremio.stremio.getCurrentMediaTarget();
  const state = await window.JStremio.stremio.getPlayerState();
  const selectedRoute = state?.selected?.stream?.deepLinks?.player;
  const equalRoutes = (left, right) => {
    try { return decodeURIComponent(left) === decodeURIComponent(right); }
    catch { return false; }
  };
  return {
    targetMatches: target?.key === id,
    selectedRouteMatches: typeof selectedRoute === "string" && equalRoutes(selectedRoute, playerRoute),
    storedRouteMatches: typeof saved?.playerDeepLink === "string" && equalRoutes(saved.playerDeepLink, playerRoute),
  };
}, { id: entry.id, playerRoute: matched.playerRoute });
await page.evaluate(async () => {
  if (window.JStremio.player.getSnapshot()?.paused === false) await window.JStremio.player.setPaused(true);
});

const result = {
  entryId: entry.id,
  pluginVersion: "1.0.1",
  layout,
  fingerprintMatches: matched.fingerprintMatches,
  routeMatchesSelectedRow,
  usedRefreshedRoute: matched.playerRoute !== entry.playerDeepLink,
  persistence,
  nativeDurationKnown: Boolean(finalSnapshot?.durationMs && finalSnapshot.durationMs > 0),
  nativePlaybackAdvanced: Boolean(
    typeof firstPosition === "number" && finalSnapshot?.positionMs !== null &&
    typeof finalSnapshot?.positionMs === "number" && finalSnapshot.positionMs >= firstPosition + 1_000
  ),
};
console.log(JSON.stringify(result));
if (!layout.compact || !result.fingerprintMatches || !result.routeMatchesSelectedRow || !result.nativeDurationKnown || !result.nativePlaybackAdvanced || !persistence.storedRouteMatches) {
  throw new Error("LastPlayed live smoke did not satisfy every assertion");
}
await browser.close();
