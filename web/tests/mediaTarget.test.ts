import { describe, expect, it } from "vitest";
import { deriveMediaTarget } from "../src/runtime/stremioAdapter";

describe("media target derivation", () => {
  it("derives a stable episode target", () => {
    expect(
      deriveMediaTarget({
        selected: { streamRequest: { path: { id: "tt123:1:2" } } },
        metaItem: {
          content: {
            id: "tt123",
            type: "series",
            name: "Series",
            poster: "https://example.invalid/poster.jpg",
            videos: [{ id: "tt123:1:2", title: "Episode", season: 1, episode: 2 }],
          },
        },
      }),
    ).toEqual({
      key: "series:tt123:1:2",
      videoId: "tt123:1:2",
      metaId: "tt123",
      mediaType: "series",
      name: "Series",
      title: "Episode",
      season: 1,
      episode: 2,
      poster: "https://example.invalid/poster.jpg",
    });
  });

  it("refuses unstable or unsupported targets", () => {
    expect(deriveMediaTarget({ metaItem: { content: { id: "tt", type: "series" } } })).toBeNull();
    expect(
      deriveMediaTarget({
        selected: { streamRequest: { path: { id: "live" } } },
        metaItem: { content: { id: "tv", type: "channel" } },
      }),
    ).toBeNull();
  });

  it("keeps the route episode when Stremio preselects the next episode before navigation", () => {
    const state = {
      selected: { streamRequest: { path: { id: "tt123:3:5" } }, title: "Next episode" },
      seriesInfo: { season: 3, episode: 5 },
      metaItem: {
        content: {
          id: "tt123",
          type: "series",
          name: "Series",
          videos: [
            { id: "tt123:3:4", title: "Current episode", season: 3, episode: 4 },
            { id: "tt123:3:5", title: "Next episode", season: 3, episode: 5 },
          ],
        },
      },
    };
    const route = "#/player/stream/stream-transport/meta-transport/series/tt123/tt123%3A3%3A4";
    expect(deriveMediaTarget(state, route)).toMatchObject({
      key: "series:tt123:3:4",
      videoId: "tt123:3:4",
      title: "Current episode",
      season: 3,
      episode: 4,
    });
  });
});
