import type { MediaTarget } from "../../runtime/types";

export type ProfileScope = "video" | "season" | "series";
export type SkipAnchor = "absolute" | "fromEnd";
export type SkipRange = {
  startMs: number;
  endMs: number;
  anchor: SkipAnchor;
  durationMsAtCreation: number | null;
};
export type ResolvedRange = { startMs: number; endMs: number };
export type SkipProfile = Omit<MediaTarget, "key"> & {
  id: string;
  scope: ProfileScope;
  intro: SkipRange | null;
  credits: SkipRange | null;
  createdAt: string;
  updatedAt: string;
};
export type ResolvedProfile = {
  profileId: string;
  scope: ProfileScope;
  intro: ResolvedRange | null;
  credits: ResolvedRange | null;
};

export function asSkipProfiles(value: unknown): SkipProfile[] {
  return Array.isArray(value)
    ? value.map(asSkipProfile).filter((profile): profile is SkipProfile => Boolean(profile))
    : [];
}

export function asResolvedProfile(value: unknown): ResolvedProfile | null {
  if (!isRecord(value) || typeof value.profileId !== "string" || !isScope(value.scope)) return null;
  const intro = asResolvedRange(value.intro);
  const credits = asResolvedRange(value.credits);
  return intro || credits ? { profileId: value.profileId, scope: value.scope, intro, credits } : null;
}

export function activeSkipKind(
  profile: ResolvedProfile | null,
  positionMs: number | null,
): { kind: "intro" | "credits"; range: ResolvedRange } | null {
  if (!profile || positionMs === null) return null;
  if (profile.intro && positionMs >= profile.intro.startMs && positionMs < profile.intro.endMs) {
    return { kind: "intro", range: profile.intro };
  }
  if (profile.credits && positionMs >= profile.credits.startMs && positionMs < profile.credits.endMs) {
    return { kind: "credits", range: profile.credits };
  }
  return null;
}

export function resolveRangeForDuration(
  range: SkipRange | null,
  durationMs: number | null,
): ResolvedRange | null {
  if (!range) return null;
  if (range.anchor === "absolute") return { startMs: range.startMs, endMs: range.endMs };
  const createdFor = range.durationMsAtCreation;
  if (createdFor === null || durationMs === null) return null;
  const startOffset = createdFor - range.startMs;
  const endOffset = createdFor - range.endMs;
  const startMs = durationMs - startOffset;
  const endMs = durationMs - endOffset;
  return startMs >= 0 && endMs > startMs ? { startMs, endMs } : null;
}

export function profileForScope(profiles: SkipProfile[], scope: ProfileScope): SkipProfile | null {
  return profiles.find((profile) => profile.scope === scope) ?? null;
}

export function scopeOptions(target: MediaTarget): ProfileScope[] {
  if (target.mediaType === "movie") return [];
  return target.season === null ? ["series"] : ["season", "series"];
}

function asSkipProfile(value: unknown): SkipProfile | null {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || !isScope(value.scope)
    || typeof value.videoId !== "string"
    || typeof value.metaId !== "string"
    || (value.mediaType !== "movie" && value.mediaType !== "series")
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
  ) return null;
  return {
    id: value.id,
    scope: value.scope,
    videoId: value.videoId,
    metaId: value.metaId,
    mediaType: value.mediaType,
    name: nullableString(value.name),
    title: nullableString(value.title),
    season: nullableNumber(value.season),
    episode: nullableNumber(value.episode),
    poster: nullableString(value.poster),
    intro: asRange(value.intro),
    credits: asRange(value.credits),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function asRange(value: unknown): SkipRange | null {
  if (!isRecord(value) || !finite(value.startMs) || !finite(value.endMs) || value.endMs <= value.startMs) return null;
  if (value.anchor !== "absolute" && value.anchor !== "fromEnd") return null;
  return {
    startMs: value.startMs,
    endMs: value.endMs,
    anchor: value.anchor,
    durationMsAtCreation: finite(value.durationMsAtCreation) ? value.durationMsAtCreation : null,
  };
}

function asResolvedRange(value: unknown): ResolvedRange | null {
  return isRecord(value) && finite(value.startMs) && finite(value.endMs) && value.endMs > value.startMs
    ? { startMs: value.startMs, endMs: value.endMs }
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScope(value: unknown): value is ProfileScope {
  return value === "video" || value === "season" || value === "series";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return finite(value) ? value : null;
}
