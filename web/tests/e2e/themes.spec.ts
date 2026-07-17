import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const built = resolve(import.meta.dirname, "..", "..", "..", "resources", "extensions");

test.beforeEach(async ({ page }) => {
  await page.setContent(`
    <style>
      :root { --primary-background-color:#0c0b11; --secondary-background-color:#1a173e; --primary-accent-color:#7b5bf5; }
      body { margin:0; min-height:100vh; background:linear-gradient(41deg,var(--primary-background-color),var(--secondary-background-color)); }
      .nav_fixture { display:flex;flex-direction:column;width:70px; }
      .nav-tab_fixture { display:flex;align-items:center;justify-content:center;width:64px;height:64px;color:#aaa;background:transparent; }
      .nav-tab_fixture svg { width:32px;height:32px; }
      .label_fixture { opacity:0; }
    </style>
    <nav class="nav_fixture"><a class="nav-tab_fixture" href="#/library" title="Library"><svg viewBox="0 0 24 24"></svg><div class="label_fixture">Library</div></a><a class="nav-tab_fixture" href="#/calendar" title="Calendar"><svg viewBox="0 0 24 24"></svg><div class="label_fixture">Calendar</div></a></nav>
    <main id="app"></main>`);
  await page.evaluate(() => {
    const listeners = new Set<(event: MessageEvent) => void>();
    let theme = {
      backgroundStart: "#0C0B11",
      backgroundEnd: "#1A173E",
      accent: "#7B5BF5",
      surface: "#0F0D20",
      text: "#E6E6E6",
      gradientAngle: 41,
    };
    const defaults = { ...theme };
    const emit = (value: unknown) => {
      for (const listener of listeners) listener(new MessageEvent("message", { data: value }));
    };
    const postMessage = (message: string) => {
      const request = JSON.parse(message) as {
        id: number;
        args: [string, { operation: string; payload: Record<string, unknown> }];
      };
      const [method, params] = request.args;
      if (method !== "jstremio-themes") return;
      if (params.operation === "set") theme = { ...params.payload } as typeof theme;
      if (params.operation === "reset") theme = { ...defaults };
      queueMicrotask(() => emit({ args: [`${method}-response`, { requestId: request.id, ok: true, result: { ...theme } }] }));
    };
    Object.assign(window, {
      core: { getState: () => null },
      chrome: {
        webview: {
          postMessage,
          addEventListener: (_type: "message", listener: (event: MessageEvent) => void) => listeners.add(listener),
          removeEventListener: (_type: "message", listener: (event: MessageEvent) => void) => listeners.delete(listener),
        },
      },
      __themeFixture: { get theme() { return theme; } },
    });
  });
  await page.addScriptTag({ path: resolve(built, "runtime.js") });
  await page.addScriptTag({ path: resolve(built, "themes", "index.js") });
});

test("previews, validates, saves, remounts, and resets themes", async ({ page }) => {
  const navigation = page.locator('[data-jstremio-testid="themes-navigation"]');
  await expect(navigation).toHaveCount(1);
  await expect(navigation).toHaveAttribute("title", "Themes");
  await navigation.click();

  await expect(page.getByRole("heading", { name: "Themes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save theme" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Stremio/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ocean/ })).toBeVisible();

  await page.getByRole("button", { name: /Ocean/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--primary-accent-color"))).toBe("#38BDF8");
  await page.getByRole("button", { name: "Close Themes" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--primary-accent-color"))).toBe("#7B5BF5");
  await navigation.click();
  await expect(page.getByLabel("Accent hex color")).toHaveValue("#7B5BF5");

  const accent = page.getByLabel("Accent hex color");
  await accent.fill("blue");
  await expect(accent).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("status")).toContainText(/six-digit hex color/i);
  await expect(page.getByRole("button", { name: "Save theme" })).toBeDisabled();

  await accent.fill("#4B8CFF");
  await page.getByLabel("Gradient angle in degrees").fill("132");
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--primary-accent-color"))).toBe("#4B8CFF");
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--jstremio-gradient-angle"))).toBe("132deg");
  await expect(page.getByText("Unsaved preview")).toBeVisible();

  await page.getByRole("button", { name: "Save theme" }).click();
  await expect(page.getByText(/ready before JStremio appears next time/i)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__themeFixture.theme)).toMatchObject({
    accent: "#4B8CFF",
    gradientAngle: 132,
  });

  await page.getByRole("button", { name: "Close Themes" }).click();
  await page.evaluate(() => {
    document.querySelector("nav")!.outerHTML = '<nav class="nav_fixture"><a class="nav-tab_fixture" href="#/library" title="Library"><svg viewBox="0 0 24 24"></svg><div class="label_fixture">Library</div></a><a class="nav-tab_fixture" href="#/calendar" title="Calendar"><svg viewBox="0 0 24 24"></svg><div class="label_fixture">Calendar</div></a></nav>';
  });
  await expect(page.locator('[data-jstremio-testid="themes-navigation"]')).toHaveCount(1);
  await page.locator('[data-jstremio-testid="themes-navigation"]').click();
  await expect(page.getByLabel("Accent hex color")).toHaveValue("#4B8CFF");

  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(page.getByText("Default theme restored and saved.")).toBeVisible();
  await expect(page.getByLabel("Accent hex color")).toHaveValue("#7B5BF5");
  await expect.poll(() => page.evaluate(() => (window as any).__themeFixture.theme.accent)).toBe("#7B5BF5");
});
