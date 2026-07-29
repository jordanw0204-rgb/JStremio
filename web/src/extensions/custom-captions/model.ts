import type { PlayerSettablePropertyName } from "../../runtime/types";

export type CaptionAssOverride = "no" | "scale" | "force";

export type CustomCaptionsSettings = {
  fontFamily: string;
  fontSize: number;
  position: number;
  textColor: string;
  textOpacity: number;
  outlineColor: string;
  outlineOpacity: number;
  outlineSize: number;
  backgroundColor: string;
  backgroundOpacity: number;
  shadowColor: string;
  shadowOpacity: number;
  shadowOffset: number;
  letterSpacing: number;
  bold: boolean;
  italic: boolean;
  assOverride: CaptionAssOverride;
};

export type CaptionPreset = {
  id: string;
  name: string;
  colors: [string, string, string];
  settings: CustomCaptionsSettings;
};

export const DEFAULT_CUSTOM_CAPTIONS: CustomCaptionsSettings = Object.freeze({
  fontFamily: "Arial",
  fontSize: 48,
  position: 100,
  textColor: "#FFFFFF",
  textOpacity: 100,
  outlineColor: "#000000",
  outlineOpacity: 100,
  outlineSize: 3,
  backgroundColor: "#000000",
  backgroundOpacity: 0,
  shadowColor: "#000000",
  shadowOpacity: 75,
  shadowOffset: 2,
  letterSpacing: 0,
  bold: false,
  italic: false,
  assOverride: "force",
});

const preset = (id: string, name: string, colors: [string, string, string], changes: Partial<CustomCaptionsSettings>): CaptionPreset => ({
  id,
  name,
  colors,
  settings: { ...DEFAULT_CUSTOM_CAPTIONS, ...changes },
});

export const CAPTION_PRESETS: readonly CaptionPreset[] = Object.freeze([
  preset("classic", "Classic", ["#FFFFFF", "#000000", "#000000"], {}),
  preset("cinema", "Cinema", ["#FFF1CE", "#24170E", "#000000"], {
    fontFamily: "Georgia",
    fontSize: 46,
    textColor: "#FFF1CE",
    outlineColor: "#24170E",
    outlineSize: 2.5,
    backgroundOpacity: 18,
    shadowOpacity: 70,
    shadowOffset: 3,
  }),
  preset("contrast", "High Contrast", ["#FFE94A", "#000000", "#000000"], {
    fontSize: 52,
    textColor: "#FFE94A",
    outlineSize: 4,
    backgroundOpacity: 68,
    shadowOpacity: 0,
    shadowOffset: 0,
    bold: true,
  }),
  preset("soft", "Soft Shadow", ["#FFFFFF", "#202030", "#000000"], {
    fontFamily: "Segoe UI",
    outlineColor: "#202030",
    outlineSize: 1.5,
    backgroundOpacity: 12,
    shadowOpacity: 82,
    shadowOffset: 4,
  }),
  preset("minimal", "Minimal", ["#F5F7FF", "#11131A", "#000000"], {
    fontFamily: "Segoe UI",
    fontSize: 44,
    textColor: "#F5F7FF",
    outlineColor: "#11131A",
    outlineSize: 1,
    backgroundOpacity: 0,
    shadowOpacity: 0,
    shadowOffset: 0,
  }),
]);

export const COMMON_CAPTION_FONTS = Object.freeze([
  "Arial", "Arial Black", "Calibri", "Cambria", "Comic Sans MS", "Consolas",
  "Georgia", "Segoe UI", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana",
]);

export function normalizeCustomCaptions(value: unknown): CustomCaptionsSettings {
  const source = value && typeof value === "object" ? value as Partial<CustomCaptionsSettings> : {};
  return {
    fontFamily: validFont(source.fontFamily) ? source.fontFamily.trim() : DEFAULT_CUSTOM_CAPTIONS.fontFamily,
    fontSize: bounded(source.fontSize, 8, 120, DEFAULT_CUSTOM_CAPTIONS.fontSize),
    position: bounded(source.position, 0, 150, DEFAULT_CUSTOM_CAPTIONS.position),
    textColor: color(source.textColor, DEFAULT_CUSTOM_CAPTIONS.textColor),
    textOpacity: bounded(source.textOpacity, 0, 100, DEFAULT_CUSTOM_CAPTIONS.textOpacity),
    outlineColor: color(source.outlineColor, DEFAULT_CUSTOM_CAPTIONS.outlineColor),
    outlineOpacity: bounded(source.outlineOpacity, 0, 100, DEFAULT_CUSTOM_CAPTIONS.outlineOpacity),
    outlineSize: bounded(source.outlineSize, 0, 10, DEFAULT_CUSTOM_CAPTIONS.outlineSize),
    backgroundColor: color(source.backgroundColor, DEFAULT_CUSTOM_CAPTIONS.backgroundColor),
    backgroundOpacity: bounded(source.backgroundOpacity, 0, 100, DEFAULT_CUSTOM_CAPTIONS.backgroundOpacity),
    shadowColor: color(source.shadowColor, DEFAULT_CUSTOM_CAPTIONS.shadowColor),
    shadowOpacity: bounded(source.shadowOpacity, 0, 100, DEFAULT_CUSTOM_CAPTIONS.shadowOpacity),
    shadowOffset: bounded(source.shadowOffset, 0, 20, DEFAULT_CUSTOM_CAPTIONS.shadowOffset),
    letterSpacing: bounded(source.letterSpacing, -10, 20, DEFAULT_CUSTOM_CAPTIONS.letterSpacing),
    bold: source.bold === true,
    italic: source.italic === true,
    assOverride: source.assOverride === "no" || source.assOverride === "scale" || source.assOverride === "force"
      ? source.assOverride
      : DEFAULT_CUSTOM_CAPTIONS.assOverride,
  };
}

