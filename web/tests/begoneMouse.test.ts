import { describe, expect, it } from "vitest";
import {
  DEFAULT_IDLE_MS,
  isBottomProtected,
  MAX_IDLE_MS,
  normalizeIdleDelay,
  overlayHiddenTokens,
} from "../src/extensions/begone-mouse/idle";

describe("BegoneMouse idle settings", () => {
  it("accepts decimal milliseconds including sub-millisecond values", () => {
    expect(normalizeIdleDelay(0.05)).toBe(0.05);
    expect(normalizeIdleDelay("125.5")).toBe(125.5);
    expect(normalizeIdleDelay(0)).toBe(0);
    expect(normalizeIdleDelay(MAX_IDLE_MS)).toBe(MAX_IDLE_MS);
  });

  it("falls back for non-finite and out-of-range delays", () => {
    expect(normalizeIdleDelay(-0.01)).toBe(DEFAULT_IDLE_MS);
    expect(normalizeIdleDelay(MAX_IDLE_MS + 0.01)).toBe(DEFAULT_IDLE_MS);
    expect(normalizeIdleDelay(Number.NaN)).toBe(DEFAULT_IDLE_MS);
  });

  it("learns only Stremio overlay-hidden class tokens", () => {
    const element = document.createElement("main");
    element.className = "player_fixture overlayHidden_ab12 unrelated";
    expect(overlayHiddenTokens(element)).toEqual(["overlayHidden_ab12"]);
  });

  it("protects the responsive bottom player-control band only while the pointer is inside it", () => {
    expect(isBottomProtected(950, 1_000)).toBe(true);
    expect(isBottomProtected(800, 1_000)).toBe(false);
    expect(isBottomProtected(640, 720)).toBe(true);
    expect(isBottomProtected(null, 1_000)).toBe(false);
  });
});
