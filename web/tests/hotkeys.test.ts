import { describe, expect, it } from "vitest";
import {
  asPluginHotkeys,
  captureHotkey,
  displayHotkey,
  isValidHotkey,
} from "../src/runtime/hotkeys";

function key(code: string, options: KeyboardEventInit = {}) {
  return new KeyboardEvent("keydown", { code, key: code, ...options });
}

describe("plugin hotkeys", () => {
  it("records canonical modifier combinations and formats them for people", () => {
    expect(captureHotkey(key("KeyR", { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: "hotkey",
      value: "Ctrl+Shift+KeyR",
    });
    expect(displayHotkey("Ctrl+Shift+KeyR")).toBe("Ctrl + Shift + R");
    expect(captureHotkey(key("F8"))).toEqual({ kind: "hotkey", value: "F8" });
  });

  it("requires a non-modifier key and rejects navigation and system shortcuts", () => {
    expect(captureHotkey(key("ControlLeft", { ctrlKey: true }))).toEqual({ kind: "modifier" });
    expect(captureHotkey(key("ArrowLeft")).kind).toBe("rejected");
    expect(captureHotkey(key("KeyJ", { metaKey: true })).kind).toBe("rejected");
    expect(captureHotkey(key("KeyN", { altKey: true })).kind).toBe("rejected");
    expect(captureHotkey(key("F4", { altKey: true })).kind).toBe("rejected");
  });

  it("accepts only canonical persisted values", () => {
    expect(isValidHotkey("Ctrl+Alt+Digit7")).toBe(true);
    expect(isValidHotkey("Shift+Comma")).toBe(true);
    expect(isValidHotkey("Shift+Ctrl+KeyR")).toBe(false);
    expect(isValidHotkey("ArrowRight")).toBe(false);
    expect(isValidHotkey("Alt+KeyN")).toBe(false);
    expect(isValidHotkey("Alt+F4")).toBe(false);
  });

  it("filters malformed native maps without exposing arbitrary plugin settings", () => {
    expect(asPluginHotkeys({
      reviews: "Ctrl+KeyR",
      "timestamp-notes": "F8",
      unknown: "KeyU",
    })).toEqual({ reviews: "Ctrl+KeyR", "timestamp-notes": "F8" });
    expect(asPluginHotkeys({ reviews: "ArrowLeft" })).toEqual({});
  });
});
