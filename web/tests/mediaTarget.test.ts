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
});
