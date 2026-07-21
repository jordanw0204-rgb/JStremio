import type { PlaybackSnapshot } from "../../runtime/types";

export const SEEK_STEP_MS = 5_000;
export const HOLD_START_DELAY_MS = 350;
export const HOLD_TICK_MS = 180;
export const HOLD_ACCELERATION_INTERVAL_MS = 700;
export const MAX_HOLD_MULTIPLIER = 8;

export function relativeSeekTarget(snapshot: PlaybackSnapshot | null, deltaMs: number): number | null {
  if (!snapshot || snapshot.positionMs === null || !Number.isFinite(deltaMs)) return null;
  const target = Math.max(0, snapshot.positionMs + deltaMs);
  return snapshot.durationMs === null ? target : Math.min(target, snapshot.durationMs);
}

export function holdSeekStepMs(heldMs: number, direction: -1 | 1, baseStepMs = SEEK_STEP_MS): number {
  const elapsedAfterStart = Math.max(0, heldMs - HOLD_START_DELAY_MS);
  const multiplier = Math.min(
    MAX_HOLD_MULTIPLIER,
    1 + Math.floor(elapsedAfterStart / HOLD_ACCELERATION_INTERVAL_MS),
  );
  return direction * baseStepMs * multiplier;
}
