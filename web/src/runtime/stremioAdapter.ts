import type { MediaTarget, MediaType } from "./types";
import { isRecord } from "./nativeEvents";

const CORE_TIMEOUT_MS = 4_000;

export async function getPlayerState(): Promise<unknown> {
  const core = await waitForCore();
  return await Promise.resolve(core.getState("player"));
}

export async function getCurrentMediaTarget(): Promise<MediaTarget | null> {
  try {
    return deriveMediaTarget(await getPlayerState());
  } catch {
    return null;
  }
}

export function deriveMediaTarget(state: unknown): MediaTarget | null {
  if (!isRecord(state)) return null;
  const selected = record(state.selected);
  const streamRequest = record(selected?.streamRequest);
  const path = record(streamRequest?.path);
  const metaItem = record(state.metaItem);
  const content = record(metaItem?.content);
  const seriesInfo = record(state.seriesInfo);
  const videos = Array.isArray(content?.videos) ? content.videos : [];

  const videoId = firstString(path?.id, selected?.videoId, state.videoId);
  const metaId = firstString(content?.id, path?.metaId, state.metaId);
  const mediaType = normalizeMediaType(firstString(content?.type, path?.type, state.type));
  if (!videoId || !metaId || !mediaType) return null;

  const video = videos.find((candidate) => isRecord(candidate) && candidate.id === videoId);
  const videoRecord = record(video);
  const season = firstInteger(videoRecord?.season, seriesInfo?.season, selected?.season);
  const episode = firstInteger(videoRecord?.episode, seriesInfo?.episode, selected?.episode);
  const target: MediaTarget = {
    key: `${mediaType}:${videoId}`,
    videoId,
    metaId,
    mediaType,
    name: firstNullableString(content?.name, state.name),
    title: firstNullableString(videoRecord?.title, selected?.title, state.title),
    season: mediaType === "series" ? season : null,
    episode: mediaType === "series" ? episode : null,
    poster: firstNullableString(content?.poster, content?.background),
  };
  return target;
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
