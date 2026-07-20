import { describe, expect, it } from "vitest";
import { timestampNotesDisabledReason } from "../src/extensions/timestamp-notes/availability";
import type { MediaTarget, PlaybackSnapshot } from "../src/runtime/types";

const target: MediaTarget = {
  key: "movie:tt123",
  videoId: "tt123",
  metaId: "tt123",
  mediaType: "movie",
  name: "Fixture",
  title: null,
  season: null,
  episode: null,
  poster: null,
};

const snapshot: PlaybackSnapshot = {
  positionMs: 60_000,
  durationMs: 7_200_000,
  paused: true,
  seeking: false,
  updatedAt: Date.now() - 60_000,
};

describe("timestamp note availability", () => {
  it("keeps a valid paused timestamp available even when MPV emits no recent update", () => {
    expect(timestampNotesDisabledReason(target, snapshot, false, false)).toBeNull();
  });

  it("still rejects playback modes that cannot create a stable local timestamp", () => {
    expect(timestampNotesDisabledReason(target, snapshot, true, false)).toMatch(/live streams/i);
    expect(timestampNotesDisabledReason(target, snapshot, false, true)).toMatch(/local MPV/i);
    expect(timestampNotesDisabledReason(target, { ...snapshot, durationMs: null }, false, false)).toMatch(
      /finite on-demand duration/i,
    );
  });
});
