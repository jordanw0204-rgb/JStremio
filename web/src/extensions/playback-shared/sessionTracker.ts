import { isPlayerRoute } from "../../runtime/compatibility";
import type { JStremioRuntime, MediaTarget, PlaybackSnapshot } from "../../runtime/types";
import { targetPayload } from "../shared";
import { historyRequest, upsertPlaybackSession } from "./historyClient";
import type { PlaybackSessionInput } from "./model";

type ActiveSession = PlaybackSessionInput & {
  key: string;
  lastSnapshot: PlaybackSnapshot;
  lastSampledAt: number;
  dirty: boolean;
};

type PendingSample = {
  snapshot: PlaybackSnapshot | null;
  sampledAt: number;
};

type SharedTracker = {
  runtime: JStremioRuntime;
  leases: number;
  releaseRuntime: () => void;
  flushTimer: number;
  active: ActiveSession | null;
  processing: Promise<void>;
  processingSamples: boolean;
  pendingSample: PendingSample | null;
  persisting: Promise<void>;
  pendingPersist: { generation: number; session: PlaybackSessionInput } | null;
  generation: number;
  suspended: boolean;
  destroyed: boolean;
};

const TRACKER_KEY = Symbol.for("JStremio.playback-session-tracker.v1");
const MAX_SAMPLE_GAP_MS = 15_000;
const MAX_PLAYBACK_SPEED = 4;
const POSITION_TOLERANCE_MS = 2_000;
const MIN_PERSISTED_WATCH_MS = 5_000;
const CHECKPOINT_INTERVAL_MS = 60_000;

export function acquirePlaybackSessionTracker(runtime: JStremioRuntime): () => void {
  const global = window as unknown as Record<PropertyKey, unknown>;
  let tracker = global[TRACKER_KEY] as SharedTracker | undefined;
  if (!tracker || tracker.destroyed) {
    tracker = createTracker(runtime);
    global[TRACKER_KEY] = tracker;
  }
  tracker.leases += 1;
  return () => {
    if (!tracker || tracker.leases === 0) return;
    tracker.leases -= 1;
    if (tracker.leases === 0) {
      finalize(tracker, Date.now());
      tracker.destroyed = true;
      tracker.releaseRuntime();
      window.clearInterval(tracker.flushTimer);
      delete global[TRACKER_KEY];
    }
  };
}

export async function mutateTrackedPlaybackHistory(
  runtime: JStremioRuntime,
  operation: "clear" | "delete",
  payload: unknown = {},
): Promise<unknown> {
  const global = window as unknown as Record<PropertyKey, unknown>;
  const tracker = global[TRACKER_KEY] as SharedTracker | undefined;
  if (!tracker || tracker.destroyed) return historyRequest(runtime, operation, payload);

  tracker.suspended = true;
  tracker.generation += 1;
  tracker.pendingSample = null;
  tracker.pendingPersist = null;
  const deletedId = operation === "delete" && isRecord(payload) && typeof payload.id === "string"
    ? payload.id
    : null;
  if (operation === "clear" || tracker.active?.id === deletedId) tracker.active = null;
  await tracker.processing;
  await tracker.persisting;
  try {
    return await historyRequest(runtime, operation, payload);
  } finally {
    tracker.suspended = false;
  }
}

export function accumulatedWatchTime(
  previous: PlaybackSnapshot,
  current: PlaybackSnapshot,
  elapsedMs: number,
): number {
  if (
    previous.paused !== false
    || previous.seeking
    || current.seeking
    || previous.positionMs === null
    || current.positionMs === null
    || elapsedMs <= 0
    || elapsedMs > MAX_SAMPLE_GAP_MS
  ) return 0;
  const positionDelta = current.positionMs - previous.positionMs;
  const plausibleMaximum = elapsedMs * MAX_PLAYBACK_SPEED + POSITION_TOLERANCE_MS;
  if (positionDelta <= 0 || positionDelta > plausibleMaximum) return 0;
  return Math.round(elapsedMs);
}

