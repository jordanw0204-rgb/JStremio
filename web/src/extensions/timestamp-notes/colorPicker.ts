export const DEFAULT_MARKER_COLOR = "#56E0CF";

const PRESET_COLORS = [
  DEFAULT_MARKER_COLOR,
  "#4B8CFF",
  "#A881FF",
  "#F062C0",
  "#FF5C7A",
  "#FF8A4C",
  "#FFD166",
  "#65D98A",
  "#22AA44",
  "#F4F8FF",
];

type HsvColor = { hue: number; saturation: number; value: number };

export type MarkerColorPicker = {
  element: HTMLElement;
  input: HTMLInputElement;
  panel: HTMLElement;
};

export function isMarkerColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function normalizeMarkerColor(value: unknown): string {
  return isMarkerColor(value) ? value.toUpperCase() : DEFAULT_MARKER_COLOR;
}

export function createMarkerColorPicker(initialColor: unknown, themeAccent?: unknown): MarkerColorPicker {
  const element = document.createElement("div");
  element.className = "color-compact";

  const preview = document.createElement("button");
  preview.type = "button";
  preview.className = "color-preview";
  preview.setAttribute("aria-label", "Open custom marker color picker");
  preview.setAttribute("aria-expanded", "false");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "color-input";
  input.maxLength = 7;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.inputMode = "text";
  input.setAttribute("aria-label", "Marker color");
  input.setAttribute("aria-describedby", "jstremio-marker-color-hint");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "color-picker-toggle";
  toggle.textContent = "Custom…";
  toggle.setAttribute("aria-expanded", "false");
  element.append(preview, input, toggle);

  const panel = document.createElement("section");
  panel.className = "color-editor";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Custom marker color picker");
  const header = document.createElement("header");
  const heading = document.createElement("strong");
  heading.textContent = "Custom color";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "color-editor-close";
  close.textContent = "Done";
  header.append(heading, close);

  const palette = document.createElement("div");
  palette.className = "color-palette";
  palette.setAttribute("role", "group");
  palette.setAttribute("aria-label", "Suggested marker colors");

  const sliders = document.createElement("div");
  sliders.className = "color-sliders";
  const hue = colorRange("Hue", 360);
  const saturation = colorRange("Saturation", 100);
  const value = colorRange("Brightness", 100);
  hue.input.classList.add("hue-range");
  sliders.append(hue.field, saturation.field, value.field);

  const hint = document.createElement("span");
  hint.id = "jstremio-marker-color-hint";
  hint.className = "color-hint";
  hint.textContent = "Choose a preset, tune the color controls, or enter a six-digit hex color.";
  panel.append(header, palette, sliders, hint);

  const presets = Array.from(
    new Set([isMarkerColor(themeAccent) ? themeAccent.toUpperCase() : null, ...PRESET_COLORS].filter(Boolean)),
  ) as string[];
  for (const color of presets) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "color-swatch";
    swatch.dataset.color = color;
    swatch.style.setProperty("--swatch-color", color);
    swatch.setAttribute("aria-label", `Use marker color ${color}`);
    swatch.addEventListener("click", () => setColor(color));
    palette.append(swatch);
  }

  let committed = normalizeMarkerColor(initialColor);
  let hsv = hexToHsv(committed);
  const sync = (syncRanges = true) => {
    preview.style.setProperty("--selected-color", committed);
    input.value = committed;
    input.setAttribute("aria-invalid", "false");
    palette.querySelectorAll<HTMLButtonElement>(".color-swatch").forEach((swatch) => {
      swatch.setAttribute("aria-pressed", String(swatch.dataset.color === committed));
    });
    if (syncRanges) {
      hue.input.value = String(Math.round(hsv.hue));
      saturation.input.value = String(Math.round(hsv.saturation));
      value.input.value = String(Math.round(hsv.value));
    }
    const pureHue = hsvToHex({ hue: hsv.hue, saturation: 100, value: 100 });
    saturation.input.style.setProperty("--range-start", hsvToHex({ hue: hsv.hue, saturation: 0, value: hsv.value }));
    saturation.input.style.setProperty("--range-end", hsvToHex({ hue: hsv.hue, saturation: 100, value: hsv.value }));
    value.input.style.setProperty("--range-start", "#000000");
    value.input.style.setProperty("--range-end", hsvToHex({ hue: hsv.hue, saturation: hsv.saturation, value: 100 }));
    hue.output.textContent = `${Math.round(hsv.hue)}°`;
    saturation.output.textContent = `${Math.round(hsv.saturation)}%`;
    value.output.textContent = `${Math.round(hsv.value)}%`;
    element.style.setProperty("--picker-hue", pureHue);
  };
  const setColor = (color: string) => {
    committed = normalizeMarkerColor(color);
    hsv = hexToHsv(committed);
    sync();
  };
  const setPanelOpen = (open: boolean) => {
    panel.hidden = !open;
    preview.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Hide" : "Custom…";
    if (open) hue.input.focus();
  };

  for (const range of [hue.input, saturation.input, value.input]) {
    range.addEventListener("input", () => {
      hsv = {
        hue: Number(hue.input.value),
        saturation: Number(saturation.input.value),
        value: Number(value.input.value),
      };
      committed = hsvToHex(hsv);
      sync(false);
    });
  }
  input.addEventListener("input", () => {
    if (isMarkerColor(input.value)) setColor(input.value);
    else input.setAttribute("aria-invalid", "true");
  });
  input.addEventListener("blur", () => setColor(committed));
  preview.addEventListener("click", () => setPanelOpen(panel.hidden));
  toggle.addEventListener("click", () => setPanelOpen(panel.hidden));
  close.addEventListener("click", () => setPanelOpen(false));
  setColor(committed);

  return { element, input, panel };
}

function colorRange(label: string, max: number) {
  const field = document.createElement("label");
  field.className = "color-range-field";
  const name = document.createElement("span");
  name.textContent = label;
  const output = document.createElement("output");
  const input = document.createElement("input");
  input.type = "range";
  input.className = "color-range";
  input.min = "0";
  input.max = String(max);
  input.step = "1";
  input.setAttribute("aria-label", `Color ${label.toLocaleLowerCase()}`);
  field.append(name, output, input);
  return { field, input, output };
}

function hexToHsv(color: string): HsvColor {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return {
    hue,
    saturation: max === 0 ? 0 : (delta / max) * 100,
    value: max * 100,
  };
}

function hsvToHex(color: HsvColor): string {
  const hue = ((color.hue % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(100, color.saturation)) / 100;
  const value = Math.max(0, Math.min(100, color.value)) / 100;
  const chroma = value * saturation;
  const section = hue / 60;
  const intermediate = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] = section < 1 ? [chroma, intermediate, 0]
    : section < 2 ? [intermediate, chroma, 0]
      : section < 3 ? [0, chroma, intermediate]
        : section < 4 ? [0, intermediate, chroma]
          : section < 5 ? [intermediate, 0, chroma]
            : [chroma, 0, intermediate];
  const match = value - chroma;
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}
