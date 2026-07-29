export type MiniPlayerBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MiniPlayerState = {
  enabled: boolean;
  topmost: boolean;
  bounds: MiniPlayerBounds;
};

export function asMiniPlayerState(value: unknown): MiniPlayerState | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<MiniPlayerState>;
  if (typeof source.enabled !== "boolean" || typeof source.topmost !== "boolean") return null;
  const bounds = source.bounds;
  if (!bounds || typeof bounds !== "object") return null;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(finiteInteger)) return null;
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  return {
    enabled: source.enabled,
    topmost: source.topmost,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
}

export function isPlayerRoute(hash = location.hash): boolean {
  return hash.startsWith("#/player/");
}

function finiteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}
