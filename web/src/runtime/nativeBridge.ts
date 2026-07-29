import { isRecord, unwrapNativeEvent } from "./nativeEvents";

const METHODS = {
  reviews: "jstremio-reviews",
  "timestamp-notes": "jstremio-timestamp-notes",
  plugins: "jstremio-plugins",
  "last-played": "jstremio-last-played",
  themes: "jstremio-themes",
  "mini-player": "jstremio-mini-player",
  "playback-history": "jstremio-playback-history",
  "skip-segments": "jstremio-skip-segments",
  "phone-remote": "jstremio-phone-remote",
} as const;
const MAX_REQUEST_BYTES = 60 * 1024;
const DEFAULT_TIMEOUT_MS = 7_500;

type Pending = {
  event: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class NativeBridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NativeBridgeError";
    this.code = code;
  }
}

export function createNativeBridge() {
  let nextRequestId = 1_000_000;
  const pending = new Map<number, Pending>();
  const channel = window.chrome?.webview;

  const onMessage = (event: MessageEvent) => {
    const nativeEvent = unwrapNativeEvent(event.data);
    if (!nativeEvent) return;
    const [eventName, payload] = nativeEvent;
    if (!isRecord(payload) || typeof payload.requestId !== "number") return;
    const request = pending.get(payload.requestId);
    if (!request || request.event !== eventName) return;
    pending.delete(payload.requestId);
    clearTimeout(request.timer);
    if (payload.ok === true) {
      request.resolve(payload.result);
      return;
    }
    const error = isRecord(payload.error) ? payload.error : {};
    request.reject(
      new NativeBridgeError(
        typeof error.code === "string" ? error.code : "native_error",
        typeof error.message === "string" ? error.message : "The local operation failed.",
      ),
    );
  };

  channel?.addEventListener("message", onMessage);

  const request = (
    namespace: keyof typeof METHODS,
    operation: string,
    payload: unknown = {},
    options: { timeoutMs?: number } = {},
  ): Promise<unknown> => {
    if (!channel) {
      return Promise.reject(
        new NativeBridgeError("shell_unavailable", "The JStremio shell channel is unavailable."),
      );
    }
    if (!(namespace in METHODS) || !operation || operation.length > 64) {
      return Promise.reject(new NativeBridgeError("invalid_request", "The local request is invalid."));
    }
    const id = nextRequestId++;
    const method = METHODS[namespace];
    const message = JSON.stringify({ id, args: [method, { operation, payload }] });
    if (new TextEncoder().encode(message).byteLength > MAX_REQUEST_BYTES) {
      return Promise.reject(
        new NativeBridgeError("message_too_large", "The local request exceeds the size limit."),
      );
    }
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 250), 30_000);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new NativeBridgeError("timeout", "The local operation timed out."));
      }, timeoutMs);
      pending.set(id, { event: `${method}-response`, resolve, reject, timer });
      try {
        channel.postMessage(message);
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(new NativeBridgeError("shell_unavailable", "The JStremio shell channel failed."));
      }
    });
  };

  const destroy = () => {
    channel?.removeEventListener("message", onMessage);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new NativeBridgeError("unloaded", "The page was unloaded."));
    }
    pending.clear();
  };

  return { request, destroy };
}
