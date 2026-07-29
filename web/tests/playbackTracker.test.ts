import { afterEach, describe, expect, it, vi } from "vitest";
import type { JStremioRuntime, PlaybackSnapshot } from "../src/runtime/types";
import { accumulatedWatchTime, acquirePlaybackSessionTracker } from "../src/extensions/playback-shared/sessionTracker";

const snapshot = (positionMs: number, overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
  positionMs,
  durationMs: 60_000,
  paused: false,
  seeking: false,
  updatedAt: 0,
  ...overrides,
});

describe("playback session accumulation", () => {
  afterEach(() => {
    vi.useRealTimers();
    location.hash = "";
  });

  it("counts plausible active playback wall time", () => {
    expect(accumulatedWatchTime(snapshot(1_000), snapshot(2_000), 1_000)).toBe(1_000);
    expect(accumulatedWatchTime(snapshot(1_000), snapshot(3_000), 1_000)).toBe(1_000);
  });

  it("ignores pauses, seeks, stalls, and long sampling gaps", () => {
    expect(accumulatedWatchTime(snapshot(1_000, { paused: true }), snapshot(2_000), 1_000)).toBe(0);
    expect(accumulatedWatchTime(snapshot(1_000), snapshot(20_000), 1_000)).toBe(0);
    expect(accumulatedWatchTime(snapshot(1_000), snapshot(1_000), 1_000)).toBe(0);
    expect(accumulatedWatchTime(snapshot(1_000), snapshot(2_000, { seeking: true }), 1_000)).toBe(0);
    expect(accumulatedWatchTime(snapshot(1_000), snapshot(2_000), 16_000)).toBe(0);
  });

  it("uses one persistence sink when both history plugins acquire the tracker", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    location.hash = "#/player/series/test";
    let listener: ((value: PlaybackSnapshot | null) => void) | null = null;
    const request = vi.fn(async () => ({}));
    const runtime = {
      bridge: { request },
      stremio: {
        getCurrentMediaTarget: vi.fn(async () => ({
          key: "series:tt1:1:1",
          videoId: "tt1:1:1",
          metaId: "tt1",
          mediaType: "series",
          name: "Show",
          title: "Episode",
          season: 1,
          episode: 1,
          poster: null,
        })),
      },
      player: {
        subscribe: vi.fn((next: (value: PlaybackSnapshot | null) => void) => {
          listener = next;
          return () => undefined;
        }),
      },
      lifecycle: { onRouteChange: vi.fn(() => () => undefined) },
      diagnostics: { report: vi.fn() },
    } as unknown as JStremioRuntime;

    const releaseStatistics = acquirePlaybackSessionTracker(runtime);
    const releaseJournal = acquirePlaybackSessionTracker(runtime);
    expect(runtime.player.subscribe).toHaveBeenCalledTimes(1);

    listener!(snapshot(0));
    await settlePromises();
    vi.setSystemTime(1_006_000);
    listener!(snapshot(6_000, { paused: true }));
    await settlePromises();

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("playback-history", "upsert", expect.objectContaining({ watchedMs: 6_000 }));
    releaseStatistics();
    releaseJournal();
    await settlePromises();
  });

  it("coalesces bursty snapshots and reuses the media target for the current route", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    location.hash = "#/player/series/test";
    let listener: ((value: PlaybackSnapshot | null) => void) | null = null;
    let resolveTarget!: (value: Awaited<ReturnType<JStremioRuntime["stremio"]["getCurrentMediaTarget"]>>) => void;
    const pendingTarget = new Promise<Awaited<ReturnType<JStremioRuntime["stremio"]["getCurrentMediaTarget"]>>>(
      (resolve) => { resolveTarget = resolve; },
    );
    const request = vi.fn(async () => ({}));
    const getCurrentMediaTarget = vi.fn(() => pendingTarget);
    const runtime = {
      bridge: { request },
      stremio: { getCurrentMediaTarget },
      player: {
        subscribe: vi.fn((next: (value: PlaybackSnapshot | null) => void) => {
          listener = next;
          return () => undefined;
        }),
      },
      lifecycle: { onRouteChange: vi.fn(() => () => undefined) },
      diagnostics: { report: vi.fn() },
    } as unknown as JStremioRuntime;

    const release = acquirePlaybackSessionTracker(runtime);
    listener!(snapshot(0, { updatedAt: 1_000_000 }));
    await Promise.resolve();
    expect(getCurrentMediaTarget).toHaveBeenCalledTimes(1);

    for (let index = 1; index <= 100; index += 1) {
      const final = index === 100;
      listener!(snapshot(Math.round(index * 60), {
        updatedAt: 1_000_000 + Math.round(index * 60),
        paused: final,
      }));
    }
    resolveTarget({
      key: "series:tt1:1:1",
      videoId: "tt1:1:1",
      metaId: "tt1",
      mediaType: "series",
      name: "Show",
      title: "Episode",
      season: 1,
      episode: 1,
      poster: null,
    });
    await settlePromises();

    expect(getCurrentMediaTarget).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("playback-history", "upsert", expect.objectContaining({
      watchedMs: 6_000,
      endPositionMs: 6_000,
    }));
    release();
    await settlePromises();
  });
});

async function settlePromises() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
