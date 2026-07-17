import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const built = resolve(import.meta.dirname, "..", "..", "..", "resources", "extensions");

test.beforeEach(async ({ page }) => {
  await page.setContent(`
    <style>
      .nav-tab-button_fixture { display:flex;flex-direction:column;align-items:center;justify-content:center;width:64px;height:64px;background-color:transparent;border-radius:12px; }
      .nav-tab-button_fixture:hover { background-color:rgba(255,255,255,.08); }
      .nav-tab-button_fixture .icon_fixture { flex:none;width:35px;height:35px;margin-bottom:8px;color:rgb(186,184,198);opacity:.35; }
      .nav-tab-button_fixture .label_fixture { color:rgb(186,184,198);font-size:13px;opacity:0; }
      .nav-tab-button_fixture:hover .label_fixture { opacity:.6; }
    </style>
    <nav><a class="nav-tab-button_fixture nav-tab-button-container_fixture" href="#/library" title="Library"><svg class="icon_fixture" viewBox="0 0 24 24"></svg><div class="label_fixture">Library</div></a><a class="nav-tab-button_fixture nav-tab-button-container_fixture" href="#/calendar" title="Calendar"><svg class="icon_fixture" viewBox="0 0 24 24"></svg><div class="label_fixture">Calendar</div></a></nav>
    <main style="position:fixed;left:0;right:0;bottom:0"><div class="control-bar-container_fixture">
      <div class="seek-bar-container_fixture"><div>00:00</div><div class="slider-container_fixture" style="height:40px;width:100%">
        <div><div></div></div><div><div style="width:20%"></div></div>
        <div><div style="--mask-width:calc(0 * 100%)"></div></div>
        <div><div style="margin-left:calc(100% * 0)"></div></div>
      </div><div tabindex="-1"><div>01:40</div></div></div>
      <div class="control-bar-buttons-container_fixture">
        <div class="control-bar-button_fixture" title="Pause" tabindex="-1"></div>
        <div class="control-bar-button_fixture" title="Next video" tabindex="-1"></div>
        <div class="control-bar-button_fixture" title="Mute" tabindex="-1"></div>
      </div>
    </div></main>
  `);
  await page.evaluate(() => {
    location.hash = "#/player/stream/exact-fixture";
    const listeners = new Set<(event: MessageEvent) => void>();
    const reviews: Array<Record<string, unknown>> = [];
    const notes: Array<Record<string, unknown>> = [];
    const commands: Array<unknown[]> = [];
    const plugins = [
      { id: "plugin-manager", name: "Plugins", version: "1.0.0", description: "Manage plugins", author: "JStremio", builtIn: true, enabled: true, core: true, error: null },
      { id: "reviews", name: "Local Reviews", version: "1.1.0", description: "Private reviews", author: "JStremio", builtIn: true, enabled: true, core: false, error: null },
      { id: "timestamp-notes", name: "Timestamp Notes", version: "1.3.0", description: "Playback notes", author: "JStremio", builtIn: true, enabled: true, core: false, error: null },
      { id: "last-played", name: "LastPlayed", version: "1.0.0", description: "Exact stream resume", author: "JStremio", builtIn: true, enabled: true, core: false, error: null },
    ];
    const hotkeys: Record<string, string> = {};
    const shortcutKeys: string[] = [];
    const lastPlayed: Array<Record<string, unknown>> = [];
    let revision = 0;
    let thumbnailCounter = 0;
    const state = {
      selected: { streamRequest: { path: { id: "tt123" } }, stream: { name: "Fixture 1080p", description: "MediaFusion fixture", infoHash: "ABC123", fileIdx: 2, deepLinks: { player: "#/player/stream/exact-fixture" } } },
      addon: { manifest: { name: "MediaFusion" } },
      metaItem: { content: { id: "tt123", type: "movie", name: "Fixture Movie", videos: [] } },
      title: "Fixture Movie",
    };
    const emit = (value: unknown) => {
      for (const listener of listeners) listener(new MessageEvent("message", { data: value }));
    };
    const respond = (method: string, id: number, result: unknown, error?: unknown) => {
      queueMicrotask(() =>
        emit({
          args: [
            `${method}-response`,
            error
              ? { requestId: id, ok: false, error }
              : { requestId: id, ok: true, result },
          ],
        }),
      );
    };
    const postMessage = (message: string) => {
      const request = JSON.parse(message) as {
        id: number;
        args: [string, { operation?: string; payload?: Record<string, unknown> } | unknown[]];
      };
      const [method, params] = request.args;
      if (method === "mpv-set-prop") {
        commands.push(params as unknown[]);
        const [name, value] = params as unknown[];
        queueMicrotask(() => emit({ args: ["mpv-prop-change", { name, data: value }] }));
        return;
      }
      if (method === "mpv-command") {
        commands.push(params as unknown[]);
        return;
      }
      if (!method.startsWith("jstremio-") || Array.isArray(params)) return;
      const operation = params.operation ?? "";
      const payload = params.payload ?? {};
      if (method === "jstremio-plugins") {
        if (operation === "list") return respond(method, request.id, plugins);
        if (operation === "getHotkeys") return respond(method, request.id, hotkeys);
        if (operation === "setHotkey") {
          if (typeof payload.hotkey === "string") hotkeys[String(payload.id)] = payload.hotkey;
          else delete hotkeys[String(payload.id)];
          return respond(method, request.id, { id: payload.id, hotkey: payload.hotkey ?? null, restartRequired: false });
        }
        if (operation === "setEnabled") {
          const plugin = plugins.find((item) => item.id === payload.id);
          if (plugin) plugin.enabled = payload.enabled === true;
          return respond(method, request.id, { enabled: payload.enabled, restartRequired: true });
        }
        return respond(method, request.id, { opened: true });
      }
      if (method === "jstremio-reviews") {
        if (operation === "list") return respond(method, request.id, reviews);
        if (operation === "get") return respond(method, request.id, reviews.find((item) => item.id === payload.id) ?? null);
        if (operation === "upsert") {
          const id = `${payload.mediaType}:${payload.videoId}`;
          const existing = reviews.find((item) => item.id === id);
          const now = new Date().toISOString();
          const review = { ...payload, id, createdAt: existing?.createdAt ?? now, updatedAt: now };
          if (existing) Object.assign(existing, review);
          else reviews.push(review);
          revision += 1;
          return respond(method, request.id, review);
        }
        if (operation === "delete") {
          const index = reviews.findIndex((item) => item.id === payload.id);
          if (index >= 0) reviews.splice(index, 1);
          return respond(method, request.id, { deleted: index >= 0 });
        }
        return respond(method, request.id, { status: "ok", revision });
      }
      if (method === "jstremio-last-played") {
        if (operation === "list") return respond(method, request.id, lastPlayed);
        if (operation === "get") return respond(method, request.id, lastPlayed.find((item) => item.id === payload.id) ?? null);
        if (operation === "upsert") {
          const id = `${payload.mediaType}:${payload.videoId}`;
          const entry = { ...payload, id, key:id, updatedAt:new Date().toISOString() };
          const existing = lastPlayed.find((item) => item.id === id);
          if (existing) Object.assign(existing,entry); else lastPlayed.push(entry);
          return respond(method,request.id,entry);
        }
      }
      if (operation === "listAll") return respond(method, request.id, notes);
      if (operation === "listForMedia") return respond(method, request.id, notes.filter((item) => item.mediaKey === payload.mediaKey));
      if (operation === "prepareFrameCapture") {
        thumbnailCounter += 1;
        const thumbnailId = `11111111-1111-4111-8111-${String(thumbnailCounter).padStart(12, "0")}`;
        return respond(method, request.id, { thumbnailId, path: `C:\\fixture\\${thumbnailId}.jpg` });
      }
      if (operation === "completeFrameCapture") return respond(method, request.id, { thumbnailId: payload.thumbnailId, ready: true });
      if (operation === "getThumbnail") return respond(method, request.id, { dataUrl: "data:image/jpeg;base64,/9j/2Q==" });
      if (operation === "get") return respond(method, request.id, notes.find((item) => item.id === payload.id) ?? null);
      if (operation === "create") {
        const now = new Date().toISOString();
        const note = {
          ...payload,
          id: `00000000-0000-4000-8000-${String(notes.length + 1).padStart(12, "0")}`,
          mediaKey: `${payload.mediaType}:${payload.videoId}`,
          createdAt: now,
          updatedAt: now,
        };
        notes.push(note);
        revision += 1;
        return respond(method, request.id, note);
      }
      if (operation === "update") {
        const note = notes.find((item) => item.id === payload.id);
        if (note) Object.assign(note, payload, { updatedAt: new Date().toISOString() });
        return respond(method, request.id, note ?? null);
      }
      if (operation === "delete") {
        const index = notes.findIndex((item) => item.id === payload.id);
        if (index >= 0) notes.splice(index, 1);
        return respond(method, request.id, { deleted: index >= 0 });
      }
      respond(method, request.id, { status: "ok", revision });
    };
    Object.assign(window, {
      core: { getState: () => state },
      chrome: {
        webview: {
          postMessage,
          addEventListener: (_type: "message", listener: (event: MessageEvent) => void) => listeners.add(listener),
          removeEventListener: (_type: "message", listener: (event: MessageEvent) => void) => listeners.delete(listener),
        },
      },
      __fixture: {
        reviews,
        notes,
        commands,
        plugins,
        hotkeys,
        shortcutKeys,
        lastPlayed,
        state,
        emitMpv: (name: string, data: unknown) => emit({ args: ["mpv-prop-change", { name, data }] }),
        emitShell: (name: string, data: unknown) => emit(JSON.stringify({ id: 0, type: 1, args: [name, data] })),
      },
    });
    window.confirm = () => {
      throw new Error("WebView2 default script dialogs are disabled");
    };
    document.addEventListener("keydown", (event) => shortcutKeys.push(event.key));
  });
  await page.addScriptTag({ path: resolve(built, "runtime.js") });
  await page.addScriptTag({ path: resolve(built, "plugin-manager", "index.js") });
  await page.addScriptTag({ path: resolve(built, "reviews", "index.js") });
  await page.addScriptTag({ path: resolve(built, "timestamp-notes", "index.js") });
  await page.addScriptTag({ path: resolve(built, "last-played", "index.js") });
});

