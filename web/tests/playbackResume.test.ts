import { describe, expect, it } from "vitest";
import { shouldResumePlayback } from "../src/extensions/timestamp-notes/playbackResume";

const allowed = {
  pausedByExtension: true,
  sawExpectedPause: true,
  manualPauseChange: false,
  capturedMediaKey: "series:tt:1:2",
  currentMediaKey: "series:tt:1:2",
  currentlyPaused: true,
};

describe("conditional playback resume", () => {
  it("resumes only the pause it owns on the same media", () => {
    expect(shouldResumePlayback(allowed)).toBe(true);
    expect(shouldResumePlayback({ ...allowed, manualPauseChange: true })).toBe(false);
    expect(shouldResumePlayback({ ...allowed, currentMediaKey: "series:tt:1:3" })).toBe(false);
    expect(shouldResumePlayback({ ...allowed, pausedByExtension: false })).toBe(false);
    expect(shouldResumePlayback({ ...allowed, currentlyPaused: false })).toBe(false);
  });
});
