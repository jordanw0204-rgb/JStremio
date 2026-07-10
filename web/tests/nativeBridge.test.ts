import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeBridge } from "../src/runtime/nativeBridge";

describe("native bridge correlation", () => {
  afterEach(() => {
    delete window.chrome;
  });

  it("correlates namespaced responses and ignores unrelated events", async () => {
    const listeners = new Set<(event: MessageEvent) => void>();
    const postMessage = vi.fn((message: string) => {
      const request = JSON.parse(message) as { id: number; args: [string] };
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener(new MessageEvent("message", { data: { args: ["unrelated", {}] } }));
          listener(
            new MessageEvent("message", {
              data: {
                args: [
                  `${request.args[0]}-response`,
                  { requestId: request.id, ok: true, result: { revision: 2 } },
                ],
              },
            }),
          );
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
    await expect(bridge.request("reviews", "health")).resolves.toEqual({ revision: 2 });
    expect(postMessage).toHaveBeenCalledOnce();
    bridge.destroy();
  });
});
