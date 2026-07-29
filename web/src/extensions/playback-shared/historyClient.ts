import type { JStremioRuntime } from "../../runtime/types";
import { asPlaybackHistoryPage, type PlaybackSession, type PlaybackSessionInput } from "./model";

type AnyBridgeRequest = (
  namespace: string,
  operation: string,
  payload?: unknown,
  options?: { timeoutMs?: number },
) => Promise<unknown>;

export function historyRequest(
  runtime: JStremioRuntime,
  operation: string,
  payload: unknown = {},
): Promise<unknown> {
  const request = runtime.bridge.request as unknown as AnyBridgeRequest;
  return request("playback-history", operation, payload);
}

export function upsertPlaybackSession(
  runtime: JStremioRuntime,
  session: PlaybackSessionInput,
): Promise<unknown> {
  return historyRequest(runtime, "upsert", session);
}

export async function listAllPlaybackSessions(
  runtime: JStremioRuntime,
  options: { since?: string; until?: string; annotatedOnly?: boolean } = {},
): Promise<PlaybackSession[]> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sessions = new Map<string, PlaybackSession>();
    let offset = 0;
    let revision: number | null = null;
    let changed = false;
    for (let pageNumber = 0; pageNumber < 25; pageNumber += 1) {
      const page = asPlaybackHistoryPage(await historyRequest(runtime, "list", {
        ...options,
        offset,
        limit: 500,
        ...(revision === null ? {} : { revision }),
      }));
      if (page.revisionChanged || (revision !== null && page.revision !== revision)) {
        changed = true;
        break;
      }
      revision ??= page.revision;
      for (const session of page.items) sessions.set(session.id, session);
      if (page.nextOffset === null || page.nextOffset <= offset || page.nextOffset >= page.total) break;
      offset = page.nextOffset;
    }
    if (!changed) return [...sessions.values()];
  }
  throw new Error("Playback history changed while it was being loaded. Please try again.");
}
