import type { PlaybackSession } from "../playback-shared/model";

export type StatisticsRange = 7 | 30 | 90 | "all";

export type DailyWatch = { date: string; watchedMs: number };
export type TopTitle = {
  key: string;
  label: string;
  watchedMs: number;
  sessions: number;
  completed: number;
};

export type PlaybackStatistics = {
  totalWatchedMs: number;
  sessions: number;
  completed: number;
  uniqueTitles: number;
  movies: number;
  episodes: number;
  currentStreak: number;
  longestStreak: number;
  daily: DailyWatch[];
  topTitles: TopTitle[];
};

export function calculatePlaybackStatistics(
  sessions: PlaybackSession[],
  options: { range: StatisticsRange; now?: Date; timeZone?: string },
): PlaybackStatistics {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const cutoff = options.range === "all"
    ? Number.NEGATIVE_INFINITY
    : now.getTime() - options.range * 24 * 60 * 60 * 1_000;
  const filtered = sessions.filter((session) => {
    const timestamp = Date.parse(session.startedAt);
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= now.getTime();
  });
  const dailyMap = new Map<string, number>();
  const titles = new Map<string, TopTitle>();
  const uniqueVideos = new Set<string>();
  let totalWatchedMs = 0;
  let completed = 0;
  let movies = 0;
  let episodes = 0;

  for (const session of filtered) {
    totalWatchedMs += session.watchedMs;
    completed += Number(session.completed);
    uniqueVideos.add(`${session.mediaType}:${session.videoId}`);
    if (session.mediaType === "movie") movies += 1;
    else episodes += 1;
    for (const day of splitWatchAcrossDays(session, timeZone)) {
      dailyMap.set(day.date, (dailyMap.get(day.date) ?? 0) + day.watchedMs);
    }
    const key = `${session.mediaType}:${session.metaId}`;
    const title = titles.get(key) ?? {
      key,
      label: session.name || session.title || session.metaId,
      watchedMs: 0,
      sessions: 0,
      completed: 0,
    };
    title.watchedMs += session.watchedMs;
    title.sessions += 1;
    title.completed += Number(session.completed);
    titles.set(key, title);
  }

  materializeCalendarDays(dailyMap, options.range, now, timeZone);
  const daily = [...dailyMap.entries()]
    .map(([date, watchedMs]) => ({ date, watchedMs }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const streaks = calculateStreaks(daily, localDateKey(now.toISOString(), timeZone));
  return {
    totalWatchedMs,
    sessions: filtered.length,
    completed,
    uniqueTitles: uniqueVideos.size,
    movies,
    episodes,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    daily,
    topTitles: [...titles.values()]
      .sort((left, right) => right.watchedMs - left.watchedMs || left.label.localeCompare(right.label))
      .slice(0, 10),
  };
}

function splitWatchAcrossDays(session: PlaybackSession, timeZone: string): DailyWatch[] {
  const startedAt = Date.parse(session.startedAt);
  const lastSeenAt = Date.parse(session.endedAt ?? session.lastSeenAt);
  const firstDay = localDateKey(session.startedAt, timeZone);
  if (!firstDay || !Number.isFinite(startedAt) || !Number.isFinite(lastSeenAt) || lastSeenAt <= startedAt) {
    return firstDay ? [{ date: firstDay, watchedMs: session.watchedMs }] : [];
  }
  const slices: Array<{ date: string; durationMs: number }> = [];
  let cursor = startedAt;
  while (cursor < lastSeenAt && slices.length < 16) {
    const date = localDateKey(new Date(cursor).toISOString(), timeZone);
    if (!date) break;
    const boundary = nextLocalDayBoundary(cursor, lastSeenAt, date, timeZone);
    slices.push({ date, durationMs: boundary - cursor });
    cursor = boundary;
  }
  if (!slices.length) return [{ date: firstDay, watchedMs: session.watchedMs }];
  const elapsed = lastSeenAt - startedAt;
  let remaining = session.watchedMs;
  return slices.map((slice, index) => {
    const watchedMs = index === slices.length - 1
      ? remaining
      : Math.min(remaining, Math.round(session.watchedMs * slice.durationMs / elapsed));
    remaining -= watchedMs;
    return { date: slice.date, watchedMs };
  });
}

function nextLocalDayBoundary(cursor: number, end: number, date: string, timeZone: string): number {
  let high = Math.min(end, cursor + 30 * 60 * 60 * 1_000);
  if (localDateKey(new Date(high).toISOString(), timeZone) === date) return end;
  let low = cursor + 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (localDateKey(new Date(middle).toISOString(), timeZone) === date) low = middle + 1;
    else high = middle;
  }
  return low;
}

function materializeCalendarDays(
  daily: Map<string, number>,
  range: StatisticsRange,
  now: Date,
  timeZone: string,
) {
  if (daily.size === 0) return;
  const today = localDateKey(now.toISOString(), timeZone);
  if (!today) return;
  const first = range === "all"
    ? [...daily.keys()].sort()[0] ?? today
    : shiftDay(today, -(range - 1));
  let cursor = first;
  for (let count = 0; count < 3_660 && cursor <= today; count += 1) {
    if (!daily.has(cursor)) daily.set(cursor, 0);
    cursor = shiftDay(cursor, 1);
  }
}

export function localDateKey(value: string, timeZone: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return lookup.year && lookup.month && lookup.day
    ? `${lookup.year}-${lookup.month}-${lookup.day}`
    : null;
}

function calculateStreaks(daily: DailyWatch[], today: string | null) {
  const activeDays = new Set(daily.filter((day) => day.watchedMs > 0).map((day) => day.date));
  const sorted = [...activeDays].sort();
  let longest = 0;
  let run = 0;
  let previous = "";
  for (const day of sorted) {
    run = previous && daysBetween(previous, day) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  let current = 0;
  if (today) {
    let cursor = today;
    if (!activeDays.has(cursor)) cursor = shiftDay(cursor, -1);
    while (activeDays.has(cursor)) {
      current += 1;
      cursor = shiftDay(cursor, -1);
    }
  }
  return { current, longest };
}

function daysBetween(left: string, right: string): number {
  return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86_400_000);
}

function shiftDay(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
