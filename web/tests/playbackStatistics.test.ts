import { describe, expect, it } from "vitest";
import { calculatePlaybackStatistics, localDateKey } from "../src/extensions/playback-statistics/analytics";
import type { PlaybackSession } from "../src/extensions/playback-shared/model";

function session(overrides: Partial<PlaybackSession> = {}): PlaybackSession {
  return {
    id: "session-one",
    videoId: "tt1:1:1",
    metaId: "tt1",
    mediaType: "series",
    name: "Example Show",
    title: "Pilot",
    season: 1,
    episode: 1,
    poster: null,
    startedAt: "2026-07-27T20:00:00.000Z",
    lastSeenAt: "2026-07-27T20:30:00.000Z",
    endedAt: "2026-07-27T20:30:00.000Z",
    watchedMs: 1_800_000,
    startPositionMs: 0,
    endPositionMs: 1_800_000,
    maxPositionMs: 1_800_000,
    durationMs: 1_800_000,
    completed: true,
    ...overrides,
  };
}

describe("playback statistics", () => {
  it("groups rewatches by title and calculates totals", () => {
    const statistics = calculatePlaybackStatistics([
      session(),
      session({ id: "session-two", videoId: "tt1:1:2", episode: 2, watchedMs: 900_000, completed: false }),
      session({ id: "movie", mediaType: "movie", videoId: "tt2", metaId: "tt2", name: "Movie", season: null, episode: null, watchedMs: 600_000 }),
    ], { range: "all", now: new Date("2026-07-28T12:00:00Z"), timeZone: "UTC" });
    expect(statistics.totalWatchedMs).toBe(3_300_000);
    expect(statistics.sessions).toBe(3);
    expect(statistics.uniqueTitles).toBe(3);
    expect(statistics.topTitles[0]).toMatchObject({ label: "Example Show", sessions: 2, watchedMs: 2_700_000 });
  });

  it("calculates current and longest streaks and excludes old sessions", () => {
    const sessions = [
      session({ id: "a", startedAt: "2026-07-25T12:00:00Z" }),
      session({ id: "b", startedAt: "2026-07-26T12:00:00Z" }),
      session({ id: "c", startedAt: "2026-07-27T12:00:00Z" }),
      session({ id: "old", startedAt: "2025-01-01T12:00:00Z" }),
    ];
    const statistics = calculatePlaybackStatistics(sessions, {
      range: 30,
      now: new Date("2026-07-28T08:00:00Z"),
      timeZone: "UTC",
    });
    expect(statistics.sessions).toBe(3);
    expect(statistics.currentStreak).toBe(3);
    expect(statistics.longestStreak).toBe(3);
  });

  it("uses the requested timezone for calendar days", () => {
    expect(localDateKey("2026-07-28T01:00:00Z", "America/Chicago")).toBe("2026-07-27");
  });

  it("splits cross-midnight playback across local calendar days", () => {
    const statistics = calculatePlaybackStatistics([session({
      startedAt: "2026-07-27T23:50:00Z",
      lastSeenAt: "2026-07-28T00:10:00Z",
      endedAt: "2026-07-28T00:10:00Z",
      watchedMs: 20 * 60_000,
    })], { range: 7, now: new Date("2026-07-28T12:00:00Z"), timeZone: "UTC" });
    expect(statistics.daily.filter((day) => day.watchedMs > 0)).toEqual([
      { date: "2026-07-27", watchedMs: 10 * 60_000 },
      { date: "2026-07-28", watchedMs: 10 * 60_000 },
    ]);
  });

  it("uses real elapsed time when a session crosses a DST change", () => {
    const statistics = calculatePlaybackStatistics([session({
      startedAt: "2026-03-08T05:30:00Z",
      lastSeenAt: "2026-03-08T08:30:00Z",
      endedAt: "2026-03-08T08:30:00Z",
      watchedMs: 3 * 60 * 60_000,
    })], { range: 7, now: new Date("2026-03-08T12:00:00Z"), timeZone: "America/Chicago" });
    expect(statistics.daily.filter((day) => day.watchedMs > 0)).toEqual([
      { date: "2026-03-07", watchedMs: 30 * 60_000 },
      { date: "2026-03-08", watchedMs: 150 * 60_000 },
    ]);
  });
});
