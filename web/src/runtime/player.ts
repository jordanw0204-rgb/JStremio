import { isRecord, unwrapNativeEvent } from "./nativeEvents";
import type {
  MediaTarget,
  PlaybackSnapshot,
  PlayerPropertyName,
  PlayerSeekGuard,
  PlayerSettablePropertyName,
} from "./types";

type TargetProvider = () => Promise<MediaTarget | null>;
type Listener = (snapshot: PlaybackSnapshot | null) => void;
type PropertyListener = (value: unknown) => void;
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
const NEXT_VIDEO_TRANSITION_TTL_MS = 15_000;
const NEXT_VIDEO_END_WINDOW_MS = 120_000;
const INHERITED_POSITION_EPSILON_MS = 15_000;

type NextVideoTransition = {
  armedAt: number;
  fromKey: string | null;
  fromPositionMs: number | null;
  fromDurationMs: number | null;
  toKey: string | null;
  lowPositionSince: number | null;
};

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
  let activeDirectPointerId: number | null = null;
  let nextVideoTransition: NextVideoTransition | null = null;
  const listeners = new Set<Listener>();
  const propertyListeners = new Map<PlayerPropertyName, Set<PropertyListener>>();
  const propertyValues = new Map<PlayerPropertyName, unknown>();
  const observedProperties = new Set<PlayerPropertyName>();
  const seekGuards = new Set<PlayerSeekGuard>();
  const channel = window.chrome?.webview;

  const beginDirectPointerAction = (event: PointerEvent) => {
    if (event.isTrusted && event.isPrimary && event.button === 0) activeDirectPointerId = event.pointerId;
  };
  const endDirectPointerAction = (event?: PointerEvent) => {
    if (!event || event.pointerId === activeDirectPointerId) activeDirectPointerId = null;
  };
  const endDirectPointerActionWhenHidden = () => {
    if (document.visibilityState === "hidden") endDirectPointerAction();
  };
  const endDirectPointerActionOnBlur = () => endDirectPointerAction();
  window.addEventListener("pointerdown", beginDirectPointerAction, true);
  window.addEventListener("pointerup", endDirectPointerAction, true);
  window.addEventListener("pointercancel", endDirectPointerAction, true);
  window.addEventListener("blur", endDirectPointerActionOnBlur);
  document.addEventListener("visibilitychange", endDirectPointerActionWhenHidden);

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
    const nativeEvent = unwrapNativeEvent(event.data);
    if (nativeEvent?.[0] === "mpv-prop-change" && isRecord(nativeEvent[1])) {
      const name = nativeEvent[1].name;
      if (isPlayerPropertyName(name)) {
        propertyValues.set(name, nativeEvent[1].data);
        for (const listener of propertyListeners.get(name) ?? []) listener(nativeEvent[1].data);
      }
    }
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
    correctInheritedNextVideoPosition();
    notify();
  };
  channel?.addEventListener("message", onMessage);

  const setMediaKey = (nextKey: string | null) => {
    if (mediaKey === nextKey) return;
    const shouldReset = mediaKey !== null || nextKey === null;
    mediaKey = nextKey;
    if (
      nextVideoTransition &&
      nextKey &&
      nextVideoTransition.fromKey &&
      nextKey !== nextVideoTransition.fromKey
    ) {
      nextVideoTransition.toKey = nextKey;
      nextVideoTransition.lowPositionSince = null;
    }
    if (shouldReset) {
      snapshot = null;
      notify();
    }
    observedPositionMs = snapshot?.positionMs ?? null;
    lastProgressAt = Date.now();
    recoveredSinceProgress = false;
  };

  const postProperty = (
    name: "time-pos" | "pause" | PlayerSettablePropertyName,
    value: number | boolean | string,
  ) => {
    if (!channel) throw new Error("The local MPV channel is unavailable.");
    channel.postMessage(JSON.stringify({ id: commandId++, args: ["mpv-set-prop", [name, value]] }));
  };

  const postCommand = (args: string[]) => {
    if (!channel) throw new Error("The local MPV channel is unavailable.");
    channel.postMessage(JSON.stringify({ id: commandId++, args: ["mpv-command", args] }));
  };

  const beginNextVideoTransition = () => {
    nextVideoTransition = {
      armedAt: Date.now(),
      fromKey: mediaKey,
      fromPositionMs: snapshot?.positionMs ?? null,
      fromDurationMs: snapshot?.durationMs ?? null,
      toKey: null,
      lowPositionSince: null,
    };
  };

  function correctInheritedNextVideoPosition() {
    const transition = nextVideoTransition;
    if (!transition) return;
    const now = Date.now();
    if (now - transition.armedAt > NEXT_VIDEO_TRANSITION_TTL_MS) {
      nextVideoTransition = null;
      return;
    }
    if (!transition.toKey || mediaKey !== transition.toKey || !snapshot) return;
    const positionMs = snapshot.positionMs;
    if (positionMs === null) return;

    // Stremio advances its selected video before unloading the old player. If
    // the old episode's end timestamp is observed in that gap, the new library
    // item can inherit it and start at (or very near) its own ending.
    const oldWasEnding = transition.fromPositionMs !== null && transition.fromDurationMs !== null &&
      transition.fromPositionMs >= Math.max(0, transition.fromDurationMs - NEXT_VIDEO_END_WINDOW_MS);
    if (!oldWasEnding) {
      nextVideoTransition = null;
      return;
    }
    const matchesOldPosition = transition.fromPositionMs !== null &&
      Math.abs(positionMs - transition.fromPositionMs) <= INHERITED_POSITION_EPSILON_MS;
    const nearNewEnding = snapshot.durationMs !== null &&
      positionMs >= Math.max(0, snapshot.durationMs - Math.max(30_000, snapshot.durationMs * 0.03));
    if (matchesOldPosition || nearNewEnding) {
      postProperty("time-pos", 0);
      nextVideoTransition = null;
      return;
    }

    if (positionMs <= 10_000) {
      transition.lowPositionSince ??= now;
      if (now - transition.lowPositionSince >= 2_500) nextVideoTransition = null;
    } else {
      // A non-ending saved position belongs to the new video; preserve it.
      nextVideoTransition = null;
    }
  }

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

  const seekTo = async (positionMs: number, options: { bypassGuards?: boolean } = {}) => {
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (activation && !activation.isActive && activeDirectPointerId === null) {
      throw new Error("Seeking requires a direct user action.");
    }
    const target = await getTarget();
    if (!target || target.key !== mediaKey || !snapshot || !Number.isFinite(positionMs) || positionMs < 0) {
      throw new Error("The active player cannot seek to this note.");
    }
    const clamped = snapshot.durationMs === null ? positionMs : Math.min(positionMs, snapshot.durationMs);
    if (!options.bypassGuards) {
      for (const guard of seekGuards) {
        if (!await guard(clamped, { ...snapshot })) return;
      }
    }
    postProperty("time-pos", clamped / 1_000);
  };

  const restorePosition = async (positionMs: number) => {
    const target = await getTarget();
    if (!target || target.key !== mediaKey || !snapshot || !Number.isFinite(positionMs) || positionMs < 0) {
      throw new Error("The replacement stream is not ready to resume.");
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

  const observeProperty = (name: PlayerPropertyName, listener: PropertyListener) => {
    let listenersForName = propertyListeners.get(name);
    if (!listenersForName) {
      listenersForName = new Set();
      propertyListeners.set(name, listenersForName);
    }
    listenersForName.add(listener);
    if (propertyValues.has(name)) listener(propertyValues.get(name));
    if (!observedProperties.has(name)) {
      if (!channel) throw new Error("The local MPV channel is unavailable.");
      observedProperties.add(name);
      postObserveProperty(name);
    }
    return () => listenersForName?.delete(listener);
  };

  const postObserveProperty = (name: PlayerPropertyName) => {
    if (!channel) throw new Error("The local MPV channel is unavailable.");
    const args = name === "audio-device-list"
      ? ["mpv-get-audio-device-list", true]
      : ["mpv-observe-prop", name];
    channel.postMessage(JSON.stringify({ id: commandId++, args }));
  };

  const refreshProperty = (name: PlayerPropertyName) => postObserveProperty(name);

  const setProperty = async (name: PlayerSettablePropertyName, value: number | string) => {
    if (name === "volume") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 130) {
        throw new Error("The volume is invalid.");
      }
    } else if (typeof value !== "string" || !value.trim() || value.length > 2_048) {
      throw new Error("The audio output device is invalid.");
    }
    postProperty(name, value);
  };

  const addSeekGuard = (guard: PlayerSeekGuard) => {
    seekGuards.add(guard);
    return () => seekGuards.delete(guard);
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
    window.removeEventListener("pointerdown", beginDirectPointerAction, true);
    window.removeEventListener("pointerup", endDirectPointerAction, true);
    window.removeEventListener("pointercancel", endDirectPointerAction, true);
    window.removeEventListener("blur", endDirectPointerActionOnBlur);
    document.removeEventListener("visibilitychange", endDirectPointerActionWhenHidden);
    window.clearInterval(watchdog);
    listeners.clear();
    propertyListeners.clear();
    propertyValues.clear();
    seekGuards.clear();
  };

  return {
    publicApi: {
      getSnapshot: () => cloneSnapshot(snapshot),
      subscribe,
      seekTo,
      restorePosition,
      setPaused,
      observeProperty,
      refreshProperty,
      setProperty,
      addSeekGuard,
      captureFrame,
    },
    setMediaKey,
    beginNextVideoTransition,
    destroy,
  };
}

function isPlayerPropertyName(value: unknown): value is PlayerPropertyName {
  return value === "volume" || value === "audio-device" || value === "audio-device-list";
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
