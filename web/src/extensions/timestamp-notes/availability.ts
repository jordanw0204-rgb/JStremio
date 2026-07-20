import type { MediaTarget, PlaybackSnapshot } from "../../runtime/types";

export function timestampNotesDisabledReason(
  target: MediaTarget | null,
  snapshot: PlaybackSnapshot | null,
  live: boolean,
  remote: boolean,
): string | null {
  if (!target?.videoId) return "No stable movie or episode is active.";
  if (remote) return "Timestamp notes require local MPV playback.";
  if (live) return "Timestamp notes are unavailable for live streams.";
  if (!snapshot || snapshot.positionMs === null || !Number.isFinite(snapshot.positionMs)) {
    return "The current playback time is unavailable.";
  }
  if (snapshot.durationMs === null || !Number.isFinite(snapshot.durationMs) || snapshot.durationMs <= 0) {
    return "This stream has no finite on-demand duration.";
  }
  return null;
}
