import { isRecord } from "../../runtime/nativeEvents";
import type { StreamOption } from "../../runtime/types";

export type CurrentStream = Omit<StreamOption, "order">;

const TECH_TOKENS = [
  "2160p", "1080p", "720p", "480p", "hdr10", "hdr", "dolby vision", "dv",
  "remux", "bluray", "web dl", "webrip", "h265", "hevc", "x265", "h264", "x264",
  "av1", "atmos", "dts", "aac", "10bit",
];

export function currentStreamFromState(state: unknown, fallbackRoute: string): CurrentStream | null {
  if (!isRecord(state)) return null;
  const selected = isRecord(state.selected) ? state.selected : null;
  const stream = selected && isRecord(selected.stream) ? selected.stream : null;
  if (!stream) return null;
  const deepLinks = isRecord(stream.deepLinks) ? stream.deepLinks : null;
  const addon = isRecord(state.addon) ? state.addon : null;
  const manifest = addon && isRecord(addon.manifest) ? addon.manifest : null;
  return {
    route: normalizeRoute(deepLinks?.player) ?? normalizeRoute(fallbackRoute) ?? fallbackRoute,
    addonName: stringValue(manifest?.name),
    addonTransportUrl: stringValue(addon?.transportUrl),
    name: stringValue(stream.name),
    description: stringValue(stream.description),
    infoHash: stringValue(stream.infoHash)?.toLocaleLowerCase() ?? null,
    fileIdx: numberLikeString(stream.fileIdx),
    url: stringValue(stream.url),
  };
}

export function selectNextStream(options: StreamOption[], current: CurrentStream | null): StreamOption | null {
  const candidates = options.filter((option) => !isCurrentStream(option, current));
  if (!candidates.length) return null;
  return candidates
    .map((option) => ({ option, score: streamSimilarity(option, current) }))
    .sort((left, right) => right.score - left.score || left.option.order - right.option.order)[0]?.option ?? null;
}

export function isCurrentStream(option: StreamOption, current: CurrentStream | null): boolean {
  if (!current) return routesEqual(option.route, location.hash);
  if (routesEqual(option.route, current.route)) return true;
  if (option.infoHash && current.infoHash && option.infoHash === current.infoHash) {
    return option.fileIdx === current.fileIdx;
  }
  return Boolean(option.url && current.url && option.url === current.url);
}

export function streamSimilarity(option: StreamOption, current: CurrentStream | null): number {
  if (!current) return -option.order;
  let score = 0;
  if (sameText(option.addonTransportUrl, current.addonTransportUrl)) score += 5_000;
  if (sameText(option.addonName, current.addonName)) score += 2_500;
  const currentResolution = resolutionOf(current);
  const optionResolution = resolutionOf(option);
  if (currentResolution && optionResolution) score += currentResolution === optionResolution ? 4_000 : -2_000;
  if (sameText(option.name, current.name)) score += 600;
  if (option.infoHash && current.infoHash && option.infoHash === current.infoHash) score += 700;
  if (urlHost(option.url) && urlHost(option.url) === urlHost(current.url)) score += 350;
  const currentTokens = technologyTokens(current);
  for (const token of technologyTokens(option)) if (currentTokens.has(token)) score += 180;
  return score;
}

export function streamLabel(option: StreamOption): { provider: string; title: string; detail: string } {
  return {
    provider: option.addonName ?? "Unknown provider",
    title: option.name ?? firstLine(option.description) ?? "Stream option",
    detail: option.description ?? option.url ?? "No stream details",
  };
}

function technologyTokens(stream: Pick<StreamOption, "name" | "description">) {
  const value = normalized(`${stream.name ?? ""} ${stream.description ?? ""}`);
  return new Set(TECH_TOKENS.filter((token) => value.includes(token)));
}

function resolutionOf(stream: Pick<StreamOption, "name" | "description">): string | null {
  const value = normalized(`${stream.name ?? ""} ${stream.description ?? ""}`);
  if (/\b(?:2160p|4k|uhd)\b/.test(value)) return "2160p";
  return value.match(/\b(?:1080p|720p|480p|360p)\b/)?.[0] ?? null;
}

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function sameText(left: string | null, right: string | null) {
  return Boolean(left && right && normalized(left) === normalized(right));
}

function routesEqual(left: string, right: string) {
  try { return decodeURIComponent(normalizeRoute(left) ?? left) === decodeURIComponent(normalizeRoute(right) ?? right); }
  catch { return left === right; }
}

function normalizeRoute(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 32_768) return null;
  if (value.startsWith("#/player/")) return value;
  if (value.startsWith("/player/")) return `#${value}`;
  try { const hash = new URL(value, location.href).hash; return hash.startsWith("#/player/") ? hash : null; }
  catch { return null; }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberLikeString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function urlHost(value: string | null) {
  if (!value) return null;
  try { return new URL(value).host.toLocaleLowerCase(); }
  catch { return null; }
}

function firstLine(value: string | null) {
  return value?.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}
