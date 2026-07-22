const CURRENT_EPISODE = /^(\s*S\d+\s*E\d+\s+)(.+)$/i;
const LIST_EPISODE = /^(\s*\d+\.\s*)(.+)$/;
const PLAYER_EPISODE = /^(.*?\s[-–—]\s)(.+?)(\s+\(\d+\s*x\s*\d+\))$/i;
const NEXT_VIDEO_EPISODE = /^(.+?)(\s+\(\s*S\d+\s*E\d+\s*\))$/i;

export function maskEpisodeLabel(value: string, percent: number): string | null {
  const match = CURRENT_EPISODE.exec(value) ?? LIST_EPISODE.exec(value);
  if (!match || !match[2]?.trim()) return null;
  return `${match[1]}${maskSpoilerText(match[2], percent)}`;
}

export function maskPlayerEpisodeLabel(value: string, percent: number): string | null {
  const match = PLAYER_EPISODE.exec(value);
  if (!match || !match[2]?.trim()) return null;
  return `${match[1]}${maskSpoilerText(match[2], percent)}${match[3]}`;
}

export function maskNextVideoEpisodeLabel(value: string, percent: number): string | null {
  const match = NEXT_VIDEO_EPISODE.exec(value);
  if (!match || !match[1]?.trim()) return null;
  return `${maskSpoilerText(match[1], percent)}${match[2]}`;
}

export function maskSpoilerText(value: string, percent: number) {
  const characters = Array.from(value);
  const nonWhitespace = characters.filter((character) => !/\s/.test(character)).length;
  const visible = Math.max(1, Math.ceil(nonWhitespace * (1 - percent / 100)));
  let remaining = visible;
  return characters.map((character) => {
    if (/\s/.test(character)) return character;
    if (remaining > 0) {
      remaining -= 1;
      return character;
    }
    return "*";
  }).join("");
}