test("mounts each extension once and remounts after upstream replacement", async ({ page }) => {
  await expect(page.locator('[data-jstremio-testid="plugin-manager-navigation"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="reviews-navigation"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="timestamp-notes-navigation"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="reviews-player-button"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="timestamp-notes-player-button"]')).toHaveCount(1);
  const playerActions = page.locator('[data-jstremio-click-only]');
  await expect(playerActions).toHaveCount(2);
  for (const action of await playerActions.all()) {
    await expect(action).toHaveAttribute("tabindex", "-1");
    await expect.poll(() => action.evaluate((element) => {
      (element as HTMLElement).focus();
      return document.activeElement === element;
    })).toBe(false);
  }
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await playerActions.first().evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator('[data-jstremio-testid="dialog"]')).toHaveCount(0);
  const pluginNavigation = page.locator('[data-jstremio-testid="plugin-manager-navigation"]');
  await expect(pluginNavigation).toHaveAttribute("title", "Plugins");
  await pluginNavigation.click();
  await expect(page.locator(".plugin-card")).toHaveCount(4);
  await expect(page.getByLabel("Disable Plugins")).toBeDisabled();
  await page.getByLabel("Disable Local Reviews").uncheck();
  await expect(page.getByText("Plugin changes were saved. Fully restart JStremio to apply them.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Restart JStremio" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.plugins.find((plugin: any) => plugin.id === "reviews").enabled)).toBe(false);
  await page.getByRole("button", { name: "Close Plugins" }).click();
  await expect(page.locator('[data-jstremio-testid="reviews-player-button"]')).toHaveClass(/control-bar-button_fixture/);
  await expect(page.locator('[data-jstremio-testid="reviews-player-button"]').locator("..")).toHaveAttribute("data-jstremio-control", "player-dock");
  const officialNavigation = page.locator('a[href="#/library"]');
  const reviewsNavigation = page.locator('[data-jstremio-testid="reviews-navigation"]');
  const officialIcon = officialNavigation.locator("svg");
  const reviewsIcon = reviewsNavigation.locator("svg");
  const reviewsLabel = reviewsNavigation.locator('[data-jstremio-navigation-label]');
  await expect(reviewsNavigation).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(reviewsIcon).toHaveCSS("color", "rgb(186, 184, 198)");
  await expect(reviewsIcon).toHaveCSS("opacity", "0.35");
  await expect(reviewsLabel).toHaveCSS("opacity", "0");
  await expect.poll(async () => {
    const official = await officialNavigation.boundingBox();
    const custom = await reviewsNavigation.boundingBox();
    if (!official || !custom) return 99;
    return Math.max(Math.abs(official.width - custom.width), Math.abs(official.height - custom.height));
  }).toBeLessThan(0.5);
  await expect.poll(async () => {
    const official = await officialIcon.boundingBox();
    const custom = await reviewsIcon.boundingBox();
    return { width: custom?.width, height: custom?.height, officialWidth: official?.width, officialHeight: official?.height };
  }).toEqual({ width: 35, height: 35, officialWidth: 35, officialHeight: 35 });
  await reviewsNavigation.hover();
  await expect(reviewsLabel).toHaveCSS("opacity", "0.6");

  await page.evaluate(() => {
    document.querySelector("nav")!.outerHTML = '<nav><a class="nav-tab-button_fixture nav-tab-button-container_fixture" href="#/library" title="Library"><svg class="icon_fixture" viewBox="0 0 24 24"></svg><div class="label_fixture">Library</div></a><a class="nav-tab-button_fixture nav-tab-button-container_fixture" href="#/calendar" title="Calendar"><svg class="icon_fixture" viewBox="0 0 24 24"></svg><div class="label_fixture">Calendar</div></a></nav>';
    document.querySelector(".control-bar-buttons-container_fixture")!.outerHTML = '<div class="control-bar-buttons-container_fixture"><div class="control-bar-button_fixture" title="Pause" tabindex="-1"></div><div class="control-bar-button_fixture" title="Next video" tabindex="-1"></div><div class="control-bar-button_fixture" title="Mute" tabindex="-1"></div></div>';
  });
  await expect(page.locator('[data-jstremio-testid="reviews-navigation"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="timestamp-notes-navigation"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="reviews-player-button"]')).toHaveCount(1);

  const dock = page.locator('[data-jstremio-testid="player-extension-dock"]');
  await page.evaluate(() => document.querySelector("main")?.classList.add("overlayHidden_fixture"));
  await expect(dock).toHaveCSS("opacity", "0");
  await expect(dock).toHaveCSS("pointer-events", "auto");
  await dock.hover();
  await expect(dock).toHaveCSS("opacity", "1");
  await page.mouse.move(5, 5);
  await expect(dock).toHaveCSS("opacity", "0");
  await page.evaluate(() => document.querySelector("main")?.classList.remove("overlayHidden_fixture"));

  await page.evaluate(() => {
    location.hash = "#/library";
  });
  await expect(page.locator('[data-jstremio-testid="reviews-player-button"]')).toHaveCount(0);
  await expect(page.locator('[data-jstremio-testid="timestamp-notes-player-button"]')).toHaveCount(0);

  await page.evaluate(() => {
    location.hash = "#/player/movie/tt123";
  });
  await expect(page.locator('[data-jstremio-testid="reviews-player-button"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="timestamp-notes-player-button"]')).toHaveCount(1);
});

