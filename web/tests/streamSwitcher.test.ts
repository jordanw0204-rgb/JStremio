import { describe, expect, it } from "vitest";
import { parseStreamOptions } from "../src/runtime/stremioAdapter";
import {
  currentStreamFromState,
  isCurrentStream,
  selectNextStream,
  streamSimilarity,
} from "../src/extensions/stream-switcher/model";

const optionsState = {
  streams: [
    {
      addon: { transportUrl: "https://torrentio.example/manifest.json", manifest: { name: "Torrentio" } },
      content: {
        type: "Ready",
        content: [
          { name: "1080p", description: "WEB-DL HEVC", infoHash: "AAA", fileIdx: 0, deepLinks: { player: "#/player/current" } },
          { name: "1080p", description: "WEB-DL HEVC alternate", infoHash: "BBB", fileIdx: 0, deepLinks: { player: "#/player/matching" } },
          { name: "720p", description: "WEBRip H264", infoHash: "CCC", fileIdx: 0, deepLinks: { player: "#/player/lower" } },
        ],
      },
    },
    {
      addon: { transportUrl: "https://other.example/manifest.json", manifest: { name: "Other" } },
      content: { type: "Loading" },
    },
  ],
};

describe("Stream Switcher", () => {
  it("extracts every ready stream with provider metadata while tracking unfinished addons", () => {
    const parsed = parseStreamOptions(optionsState);
    expect(parsed.loading).toBe(true);
    expect(parsed.options).toHaveLength(3);
    expect(parsed.options[1]).toMatchObject({
      route: "#/player/matching",
      addonName: "Torrentio",
      addonTransportUrl: "https://torrentio.example/manifest.json",
      infoHash: "bbb",
      fileIdx: "0",
      order: 1,
    });
  });

  it("prefers the same provider, resolution, source, and codec over lower-quality options", () => {
    const current = currentStreamFromState({
      selected: { stream: { name: "1080p", description: "WEB-DL HEVC", infoHash: "AAA", fileIdx: 0, deepLinks: { player: "#/player/current" } } },
      addon: { transportUrl: "https://torrentio.example/manifest.json", manifest: { name: "Torrentio" } },
    }, "#/player/current");
    const options = parseStreamOptions(optionsState).options;
    expect(isCurrentStream(options[0]!, current)).toBe(true);
    expect(streamSimilarity(options[1]!, current)).toBeGreaterThan(streamSimilarity(options[2]!, current));
    expect(selectNextStream(options, current)?.route).toBe("#/player/matching");
  });

  it("uses picker order as the deterministic fallback when current metadata is unavailable", () => {
    const options = parseStreamOptions(optionsState).options;
    location.hash = "#/player/not-listed";
    expect(selectNextStream(options, null)?.route).toBe("#/player/current");
  });
});
