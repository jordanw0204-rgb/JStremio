import { afterEach, describe, expect, it } from "vitest";
import {
  applyTheme,
  asThemeSettings,
  DEFAULT_THEME,
  normalizeHexColor,
  themesEqual,
} from "../src/runtime/theme";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-jstremio-theme");
  document.documentElement.removeAttribute("data-jstremio-player-route");
  document.getElementById("jstremio-theme-runtime-style")?.remove();
});

describe("theme runtime", () => {
  it("normalizes only safe six-digit hexadecimal colors", () => {
    expect(normalizeHexColor(" #4b8cff ")).toBe("#4B8CFF");
    expect(normalizeHexColor("#abc")).toBeNull();
    expect(normalizeHexColor("red")).toBeNull();
    expect(normalizeHexColor("url(javascript:bad)")).toBeNull();
  });

  it("validates complete palettes and bounded gradient angles", () => {
    expect(asThemeSettings({ ...DEFAULT_THEME, gradientAngle: 360 })).toEqual({
      ...DEFAULT_THEME,
      gradientAngle: 360,
    });
    expect(() => asThemeSettings({ ...DEFAULT_THEME, accent: "blue" })).toThrow(/invalid color/i);
    expect(() => asThemeSettings({ ...DEFAULT_THEME, gradientAngle: 361 })).toThrow(/gradient angle/i);
  });

  it("applies Stremio's stable variables and one resilient body gradient rule", () => {
    const theme = {
      backgroundStart: "#001122",
      backgroundEnd: "#223344",
      accent: "#55AAFF",
      surface: "#101820",
      text: "#F4F8FF",
      gradientAngle: 125,
    };
    applyTheme(theme);
    applyTheme(theme);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--primary-background-color")).toBe("#001122");
    expect(root.style.getPropertyValue("--secondary-background-color")).toBe("#223344");
    expect(root.style.getPropertyValue("--primary-accent-color")).toBe("#55AAFF");
    expect(root.style.getPropertyValue("--modal-background-color")).toBe("#101820");
    expect(root.style.getPropertyValue("--primary-foreground-color")).toBe("#F4F8FF");
    expect(root.style.getPropertyValue("--jstremio-gradient-angle")).toBe("125deg");
    expect(document.querySelectorAll("#jstremio-theme-runtime-style")).toHaveLength(1);
    expect(document.getElementById("jstremio-theme-runtime-style")?.textContent).toContain(
      "linear-gradient(var(--jstremio-gradient-angle)",
    );
    expect(document.getElementById("jstremio-theme-runtime-style")?.textContent).toContain(
      "html[data-jstremio-player-route] body{background:transparent!important}",
    );
    expect(document.getElementById("jstremio-theme-runtime-style")?.textContent).toContain(
      'html[data-jstremio-player-route] [data-jstremio-control="navigation"]{display:none!important}',
    );
    location.hash = "#/player/fixture";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(root.hasAttribute("data-jstremio-player-route")).toBe(true);
    location.hash = "#/";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(root.hasAttribute("data-jstremio-player-route")).toBe(false);
  });

  it("compares every persisted theme field", () => {
    expect(themesEqual({ ...DEFAULT_THEME }, { ...DEFAULT_THEME })).toBe(true);
    expect(themesEqual({ ...DEFAULT_THEME }, { ...DEFAULT_THEME, surface: "#000000" })).toBe(false);
  });
});
