import { describe, expect, it } from "vitest";
import { activeSkipKind, asResolvedProfile, resolveRangeForDuration, scopeOptions } from "../src/extensions/intro-credits-skipper/model";
import type { MediaTarget } from "../src/runtime/types";

const target: MediaTarget = {
  key: "series:tt1:1:2",
  videoId: "tt1:1:2",
  metaId: "tt1",
  mediaType: "series",
  name: "Show",
  title: "Episode",
  season: 1,
  episode: 2,
  poster: null,
};

describe("intro and credits skipper model", () => {
  it("parses resolved ranges and exposes the active skip", () => {
    const profile = asResolvedProfile({
      profileId: "series:tt1",
      scope: "series",
      intro: { startMs: 5_000, endMs: 75_000 },
      credits: { startMs: 1_700_000, endMs: 1_800_000 },
    });
    expect(activeSkipKind(profile, 50_000)).toMatchObject({ kind: "intro", range: { endMs: 75_000 } });
    expect(activeSkipKind(profile, 1_750_000)).toMatchObject({ kind: "credits" });
    expect(activeSkipKind(profile, 500_000)).toBeNull();
  });

  it("offers only valid scopes for the current media", () => {
    expect(scopeOptions(target)).toEqual(["season", "series"]);
    expect(scopeOptions({ ...target, season: null, episode: null })).toEqual(["series"]);
    expect(scopeOptions({ ...target, mediaType: "movie", videoId: "tt2", key: "movie:tt2", season: null, episode: null })).toEqual([]);
  });

  it("preserves a shared credits marker's distance from the end", () => {
    const saved = {
      startMs: 1_700_000,
      endMs: 1_800_000,
      anchor: "fromEnd" as const,
      durationMsAtCreation: 1_800_000,
    };
    expect(resolveRangeForDuration(saved, 1_920_000)).toEqual({
      startMs: 1_820_000,
      endMs: 1_920_000,
    });
    expect(saved).toEqual({
      startMs: 1_700_000,
      endMs: 1_800_000,
      anchor: "fromEnd",
      durationMsAtCreation: 1_800_000,
    });
  });
});
