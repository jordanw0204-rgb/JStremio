import { isRecord, unwrapNativeEvent } from "./nativeEvents";
import type { MediaTarget, PlaybackSnapshot } from "./types";

type TargetProvider = () => Promise<MediaTarget | null>;
type Listener = (snapshot: PlaybackSnapshot | null) => void;
type BridgeRequest = (
      namespace: "reviews" | "timestamp-notes" | "plugins" | "last-played",
  operation: string,
  payload?: unknown,
  options?: { timeoutMs?: number },
) => Promise<unknown>;

const PLAYER_WATCHDOG_INTERVAL_MS = 1_000;
const PLAYER_STALL_RECOVERY_MS = 15_000;
const PLAYER_RECOVERY_COOLDOWN_MS = 30_000;
const PLAYER_PROGRESS_EPSILON_MS = 250;

export function parseMpvPropertyEvent(input: unknown): Partial<PlaybackSnapshot> | null {
  const nativeEvent = unwrapNativeEvent(input);
  if (!nativeEvent || nativeEvent[0] !== "mpv-prop-change" || !isRecord(nativeEvent[1])) {
    return null;
  }
  const name = nativeEvent[1].name;
  const data = nativeEvent[1].data;
  if (name === "time-pos" && typeof data === "number" && Number.isFinite(data) && data >= 0) {
    return { positionMs: Math.round(data * 1_000) };
  }
  if (name === "duration" && typeof data === "number" && Number.isFinite(data) && data > 0) {
    return { durationMs: Math.round(data * 1_000) };
  }
  if (name === "pause" && typeof data === "boolean") return { paused: data };
  if (name === "seeking" && typeof data === "boolean") return { seeking: data };
  return null;
}

