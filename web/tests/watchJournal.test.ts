import { describe, expect, it } from "vitest";
import { filterJournalSessions, groupJournalSessions, normalizeTags } from "../src/extensions/local-watch-journal/model";
import type { PlaybackSession } from "../src/extensions/playback-shared/model";

function session(id: string, startedAt: string, favorite = false, text = ""): PlaybackSession {
  return {
    id,
    videoId: `tt1:1:${id}`,
    metaId: "tt1",
    mediaType: "series",
    name: "Mystery Show",
    title: `Episode ${id}`,
    season: 1,
    episode: Number(id),
    poster: null,
    startedAt,
    lastSeenAt: startedAt,
    endedAt: null,
    watchedMs: 60_000,
    startPositionMs: 0,
    endPositionMs: 60_000,
    maxPositionMs: 60_000,
    durationMs: 120_000,
    completed: false,
    journal: { text, tags: ["Comfort"], favorite, updatedAt: startedAt },
  };
}

describe("watch journal model", () => {
  it("filters notes, favorites, queries, and sorts newest first", () => {
    const sessions = [
      session("1", "2026-07-26T20:00:00Z"),
      session("2", "2026-07-27T20:00:00Z", true, "Great ending"),
    ];
    expect(filterJournalSessions(sessions, "ending", "all").map((item) => item.id)).toEqual(["2"]);
    expect(filterJournalSessions(sessions, "", "favorites").map((item) => item.id)).toEqual(["2"]);
    expect(filterJournalSessions(sessions, "", "notes").map((item) => item.id)).toEqual(["2"]);
  });

  it("groups by local calendar day and normalizes duplicate tags", () => {
    const groups = groupJournalSessions([
      session("1", "2026-07-26T20:00:00Z"),
      session("2", "2026-07-26T22:00:00Z"),
    ], "en-US");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sessions).toHaveLength(2);
    expect(normalizeTags(" Mystery, mystery, Great ending, ")).toEqual(["Mystery", "Great ending"]);
  });
});
