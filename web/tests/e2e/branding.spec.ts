import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const runtime = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "resources",
  "extensions",
  "runtime.js",
);
const officialSource = "https://web.stremio.com/build/scripts/../../images/stremio_symbol.png";

test("rebrands only the application mark across upstream route remounts", async ({ page }) => {
  await page.setContent(`
    <header><a id="official-home-link" href="#/"><img id="official-logo" class="logo-fixture" style="width:35px;height:35px" src="${officialSource}" alt=" "></a></header>
    <main><button aria-label="Play"><img id="play-icon" src="/images/play.png" alt="Play"></button></main>
  `);
  await page.addScriptTag({ path: runtime });

  const branded = page.locator("[data-jstremio-brand-logo]");
  await expect(branded).toHaveCount(1);
  await expect(branded).toHaveAttribute("alt", "JStremio");
  await expect(branded).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(branded).toHaveCSS("width", "35px");
  await expect(branded).toHaveCSS("height", "35px");
  await expect(page.locator("#official-home-link")).toHaveAttribute("href", "#/");
  await expect(page.locator("#play-icon")).toHaveAttribute("src", "/images/play.png");
  await expect(page.locator("img")).toHaveCount(2);

  await page.evaluate((source) => {
    location.hash = "#/settings";
    document.querySelector("header")!.innerHTML = `<a id="settings-logo-link" href="#/"><img id="settings-logo" class="logo-fixture" style="width:35px;height:35px" src="${source}" alt=" "></a>`;
  }, officialSource);
  await expect(branded).toHaveCount(1);
  await expect(page.locator("#settings-logo")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(page.locator("#settings-logo-link")).toHaveAttribute("href", "#/");
  await expect(page.locator("img")).toHaveCount(2);

  await page.locator("#settings-logo").evaluate((image, source) => image.setAttribute("src", source), officialSource);
  await expect(page.locator("#settings-logo")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(branded).toHaveCount(1);
});
