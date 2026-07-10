export type MarkerNote = { id: string; timestampMs: number };

export type MarkerCluster<T extends MarkerNote> = {
  leftPercent: number;
  notes: T[];
};

export function markerPercent(timestampMs: number, durationMs: number): number | null {
  if (!Number.isFinite(timestampMs) || timestampMs < 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  if (timestampMs > durationMs) return null;
  return (timestampMs / durationMs) * 100;
}

export function clusterMarkers<T extends MarkerNote>(
  notes: T[],
  durationMs: number,
  widthCssPixels: number,
  devicePixelRatio = 1,
  thresholdPhysicalPixels = 10,
): MarkerCluster<T>[] {
  if (!Number.isFinite(widthCssPixels) || widthCssPixels <= 0) return [];
  const positioned = notes
    .map((note) => ({ note, percent: markerPercent(note.timestampMs, durationMs) }))
    .filter((item): item is { note: T; percent: number } => item.percent !== null)
    .sort((left, right) => left.percent - right.percent);
  const clusters: MarkerCluster<T>[] = [];
  for (const item of positioned) {
    const previous = clusters.at(-1);
    const pixel = (item.percent / 100) * widthCssPixels * devicePixelRatio;
    const previousPixel = previous
      ? (previous.leftPercent / 100) * widthCssPixels * devicePixelRatio
      : Number.NEGATIVE_INFINITY;
    if (previous && Math.abs(pixel - previousPixel) <= thresholdPhysicalPixels) {
      previous.notes.push(item.note);
      previous.leftPercent =
        previous.notes.reduce((sum, note) => sum + (markerPercent(note.timestampMs, durationMs) ?? 0), 0) /
        previous.notes.length;
    } else {
      clusters.push({ leftPercent: item.percent, notes: [item.note] });
    }
  }
  return clusters;
}
