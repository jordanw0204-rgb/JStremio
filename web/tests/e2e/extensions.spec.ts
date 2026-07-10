import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const built = resolve(import.meta.dirname, "..", "..", "..", "resources", "extensions");

test.beforeEach(async ({ page }) => {
  await page.setContent(`
    <nav><a href="#/library">Library</a><a href="#/calendar">Calendar</a></nav>
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
    location.hash = "#/player/movie/tt123";
    const listeners = new Set<(event: MessageEvent) => void>();
    const reviews: Array<Record<string, unknown>> = [];
    const notes: Array<Record<string, unknown>> = [];
    const commands: Array<unknown[]> = [];
    let revision = 0;
    const state = {
      selected: { streamRequest: { path: { id: "tt123" } } },
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
      if (!method.startsWith("jstremio-") || Array.isArray(params)) return;
      const operation = params.operation ?? "";
      const payload = params.payload ?? {};
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
      if (operation === "listAll") return respond(method, request.id, notes);
      if (operation === "listForMedia") return respond(method, request.id, notes.filter((item) => item.mediaKey === payload.mediaKey));
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
        emitMpv: (name: string, data: unknown) => emit({ args: ["mpv-prop-change", { name, data }] }),
      },
    });
  });
  await page.addScriptTag({ path: resolve(built, "runtime.js") });
  await page.addScriptTag({ path: resolve(built, "reviews", "index.js") });
  await page.addScriptTag({ path: resolve(built, "timestamp-notes", "index.js") });
});

test("mounts each extension once and remounts after upstream replacement", async ({ page }) => {
  await expect(page.locator('[data-jstremio-testid="reviews-navigation"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="timestamp-notes-navigation"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="reviews-player-button"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="timestamp-notes-player-button"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="reviews-player-button"]')).toHaveClass(/control-bar-button_fixture/);
  await expect(page.locator('[data-jstremio-testid="reviews-player-button"]').locator("..")).toHaveAttribute("data-jstremio-control", "player-dock");

  await page.evaluate(() => {
    document.querySelector("nav")!.outerHTML = '<nav><a href="#/library">Library</a><a href="#/calendar">Calendar</a></nav>';
    document.querySelector(".control-bar-buttons-container_fixture")!.outerHTML = '<div class="control-bar-buttons-container_fixture"><div class="control-bar-button_fixture" title="Pause" tabindex="-1"></div><div class="control-bar-button_fixture" title="Next video" tabindex="-1"></div><div class="control-bar-button_fixture" title="Mute" tabindex="-1"></div></div>';
  });
  await expect(page.locator('[data-jstremio-testid="reviews-navigation"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="timestamp-notes-navigation"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="reviews-player-button"]')).toHaveCount(1);

  const dock = page.locator('[data-jstremio-testid="player-extension-dock"]');
  await page.evaluate(() => document.querySelector("main")?.classList.add("overlayHidden_fixture"));
  await expect(dock).toHaveCSS("opacity", "0.16");
  await expect(dock).toHaveCSS("pointer-events", "auto");
  await dock.hover();
  await expect(dock).toHaveCSS("opacity", "1");
  await page.mouse.move(5, 5);
  await expect(dock).toHaveCSS("opacity", "0.16");
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

test("creates and manages a private review without network leakage", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(`${request.url()} ${request.postData() ?? ""}`));
  await page.locator('[data-jstremio-testid="reviews-player-button"]').click();
  await page.getByRole("radio", { name: "5 stars" }).check();
  await page.getByLabel("Private review").fill("local-only-review-sentinel");
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.reviews.length)).toBe(1);

  await page.locator('[data-jstremio-testid="reviews-navigation"]').click();
  await expect(page.getByText("local-only-review-sentinel")).toBeVisible();
  expect(requests.join("\n")).not.toContain("local-only-review-sentinel");
});

test("captures, pauses conditionally, clusters markers, and seeks without blocking the slider", async ({ page }) => {
  await emitPlayback(page, 12.345, 100, false);
  const addButton = page.locator('[data-jstremio-testid="timestamp-notes-player-button"]');
  await expect(addButton).toBeEnabled();
  await addButton.click();
  await expect(page.getByText("00:12", { exact: true })).toBeVisible();
  await page.getByLabel("Note (required)").fill("first marker note");
  await page.getByLabel("Marker color").fill("#ff3366");
  await page.getByLabel("Rating (optional)").selectOption("5");
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.notes.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => ({
    color: (window as any).__fixture.notes[0].color,
    rating: (window as any).__fixture.notes[0].rating,
  }))).toEqual({ color: "#FF3366", rating: 5 });

  await emitPlayback(page, 12.7, 100, false);
  await addButton.click();
  await page.getByLabel("Note (required)").fill("nearby marker note");
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.notes.length)).toBe(2);

  const marker = page.locator(".jstremio-marker.cluster");
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAccessibleName(/2 notes/);
  const layer = page.locator('[data-jstremio-testid="timestamp-note-markers"]');
  await expect(layer).toHaveCSS("pointer-events", "none");
  await expect(layer.locator("..")).toHaveJSProperty("tagName", "BODY");
  await expect.poll(() => layer.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(0);

  await marker.click();
  const firstItem = page.locator(".marker-note").filter({ hasText: "first marker note" });
  await expect(firstItem.getByLabel("5 out of 5 stars")).toBeVisible();
  await firstItem.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Marker color").fill("#22aa44");
  await page.getByLabel("Rating (optional)").selectOption("3");
  await page.getByRole("button", { name: "Update" }).click();
  await expect.poll(() => page.evaluate(() => ({
    color: (window as any).__fixture.notes[0].color,
    rating: (window as any).__fixture.notes[0].rating,
  }))).toEqual({ color: "#22AA44", rating: 3 });
  await expect.poll(() => marker.evaluate((element) => element.style.getPropertyValue("--marker-fill"))).toContain("#22AA44");

  await marker.click();
  await expect(page.locator(".marker-popover")).toHaveCount(1);
  await page.mouse.click(5, 5);
  await expect(page.locator(".marker-popover")).toHaveCount(0);

  await marker.click();
  const closePopover = page.getByRole("button", { name: "Close timestamp notes" });
  await expect(closePopover).toBeFocused();
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
