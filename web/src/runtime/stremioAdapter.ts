import type { MediaTarget, MediaType, StreamOption } from "./types";
import { isRecord } from "./nativeEvents";

const CORE_TIMEOUT_MS = 4_000;

export async function getPlayerState(): Promise<unknown> {
  const core = await waitForCore();
  return await Promise.resolve(core.getState("player"));
}

export async function getCurrentMediaTarget(): Promise<MediaTarget | null> {
  try {
    return deriveMediaTarget(await getPlayerState(), location.hash);
  } catch {
    return null;
  }
}

export async function getStreamOptions(target: MediaTarget): Promise<StreamOption[]> {
  const core = await waitForCore();
  if (typeof core.dispatch !== "function") throw new Error("Stremio's stream loader is unavailable");
  await Promise.resolve(core.dispatch({
    action: "Load",
    args: {
      model: "MetaDetails",
      args: {
        metaPath: { resource: "meta", type: target.mediaType, id: target.metaId, extra: [] },
        streamPath: { resource: "stream", type: target.mediaType, id: target.videoId, extra: [] },
        guessStream: true,
      },
    },
  }, "meta_details"));

  const startedAt = Date.now();
  let best: StreamOption[] = [];
  let stableSince = startedAt;
  try {
    while (Date.now() - startedAt < 10_000) {
      const parsed = parseStreamOptions(await Promise.resolve(core.getState("meta_details")));
      if (parsed.options.length !== best.length) {
        best = parsed.options;
        stableSince = Date.now();
      } else if (parsed.options.length) {
        best = parsed.options;
      }
      if (best.length && (!parsed.loading || Date.now() - stableSince >= 1_200)) return best;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return best;
  } finally {
    if (/^#\/player(?:\/|$)/i.test(location.hash)) {
      void Promise.resolve(core.dispatch({ action: "Unload" }, "meta_details"));
    }
  }
}

export function parseStreamOptions(state: unknown): { options: StreamOption[]; loading: boolean } {
  if (!isRecord(state) || !Array.isArray(state.streams)) return { options: [], loading: true };
  const options: StreamOption[] = [];
  let loading = false;
  for (const groupValue of state.streams) {
    const group = record(groupValue);
    const content = record(group?.content);
    if (content?.type === "Loading") loading = true;
    if (content?.type !== "Ready" || !Array.isArray(content.content)) continue;
    const addon = record(group?.addon);
    const manifest = record(addon?.manifest);
    for (const streamValue of content.content) {
      const stream = record(streamValue);
      const deepLinks = record(stream?.deepLinks);
      const route = normalizePlayerRoute(deepLinks?.player);
      if (!stream || !route) continue;
      options.push({
        route,
        addonName: limitedString(manifest?.name),
        addonTransportUrl: limitedString(addon?.transportUrl),
        name: limitedString(stream.name),
        description: limitedString(stream.description),
        infoHash: limitedString(stream.infoHash)?.toLocaleLowerCase() ?? null,
        fileIdx: numberLikeString(stream.fileIdx),
        url: limitedString(stream.url),
        order: options.length,
      });
    }
  }
  return { options, loading };
}

export function deriveMediaTarget(state: unknown, route = ""): MediaTarget | null {
  if (!isRecord(state)) return null;
  const selected = record(state.selected);
  const streamRequest = record(selected?.streamRequest);
  const path = record(streamRequest?.path);
  const metaItem = record(state.metaItem);
  const content = record(metaItem?.content);
  const seriesInfo = record(state.seriesInfo);
  const videos = Array.isArray(content?.videos) ? content.videos : [];

  const selectedVideoId = firstString(path?.id, selected?.videoId, state.videoId);
  const routeIdentity = playerRouteMediaIdentity(route);
  const videoId = routeIdentity?.videoId ?? selectedVideoId;
  const metaId = routeIdentity?.metaId ?? firstString(content?.id, path?.metaId, state.metaId);
  const mediaType = routeIdentity?.mediaType ?? normalizeMediaType(firstString(content?.type, path?.type, state.type));
  if (!videoId || !metaId || !mediaType) return null;

  const video = videos.find((candidate) => isRecord(candidate) && candidate.id === videoId);
  const videoRecord = record(video);
  const routeOwnsSelection = !routeIdentity || selectedVideoId === videoId;
  const coordinates = episodeCoordinates(videoId);
  const season = firstInteger(
    videoRecord?.season,
    routeOwnsSelection ? seriesInfo?.season : null,
    routeOwnsSelection ? selected?.season : null,
    coordinates?.season,
  );
  const episode = firstInteger(
    videoRecord?.episode,
    routeOwnsSelection ? seriesInfo?.episode : null,
    routeOwnsSelection ? selected?.episode : null,
    coordinates?.episode,
  );
  const target: MediaTarget = {
    key: `${mediaType}:${videoId}`,
    videoId,
    metaId,
    mediaType,
    name: firstNullableString(content?.name, state.name),
    title: firstNullableString(
      videoRecord?.title,
      routeOwnsSelection ? selected?.title : null,
      routeOwnsSelection ? state.title : null,
    ),
    season: mediaType === "series" ? season : null,
    episode: mediaType === "series" ? episode : null,
    poster: firstNullableString(content?.poster, content?.background),
  };
  return target;
}

export function playerRouteMediaIdentity(route: string): {
  mediaType: MediaType;
  metaId: string;
  videoId: string;
} | null {
  if (typeof route !== "string" || route.length > 32_768) return null;
  const path = route.trim().replace(/^#/, "").split("?", 1)[0] ?? "";
  const match = path.match(/^\/player\/([^/]*)(?:\/([^/]*)\/([^/]*)\/([^/]*)\/([^/]*)\/([^/]*))?$/i);
  if (!match?.[4] || !match[5] || !match[6]) return null;
  try {
    const mediaType = normalizeMediaType(decodeURIComponent(match[4]));
    const metaId = decodeURIComponent(match[5]);
    const videoId = decodeURIComponent(match[6]);
    if (!mediaType || !firstString(metaId) || !firstString(videoId)) return null;
    return { mediaType, metaId, videoId };
  } catch {
    return null;
  }
}

export function canonicalDetailHash(target: MediaTarget): string {
  return `#/detail/${encodeURIComponent(target.mediaType)}/${encodeURIComponent(target.metaId)}/${encodeURIComponent(target.videoId)}`;
}

export function isLikelyLiveState(state: unknown): boolean {
  if (!isRecord(state)) return false;
  const selected = record(state.selected);
  const stream = record(selected?.stream);
  return state.isLive === true || selected?.isLive === true || stream?.isLive === true;
}

async function waitForCore(): Promise<NonNullable<Window["core"]>> {
  const started = Date.now();
  while (Date.now() - started < CORE_TIMEOUT_MS) {
    if (window.core && typeof window.core.getState === "function") return window.core;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Stremio core is unavailable");
}

function normalizePlayerRoute(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 32_768) return null;
  const route = value.trim();
  if (route.startsWith("#/player/")) return route;
  if (route.startsWith("/player/")) return `#${route}`;
  try {
    const hash = new URL(route, location.href).hash;
    return hash.startsWith("#/player/") ? hash : null;
  } catch {
    return null;
  }
}

function numberLikeString(value: unknown): string | null {
  return typeof value === "number" || typeof value === "string" ? String(value) : null;
}

function limitedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.length <= 4_096 ? value : null;
}

function normalizeMediaType(value: string | null): MediaType | null {
  if (value === "movie") return "movie";
  if (value === "series") return "series";
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() && value.length <= 512) return value;
  }
  return null;
}

function firstNullableString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() && value.length <= 4_096) return value;
  }
  return null;
}

function firstInteger(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}

function episodeCoordinates(videoId: string): { season: number; episode: number } | null {
  const match = videoId.match(/:(\d+):(\d+)$/);
  if (!match) return null;
  return { season: Number(match[1]), episode: Number(match[2]) };
}
