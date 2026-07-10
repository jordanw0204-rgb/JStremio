import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const built = resolve(import.meta.dirname, "..", "..", "..", "resources", "extensions");

test.beforeEach(async ({ page }) => {
  await page.setContent(`
    <nav><a href="#/library">Library</a><a href="#/calendar">Calendar</a></nav>
    <main><div class="controls" role="toolbar"><button aria-label="Play">Play</button><button aria-label="Next video">Next</button><button aria-label="Fullscreen">Fullscreen</button></div><div class="seek"><div role="slider" aria-label="Seek position"></div></div></main>
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

  await page.evaluate(() => {
    document.querySelector("nav")!.outerHTML = '<nav><a href="#/library">Library</a><a href="#/calendar">Calendar</a></nav>';
    document.querySelector(".controls")!.outerHTML = '<div class="controls" role="toolbar"><button aria-label="Play">Play</button><button aria-label="Next video">Next</button><button aria-label="Fullscreen">Fullscreen</button></div>';
  });
  await expect(page.locator('[data-jstremio-testid="reviews-navigation"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="timestamp-notes-navigation"]')).toHaveCount(1);
  await expect(page.locator('[data-jstremio-testid="reviews-player-button"]')).toHaveCount(1);
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
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.notes.length)).toBe(1);

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
  await marker.click();
  await page.getByRole("button", { name: /first marker note/ }).click();
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
