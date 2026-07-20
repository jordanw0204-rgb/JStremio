import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOverlayHost } from "../src/runtime/overlayHost";

describe("in-shell extension page host", () => {
  const hosts: ReturnType<typeof createOverlayHost>[] = [];

  beforeEach(() => {
    location.hash = "#/library";
    document.body.innerHTML = `
      <nav id="rail"><a href="#/library">Library</a><a href="#/calendar">Calendar</a><button id="settings">Settings</button>
        <button data-jstremio-extension="reviews" data-jstremio-control="navigation">Reviews</button>
      </nav><main id="official-page">Official page</main>`;
    const rail = document.querySelector<HTMLElement>("#rail")!;
    rail.getBoundingClientRect = () => ({ left: 0, right: 72, top: 0, bottom: 720, width: 72, height: 720, x: 0, y: 0, toJSON() {} });
  });

  afterEach(() => {
    hosts.splice(0).forEach((host) => host.destroy());
    vi.restoreAllMocks();
  });

  it("mounts beside the official rail, marks its button active, and closes on official navigation", () => {
    const host = createOverlayHost();
    hosts.push(host);
    host.publicApi.openPage("reviews", (container) => {
      container.innerHTML = '<main><h1>Local Reviews</h1></main>';
    });

    const root = document.querySelector<HTMLElement>('[data-jstremio-testid="overlay-host"]')!.shadowRoot!;
    const surface = root.querySelector<HTMLElement>('[data-jstremio-testid="page"]')!;
    const button = document.querySelector<HTMLElement>('[data-jstremio-extension="reviews"]')!;
    expect(surface.style.left).toBe("72px");
    expect(document.querySelector("#rail")?.isConnected).toBe(true);
    expect(document.querySelector("#official-page")?.isConnected).toBe(true);
    expect(button.classList.contains("selected")).toBe(true);
    expect(button.getAttribute("aria-current")).toBe("page");

    location.hash = "#/calendar";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(root.querySelector('[data-jstremio-testid="page"]')).toBeNull();
    expect(button.classList.contains("selected")).toBe(false);
    expect(button.hasAttribute("aria-current")).toBe(false);
  });

  it("cleans up the previous custom page when another one opens", () => {
    const host = createOverlayHost();
    hosts.push(host);
    const cleanup = vi.fn();
    host.publicApi.openPage("reviews", () => cleanup);
    host.publicApi.openPage("themes", (container) => {
      container.textContent = "Themes";
    });

    const root = document.querySelector<HTMLElement>('[data-jstremio-testid="overlay-host"]')!.shadowRoot!;
    expect(cleanup).toHaveBeenCalledOnce();
    expect(root.querySelectorAll('[data-jstremio-testid="page"]')).toHaveLength(1);
    expect(document.documentElement.dataset.jstremioActivePage).toBe("themes");
  });

  it("reveals official pages after native navigation clicks that emit no route event", async () => {
    const host = createOverlayHost();
    hosts.push(host);
    host.publicApi.openPage("reviews", (container) => {
      container.textContent = "Local Reviews";
    });
    const settings = document.querySelector<HTMLButtonElement>("#settings")!;
    const selected = vi.fn();
    settings.addEventListener("click", selected);

    settings.click();
    await Promise.resolve();

    const root = document.querySelector<HTMLElement>('[data-jstremio-testid="overlay-host"]')!.shadowRoot!;
    expect(selected).toHaveBeenCalledOnce();
    expect(root.querySelector('[data-jstremio-testid="page"]')).toBeNull();
    expect(document.activeElement).not.toBe(document.querySelector('[data-jstremio-extension="reviews"]'));
  });
});
