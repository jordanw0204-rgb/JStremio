import { describe, expect, it } from "vitest";
import { isValidPlayerProperty } from "../src/runtime/player";
import {
  CAPTION_PRESETS,
  DEFAULT_CUSTOM_CAPTIONS,
  captionMpvProperties,
  matchingCaptionPreset,
  normalizeCustomCaptions,
  validateCustomCaptions,
} from "../src/extensions/custom-captions/model";

describe("Custom Captions", () => {
  it("maps independent caption colors and opacity to MPV AARRGGBB properties", () => {
    const settings = {
      ...DEFAULT_CUSTOM_CAPTIONS,
      textColor: "#FFE94A",
      textOpacity: 50,
      backgroundOpacity: 68,
      bold: true,
    };
    const properties = Object.fromEntries(captionMpvProperties(settings));
    expect(properties).toMatchObject({
      "sub-font": "Arial",
      "sub-color": "#7FFFE94A",
      "sub-back-color": "#AD000000",
      "sub-border-style": "background-box",
      "sub-bold": true,
      "sub-ass-override": "force",
    });
  });

  it("recognizes presets and safely normalizes malformed persisted settings", () => {
    expect(matchingCaptionPreset({ ...CAPTION_PRESETS[2]!.settings })?.name).toBe("High Contrast");
    expect(normalizeCustomCaptions({ fontFamily: "\0bad", fontSize: 999, textColor: "red" }))
      .toEqual(DEFAULT_CUSTOM_CAPTIONS);
  });

  it("validates settings and keeps the player property boundary narrow", () => {
    expect(validateCustomCaptions({ ...DEFAULT_CUSTOM_CAPTIONS, fontFamily: "" })).toMatch(/font family/i);
    expect(validateCustomCaptions({ ...DEFAULT_CUSTOM_CAPTIONS, outlineSize: 11 })).toMatch(/outline width/i);
    expect(isValidPlayerProperty("sub-font", "Segoe UI")).toBe(true);
    expect(isValidPlayerProperty("sub-color", "#80FFFFFF")).toBe(true);
    expect(isValidPlayerProperty("sub-color", "white")).toBe(false);
    expect(isValidPlayerProperty("sub-font-size", 121)).toBe(false);
    expect(isValidPlayerProperty("sub-bold", "yes")).toBe(false);
  });
});
