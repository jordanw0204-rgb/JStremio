import { chromium } from "@playwright/test";

const endpoint = process.env.JSTREMIO_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const mediaUrl = process.argv[2];
if (!mediaUrl) throw new Error("Usage: quick-seek-interaction-live-smoke.mjs <media-url>");

const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes("web.stremio.com"));
if (!page) throw new Error("JStremio WebView page was not found");
page.setDefaultTimeout(12_000);
await page.waitForFunction(() => Boolean(window.JStremio));
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

await page.waitForFunction(() => {
  const snapshot = window.JStremio?.player.getSnapshot();
  return Boolean(snapshot && snapshot.positionMs !== null && snapshot.durationMs !== null && snapshot.durationMs >= 60_000);
}, null, { timeout: 30_000 });
await page.evaluate(() => window.JStremio.player.seekTo(20_000));
await page.waitForFunction(() => (window.JStremio?.player.getSnapshot()?.positionMs ?? 0) >= 19_000);
const viewport = page.viewportSize();
if (viewport) await page.mouse.move(Math.round(viewport.width / 2), Math.max(1, viewport.height - 24));

const back = page.locator('[data-jstremio-control="quick-seek-bar-back"]');
const forward = page.locator('[data-jstremio-control="quick-seek-bar-forward"]');
try {
  await page.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('[data-jstremio-control^="quick-seek-bar-"]'));
    return buttons.length === 2 && buttons.every((button) =>
      button instanceof HTMLButtonElement
      && !button.disabled
      && !button.classList.contains("disabled")
      && getComputedStyle(button).pointerEvents === "auto",
    );
  });
} catch (error) {
  const unavailableState = await page.evaluate(() => ({
    snapshot: window.JStremio?.player.getSnapshot(),
    buttons: Array.from(document.querySelectorAll('[data-jstremio-control^="quick-seek-bar-"]')).map((button) => ({
      control: button.getAttribute("data-jstremio-control"),
      disabled: button instanceof HTMLButtonElement ? button.disabled : null,
      classes: button.className,
      pointerEvents: getComputedStyle(button).pointerEvents,
      connected: button.isConnected,
    })),
  }));
  console.error(JSON.stringify({ unavailableState }));
  throw error;
}

await forward.hover();
await new Promise((resolve) => setTimeout(resolve, 220));
const interactionState = await page.evaluate(() => {
  const describe = (selector) => {
    const button = document.querySelector(selector);
    const bounds = button.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return {
      disabled: button.disabled,
      disabledClass: button.classList.contains("disabled"),
      pointerEvents: getComputedStyle(button).pointerEvents,
      color: getComputedStyle(button).color,
      accent: getComputedStyle(document.documentElement).getPropertyValue("--jstremio-accent-color").trim(),
      hitOwned: hit === button || button.contains(hit),
    };
  };
  return {
    back: describe('[data-jstremio-control="quick-seek-bar-back"]'),
    forward: describe('[data-jstremio-control="quick-seek-bar-forward"]'),
  };
});

const position = () => page.evaluate(() => window.JStremio.player.getSnapshot()?.positionMs ?? null);
const beforeBack = await position();
await back.click();
await new Promise((resolve) => setTimeout(resolve, 650));
const afterBack = await position();
if (beforeBack === null || afterBack === null || afterBack >= beforeBack - 3_000) {
  throw new Error(`Compact rewind did not seek backward: ${beforeBack} -> ${afterBack}`);
}
await forward.click();
await new Promise((resolve) => setTimeout(resolve, 650));
const afterForward = await position();
if (afterForward === null || afterForward <= afterBack + 3_000) {
  throw new Error(`Compact fast-forward did not seek forward: ${afterBack} -> ${afterForward}`);
}

await page.evaluate(() => window.JStremio.player.seekTo(10_000));
await page.waitForFunction(() => {
  const positionMs = window.JStremio?.player.getSnapshot()?.positionMs;
  return positionMs !== null && positionMs !== undefined && positionMs >= 9_000 && positionMs <= 12_000;
});
await forward.hover();
await forward.evaluate((button) => {
  window.__quickSeekPointerLog = [];
  for (const type of ["pointerdown", "pointerup", "pointercancel", "gotpointercapture", "lostpointercapture", "click"]) {
    button.addEventListener(type, (event) => window.__quickSeekPointerLog.push({
      type,
      button: event.button,
      isPrimary: event.isPrimary,
      trusted: event.isTrusted,
      disabled: button.disabled,
    }), { capture: true });
  }
});
await page.mouse.down();
await new Promise((resolve) => setTimeout(resolve, 1_300));
const acceleratedAmount = Number(await forward.locator("[data-quick-seek-amount]").textContent());
const holdState = await page.evaluate(() => ({
  log: window.__quickSeekPointerLog,
  holding: document.querySelector('[data-jstremio-control="quick-seek-bar-forward"]')?.hasAttribute("data-holding"),
  snapshot: window.JStremio.player.getSnapshot(),
}));
await page.mouse.up();
if (acceleratedAmount <= 5) {
  console.log(JSON.stringify({ interactionState, beforeBack, afterBack, afterForward, acceleratedAmount, holdState }));
  throw new Error(`Compact Quick Seek hold did not accelerate its displayed step: ${acceleratedAmount}`);
}

console.log(JSON.stringify({ interactionState, beforeBack, afterBack, afterForward, acceleratedAmount, holdState }));
await browser.close();
