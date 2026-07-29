import { chromium } from "@playwright/test";

const endpoint = process.env.JSTREMIO_CDP_ENDPOINT;
const mediaUrl = process.argv[2];
if (!endpoint) throw new Error("JSTREMIO_CDP_ENDPOINT is required");
if (!mediaUrl) throw new Error("A media URL is required");

const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes("web.stremio.com"));
  if (!page) throw new Error("JStremio WebView page was not found");
  await page.waitForFunction(() => Boolean(window.JStremio));
  await page.evaluate(() => { location.hash = "#/search"; });
  const search = page.locator('input[type="text"]');
  await search.waitFor({ state: "visible", timeout: 20_000 });
  await search.evaluate((element, url) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", url);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
  }, mediaUrl);
  await page.waitForURL((url) => url.hash.startsWith("#/player/"), { timeout: 30_000 });
  await page.waitForFunction(() => (window.JStremio?.player.getSnapshot()?.durationMs ?? 0) > 10_000, null, { timeout: 30_000 });
  await page.mouse.move(600, Math.max(1, (page.viewportSize()?.height ?? 800) - 20));

  const subtitles = page.locator('[data-jstremio-custom-captions-anchor="true"]');
  await subtitles.waitFor({ state: "visible", timeout: 20_000 });
  await subtitles.evaluate((element) => element.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
  })));
  const editor = page.getByRole("dialog", { name: "Custom Captions" });
  await editor.waitFor({ state: "visible", timeout: 10_000 });
  await editor.getByRole("button", { name: "High Contrast" }).click();

  await page.waitForFunction(async () => {
    const runtime = window.JStremio;
    if (!runtime) return false;
    const read = (name) => new Promise((resolve) => {
      let unsubscribe = () => {};
      unsubscribe = runtime.player.observeProperty(name, (value) => {
        unsubscribe();
        resolve(value);
      });
      runtime.player.refreshProperty(name);
    });
    const [color, bold, box] = await Promise.all([
      read("sub-color"),
      read("sub-bold"),
      read("sub-border-style"),
    ]);
    return String(color).toUpperCase() === "#FFFFE94A" && bold === true && box === "background-box";
  }, null, { timeout: 10_000 });

  await editor.getByRole("button", { name: "Close caption settings" }).click();
  await editor.waitFor({ state: "detached", timeout: 10_000 });
  console.log("Custom Captions live player smoke test passed");
} finally {
  await browser.close();
}
