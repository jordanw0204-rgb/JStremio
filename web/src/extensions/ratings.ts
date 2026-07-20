export const MAX_RATING = 10;

export function normalizeRating(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_RATING
    ? value
    : null;
}

export function ratingStars(value: number): string {
  const rating = normalizeRating(value) ?? 0;
  return `${"★".repeat(rating)}${"☆".repeat(MAX_RATING - rating)}`;
}

export function ratingAriaLabel(value: number): string {
  return `${value} out of ${MAX_RATING} stars`;
}
