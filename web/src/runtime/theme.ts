export type ThemeSettings = {
  backgroundStart: string;
  backgroundEnd: string;
  accent: string;
  surface: string;
  text: string;
  gradientAngle: number;
};

export const DEFAULT_THEME: Readonly<ThemeSettings> = Object.freeze({
  backgroundStart: "#0C0B11",
  backgroundEnd: "#1A173E",
  accent: "#7B5BF5",
  surface: "#0F0D20",
  text: "#E6E6E6",
  gradientAngle: 41,
});

export const THEME_COLOR_KEYS = [
  "backgroundStart",
  "backgroundEnd",
  "accent",
  "surface",
  "text",
] as const;

const STYLE_ID = "jstremio-theme-runtime-style";
const PLAYER_ROUTE = /^#\/player(?:\/|$)/i;
let routeSyncInstalled = false;

export function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

export function asThemeSettings(value: unknown): ThemeSettings {
  if (!isRecord(value)) throw new TypeError("The saved theme is invalid.");
  const colors = Object.fromEntries(
    THEME_COLOR_KEYS.map((key) => [key, typeof value[key] === "string" ? normalizeHexColor(value[key]) : null]),
  ) as Record<(typeof THEME_COLOR_KEYS)[number], string | null>;
  if (THEME_COLOR_KEYS.some((key) => colors[key] === null)) {
    throw new TypeError("The saved theme contains an invalid color.");
  }
  const angle = value.gradientAngle;
  if (typeof angle !== "number" || !Number.isInteger(angle) || angle < 0 || angle > 360) {
    throw new TypeError("The saved theme contains an invalid gradient angle.");
  }
  return {
    backgroundStart: colors.backgroundStart!,
    backgroundEnd: colors.backgroundEnd!,
    accent: colors.accent!,
    surface: colors.surface!,
    text: colors.text!,
    gradientAngle: angle,
  };
}

export function applyTheme(theme: ThemeSettings): void {
  const validated = asThemeSettings(theme);
  const root = document.documentElement;
  const set = (name: string, value: string) => root.style.setProperty(name, value);
  set("--jstremio-background-start", validated.backgroundStart);
  set("--jstremio-background-end", validated.backgroundEnd);
  set("--jstremio-gradient-angle", `${validated.gradientAngle}deg`);
  set("--jstremio-accent-color", validated.accent);
  set("--jstremio-surface-color", validated.surface);
  set("--jstremio-text-color", validated.text);

  // Stable variables published by Stremio Web's root stylesheet.
  set("--primary-background-color", validated.backgroundStart);
  set("--secondary-background-color", validated.backgroundEnd);
  set("--primary-accent-color", validated.accent);
  set("--modal-background-color", validated.surface);
  set("--primary-foreground-color", validated.text);
  set("--overlay-color", `color-mix(in srgb, ${validated.text} 6%, transparent)`);
  set("--outer-glow", `0 0 15px color-mix(in srgb, ${validated.accent} 37%, transparent)`);

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    root.append(style);
  }
  style.textContent =
    "html body{background:linear-gradient(var(--jstremio-gradient-angle),var(--jstremio-background-start) 0%,var(--jstremio-background-end) 100%)!important;color:var(--jstremio-text-color)}" +
    "html[data-jstremio-player-route] body{background:transparent!important}";
  syncThemeRoute();
  if (!routeSyncInstalled) {
    routeSyncInstalled = true;
    window.addEventListener("hashchange", syncThemeRoute);
  }
  root.dataset.jstremioTheme = "active";
}

export function syncThemeRoute(): void {
  document.documentElement.toggleAttribute("data-jstremio-player-route", PLAYER_ROUTE.test(location.hash));
}

export function themesEqual(left: ThemeSettings, right: ThemeSettings): boolean {
  return (
    left.backgroundStart === right.backgroundStart &&
    left.backgroundEnd === right.backgroundEnd &&
    left.accent === right.accent &&
    left.surface === right.surface &&
    left.text === right.text &&
    left.gradientAngle === right.gradientAngle
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
