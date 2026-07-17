import { afterEach, describe, expect, it } from "vitest";
import { createBrandingAdapter } from "../src/runtime/branding";

const officialSource = "https://web.stremio.com/build/scripts/../../images/stremio_symbol.png";
const replacementSource = "data:image/png;base64,anN0cmVtaW8=";

afterEach(() => {
  document.body.replaceChildren();
});

describe("JStremio in-app branding", () => {
  it("replaces only the official mark, survives remounts, and restores cleanly", async () => {
    document.body.innerHTML = `
      <a id="home" href="#/"><img id="official" class="official-layout" width="35" height="35" src="${officialSource}" alt=" "></a>
      <button id="play"><img id="unrelated" src="/images/play.png" alt="Play"></button>
    `;
    let reconcile = () => {};
    let unsubscribed = false;
    const adapter = createBrandingAdapter((callback) => {
      reconcile = callback;
      return () => { unsubscribed = true; };
    }, replacementSource);

    const official = document.querySelector<HTMLImageElement>("#official")!;
    const unrelated = document.querySelector<HTMLImageElement>("#unrelated")!;
    expect(official.src).toBe(replacementSource);
    expect(official.alt).toBe("JStremio");
    expect(official.hasAttribute("data-jstremio-brand-logo")).toBe(true);
    expect(official.className).toBe("official-layout");
    expect(official.width).toBe(35);
    expect(document.querySelector<HTMLAnchorElement>("#home")?.href).toContain("#/");
    expect(unrelated.getAttribute("src")).toBe("/images/play.png");
    expect(document.querySelectorAll("[data-jstremio-brand-logo]")).toHaveLength(1);

    official.setAttribute("src", officialSource);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(official.src).toBe(replacementSource);

    official.outerHTML = `<img id="official-remounted" class="official-layout" width="35" height="35" src="${officialSource}" alt=" ">`;
    reconcile();
    expect(document.querySelectorAll("[data-jstremio-brand-logo]")).toHaveLength(1);
    expect(document.querySelector<HTMLImageElement>("#official-remounted")?.src).toBe(replacementSource);
    expect(document.querySelectorAll("img")).toHaveLength(2);

    adapter.destroy();
    const restored = document.querySelector<HTMLImageElement>("#official-remounted")!;
    expect(restored.getAttribute("src")).toBe(officialSource);
    expect(restored.getAttribute("alt")).toBe(" ");
    expect(restored.hasAttribute("data-jstremio-brand-logo")).toBe(false);
    expect(unsubscribed).toBe(true);
  });
});