function createTracker(runtime: JStremioRuntime): SharedTracker {
  const tracker: SharedTracker = {
    runtime,
    leases: 0,
    releaseRuntime: () => undefined,
    flushTimer: 0,
    active: null,
    processing: Promise.resolve(),
    processingSamples: false,
    pendingSample: null,
    persisting: Promise.resolve(),
    pendingPersist: null,
    generation: 0,
    suspended: false,
    destroyed: false,
  };
  let cachedTargetRoute: string | null = null;
  let cachedTarget: MediaTarget | null = null;

  const clearCachedTarget = () => {
    cachedTargetRoute = null;
    cachedTarget = null;
  };
  const resolveTarget = async (snapshot: PlaybackSnapshot | null) => {
    if (!snapshot || !isPlayerRoute()) return null;
    const route = location.hash;
    if (cachedTargetRoute === route && cachedTarget) return cachedTarget;
    const next = await runtime.stremio.getCurrentMediaTarget();
    if (tracker.destroyed || tracker.suspended || location.hash !== route || !isPlayerRoute()) return null;
    if (next) {
      cachedTargetRoute = route;
      cachedTarget = next;
    }
    return next;
  };
  const drainSamples = () => {
    if (tracker.processingSamples || tracker.destroyed || tracker.suspended) return;
    tracker.processingSamples = true;
    tracker.processing = (async () => {
      while (tracker.pendingSample) {
        const sample = tracker.pendingSample;
        tracker.pendingSample = null;
        if (tracker.destroyed || tracker.suspended) continue;
        const target = await resolveTarget(sample.snapshot);
        if (tracker.destroyed || tracker.suspended) continue;
        applySample(tracker, target, sample.snapshot, sample.sampledAt);
      }
    })()
      .catch((error) => runtime.diagnostics.report("playback-tracker", error))
      .finally(() => {
        tracker.processingSamples = false;
        if (tracker.pendingSample && !tracker.destroyed && !tracker.suspended) drainSamples();
      });
  };
  const queueSnapshot = (snapshot: PlaybackSnapshot | null) => {
    if (tracker.destroyed || tracker.suspended) return;
    const updatedAt = snapshot?.updatedAt;
    tracker.pendingSample = {
      snapshot: snapshot ? { ...snapshot } : null,
      sampledAt: typeof updatedAt === "number" && Number.isFinite(updatedAt) && updatedAt > 0
        ? updatedAt
        : Date.now(),
    };
    drainSamples();
  };
  const unsubscribe = runtime.player.subscribe(queueSnapshot);
  const unsubscribeRoute = runtime.lifecycle.onRouteChange(() => {
    clearCachedTarget();
    queueSnapshot(null);
  });
  const onUnload = () => finalize(tracker, Date.now());
  window.addEventListener("unload", onUnload, { once: true });
  tracker.releaseRuntime = () => {
    unsubscribe();
    unsubscribeRoute();
    window.removeEventListener("unload", onUnload);
  };
  tracker.flushTimer = window.setInterval(() => flush(tracker), CHECKPOINT_INTERVAL_MS);
  return tracker;
}

function applySample(
  tracker: SharedTracker,
  target: MediaTarget | null,
  snapshot: PlaybackSnapshot | null,
  now: number,
) {
  if (!target || !snapshot || snapshot.positionMs === null) {
    finalize(tracker, now);
    return;
  }
  if (!tracker.active || tracker.active.key !== target.key) {
    finalize(tracker, now);
    const timestamp = new Date(now).toISOString();
    tracker.active = {
      id: sessionId(now),
      key: target.key,
      ...targetPayload(target),
      startedAt: timestamp,
      lastSeenAt: timestamp,
      endedAt: null,
      watchedMs: 0,
      startPositionMs: Math.round(snapshot.positionMs),
      endPositionMs: Math.round(snapshot.positionMs),
      maxPositionMs: Math.round(snapshot.positionMs),
      durationMs: snapshot.durationMs === null ? null : Math.round(snapshot.durationMs),
      completed: false,
      lastSnapshot: { ...snapshot },
      lastSampledAt: now,
      dirty: false,
    };
    return;
  }

  const active = tracker.active;
  const watched = accumulatedWatchTime(active.lastSnapshot, snapshot, now - active.lastSampledAt);
  active.watchedMs += watched;
  active.endPositionMs = Math.round(snapshot.positionMs);
  active.maxPositionMs = Math.max(active.maxPositionMs, active.endPositionMs);
  if (snapshot.durationMs !== null && snapshot.durationMs > 0) {
    active.durationMs = Math.round(snapshot.durationMs);
  }
  active.completed ||= active.watchedMs >= MIN_PERSISTED_WATCH_MS
    && active.durationMs !== null
    && active.maxPositionMs >= active.durationMs * 0.9;
  active.lastSeenAt = new Date(now).toISOString();
  active.lastSnapshot = { ...snapshot };
  active.lastSampledAt = now;
  active.dirty ||= watched > 0;
  if (snapshot.paused === true) flush(tracker);
}

function finalize(tracker: SharedTracker, now: number) {
  if (!tracker.active) return;
  tracker.active.endedAt = new Date(now).toISOString();
  tracker.active.lastSeenAt = tracker.active.endedAt;
  tracker.active.dirty = true;
  flush(tracker);
  tracker.active = null;
}

function flush(tracker: SharedTracker) {
  const active = tracker.active;
  if (!active?.dirty || active.watchedMs < MIN_PERSISTED_WATCH_MS || tracker.suspended) return;
  active.dirty = false;
  const { key: _key, lastSnapshot: _snapshot, lastSampledAt: _sampled, dirty: _dirty, ...session } = active;
  tracker.pendingPersist = { generation: tracker.generation, session: { ...session } };
  tracker.persisting = tracker.persisting
    .then(async () => {
      const pending = tracker.pendingPersist;
      tracker.pendingPersist = null;
      if (!pending || pending.generation !== tracker.generation || tracker.suspended) return;
      await upsertPlaybackSession(tracker.runtime, pending.session);
    })
    .catch((error) => tracker.runtime.diagnostics.report("playback-tracker", error));
}

function sessionId(now: number): string {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
