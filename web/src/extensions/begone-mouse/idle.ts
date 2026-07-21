export const DEFAULT_IDLE_MS = 1_000;
export const MAX_IDLE_MS = 600_000;
export const BOTTOM_PROTECTED_RATIO = 0.18;
export const BOTTOM_PROTECTED_MIN_PX = 96;
export const BOTTOM_PROTECTED_MAX_PX = 220;

export function normalizeIdleDelay(value: unknown): number {
  const idleMs = typeof value === "number" ? value : Number(value);
  return Number.isFinite(idleMs) && idleMs >= 0 && idleMs <= MAX_IDLE_MS
    ? idleMs
    : DEFAULT_IDLE_MS;
}

export function overlayHiddenTokens(element: Element): string[] {
  return Array.from(element.classList).filter((token) => token.includes("overlayHidden"));
}

export function isBottomProtected(pointerY: number | null, viewportHeight: number): boolean {
  if (pointerY === null || !Number.isFinite(pointerY) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return false;
  }
  const height = Math.min(
    BOTTOM_PROTECTED_MAX_PX,
    Math.max(BOTTOM_PROTECTED_MIN_PX, viewportHeight * BOTTOM_PROTECTED_RATIO),
  );
  return pointerY >= viewportHeight - height && pointerY <= viewportHeight;
}
