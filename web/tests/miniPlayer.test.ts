import { afterEach, describe, expect, it, vi } from "vitest";
import { asMiniPlayerState, isPlayerRoute } from "../src/extensions/mini-player/model";
import { syncMiniPlayerUiState } from "../src/extensions/mini-player/ui";
import { createNativeBridge } from "../src/runtime/nativeBridge";

describe("mini player", () => {
  afterEach(() => {
    delete window.chrome;
    location.hash = "";
  });

  it("accepts complete native state and rejects malformed bounds", () => {
    expect(asMiniPlayerState({
      enabled: true,
      topmost: true,
      bounds: { x: -1200, y: 40, width: 640, height: 408 },
    })).toEqual({
      enabled: true,
      topmost: true,
      bounds: { x: -1200, y: 40, width: 640, height: 408 },
    });
    expect(asMiniPlayerState({
      enabled: true,
      topmost: true,
      bounds: { x: 0, y: 0, width: 0, height: 300 },
    })).toBeNull();
  });

  it("recognizes only player routes", () => {
    expect(isPlayerRoute("#/player/stream/meta/video")).toBe(true);
    expect(isPlayerRoute("#/detail/movie/tt1")).toBe(false);
  });

  it("does not create a MutationObserver feedback loop for unchanged UI state", async () => {
    const playerButton = document.createElement("button");
    const restoreButton = document.createElement("button");
    document.body.append(playerButton, restoreButton);
    syncMiniPlayerUiState(document.documentElement, playerButton, restoreButton, {
      enabled: false,
      busy: false,
    });

    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(document.documentElement, { attributes: true, subtree: true });

    syncMiniPlayerUiState(document.documentElement, playerButton, restoreButton, {
      enabled: false,
      busy: false,
    });
    await Promise.resolve();
    expect(mutations).toEqual([]);

    syncMiniPlayerUiState(document.documentElement, playerButton, restoreButton, {
      enabled: true,
      busy: true,
    });
    await Promise.resolve();
    expect(mutations.length).toBeGreaterThan(0);
    observer.disconnect();
    playerButton.remove();
    restoreButton.remove();
    delete document.documentElement.dataset.jstremioMiniPlayer;
  });

  it("uses the fixed mini-player native namespace", async () => {
    const listeners = new Set<(event: MessageEvent) => void>();
    const postMessage = vi.fn((message: string) => {
      const request = JSON.parse(message) as { id: number; args: [string, unknown] };
      expect(request.args[0]).toBe("jstremio-mini-player");
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener(new MessageEvent("message", {
            data: { args: [
              "jstremio-mini-player-response",
              {
                requestId: request.id,
                ok: true,
                result: {
                  enabled: true,
                  topmost: true,
                  bounds: { x: 10, y: 20, width: 640, height: 408 },
                },
              },
            ] },
          }));
        }
      });
    });
    window.chrome = {
      webview: {
        postMessage,
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener),
      },
    };
    const bridge = createNativeBridge();
    await expect(bridge.request("mini-player", "set", { enabled: true })).resolves.toMatchObject({
      enabled: true,
      topmost: true,
    });
    bridge.destroy();
  });
});
