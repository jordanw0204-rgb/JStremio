import type { PlaybackSession } from "../playback-shared/model";

export type JournalFilter = "all" | "notes" | "favorites";
export type JournalGroup = { date: string; label: string; sessions: PlaybackSession[] };

export function filterJournalSessions(
  sessions: PlaybackSession[],
  query: string,
  filter: JournalFilter,
): PlaybackSession[] {
  const needle = query.trim().toLocaleLowerCase();
  return sessions
    .filter((session) => {
      if (filter === "notes" && !session.journal?.text.trim()) return false;
      if (filter === "favorites" && session.journal?.favorite !== true) return false;
      if (!needle) return true;
      return [
        session.name,
        session.title,
        session.metaId,
        session.journal?.text,
        ...(session.journal?.tags ?? []),
      ].some((value) => value?.toLocaleLowerCase().includes(needle));
    })
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
}

export function groupJournalSessions(
  sessions: PlaybackSession[],
  locale?: string,
): JournalGroup[] {
  const groups = new Map<string, JournalGroup>();
  for (const session of sessions) {
    const date = new Date(session.startedAt);
    if (!Number.isFinite(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const group = groups.get(key) ?? {
      date: key,
      label: new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(date),
      sessions: [],
    };
    group.sessions.push(session);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.date.localeCompare(left.date));
}

export function normalizeTags(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const candidate of value.split(",")) {
    const tag = candidate.trim().slice(0, 32);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length === 12) break;
  }
  return tags;
}

export function journalMediaLabel(session: PlaybackSession): string {
  const episode = session.mediaType === "series" && session.season !== null && session.episode !== null
    ? `S${session.season} E${session.episode}`
    : "";
  return [session.name, episode, session.title].filter(Boolean).join(" · ") || session.videoId;
}
