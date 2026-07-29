import type { JStremioRuntime } from "../../runtime/types";
import { addStyles } from "../shared";
import {
  CAPTION_PRESETS,
  COMMON_CAPTION_FONTS,
  DEFAULT_CUSTOM_CAPTIONS,
  matchingCaptionPreset,
  normalizeCustomCaptions,
  validateCustomCaptions,
  type CustomCaptionsSettings,
} from "./model";

type EditorOptions = {
  runtime: JStremioRuntime;
  settings: CustomCaptionsSettings;
  anchor?: HTMLElement;
  liveApply: (settings: CustomCaptionsSettings) => void;
  saved?: (settings: CustomCaptionsSettings) => void;
  close: () => void;
};

const SETTINGS_CHANGED = "jstremio-custom-captions-settings-changed";

export function mountCaptionEditor(container: HTMLElement, options: EditorOptions): () => void {
  addStyles(container, options.runtime.plugins.getStyles("custom-captions"));
  const original = { ...options.settings };
  let committed = false;
  let frame = 0;
  let lastDraft = original;
  const dialog = document.createElement("section");
  dialog.className = `caption-editor${options.anchor ? " caption-player-popover" : ""}`;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "jstremio-caption-editor-title");
  dialog.innerHTML = `
    <header class="caption-editor-header">
      <div><h2 id="jstremio-caption-editor-title">Custom Captions</h2><p>Changes update the playing video immediately. Save keeps them for future videos.</p></div>
      <div class="caption-header-actions"><button type="button" class="caption-button primary" data-action="save">Save</button><button type="button" class="caption-icon-button" data-action="close" aria-label="Close caption settings">&times;</button></div>
    </header>
    <section class="caption-editor-section caption-theme-section"><h3>Caption themes</h3><div class="caption-presets">
      ${CAPTION_PRESETS.map((preset) => `<button type="button" class="caption-preset" data-caption-preset="${preset.id}"><span class="caption-preset-dots" aria-hidden="true">${preset.colors.map((color) => `<i style="background:${color}"></i>`).join("")}</span><span>${preset.name}</span></button>`).join("")}
    </div></section>
    <div class="caption-editor-grid">
      <section class="caption-editor-section"><h3>Typography</h3>
        <label class="caption-field"><span>Font family</span><input class="caption-text-input" data-caption="fontFamily" list="caption-fonts-live" autocomplete="off" maxlength="128"><datalist id="caption-fonts-live">${COMMON_CAPTION_FONTS.map((font) => `<option value="${font}"></option>`).join("")}</datalist></label>
        ${captionRange("Font size", "fontSize", 8, 120, 1, "px")}
        ${captionRange("Vertical position", "position", 0, 150, 1, "%")}
        ${captionRange("Letter spacing", "letterSpacing", -10, 20, 0.5, "px")}
        <div class="caption-toggle-pair"><label class="caption-toggle"><input type="checkbox" data-caption="bold"><span>Bold</span></label><label class="caption-toggle"><input type="checkbox" data-caption="italic"><span>Italic</span></label></div>
      </section>
      <section class="caption-editor-section"><h3>Text and outline</h3>
        ${captionColor("Text", "textColor")}${captionRange("Text opacity", "textOpacity", 0, 100, 1, "%")}
        ${captionColor("Outline", "outlineColor")}${captionRange("Outline opacity", "outlineOpacity", 0, 100, 1, "%")}
        ${captionRange("Outline width", "outlineSize", 0, 10, 0.5, "px")}
      </section>
      <section class="caption-editor-section"><h3>Background and shadow</h3>
        ${captionColor("Background", "backgroundColor")}${captionRange("Background opacity", "backgroundOpacity", 0, 100, 1, "%")}
        ${captionColor("Shadow", "shadowColor")}${captionRange("Shadow opacity", "shadowOpacity", 0, 100, 1, "%")}
        ${captionRange("Shadow offset / box padding", "shadowOffset", 0, 20, 0.5, "px")}
      </section>
      <section class="caption-editor-section"><h3>Subtitle compatibility</h3>
        <label class="caption-field"><span>Embedded ASS styles</span><select class="caption-text-input" data-caption="assOverride"><option value="force">Force my custom style</option><option value="scale">Keep authored style, apply scale</option><option value="no">Respect authored style completely</option></select></label>
        <p class="caption-help">Force is required when an embedded subtitle track supplies its own colors. Image-based DVD/PGS subtitles cannot be restyled.</p>
      </section>
    </div>
    <div class="caption-editor-status" role="status" aria-live="polite"></div>
    <footer class="caption-editor-actions"><button type="button" class="caption-button" data-action="default">Reset to Classic</button><span></span><button type="button" class="caption-button" data-action="cancel">Cancel</button></footer>`;
  container.append(dialog);
  if (options.anchor) positionBesideAnchor(dialog, options.anchor);

  const status = dialog.querySelector<HTMLElement>(".caption-editor-status")!;
  const saveButton = dialog.querySelector<HTMLButtonElement>('[data-action="save"]')!;
  const input = <T extends HTMLInputElement | HTMLSelectElement>(key: keyof CustomCaptionsSettings) =>
    dialog.querySelector<T>(`[data-caption="${key}"]`)!;
  const colorText = (key: "textColor" | "outlineColor" | "backgroundColor" | "shadowColor") =>
    dialog.querySelector<HTMLInputElement>(`[data-caption-color="${key}"]`)!;

  const read = (): CustomCaptionsSettings => ({
    fontFamily: input<HTMLInputElement>("fontFamily").value,
    fontSize: Number(input<HTMLInputElement>("fontSize").value),
    position: Number(input<HTMLInputElement>("position").value),
    textColor: colorText("textColor").value.toUpperCase(),
    textOpacity: Number(input<HTMLInputElement>("textOpacity").value),
    outlineColor: colorText("outlineColor").value.toUpperCase(),
    outlineOpacity: Number(input<HTMLInputElement>("outlineOpacity").value),
    outlineSize: Number(input<HTMLInputElement>("outlineSize").value),
    backgroundColor: colorText("backgroundColor").value.toUpperCase(),
    backgroundOpacity: Number(input<HTMLInputElement>("backgroundOpacity").value),
    shadowColor: colorText("shadowColor").value.toUpperCase(),
    shadowOpacity: Number(input<HTMLInputElement>("shadowOpacity").value),
    shadowOffset: Number(input<HTMLInputElement>("shadowOffset").value),
    letterSpacing: Number(input<HTMLInputElement>("letterSpacing").value),
    bold: input<HTMLInputElement>("bold").checked,
    italic: input<HTMLInputElement>("italic").checked,
    assOverride: input<HTMLSelectElement>("assOverride").value as CustomCaptionsSettings["assOverride"],
  });
  const scheduleLive = (candidate: CustomCaptionsSettings) => {
    lastDraft = candidate;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      options.liveApply({ ...lastDraft });
    });
  };
  const render = () => {
    const raw = read();
    const error = validateCustomCaptions(raw);
    const candidate = normalizeCustomCaptions(raw);
    saveButton.disabled = Boolean(error);
    status.textContent = error ?? "Live preview is applied to the playing video.";
    dialog.querySelectorAll<HTMLButtonElement>("[data-caption-preset]").forEach((button) => {
      button.toggleAttribute("data-active", button.dataset.captionPreset === matchingCaptionPreset(candidate)?.id);
    });
    dialog.querySelectorAll<HTMLOutputElement>("[data-caption-output]").forEach((output) => {
      const key = output.dataset.captionOutput as keyof CustomCaptionsSettings;
      output.value = `${candidate[key]}${output.dataset.suffix ?? ""}`;
    });
    if (!error) scheduleLive(candidate);
  };
  const write = (candidate: CustomCaptionsSettings) => {
    input<HTMLInputElement>("fontFamily").value = candidate.fontFamily;
    for (const key of ["fontSize", "position", "textOpacity", "outlineOpacity", "outlineSize", "backgroundOpacity", "shadowOpacity", "shadowOffset", "letterSpacing"] as const) {
      input<HTMLInputElement>(key).value = String(candidate[key]);
    }
    for (const key of ["textColor", "outlineColor", "backgroundColor", "shadowColor"] as const) {
      colorText(key).value = candidate[key];
      input<HTMLInputElement>(key).value = candidate[key];
    }
    input<HTMLInputElement>("bold").checked = candidate.bold;
    input<HTMLInputElement>("italic").checked = candidate.italic;
    input<HTMLSelectElement>("assOverride").value = candidate.assOverride;
    render();
  };

  dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-caption]").forEach((control) => {
    control.addEventListener("input", render);
    control.addEventListener("change", render);
  });
  for (const key of ["textColor", "outlineColor", "backgroundColor", "shadowColor"] as const) {
    const picker = input<HTMLInputElement>(key);
    const text = colorText(key);
    picker.addEventListener("input", () => { text.value = picker.value.toUpperCase(); render(); });
    text.addEventListener("input", () => {
      if (/^#[0-9A-F]{6}$/i.test(text.value)) picker.value = text.value;
      render();
    });
  }
  dialog.querySelectorAll<HTMLButtonElement>("[data-caption-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = CAPTION_PRESETS.find((preset) => preset.id === button.dataset.captionPreset);
      if (selected) write({ ...selected.settings });
    });
  });
  dialog.querySelector('[data-action="default"]')?.addEventListener("click", () => write({ ...DEFAULT_CUSTOM_CAPTIONS }));
  dialog.querySelector('[data-action="close"]')?.addEventListener("click", options.close);
  dialog.querySelector('[data-action="cancel"]')?.addEventListener("click", options.close);
  saveButton.addEventListener("click", () => {
    const candidate = read();
    const error = validateCustomCaptions(candidate);
    if (error) { status.textContent = error; return; }
    saveButton.disabled = true;
    status.textContent = "Saving…";
    void options.runtime.bridge.request("plugins", "setCustomCaptions", candidate).then(() => {
      committed = true;
      Object.assign(options.settings, candidate);
      window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED, { detail: { ...candidate } }));
      options.saved?.(candidate);
      options.close();
    }).catch((error) => {
      saveButton.disabled = false;
      status.textContent = error instanceof Error ? error.message : "Caption settings could not be saved.";
    });
  });
  write(original);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    if (!committed) options.liveApply(original);
  };
}

