import { beforeEach, describe, expect, it } from "vitest";
import {
  createMarkerColorPicker,
  normalizeMarkerColor,
} from "../src/extensions/timestamp-notes/colorPicker";

describe("timestamp marker color picker", () => {
  beforeEach(() => document.body.replaceChildren());

  it("renders an inline accessible palette with the current theme accent", () => {
    const picker = createMarkerColorPicker("#ff3366", "#123ABC");
    document.body.append(picker.element, picker.panel);

    expect(picker.input.type).toBe("text");
    expect(picker.input.value).toBe("#FF3366");
    expect(picker.panel.hidden).toBe(true);
    picker.element.querySelector<HTMLButtonElement>(".color-picker-toggle")?.click();
    expect(picker.panel.hidden).toBe(false);
    const accent = document.querySelector<HTMLButtonElement>('[data-color="#123ABC"]');
    expect(accent).not.toBeNull();
    accent?.click();
    expect(picker.input.value).toBe("#123ABC");
    expect(accent?.getAttribute("aria-pressed")).toBe("true");
    const hue = document.querySelector<HTMLInputElement>('[aria-label="Color hue"]')!;
    hue.value = "180";
    hue.dispatchEvent(new Event("input"));
    expect(picker.input.value).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("normalizes safe hex colors and rejects native-picker-style invalid values", () => {
    expect(normalizeMarkerColor("#22aa44")).toBe("#22AA44");
    expect(normalizeMarkerColor("red")).toBe("#56E0CF");
  });
});