export function createPlayerAdapter(getTarget: TargetProvider, bridgeRequest?: BridgeRequest) {
  let snapshot: PlaybackSnapshot | null = null;
  let mediaKey: string | null = null;
  let notifyScheduled = false;
  let commandId = 2_000_000;
  let observedPositionMs: number | null = null;
  let lastProgressAt = Date.now();
  let lastRecoveryAt = Number.NEGATIVE_INFINITY;
  let recoveredSinceProgress = false;
  const listeners = new Set<Listener>();
  const channel = window.chrome?.webview;

  const notify = () => {
    if (notifyScheduled) return;
    notifyScheduled = true;
    const schedule = window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 16));
    schedule(() => {
      notifyScheduled = false;
      const value = cloneSnapshot(snapshot);
      for (const listener of listeners) listener(value);
    });
  };

  const onMessage = (event: MessageEvent) => {
    const update = parseMpvPropertyEvent(event.data);
    if (!update) return;
    snapshot = {
      positionMs: snapshot?.positionMs ?? null,
      durationMs: snapshot?.durationMs ?? null,
      paused: snapshot?.paused ?? null,
      seeking: snapshot?.seeking ?? false,
      ...update,
      updatedAt: Date.now(),
    };
    notify();
  };
  channel?.addEventListener("message", onMessage);

  const setMediaKey = (nextKey: string | null) => {
    if (mediaKey === nextKey) return;
    const shouldReset = mediaKey !== null || nextKey === null;
    mediaKey = nextKey;
    if (shouldReset) {
      snapshot = null;
      notify();
    }
    observedPositionMs = snapshot?.positionMs ?? null;
    lastProgressAt = Date.now();
    recoveredSinceProgress = false;
  };

  const postProperty = (name: "time-pos" | "pause", value: number | boolean) => {
    if (!channel) throw new Error("The local MPV channel is unavailable.");
    channel.postMessage(JSON.stringify({ id: commandId++, args: ["mpv-set-prop", [name, value]] }));
  };

  const postCommand = (args: string[]) => {
    if (!channel) throw new Error("The local MPV channel is unavailable.");
    channel.postMessage(JSON.stringify({ id: commandId++, args: ["mpv-command", args] }));
  };

  const watchdog = window.setInterval(() => {
    const now = Date.now();
    const positionMs = snapshot?.positionMs;
    const active =
      Boolean(channel && mediaKey && isPlayerRoute(location.hash)) &&
      document.visibilityState !== "hidden" &&
      snapshot?.paused === false &&
      snapshot.seeking !== true &&
      positionMs !== null &&
      positionMs !== undefined;
    if (!active) {
      observedPositionMs = positionMs ?? null;
      lastProgressAt = now;
      return;
    }
    if (
      observedPositionMs === null ||
      positionMs > observedPositionMs + PLAYER_PROGRESS_EPSILON_MS ||
      positionMs < observedPositionMs - PLAYER_PROGRESS_EPSILON_MS
    ) {
      observedPositionMs = positionMs;
      lastProgressAt = now;
      recoveredSinceProgress = false;
      return;
    }
    if (
      !recoveredSinceProgress &&
      now - lastProgressAt >= PLAYER_STALL_RECOVERY_MS &&
      now - lastRecoveryAt >= PLAYER_RECOVERY_COOLDOWN_MS
    ) {
      channel!.postMessage(
        JSON.stringify({ id: commandId++, args: ["mpv-recover-playback", true] }),
      );
      recoveredSinceProgress = true;
      lastRecoveryAt = now;
      lastProgressAt = now;
    }
  }, PLAYER_WATCHDOG_INTERVAL_MS);

  const seekTo = async (positionMs: number) => {
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (activation && !activation.isActive) throw new Error("Seeking requires a direct user action.");
    const target = await getTarget();
    if (!target || target.key !== mediaKey || !snapshot || !Number.isFinite(positionMs) || positionMs < 0) {
      throw new Error("The active player cannot seek to this note.");
    }
    const clamped = snapshot.durationMs === null ? positionMs : Math.min(positionMs, snapshot.durationMs);
    postProperty("time-pos", clamped / 1_000);
  };

  const setPaused = async (paused: boolean) => {
    const target = await getTarget();
    if (!target || target.key !== mediaKey || typeof paused !== "boolean") {
      throw new Error("The active player cannot change pause state.");
    }
    postProperty("pause", paused);
  };

  const captureFrame = async () => {
    const target = await getTarget();
    if (!target || target.key !== mediaKey || !snapshot || !bridgeRequest) {
      throw new Error("The active player cannot capture this frame.");
    }
    const prepared = await bridgeRequest("timestamp-notes", "prepareFrameCapture", {});
    if (!isRecord(prepared) || typeof prepared.thumbnailId !== "string" || typeof prepared.path !== "string") {
      throw new Error("The frame capture could not be prepared.");
    }
    postCommand(["screenshot-to-file", prepared.path, "video"]);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        await bridgeRequest("timestamp-notes", "completeFrameCapture", { thumbnailId: prepared.thumbnailId });
        return prepared.thumbnailId;
      } catch (error) {
        if (attempt === 19) throw error;
      }
    }
    throw new Error("The frame thumbnail was not created.");
  };

  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    listener(cloneSnapshot(snapshot));
    return () => listeners.delete(listener);
  };

  const destroy = () => {
    channel?.removeEventListener("message", onMessage);
    window.clearInterval(watchdog);
    listeners.clear();
  };

  return {
    publicApi: {
      getSnapshot: () => cloneSnapshot(snapshot),
      subscribe,
      seekTo,
      setPaused,
      captureFrame,
    },
    setMediaKey,
    destroy,
  };
}

function isPlayerRoute(route: string): boolean {
  try {
    return /^#\/player(?:\/|$)/i.test(decodeURIComponent(route));
  } catch {
    return false;
  }
}

function cloneSnapshot(snapshot: PlaybackSnapshot | null): PlaybackSnapshot | null {
  return snapshot ? { ...snapshot } : null;
}
