import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const built = resolve(import.meta.dirname, "..", "..", "..", "resources", "extensions");

test("adds exact LastPlayed actions and metadata to played movie and series cards only", async ({ page }) => {
  await page.setContent(`
    <style>
      * { overflow: hidden; }
      body { margin: 30px; background: #0e1026; color: white; font-family: sans-serif; }
      .row { display: flex; gap: 24px; }
      article { width: 180px; }
      article > a, .row > a { display: block; width: 180px; height: 260px; }
      .poster-container { position: relative; height: 100%; }
      article img { display: block; width: 100%; height: 100%; background: #25284c; }
    </style>
    <nav id="nav"><a href="#/detail/series/tt2741602">The Blacklist navigation</a></nav>
    <p id="detail-text"><a href="#/detail/series/tt2741602">Text-only details link</a></p>
    <p id="stream-text"><a href="#/player/series/tt2741602/exact">Stream link containing the same ID</a></p>
    <section class="row">
      <article id="series-card"><a href="#/detail/series/tt2741602"><img alt="The Blacklist poster"></a></article>
      <a id="direct-series-card" href="#/detail/series/tt2741602"><div class="poster-container"><img alt="Direct Stremio-style poster"></div></a>
      <article id="episode-card"><a href="#/detail/series/tt2741602/tt2741602%3A4%3A8"><img alt="Older episode poster"></a></article>
      <article id="movie-card"><a href="#/detail/movie/tt123/tt123"><img alt="Fixture Movie poster"></a></article>
      <article id="unplayed-card"><a href="#/detail/movie/tt999"><img alt="Unplayed poster"></a></article>
    </section>`);

  await page.evaluate(() => {
    location.hash = "#/home";
    const entries = [
      {
        id: "series:tt2741602:4:8", key: "series:tt2741602:4:8", playerDeepLink: "#/player/series/old-exact",
        streamKey: "torrent:old:0", videoId: "tt2741602:4:8", metaId: "tt2741602", mediaType: "series",
        name: "The Blacklist", title: "The Troll Farmer", season: 4, episode: 8, poster: null,
        addonName: "Torrentio RD", streamName: "[RD+] Torrentio 720p", streamDescription: "Older exact stream",
        positionMs: 60_000, updatedAt: "2026-07-10T10:00:00.000Z",
      },
      {
        id: "series:tt2741602:5:18", key: "series:tt2741602:5:18", playerDeepLink: "#/player/series/newest-exact",
        streamKey: "torrent:new:0", videoId: "tt2741602:5:18", metaId: "tt2741602", mediaType: "series",
        name: "The Blacklist", title: "Zarak Mosadek", season: 5, episode: 18, poster: null,
        addonName: "Torrentio RD", streamName: "[RD+] Torrentio 1080p",
        streamDescription: "The.Blacklist.S05E18.1080p\n👤 16 seeders · 💾 855.3 MB\nFull saved provider description",
        positionMs: 754_000, updatedAt: "2026-07-17T15:30:00.000Z",
      },
      {
        id: "movie:tt123", key: "movie:tt123", playerDeepLink: "#/player/movie/exact",
        streamKey: "url:movie", videoId: "tt123", metaId: "tt123", mediaType: "movie",
        name: "Fixture Movie", title: "Fixture Movie", season: null, episode: null, poster: null,
        addonName: "MediaFusion", streamName: "4K HDR", streamDescription: "Movie provider details",
        positionMs: 3_754_000, updatedAt: "2026-07-16T15:30:00.000Z",
      },
    ];
    const listeners = new Set<(event: MessageEvent) => void>();
    const emit = (value: unknown) => {
      for (const listener of listeners) listener(new MessageEvent("message", { data: value }));
    };
    const postMessage = (message: string) => {
      const request = JSON.parse(message) as { id: number; args: [string, { operation?: string }] };
      const [method, params] = request.args;
      if (method !== "jstremio-last-played" || params.operation !== "list") return;
      queueMicrotask(() => emit({ args: [`${method}-response`, { requestId: request.id, ok: true, result: entries }] }));
    };
    Object.assign(window, {
      core: { getState: () => ({}) },
      chrome: { webview: {
        postMessage,
        addEventListener: (_type: "message", listener: (event: MessageEvent) => void) => listeners.add(listener),
        removeEventListener: (_type: "message", listener: (event: MessageEvent) => void) => listeners.delete(listener),
      } },
    });
  });

  await page.addScriptTag({ path: resolve(built, "runtime.js") });
  await page.addScriptTag({ path: resolve(built, "last-played", "index.js") });

  await expect(page.locator("[data-jstremio-last-played-card]")).toHaveCount(4);
  await expect(page.locator("#series-card [data-jstremio-last-played-card]")).toHaveCount(1);
  await expect(page.locator("#direct-series-card > .poster-container > [data-jstremio-last-played-card]")).toHaveCount(1);
  await expect.poll(async () => (await page.locator("#direct-series-card [data-jstremio-last-played-card]").boundingBox())?.width ?? 0).toBeLessThanOrEqual(180);
  await expect(page.locator("#episode-card [data-jstremio-last-played-card]")).toHaveCount(1);
  await expect(page.locator("#movie-card [data-jstremio-last-played-card]")).toHaveCount(1);
  await expect(page.locator("#nav [data-jstremio-last-played-card],#detail-text [data-jstremio-last-played-card],#stream-text [data-jstremio-last-played-card],#unplayed-card [data-jstremio-last-played-card]")).toHaveCount(0);

  const newestAction = page.locator("#series-card .jstremio-last-played-button");
  await page.locator("#series-card").hover();
  await newestAction.hover();
  const details = page.locator("body > [role=tooltip][data-open]").filter({ hasText: "Zarak Mosadek" });
  await expect(details).toBeVisible();
  await expect.poll(async () => (await details.boundingBox())?.width ?? 0).toBeGreaterThan(180);
  await expect(details).toContainText("The Blacklist — S05E18 · Zarak Mosadek");
  await expect(details).toContainText("Provider · Torrentio RD");
  await expect(details).toContainText("Stream · [RD+] Torrentio 1080p");
  await expect(details).toContainText("👤 16 seeders · 💾 855.3 MB");
  await expect(details).toContainText("Full saved provider description");
  await expect(details).toContainText("Resume at 12:34");
  await expect(details).toContainText("Saved");

  // Stremio can replace a hovered poster subtree while applying its own hover
  // state. The LastPlayed intent and body-level tooltip must survive that render.
  await page.locator("#series-card").evaluate((card) => {
    card.innerHTML = '<a href="#/detail/series/tt2741602"><img alt="The Blacklist replacement poster"></a>';
  });
  await expect(page.locator("#series-card .jstremio-last-played-button")).toBeVisible();
  await expect(details).toBeVisible();

  await page.locator("#series-card .jstremio-last-played-button").click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/player/series/newest-exact");
});