test("records persistent plugin hotkeys and opens the matching player dialogs", async ({ page }) => {
  await page.locator('[data-jstremio-testid="plugin-manager-navigation"]').click();
  await expect(page.getByRole("button", { name: /^Settings for / })).toHaveCount(2);
  await expect(page.locator(".plugin-card").filter({ hasText: "LastPlayed" }).getByRole("button", { name: /Settings/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Settings for Local Reviews" }).click();
  const reviewInput = page.getByLabel("Hotkey for Local Reviews");
  await reviewInput.click();
  await page.keyboard.press("Control+Shift+R");
  await expect(reviewInput).toHaveValue("Ctrl + Shift + R");
  await page.getByRole("dialog", { name: "Local Reviews settings" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Hotkey: Ctrl + Shift + R")).toBeVisible();

  await page.getByRole("button", { name: "Settings for Timestamp Notes" }).click();
  const timestampInput = page.getByLabel("Hotkey for Timestamp Notes");
  await timestampInput.click();
  await page.keyboard.press("Control+Shift+R");
  await expect(page.getByText("That hotkey is already assigned to Local Reviews.")).toBeVisible();
  await page.keyboard.press("Control+Alt+N");
  await expect(timestampInput).toHaveValue("Ctrl + Alt + N");
  await page.getByRole("dialog", { name: "Timestamp Notes settings" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Hotkey: Ctrl + Alt + N")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.hotkeys)).toEqual({
    reviews: "Ctrl+Shift+KeyR",
    "timestamp-notes": "Ctrl+Alt+KeyN",
  });
  await page.getByRole("button", { name: "Close Plugins" }).click();
  await page.waitForTimeout(50);

  await page.evaluate(() => {
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Official search fixture");
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press("Control+Shift+R");
  await expect(page.getByRole("dialog", { name: "Add review" })).toHaveCount(0);
  await page.getByLabel("Official search fixture").evaluate((element) => element.remove());

  await page.keyboard.press("Control+Shift+R");
  await expect(page.getByRole("dialog", { name: "Add review" })).toBeVisible();
  await page.getByRole("dialog", { name: "Add review" }).getByRole("button", { name: "Cancel" }).click();

  await emitPlayback(page, 18, 100, false);
  await expect(page.locator('[data-jstremio-testid="timestamp-notes-player-button"]')).toBeEnabled();
  await page.keyboard.press("Control+Alt+N");
  await expect(page.getByRole("dialog", { name: "Add timestamp note" })).toBeVisible();
  await page.getByRole("dialog", { name: "Add timestamp note" }).getByRole("button", { name: "Cancel" }).click();
});

test("LastPlayed resumes and promotes the exact previously selected stream", async ({ page }) => {
  await emitPlayback(page, 12, 100, false);
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.lastPlayed.length)).toBe(1);
  await page.evaluate(() => {
    const fixture = (window as any).__fixture;
    fixture.state.selected.stream = {
      name: "Browsed but not played",
      description: "This stream must not replace active playback history",
      url: "https://media.invalid/browsed-only.m3u8",
      deepLinks: { player: "#/player/stream/browsed-only" },
    };
    location.hash="#/detail/movie/tt123/tt123";
    document.querySelector("main")!.insertAdjacentHTML("afterbegin", `
      <div class="detail-player-decoy"><a href="#/player/stream/exact-fixture">Unrelated player link</a></div>
      <section><h2>Continue watching</h2><article class="continue-card"><a href="#/detail/movie/tt123/tt123"><img alt="Fixture Movie"></a></article></section>
      <aside class="streams-panel"><div class="streams-list"><div class="streams-container">
        <a class="stream-row" href="#/player/stream/other">Other stream</a>
        <a class="stream-row exact" href="#/player/stream/refreshed-fixture">MediaFusion fixture</a>
      </div></div></aside>`);
  });
  await page.waitForTimeout(200);
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.lastPlayed[0].playerDeepLink)).toBe("#/player/stream/exact-fixture");
  await expect(page.getByRole("button", { name: /Resume last played Fixture Movie/ })).toBeVisible();
  await expect(page.locator("[data-jstremio-last-played-badge]")).toHaveText("Last played");
  await expect(page.locator(".streams-container > :first-child")).toHaveClass(/exact/);
  const resume = page.locator("[data-jstremio-last-played-resume]");
  await expect(resume).toContainText("MediaFusion");
  await expect(resume.locator("xpath=ancestor::aside[contains(@class,'streams-panel')]")).toHaveCount(1);
  await resume.click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/player/stream/refreshed-fixture");
  await page.evaluate(() => {
    (window as any).__fixture.state.selected.stream = {
      name: "Fixture 1080p",
      description: "MediaFusion fixture",
      infoHash: "ABC123",
      fileIdx: 2,
      deepLinks: { player: "#/player/stream/exact-fixture" },
    };
  });
  await emitPlayback(page, 20, 100, false);
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.lastPlayed[0].playerDeepLink)).toBe("#/player/stream/refreshed-fixture");
});

test("creates and manages a private review without network leakage", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(`${request.url()} ${request.postData() ?? ""}`));
  await page.locator('[data-jstremio-testid="reviews-player-button"]').click();
  await page.getByRole("radio", { name: "5 stars" }).check();
  await page.getByLabel("Private review").click();
  await page.keyboard.type("local-only-review-sentinel");
  await expect(page.getByLabel("Private review")).toHaveValue("local-only-review-sentinel");
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.shortcutKeys)).toEqual([]);
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.reviews.length)).toBe(1);

  await page.evaluate(() => {
    const reviews = (window as any).__fixture.reviews;
    const base = {
      metaId: "tt2741602",
      mediaType: "series",
      name: "The Blacklist",
      poster: null,
      rating: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    reviews.push(
      { ...base, id: "series:tt2741602:1:1", videoId: "tt2741602:1:1", title: "Pilot", season: 1, episode: 1, text: "pilot review" },
      { ...base, id: "series:tt2741602:1:2", videoId: "tt2741602:1:2", title: "The Freelancer", season: 1, episode: 2, text: "freelancer review" },
    );
  });

  await page.locator('[data-jstremio-testid="reviews-navigation"]').click();
  await expect(page.locator(".collection-card")).toHaveCount(2);
  await expect(page.getByText("The Blacklist", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Open The Blacklist, 2 reviews" }).click();
  await expect(page.locator(".review-card")).toHaveCount(2);
  await expect(page.getByText("Pilot", { exact: true })).toBeVisible();
  await expect(page.getByText("The Freelancer", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "← Back to titles" }).click();
  await page.getByRole("button", { name: "Open Fixture Movie, 1 review" }).click();
  await expect(page.getByText("local-only-review-sentinel")).toBeVisible();
  const closeReviews = page.getByRole("button", { name: "Close Reviews" });
  await expect.poll(async () => {
    const button = await closeReviews.boundingBox();
    const icon = await closeReviews.locator("svg").boundingBox();
    if (!button || !icon) return 99;
    return Math.max(
      Math.abs(button.x + button.width / 2 - (icon.x + icon.width / 2)),
      Math.abs(button.y + button.height / 2 - (icon.y + icon.height / 2)),
    );
  }).toBeLessThan(0.6);
  expect(requests.join("\n")).not.toContain("local-only-review-sentinel");
});

test("captures, pauses conditionally, clusters markers, and seeks without blocking the slider", async ({ page }) => {
  await emitPlayback(page, 12.345, 100, false);
  const addButton = page.locator('[data-jstremio-testid="timestamp-notes-player-button"]');
  await expect(addButton).toBeEnabled();
  await addButton.click();
  await expect(page.getByText("00:12", { exact: true })).toBeVisible();
  await page.getByLabel("Note (required)").click();
  await page.keyboard.type("first marker note");
  await expect(page.getByLabel("Note (required)")).toHaveValue("first marker note");
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.shortcutKeys)).toEqual([]);
  await page.getByLabel("Marker color").fill("#ff3366");
  await page.getByLabel("Rating (optional)").selectOption("5");
  await page.getByLabel("Save a thumbnail of this video frame").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.notes.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => ({
    color: (window as any).__fixture.notes[0].color,
    rating: (window as any).__fixture.notes[0].rating,
    thumbnailId: (window as any).__fixture.notes[0].thumbnailId,
  }))).toEqual({ color: "#FF3366", rating: 5, thumbnailId: "11111111-1111-4111-8111-000000000001" });
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).__fixture.commands))).toContain("screenshot-to-file");

  await emitPlayback(page, 12.7, 100, false);
  await addButton.click();
  await page.getByLabel("Note (required)").fill("nearby marker note");
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.notes.length)).toBe(2);

  const marker = page.locator(".jstremio-marker.cluster");
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAccessibleName(/2 notes/);
  await expect.poll(() =>
    marker.evaluate((element) => getComputedStyle(element, "::before").width),
  ).toBe("11px");
  const layer = page.locator('[data-jstremio-testid="timestamp-note-markers"]');
  await expect(layer).toHaveCSS("pointer-events", "none");
  await expect(layer.locator("..")).toHaveJSProperty("tagName", "BODY");
  await expect.poll(() => layer.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(0);

  await marker.hover();
  await expect(page.locator(".marker-popover")).toHaveCount(1);
  await expect(page.locator(".marker-note")).toHaveCount(2);
  await expect(page.locator(".marker-thumbnail")).toHaveCount(1);
  await expect.poll(() =>
    marker.evaluate((element) => getComputedStyle(element, "::before").transform),
  ).not.toBe("none");
  await expect.poll(async () => {
    const popoverBounds = await page.locator(".marker-popover").boundingBox();
    const viewport = page.viewportSize();
    if (!popoverBounds || !viewport) return -999;
    return Math.min(popoverBounds.x, viewport.width - popoverBounds.x - popoverBounds.width);
  }).toBeGreaterThanOrEqual(9);
  await page.mouse.click(5, 5);
  await expect(page.locator(".marker-popover")).toHaveCount(0);

  // Native shell fullscreen can move a paused control bar without changing the
  // seek element's own size. Its visibility signal must realign the body-owned
  // layer without waiting for another MPV time-pos event.
  await emitPlayback(page, 12.7, 100, true);
  await page.evaluate(() => {
    const seek = document.querySelector<HTMLElement>(".slider-container_fixture")!;
    seek.style.transform = "translateY(-72px)";
    (window as any).__fixture.emitShell("win-visibility-changed", { fullscreen: true, visible: true });
  });
  await expect.poll(async () => {
    const markerBounds = await layer.boundingBox();
    const seekBounds = await page.locator(".slider-container_fixture").boundingBox();
    return markerBounds && seekBounds ? Math.abs(markerBounds.y - seekBounds.y) : 999;
  }).toBeLessThan(0.5);

  await marker.click();
  const firstItem = page.locator(".marker-note").filter({ hasText: "first marker note" });
  await expect(firstItem.getByLabel("5 out of 5 stars")).toBeVisible();
  await firstItem.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Replace the saved thumbnail with this video frame").check();
  await page.getByLabel("Marker color").fill("#22aa44");
  await page.getByLabel("Rating (optional)").selectOption("3");
  await page.getByRole("button", { name: "Update" }).click();
  await expect.poll(() => page.evaluate(() => ({
    color: (window as any).__fixture.notes[0].color,
    rating: (window as any).__fixture.notes[0].rating,
    thumbnailId: (window as any).__fixture.notes[0].thumbnailId,
  }))).toEqual({ color: "#22AA44", rating: 3, thumbnailId: "11111111-1111-4111-8111-000000000002" });
  await expect.poll(() => marker.evaluate((element) => element.style.getPropertyValue("--marker-fill"))).toContain("#22AA44");

  await marker.click();
  await expect(page.locator(".marker-popover")).toHaveCount(1);
  await expect(page.locator(".marker-popover")).toHaveAttribute("data-sticky", "true");
  const pinnedPosition = await page.locator(".marker-popover").boundingBox();
  await page.mouse.move(700, 300);
  expect(await page.locator(".marker-popover").boundingBox()).toEqual(pinnedPosition);
  await marker.hover();
  await expect(page.locator(".marker-popover")).toHaveAttribute("data-sticky", "true");
  await page.mouse.click(5, 5);
  await expect(page.locator(".marker-popover")).toHaveCount(0);

  await marker.click();
  const closePopover = page.getByRole("button", { name: "Close timestamp notes" });
  await expect(closePopover).toBeFocused();
  await expect.poll(async () => {
    const button = await closePopover.boundingBox();
    const icon = await closePopover.locator("svg").boundingBox();
    if (!button || !icon) return 99;
    const x = Math.abs((button.x + button.width / 2) - (icon.x + icon.width / 2));
    const y = Math.abs((button.y + button.height / 2) - (icon.y + icon.height / 2));
    return Math.max(x, y);
  }).toBeLessThan(0.6);
  await page.keyboard.press("Escape");
  await expect(page.locator(".marker-popover")).toHaveCount(0);

  await marker.click();
  await page.getByRole("button", { name: "Close timestamp notes" }).click();
  await expect(page.locator(".marker-popover")).toHaveCount(0);

  await marker.click();
  await page.evaluate(() => document.querySelector("main")?.classList.add("overlayHidden_fixture"));
  await emitPlayback(page, 13, 100, false);
  await expect(layer).toHaveCSS("visibility", "hidden");
  await expect(page.locator(".marker-popover")).toHaveCount(0);
  await page.evaluate(() => document.querySelector("main")?.classList.remove("overlayHidden_fixture"));
  await expect(layer).toHaveCSS("visibility", "visible");

  await marker.click();
  await page.getByRole("button", { name: /first marker note/ }).click();
  await expect(page.locator(".marker-popover")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as any).__fixture.commands))).toContain("time-pos");

  await marker.click();
  await page.locator(".marker-note").filter({ hasText: "nearby marker note" }).getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.notes.length)).toBe(1);
  await emitPlayback(page, 50, 100, false);
  const singleMarker = page.locator(".jstremio-marker:not(.cluster)");
  await expect(singleMarker).toHaveCount(1);
  await singleMarker.hover();
  await expect(page.locator(".marker-popover")).toHaveCount(1);
  await expect(page.locator(".marker-note")).toHaveCount(1);
  await expect(page.locator(".marker-popover")).toHaveAttribute("data-sticky", "false");

  await page.mouse.click(5, 5);
  await page.evaluate(() => {
    const notes = (window as any).__fixture.notes;
    const base = {
      metaId: "tt2741602",
      mediaType: "series",
      name: "The Blacklist",
      poster: null,
      durationMsAtCreation: 2_700_000,
      color: "#56E0CF",
      rating: null,
      thumbnailId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    notes.push(
      { ...base, id: "22222222-2222-4222-8222-000000000001", mediaKey: "series:tt2741602:1:1", videoId: "tt2741602:1:1", title: "Pilot", season: 1, episode: 1, timestampMs: 30_000, text: "pilot timestamp" },
      { ...base, id: "22222222-2222-4222-8222-000000000002", mediaKey: "series:tt2741602:1:2", videoId: "tt2741602:1:2", title: "The Freelancer", season: 1, episode: 2, timestampMs: 45_000, text: "freelancer timestamp" },
    );
  });
  await page.locator('[data-jstremio-testid="timestamp-notes-navigation"]').click();
  await expect(page.locator(".collection-card")).toHaveCount(2);
  await expect(page.getByText("The Blacklist", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Open The Blacklist, 2 timestamp notes" }).click();
  await expect(page.getByText("Pilot", { exact: true })).toBeVisible();
  await expect(page.getByText("The Freelancer", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "← Back to titles" }).click();
  await page.getByRole("button", { name: "Open Fixture Movie, 1 timestamp note" }).click();
  await expect(page.locator(".note-thumbnail")).toHaveCount(1);
  const thumbnailButton = page.getByRole("button", { name: /Enlarge video frame/ });
  await expect.poll(() => thumbnailButton.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(200);
  await thumbnailButton.click();
  const enlarged = page.getByRole("dialog", { name: /Video frame at/ }).locator("img");
  await expect(enlarged).toBeVisible();
  await expect.poll(() => enlarged.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(300);
  await page.getByRole("button", { name: "Close enlarged thumbnail" }).click();

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog", { name: "Update timestamp note" }).getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.notes.length)).toBe(2);
  await expect(page.locator(".collection-card")).toHaveCount(1);

  const pauseCommands = await page.evaluate(() =>
    (window as any).__fixture.commands.filter((command: unknown[]) => command[0] === "pause"),
  );
  expect(pauseCommands.some((command: unknown[]) => command[1] === true)).toBe(true);
  expect(pauseCommands.some((command: unknown[]) => command[1] === false)).toBe(true);
});

async function emitPlayback(page: Page, positionSeconds: number, durationSeconds: number, paused: boolean) {
  await page.evaluate(
    ({ positionSeconds, durationSeconds, paused }) => {
      const fixture = (window as any).__fixture;
      fixture.emitMpv("duration", durationSeconds);
      fixture.emitMpv("time-pos", positionSeconds);
      fixture.emitMpv("pause", paused);
      fixture.emitMpv("seeking", false);
    },
    { positionSeconds, durationSeconds, paused },
  );
}