function captionRange(label: string, key: keyof CustomCaptionsSettings, min: number, max: number, step: number, suffix: string) {
  return `<label class="caption-range"><span>${label}</span><div><input type="range" data-caption="${key}" min="${min}" max="${max}" step="${step}"><output data-caption-output="${key}" data-suffix="${suffix}"></output></div></label>`;
}

function captionColor(label: string, key: "textColor" | "outlineColor" | "backgroundColor" | "shadowColor") {
  return `<label class="caption-color"><span>${label} color</span><div><input type="color" data-caption="${key}" aria-label="${label} color picker"><input class="caption-text-input" data-caption-color="${key}" maxlength="7" spellcheck="false" aria-label="${label} color hexadecimal value"></div></label>`;
}

function positionBesideAnchor(dialog: HTMLElement, anchor: HTMLElement) {
  const bounds = anchor.getBoundingClientRect();
  const width = Math.min(760, window.innerWidth - 24);
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, bounds.right - width));
  dialog.style.width = `${width}px`;
  dialog.style.left = `${left}px`;
  const availableAbove = bounds.top - 22;
  if (bounds.width > 0 && bounds.height > 0 && availableAbove >= 320) {
    dialog.style.bottom = `${window.innerHeight - bounds.top + 10}px`;
    dialog.style.maxHeight = `${Math.min(760, availableAbove)}px`;
  } else {
    dialog.style.top = "12px";
    dialog.style.maxHeight = `${window.innerHeight - 24}px`;
  }
}
