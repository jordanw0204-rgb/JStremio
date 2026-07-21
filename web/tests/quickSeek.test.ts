import { describe, expect, it } from "vitest";
import {
  HOLD_START_DELAY_MS,
  holdSeekStepMs,
  MAX_HOLD_MULTIPLIER,
  relativeSeekTarget,
  SEEK_STEP_MS,
} from "../src/extensions/quick-seek/seek";
import type { PlaybackSnapshot } from "../src/runtime/types";

const snapshot = (positionMs: number | null, durationMs: number | null): PlaybackSnapshot => ({
  positionMs,
  durationMs,
  paused: false,
  seeking: false,
  updatedAt: 0,
});

describe("Quick Seek targets", () => {
  it("moves exactly five seconds and clamps at both ends", () => {
    expect(relativeSeekTarget(snapshot(30_000, 100_000), -SEEK_STEP_MS)).toBe(25_000);
    expect(relativeSeekTarget(snapshot(30_000, 100_000), SEEK_STEP_MS)).toBe(35_000);
    expect(relativeSeekTarget(snapshot(2_000, 100_000), -SEEK_STEP_MS)).toBe(0);
    expect(relativeSeekTarget(snapshot(98_000, 100_000), SEEK_STEP_MS)).toBe(100_000);
  });

  it("requires a known position and supports unknown duration", () => {
    expect(relativeSeekTarget(snapshot(null, 100_000), SEEK_STEP_MS)).toBeNull();
    expect(relativeSeekTarget(snapshot(30_000, null), SEEK_STEP_MS)).toBe(35_000);
    expect(relativeSeekTarget(snapshot(30_000, null), Number.NaN)).toBeNull();
  });

  it("accelerates a held seek in five-second stages with a safe maximum", () => {
    expect(holdSeekStepMs(HOLD_START_DELAY_MS, 1)).toBe(5_000);
    expect(holdSeekStepMs(HOLD_START_DELAY_MS + 700, 1)).toBe(10_000);
    expect(holdSeekStepMs(HOLD_START_DELAY_MS + 1_400, -1)).toBe(-15_000);
    expect(holdSeekStepMs(Number.MAX_SAFE_INTEGER, 1)).toBe(SEEK_STEP_MS * MAX_HOLD_MULTIPLIER);
    expect(holdSeekStepMs(HOLD_START_DELAY_MS + 700, -1, 7_500)).toBe(-15_000);
  });
});
