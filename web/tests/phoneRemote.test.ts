import { describe, expect, it, vi } from "vitest";
import { asInterfaces, asPairing, asStatus, playbackState } from "../src/extensions/phone-remote/model";

describe("Phone Remote state", () => {
  it("publishes only sanitized playback fields", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    const state = playbackState(
      "publisher-one",
      7,
      "opaque-session",
      {
        key: "series:private-id:video",
        videoId: "video",
        metaId: "private-id",
        mediaType: "series",
        name: "Example\u0000 Show",
        title: "Episode title",
        season: 2,
        episode: 3,
        poster: "https://third-party.invalid/poster.jpg",
      },
      { positionMs: 12_345, durationMs: 60_000, paused: false, seeking: false, updatedAt: 1 },
      130,
      true,
    );

    expect(state).toEqual({
      publisherId: "publisher-one",
      revision: 7,
      active: true,
      mediaSessionId: "opaque-session",
      title: "Example Show",
      subtitle: "S2 E3 · Episode title",
      season: 2,
      episode: 3,
      paused: false,
      positionMs: 12_345,
      durationMs: 60_000,
      volume: 100,
      muted: true,
      updatedAt: 1234,
    });
    expect(JSON.stringify(state)).not.toContain("private-id");
    expect(JSON.stringify(state)).not.toContain("third-party");
  });

  it("strictly normalizes native responses", () => {
    expect(asInterfaces([
      { name: "Wi-Fi", address: "192.168.1.4" },
      { name: "bad" },
    ])).toEqual([{ name: "Wi-Fi", address: "192.168.1.4" }]);
    expect(asStatus({ running: true, connectedClients: 2, pairedSessions: -1 })).toMatchObject({
      running: true,
      connectedClients: 2,
      pairedSessions: 0,
    });
    expect(asPairing({ url: "http://local/#pair=x", qrDataUrl: "javascript:alert(1)", expiresAt: "now" })).toBeNull();
  });
});
