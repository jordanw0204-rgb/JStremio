import { chromium } from "@playwright/test";

const endpoint = process.argv[2];
const mediaUrl = process.argv[3];
if (!endpoint || !mediaUrl) {
  throw new Error("Usage: player-dom-smoke.mjs <cdp-endpoint> <media-url>");
}

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
const consoleMessages = [];
page.on("console", (message) => {
  const text = message.text();
  if (text.includes("JStremio")) consoleMessages.push(text);
});
if (!page.url().includes("web.stremio.com")) {
  await page.waitForURL((url) => url.origin === "https://web.stremio.com", { timeout: 30_000 });
}
await page.waitForFunction(() => Boolean(window.JStremio && window.core), undefined, { timeout: 20_000 });
await page.evaluate(() => {
  window.__jstremioSmokeReconciles = 0;
  window.JStremio.lifecycle.onReconcile(() => {
    window.__jstremioSmokeReconciles += 1;
  });
});
if (!page.url().includes("#/player/")) {
  await page.evaluate(() => {
    location.hash = "#/search";
  });
  const input = page.locator('input[type="text"]');
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await input.evaluate((element, url) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", url);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
  }, mediaUrl);
}
await page.waitForURL((url) => url.hash.startsWith("#/player/"), { timeout: 30_000 });
await page.evaluate(() => {
  const stream = location.hash.split("/")[2];
  if (!stream) throw new Error("The HTTP stream route has no encoded stream segment");
  const transport = encodeURIComponent("https://v3-cinemeta.strem.io/manifest.json");
  location.hash = `#/player/${stream}/${transport}/${transport}/series/tt2741602/${encodeURIComponent("tt2741602:4:22")}`;
});
await page.waitForFunction(
  async () => (await window.JStremio.stremio.getCurrentMediaTarget())?.key === "series:tt2741602:4:22",
  undefined,
  { timeout: 20_000 },
);
await page.waitForFunction(
  () =>
    document.querySelectorAll('[data-jstremio-control="player-dock"] [data-jstremio-control="player"]').length === 2,
  undefined,
  { timeout: 10_000 },
);
await page.waitForSelector('[data-jstremio-testid="timestamp-note-markers"]', { timeout: 10_000 });
await page.mouse.move(1, 1);
await page.mouse.move(400, 300);
await page.waitForTimeout(500);
const noteButton = page.locator('[data-jstremio-testid="timestamp-notes-player-button"]');
await page.waitForFunction(
  () => {
    const button = document.querySelector('[data-jstremio-testid="timestamp-notes-player-button"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  },
  undefined,
  { timeout: 15_000 },
);
await noteButton.click();
await page.getByLabel("Note (required)").fill("real-player customization smoke");
await page.getByLabel("Marker color").fill("#ff3366");
await page.getByLabel("Rating (optional)").selectOption("4");
await page.getByRole("button", { name: "Save" }).click();
const marker = page.locator(".jstremio-marker").first();
await marker.waitFor({ state: "visible", timeout: 10_000 });
const customizationPersisted = await page.evaluate(async () => {
  const notes = await window.JStremio.bridge.request("timestamp-notes", "listForMedia", {
    mediaKey: "series:tt2741602:4:22",
  });
  const customized = Array.isArray(notes)
    ? notes.find((note) => note && typeof note === "object" && note.color === "#FF3366" && note.rating === 4)
    : null;
  return Boolean(customized);
});
const markerColorApplied = await marker.evaluate(
  (element) => element.style.getPropertyValue("--marker-color") === "#FF3366",
);

await marker.click();
await page.waitForSelector(".marker-popover");
await page.mouse.click(5, 5);
await page.waitForSelector(".marker-popover", { state: "detached" });
const outsideDismissed = true;

await marker.click();
await page.getByRole("button", { name: "Close timestamp notes" }).click();
await page.waitForSelector(".marker-popover", { state: "detached" });
const closeButtonDismissed = true;

await marker.click();
await page.waitForSelector(".marker-popover");
await page.evaluate(async () => {
  await window.JStremio.player.setPaused(false);
  const player = document.querySelector('[class*="player-container"]');
  if (!(player instanceof HTMLElement)) throw new Error("The official player root was not found");
  player.classList.add("overlayHidden_jstremioSmoke");
});
await page.waitForSelector(".overlayHidden_jstremioSmoke", { timeout: 5_000 });
await page.waitForSelector(".marker-popover", { state: "detached", timeout: 5_000 });
const popoverClosedWhenImmersed = true;
await page.waitForFunction(() => {
  const dock = document.querySelector('[data-jstremio-control="player-dock"]');
  const layer = document.querySelector('[data-jstremio-testid="timestamp-note-markers"]');
  return Boolean(
    dock &&
    layer &&
    Number.parseFloat(getComputedStyle(dock).opacity) <= 0.2 &&
    getComputedStyle(layer).visibility === "hidden",
  );
});
const immersedState = await page.evaluate(() => {
  const dock = document.querySelector('[data-jstremio-control="player-dock"]');
  const layer = document.querySelector('[data-jstremio-testid="timestamp-note-markers"]');
  return {
    dockOpacity: dock ? Number.parseFloat(getComputedStyle(dock).opacity) : 1,
    dockPointerEvents: dock ? getComputedStyle(dock).pointerEvents : "none",
    markerVisibility: layer ? getComputedStyle(layer).visibility : "visible",
  };
});
const dock = page.locator('[data-jstremio-control="player-dock"]');
await dock.hover();
await page.waitForFunction(() => {
  const element = document.querySelector('[data-jstremio-control="player-dock"]');
  return element && Number.parseFloat(getComputedStyle(element).opacity) > 0.9;
});
const dockHoverReveal = true;
await page.evaluate(() => {
  document.querySelector(".overlayHidden_jstremioSmoke")?.classList.remove("overlayHidden_jstremioSmoke");
});
await page.mouse.move(400, 300);
await page.waitForSelector(".overlayHidden_jstremioSmoke", { state: "detached", timeout: 5_000 });
const diagnostics = await page.evaluate(() => ({
  url: location.href,
  runtime: Boolean(window.JStremio),
  reconciles: window.__jstremioSmokeReconciles ?? -1,
  owned: Array.from(document.querySelectorAll("[data-jstremio-extension]")).map((element) => ({
    tag: element.tagName,
    extension: element.getAttribute("data-jstremio-extension"),
    control: element.getAttribute("data-jstremio-control"),
    testid: element.getAttribute("data-jstremio-testid"),
    parentTag: element.parentElement?.tagName ?? null,
    parentClass: element.parentElement?.className ?? null,
  })),
  titledControls: Array.from(document.querySelectorAll("[title][tabindex]")).map((element) => ({
    title: element.getAttribute("title"),
    tag: element.tagName,
    className: element.className,
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
  })),
}));
console.log(JSON.stringify({ diagnostics, consoleMessages }));

const result = await page.evaluate((verification) => {
  const dock = document.querySelector('[data-jstremio-control="player-dock"]');
  const buttons = Array.from(document.querySelectorAll('[data-jstremio-control="player-dock"] [data-jstremio-control="player"]'));
  const markerLayer = document.querySelector('[data-jstremio-testid="timestamp-note-markers"]');
  const mask = document.querySelector('[style*="--mask-width"]');
  const slider = mask?.parentElement?.parentElement ?? null;
  const layerRect = markerLayer?.getBoundingClientRect();
  const sliderRect = slider?.getBoundingClientRect();
  const dockStyle = dock ? getComputedStyle(dock) : null;
  return {
    playerRoute: location.hash.startsWith("#/player/"),
    runtime: Boolean(window.JStremio),
    dockInBody: dock?.parentElement === document.body,
    playerButtons: buttons.map((button) => button.getAttribute("aria-label")),
    buttonsInDock: buttons.every((button) => button.parentElement === dock),
    playerButtonsVisible:
      Boolean(dockStyle) &&
      dockStyle.display !== "none" &&
      dockStyle.visibility !== "hidden" &&
      Number.parseFloat(dockStyle.opacity) > 0.9 &&
      buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return rect.width >= 40 && rect.height >= 40 && style.display !== "none" && style.visibility !== "hidden";
      }),
    markerLayerInBody: markerLayer?.parentElement === document.body,
    markerLayerVisible: Boolean(layerRect) && layerRect.width > 0 && layerRect.height > 0,
    markerWidthMatchesSlider:
      Boolean(layerRect && sliderRect) && Math.abs(layerRect.width - sliderRect.width) < 1,
    markerLeftMatchesSlider:
      Boolean(layerRect && sliderRect) && Math.abs(layerRect.left - sliderRect.left) < 1,
    markerTopMatchesSlider:
      Boolean(layerRect && sliderRect) && Math.abs(layerRect.top - sliderRect.top) < 1,
    customizationPersisted: verification.customizationPersisted,
    markerColorApplied: verification.markerColorApplied,
    outsideDismissed: verification.outsideDismissed,
    closeButtonDismissed: verification.closeButtonDismissed,
    markerHiddenWhenImmersed: verification.immersedState.markerVisibility === "hidden",
    popoverClosedWhenImmersed: verification.popoverClosedWhenImmersed,
    dockRemainsInteractiveWhenImmersed:
      verification.immersedState.dockOpacity > 0 &&
      verification.immersedState.dockOpacity <= 0.2 &&
      verification.immersedState.dockPointerEvents === "auto",
    dockHoverReveal: verification.dockHoverReveal,
  };
}, {
  customizationPersisted,
  markerColorApplied,
  outsideDismissed,
  closeButtonDismissed,
  immersedState,
  popoverClosedWhenImmersed,
  dockHoverReveal,
});

