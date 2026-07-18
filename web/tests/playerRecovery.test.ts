import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlayerAdapter } from "../src/runtime/player";

type WebViewListener = (event: MessageEvent) => void;

describe("player stall recovery", () => {
  let listener: WebViewListener | undefined;
  const postMessage = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    listener = undefined;
    postMessage.mockReset();
    Object.defineProperty(window, "chrome", {
      configurable: true,
      value: {
        webview: {
          postMessage,
          addEventListener: (_type: "message", next: WebViewListener) => { listener = next; },
          removeEventListener: (_type: "message", current: WebViewListener) => {
            if (listener === current) listener = undefined;
          },
        },
      },
    });
    location.hash = "#/player/series/fixture/fixture%3A1%3A1/local.mp4";
  });

  afterEach(() => {
    vi.useRealTimers();
    location.hash = "#/";
    Reflect.deleteProperty(window, "chrome");
  });

  it("requests one bounded MPV surface recovery after active playback stops advancing", () => {
    const adapter = createPlayerAdapter(async () => null);
    adapter.setMediaKey("series:fixture:1:1");
    emit("time-pos", 1);
    emit("duration", 120);
    emit("pause", false);

    vi.advanceTimersByTime(15_000);
    expect(postMessage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postMessage.mock.calls[0]![0])).toMatchObject({
      args: ["mpv-recover-playback", true],
    });

    vi.advanceTimersByTime(60_000);
    expect(postMessage).toHaveBeenCalledTimes(1);
    adapter.destroy();
  });

  it("does not recover paused playback or playback outside the player route", () => {
    const adapter = createPlayerAdapter(async () => null);
    adapter.setMediaKey("series:fixture:1:1");
    emit("time-pos", 1);
    emit("pause", true);
    vi.advanceTimersByTime(60_000);
    expect(postMessage).not.toHaveBeenCalled();

    emit("pause", false);
    location.hash = "#/detail/series/fixture/fixture%3A1%3A1";
    vi.advanceTimersByTime(60_000);
    expect(postMessage).not.toHaveBeenCalled();
    adapter.destroy();
  });

  function emit(name: string, data: unknown) {
    listener?.(new MessageEvent("message", {
      data: ["mpv-prop-change", { name, data }],
    }));
  }
});
