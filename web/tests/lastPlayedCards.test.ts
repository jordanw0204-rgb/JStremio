import { afterEach, describe, expect, it, vi } from "vitest";
import {
  entryForCardHref,
  formatPosition,
  mediaLabel,
  mountMediaCardButtons,
  type LastPlayedCardEntry,
} from "../src/extensions/last-played/cards";

const seriesEntry = (overrides: Partial<LastPlayedCardEntry> = {}): LastPlayedCardEntry => ({
  id: "series:tt2741602:5:18",
  playerDeepLink: "#/player/series/blacklist-s05e18/exact",
  videoId: "tt2741602:5:18",
  metaId: "tt2741602",
  mediaType: "series",
  name: "The Blacklist",
  title: "Zarak Mosadek",
  season: 5,
  episode: 18,
  addonName: "Torrentio RD",
  streamName: "[RD+] Torrentio 1080p",
  streamDescription: "The.Blacklist.S05E18.1080p\n👤 16 · 💾 855.3 MB",
  positionMs: 754_000,
  updatedAt: "2026-07-17T15:30:00.000Z",
  ...overrides,
});

afterEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
});

describe("LastPlayed media cards", () => {
  it("prefers an exact video route and otherwise uses the newest episode for a series", () => {
    const old = seriesEntry({ id: "old", videoId: "tt2741602:4:8", season: 4, episode: 8, updatedAt: "2026-07-10T12:00:00Z" });
    const newest = seriesEntry();
    expect(entryForCardHref([old, newest], "#/detail/series/tt2741602")?.id).toBe(newest.id);
    expect(entryForCardHref([old, newest], "#/detail/series/tt2741602/tt2741602%3A4%3A8")?.id).toBe(old.id);
    expect(entryForCardHref([old, newest], "#/detail/movie/tt2741602/tt2741602")).toBeNull();
  });

  it("formats the exact episode and saved playback position", () => {
    expect(mediaLabel(seriesEntry())).toBe("The Blacklist — S05E18 · Zarak Mosadek");
    expect(formatPosition(754_000)).toBe("12:34");
    expect(formatPosition(3_754_000)).toBe("1:02:34");
  });

  it("decorates visual media cards only, keeps one action per card, and refreshes changed history", () => {
    document.body.innerHTML = `
      <nav><a id="nav" href="#/detail/series/tt2741602">The Blacklist navigation</a></nav>
      <a id="text-link" href="#/detail/series/tt2741602">Open details</a>
      <a id="stream-link" href="#/player/series/tt2741602/exact">Stream containing the media id</a>
      <article id="card">
        <a href="#/detail/series/tt2741602"><img alt="The Blacklist poster"></a>
        <a href="#/detail/series/tt2741602"><img alt="Duplicate overlay link"></a>
      </article>
      <article id="unplayed"><a href="#/detail/movie/tt000"><img alt="Unplayed poster"></a></article>`;
    const play = vi.fn();
    const old = seriesEntry({ id: "old", videoId: "tt2741602:4:8", season: 4, episode: 8, title: "The Troll Farmer", updatedAt: "2026-07-10T12:00:00Z" });
    mountMediaCardButtons([old], play);

    expect(document.querySelectorAll("[data-jstremio-last-played-card]")).toHaveLength(1);
    expect(document.querySelector("#card [data-jstremio-last-played-card]")).not.toBeNull();
    expect(document.querySelector("#nav [data-jstremio-last-played-card],#text-link [data-jstremio-last-played-card],#stream-link [data-jstremio-last-played-card],#unplayed [data-jstremio-last-played-card]")).toBeNull();

    const newest = seriesEntry();
    mountMediaCardButtons([old, newest], play);
    const action = document.querySelector<HTMLButtonElement>("#card .jstremio-last-played-button");
    expect(document.querySelectorAll("#card [data-jstremio-last-played-card]")).toHaveLength(1);
    expect(action?.getAttribute("aria-label")).toContain("S05E18 · Zarak Mosadek");
    expect(document.querySelector("body > [role=tooltip]")?.textContent).toContain("👤 16 · 💾 855.3 MB");
    action?.click();
    expect(play).toHaveBeenCalledWith(newest);

    const refreshed = seriesEntry({ positionMs: 900_000, streamDescription: "Updated saved stream details", updatedAt: "2026-07-17T16:00:00Z" });
    mountMediaCardButtons([refreshed], play);
    expect(document.querySelector("body > [role=tooltip]")?.textContent).toContain("Resume at 15:00");
    expect(document.querySelector("body > [role=tooltip]")?.textContent).toContain("Updated saved stream details");
  });
});