export function validateCustomCaptions(settings: CustomCaptionsSettings): string | null {
  if (!validFont(settings.fontFamily)) return "Enter an installed font family using 1–128 printable characters.";
  if (!validRange(settings.fontSize, 8, 120)) return "Font size must be from 8 through 120.";
  if (!validRange(settings.position, 0, 150)) return "Screen position must be from 0 through 150.";
  for (const [label, value] of [["Text", settings.textColor], ["Outline", settings.outlineColor], ["Background", settings.backgroundColor], ["Shadow", settings.shadowColor]] as const) {
    if (!/^#[0-9A-F]{6}$/i.test(value)) return `${label} color must use six-digit hexadecimal notation.`;
  }
  for (const [label, value] of [["Text", settings.textOpacity], ["Outline", settings.outlineOpacity], ["Background", settings.backgroundOpacity], ["Shadow", settings.shadowOpacity]] as const) {
    if (!validRange(value, 0, 100)) return `${label} opacity must be from 0 through 100.`;
  }
  if (!validRange(settings.outlineSize, 0, 10)) return "Outline width must be from 0 through 10.";
  if (!validRange(settings.shadowOffset, 0, 20)) return "Shadow offset must be from 0 through 20.";
  if (!validRange(settings.letterSpacing, -10, 20)) return "Letter spacing must be from -10 through 20.";
  if (!(["no", "scale", "force"] as const).includes(settings.assOverride)) return "Choose a valid embedded-style mode.";
  return null;
}

export function captionMpvProperties(settings: CustomCaptionsSettings): ReadonlyArray<readonly [PlayerSettablePropertyName, string | number | boolean]> {
  return [
    ["sub-font", settings.fontFamily],
    ["sub-font-size", settings.fontSize],
    ["sub-pos", settings.position],
    ["sub-color", mpvColor(settings.textColor, settings.textOpacity)],
    ["sub-border-color", mpvColor(settings.outlineColor, settings.outlineOpacity)],
    ["sub-border-size", settings.outlineSize],
    ["sub-back-color", mpvColor(settings.backgroundColor, settings.backgroundOpacity)],
    ["sub-border-style", settings.backgroundOpacity > 0 ? "background-box" : "outline-and-shadow"],
    ["sub-shadow-color", mpvColor(settings.shadowColor, settings.shadowOpacity)],
    ["sub-shadow-offset", settings.shadowOffset],
    ["sub-spacing", settings.letterSpacing],
    ["sub-bold", settings.bold],
    ["sub-italic", settings.italic],
    ["sub-ass-override", settings.assOverride],
  ];
}

export function matchingCaptionPreset(settings: CustomCaptionsSettings): CaptionPreset | null {
  return CAPTION_PRESETS.find((candidate) => settingsEqual(settings, candidate.settings)) ?? null;
}

export function hexToRgba(hex: string, opacity: number): string {
  const normalized = color(hex, "#FFFFFF").slice(1);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${bounded(opacity, 0, 100, 100) / 100})`;
}

function mpvColor(hex: string, opacity: number): string {
  const alpha = Math.round(bounded(opacity, 0, 100, 100) * 2.55).toString(16).padStart(2, "0").toUpperCase();
  return `#${alpha}${color(hex, "#FFFFFF").slice(1)}`;
}

function settingsEqual(left: CustomCaptionsSettings, right: CustomCaptionsSettings): boolean {
  return (Object.keys(DEFAULT_CUSTOM_CAPTIONS) as Array<keyof CustomCaptionsSettings>)
    .every((key) => left[key] === right[key]);
}

function validFont(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 128 && !/[\u0000-\u001F\u007F]/.test(value);
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9A-F]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  return validRange(numeric, min, max) ? numeric : fallback;
}

function validRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