console.log(JSON.stringify(result));
const expectedButtons = new Set(["Review this title", "Add timestamp note"]);
const failures = [
  [result.playerRoute, "official player route"],
  [result.runtime, "injected runtime"],
  [result.dockInBody, "body-owned player dock"],
  [result.buttonsInDock, "buttons inside the player dock"],
  [result.playerButtonsVisible, "visible player buttons"],
  [result.playerButtons.length === expectedButtons.size && result.playerButtons.every((label) => expectedButtons.has(label)), "both extension buttons"],
  [result.markerLayerInBody, "body-owned marker layer"],
  [result.markerLayerVisible, "visible marker layer"],
  [result.markerWidthMatchesSlider && result.markerLeftMatchesSlider && result.markerTopMatchesSlider, "marker geometry aligned to the official slider"],
  [result.customizationPersisted && result.markerColorApplied, "persisted marker color and rating"],
  [result.outsideDismissed && result.closeButtonDismissed, "popover outside and close-button dismissal"],
  [result.markerHiddenWhenImmersed && result.popoverClosedWhenImmersed, "immersed marker and popover hiding"],
  [result.dockRemainsInteractiveWhenImmersed && result.dockHoverReveal, "immersed dock hover reveal"],
].filter(([passed]) => !passed).map(([, label]) => label);
if (failures.length) throw new Error(`Real-player DOM smoke failed: ${failures.join(", ")}`);
await browser.close();
