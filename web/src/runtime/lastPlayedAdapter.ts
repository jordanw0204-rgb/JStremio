import type { MediaTarget } from "./types";
import { isRecord } from "./nativeEvents";

export function extractLastPlayedInput(state: unknown, target: MediaTarget, positionMs: number | null) {
  if (!isRecord(state)) return null;
  const selected = isRecord(state.selected) ? state.selected : null;
  const stream = selected && isRecord(selected.stream) ? selected.stream : null;
  const deepLinks = stream && isRecord(stream.deepLinks) ? stream.deepLinks : null;
  const playerDeepLink = normalizePlayerRoute(deepLinks?.player);
  if (!stream || !playerDeepLink) return null;
  const addon = isRecord(state.addon) ? state.addon : null;
  const addonManifest = addon && isRecord(addon.manifest) ? addon.manifest : null;
  return {
    videoId:target.videoId,metaId:target.metaId,mediaType:target.mediaType,name:target.name,title:target.title,
    season:target.season,episode:target.episode,poster:target.poster,
    playerDeepLink, streamKey:createStreamKey(stream,playerDeepLink), addonName:limitedString(addonManifest?.name),
    streamName:limitedString(stream.name), streamDescription:limitedString(stream.description),
    positionMs:typeof positionMs === "number" && Number.isFinite(positionMs) && positionMs >= 0 ? Math.round(positionMs) : null,
  };
}

export function createStreamKey(stream: Record<string, unknown>, playerDeepLink: string): string {
  const infoHash=limitedString(stream.infoHash)?.toLowerCase();
  const fileIdx=typeof stream.fileIdx === "number" || typeof stream.fileIdx === "string" ? String(stream.fileIdx) : "";
  if(infoHash) return `torrent:${infoHash}:${fileIdx}`;
  const url=limitedString(stream.url); return url ? `url:${url}` : `route:${playerDeepLink}`;
}

export function normalizePlayerRoute(value: unknown): string | null {
  if(typeof value !== "string" || value.length > 32_768) return null;
  const route=value.trim(); if(route.startsWith("#/")) return route; if(route.startsWith("/")) return `#${route}`; return null;
}

function limitedString(value: unknown) { return typeof value === "string" && value.trim() && value.length <= 4_096 ? value : null; }
