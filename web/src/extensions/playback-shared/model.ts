import type { MediaTarget } from "../../runtime/types";

export type JournalAnnotation = {
  text: string;
  tags: string[];
  favorite: boolean;
  updatedAt: string;
};

export type PlaybackSession = Omit<MediaTarget, "key"> & {
  id: string;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  watchedMs: number;
  startPositionMs: number;
  endPositionMs: number;
  maxPositionMs: number;
  durationMs: number | null;
  completed: boolean;
  journal?: JournalAnnotation;
};

export type PlaybackSessionInput = PlaybackSession & { journal?: never };

export type PlaybackHistoryPage = {
  items: PlaybackSession[];
  total: number;
  nextOffset: number | null;
  revision: number | null;
  revisionChanged: boolean;
};

export function asPlaybackSession(value: unknown): PlaybackSession | null {
  if (!isRecord(value)) return null;
  const mediaType = value.mediaType;
  if (
    typeof value.id !== "string"
    || typeof value.videoId !== "string"
    || typeof value.metaId !== "string"
    || (mediaType !== "movie" && mediaType !== "series")
    || typeof value.startedAt !== "string"
    || typeof value.lastSeenAt !== "string"
  ) return null;
  const requiredNumbers = [
    value.watchedMs,
    value.startPositionMs,
    value.endPositionMs,
    value.maxPositionMs,
  ];
  if (requiredNumbers.some((item) => !finiteNonNegative(item))) return null;
  const journal = asJournal(value.journal);
  return {
    id: value.id,
    videoId: value.videoId,
    metaId: value.metaId,
    mediaType,
    name: nullableString(value.name),
    title: nullableString(value.title),
    season: nullableNumber(value.season),
    episode: nullableNumber(value.episode),
    poster: nullableString(value.poster),
    startedAt: value.startedAt,
    lastSeenAt: value.lastSeenAt,
    endedAt: nullableString(value.endedAt),
    watchedMs: Number(value.watchedMs),
    startPositionMs: Number(value.startPositionMs),
    endPositionMs: Number(value.endPositionMs),
    maxPositionMs: Number(value.maxPositionMs),
    durationMs: finitePositive(value.durationMs) ? Number(value.durationMs) : null,
    completed: value.completed === true,
    ...(journal ? { journal } : {}),
  };
}

export function asPlaybackHistoryPage(value: unknown): PlaybackHistoryPage {
  if (Array.isArray(value)) {
    const items = value.map(asPlaybackSession).filter((item): item is PlaybackSession => Boolean(item));
    return { items, total: items.length, nextOffset: null, revision: null, revisionChanged: false };
  }
  if (!isRecord(value)) {
    return { items: [], total: 0, nextOffset: null, revision: null, revisionChanged: false };
  }
  const items = Array.isArray(value.items)
    ? value.items.map(asPlaybackSession).filter((item): item is PlaybackSession => Boolean(item))
    : [];
  return {
    items,
    total: finiteNonNegative(value.total) ? Number(value.total) : items.length,
    nextOffset: finiteNonNegative(value.nextOffset) ? Number(value.nextOffset) : null,
    revision: finiteNonNegative(value.revision) ? Number(value.revision) : null,
    revisionChanged: value.revisionChanged === true,
  };
}

function asJournal(value: unknown): JournalAnnotation | null {
  if (!isRecord(value) || typeof value.text !== "string" || typeof value.updatedAt !== "string") return null;
  return {
    text: value.text,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : [],
    favorite: value.favorite === true,
    updatedAt: value.updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finitePositive(value: unknown): value is number {
  return finiteNonNegative(value) && value > 0;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return finiteNonNegative(value) ? Number(value) : null;
}
