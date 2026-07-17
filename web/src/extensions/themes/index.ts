import styles from "./styles.css";
import {
  applyTheme,
  asThemeSettings,
  DEFAULT_THEME,
  normalizeHexColor,
  themesEqual,
  type ThemeSettings,
} from "../../runtime/theme";
import type { JStremioRuntime } from "../../runtime/types";
import { addStyles, mountNavigationButton, removeOwned, requireRuntime } from "../shared";

const manifest = {
  schemaVersion: 1,
  id: "themes",
  name: "Themes",
  version: "1.0.0",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 15,
} as const;

const THEME_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18h1.1a1.9 1.9 0 0 0 0-3.8h-.6a1.6 1.6 0 0 1 0-3.2H15A6 6 0 0 0 12 3Z"/><circle cx="7.5" cy="11.5" r=".8" fill="currentColor" stroke="none"/><circle cx="9" cy="7.5" r=".8" fill="currentColor" stroke="none"/><circle cx="13" cy="6.5" r=".8" fill="currentColor" stroke="none"/><circle cx="16.5" cy="9" r=".8" fill="currentColor" stroke="none"/></svg>';
const CLOSE_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

type ColorKey = "backgroundStart" | "backgroundEnd" | "accent" | "surface" | "text";

const COLOR_FIELDS: ReadonlyArray<{ key: ColorKey; label: string; description: string }> = [
  { key: "backgroundStart", label: "Gradient start", description: "The deepest side of the app background." },
  { key: "backgroundEnd", label: "Gradient end", description: "The color the background flows toward." },
  { key: "accent", label: "Accent", description: "Selected navigation, highlights, and primary actions." },
  { key: "surface", label: "Surface", description: "Dialogs, panels, and elevated controls." },
  { key: "text", label: "Text", description: "Primary text and high-contrast icons." },
];

const PRESETS: ReadonlyArray<{ name: string; theme: ThemeSettings }> = [
  { name: "Stremio", theme: { ...DEFAULT_THEME } },
  { name: "Midnight", theme: { backgroundStart: "#070B19", backgroundEnd: "#20285E", accent: "#6C8CFF", surface: "#11172D", text: "#F3F6FF", gradientAngle: 125 } },
  { name: "Ocean", theme: { backgroundStart: "#061622", backgroundEnd: "#0E4664", accent: "#38BDF8", surface: "#092536", text: "#F0FAFF", gradientAngle: 135 } },
  { name: "Aurora", theme: { backgroundStart: "#071A22", backgroundEnd: "#25214E", accent: "#50E3C2", surface: "#101D2D", text: "#F2FFFC", gradientAngle: 55 } },
];

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let saved: ThemeSettings = { ...DEFAULT_THEME };
  let activePreview: ThemeSettings | null = null;
  let loaded = false;

  const refreshSavedTheme = async () => {
    const theme = asThemeSettings(await runtime.bridge.request("themes", "get"));
    saved = theme;
    loaded = true;
    applyTheme(theme);
    return theme;
  };

  const openThemes = () => {
    runtime.ui.openOverlay((container, close) => {
      addStyles(container, styles);
      const shell = document.createElement("main");
      shell.className = "themes-shell";
      shell.innerHTML = `
        <header class="themes-header">
          <div><p class="eyebrow">Appearance</p><h1 tabindex="-1">Themes</h1><p>Make JStremio yours. Changes preview instantly and stay private on this computer.</p></div>
          <button class="button icon-button" data-action="close" aria-label="Close Themes">${CLOSE_ICON}</button>
        </header>
        <div class="themes-layout">
          <section class="editor" aria-labelledby="theme-colors-heading">
            <div class="section-heading"><div><h2 id="theme-colors-heading">Colors</h2><p>Enter a six-digit hex color or use the color picker.</p></div></div>
            <div class="preset-list" aria-label="Theme presets"></div>
            <div class="color-grid"></div>
            <fieldset class="angle-field">
              <legend>Gradient angle</legend>
              <div class="angle-controls"><input type="range" min="0" max="360" step="1" data-angle="range" aria-label="Gradient angle"><input class="angle-number" type="number" min="0" max="360" step="1" data-angle="number" aria-label="Gradient angle in degrees"><span aria-hidden="true">&deg;</span></div>
            </fieldset>
          </section>
          <aside class="preview-panel" aria-labelledby="theme-preview-heading">
            <div class="preview-heading"><div><p class="eyebrow">Live</p><h2 id="theme-preview-heading">Preview</h2></div><span class="saved-indicator">Saved</span></div>
            <div class="theme-preview">
              <div class="preview-nav"><span class="preview-logo">J</span><span class="preview-nav-item active"></span><span class="preview-nav-item"></span><span class="preview-nav-item"></span></div>
              <div class="preview-content"><div class="preview-search"></div><div class="preview-title">Continue watching</div><div class="preview-cards"><div class="preview-card"><span></span></div><div class="preview-card alt"><span></span></div></div><button type="button" tabindex="-1">Play now</button></div>
            </div>
            <p class="preview-note">The preview and Stremio interface update together.</p>
          </aside>
        </div>
        <footer class="themes-footer"><p class="status" role="status" aria-live="polite"></p><div class="footer-actions"><button class="button reset-button" data-action="reset">Reset to defaults</button><button class="button primary" data-action="save">Save theme</button></div></footer>`;
      container.append(shell);

      const colorGrid = shell.querySelector<HTMLElement>(".color-grid")!;
      const presetList = shell.querySelector<HTMLElement>(".preset-list")!;
      const preview = shell.querySelector<HTMLElement>(".theme-preview")!;
      const status = shell.querySelector<HTMLElement>(".status")!;
      const savedIndicator = shell.querySelector<HTMLElement>(".saved-indicator")!;
      const saveButton = shell.querySelector<HTMLButtonElement>('[data-action="save"]')!;
      const resetButton = shell.querySelector<HTMLButtonElement>('[data-action="reset"]')!;
      const range = shell.querySelector<HTMLInputElement>('[data-angle="range"]')!;
      const angleNumber = shell.querySelector<HTMLInputElement>('[data-angle="number"]')!;
      let draft: ThemeSettings = { ...saved };
      const invalidFields = new Set<string>();

      for (const field of COLOR_FIELDS) {
        const row = document.createElement("label");
        row.className = "color-field";
        row.innerHTML = `<span class="color-copy"><strong>${field.label}</strong><small>${field.description}</small></span><span class="color-controls"><input type="color" data-color-picker="${field.key}" aria-label="${field.label} color picker"><input class="hex-input" type="text" data-color-text="${field.key}" inputmode="text" maxlength="7" spellcheck="false" aria-label="${field.label} hex color"></span>`;
        colorGrid.append(row);
      }

      PRESETS.forEach((preset, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "preset";
        button.dataset.preset = String(index);
        button.innerHTML = `<span class="preset-swatches" aria-hidden="true"><i></i><i></i><i></i></span><span>${preset.name}</span>`;
        const swatches = button.querySelectorAll<HTMLElement>("i");
        swatches[0]?.style.setProperty("--swatch", preset.theme.backgroundStart);
        swatches[1]?.style.setProperty("--swatch", preset.theme.backgroundEnd);
        swatches[2]?.style.setProperty("--swatch", preset.theme.accent);
        presetList.append(button);
      });

      const setStatus = (message: string, error = false) => {
        status.textContent = message;
        status.classList.toggle("error", error);
      };

      const renderDraft = () => {
        for (const field of COLOR_FIELDS) {
          const picker = shell.querySelector<HTMLInputElement>(`[data-color-picker="${field.key}"]`)!;
          const text = shell.querySelector<HTMLInputElement>(`[data-color-text="${field.key}"]`)!;
          picker.value = draft[field.key];
          text.value = draft[field.key];
          text.setCustomValidity("");
          text.removeAttribute("aria-invalid");
        }
        range.value = String(draft.gradientAngle);
        angleNumber.value = String(draft.gradientAngle);
        angleNumber.setCustomValidity("");
        angleNumber.removeAttribute("aria-invalid");
        preview.style.setProperty("--preview-start", draft.backgroundStart);
        preview.style.setProperty("--preview-end", draft.backgroundEnd);
        preview.style.setProperty("--preview-angle", `${draft.gradientAngle}deg`);
        preview.style.setProperty("--preview-accent", draft.accent);
        preview.style.setProperty("--preview-surface", draft.surface);
        preview.style.setProperty("--preview-text", draft.text);
        invalidFields.clear();
        activePreview = { ...draft };
        applyTheme(activePreview);
        updateActions();
      };

      const updateActions = () => {
        const changed = !themesEqual(draft, saved);
        saveButton.disabled = invalidFields.size > 0 || !changed;
        savedIndicator.textContent = changed ? "Unsaved preview" : "Saved";
        savedIndicator.classList.toggle("unsaved", changed);
      };

      const setDraftColor = (key: ColorKey, value: string) => {
        draft = { ...draft, [key]: value };
        preview.style.setProperty(`--preview-${colorPreviewName(key)}`, value);
        activePreview = { ...draft };
        applyTheme(activePreview);
        updateActions();
      };

      colorGrid.addEventListener("input", (event) => {
        const input = event.target as HTMLInputElement;
        const pickerKey = input.dataset.colorPicker as ColorKey | undefined;
        const textKey = input.dataset.colorText as ColorKey | undefined;
        if (pickerKey) {
          const color = normalizeHexColor(input.value)!;
          shell.querySelector<HTMLInputElement>(`[data-color-text="${pickerKey}"]`)!.value = color;
          invalidFields.delete(pickerKey);
          setDraftColor(pickerKey, color);
          setStatus("Previewing changes. Save when it looks right.");
        } else if (textKey) {
          const color = normalizeHexColor(input.value);
          input.setCustomValidity(color ? "" : "Enter a color such as #4B8CFF.");
          if (color) input.removeAttribute("aria-invalid");
          else input.setAttribute("aria-invalid", "true");
          if (color) invalidFields.delete(textKey);
          else invalidFields.add(textKey);
          if (color) {
            shell.querySelector<HTMLInputElement>(`[data-color-picker="${textKey}"]`)!.value = color;
            setDraftColor(textKey, color);
            setStatus("Previewing changes. Save when it looks right.");
          } else {
            setStatus("Use a six-digit hex color, for example #4B8CFF.", true);
            updateActions();
          }
        }
      });

      const updateAngle = (value: string) => {
        const angle = Number(value);
        const valid = Number.isInteger(angle) && angle >= 0 && angle <= 360;
        angleNumber.setCustomValidity(valid ? "" : "Enter an angle between 0 and 360.");
        if (valid) angleNumber.removeAttribute("aria-invalid");
        else angleNumber.setAttribute("aria-invalid", "true");
        if (valid) invalidFields.delete("gradientAngle");
        else invalidFields.add("gradientAngle");
        if (!valid) {
          setStatus("Gradient angle must be a whole number from 0 to 360.", true);
          updateActions();
          return;
        }
        draft = { ...draft, gradientAngle: angle };
        range.value = String(angle);
        angleNumber.value = String(angle);
        preview.style.setProperty("--preview-angle", `${angle}deg`);
        activePreview = { ...draft };
        applyTheme(activePreview);
        setStatus("Previewing changes. Save when it looks right.");
        updateActions();
      };
      range.addEventListener("input", () => updateAngle(range.value));
      angleNumber.addEventListener("input", () => updateAngle(angleNumber.value));

      presetList.addEventListener("click", (event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>("[data-preset]");
        const preset = button ? PRESETS[Number(button.dataset.preset)] : undefined;
        if (!preset) return;
        draft = { ...preset.theme };
        renderDraft();
        setStatus(`${preset.name} is ready to preview. Save to keep it.`);
      });

      saveButton.addEventListener("click", () => {
        if (invalidFields.size) return;
        saveButton.disabled = true;
        resetButton.disabled = true;
        setStatus("Saving theme…");
        void runtime.bridge.request("themes", "set", draft)
          .then((value) => {
            saved = asThemeSettings(value);
            draft = { ...saved };
            applyTheme(saved);
            setStatus("Theme saved. It will be ready before JStremio appears next time.");
            renderDraft();
          })
          .catch((error) => setStatus(error instanceof Error ? error.message : "The theme could not be saved.", true))
          .finally(() => {
            resetButton.disabled = false;
            updateActions();
          });
      });

      resetButton.addEventListener("click", () => {
        saveButton.disabled = true;
        resetButton.disabled = true;
        setStatus("Restoring the Stremio theme…");
        void runtime.bridge.request("themes", "reset")
          .then((value) => {
            saved = asThemeSettings(value);
            draft = { ...saved };
            renderDraft();
            setStatus("Default theme restored and saved.");
          })
          .catch((error) => setStatus(error instanceof Error ? error.message : "The theme could not be reset.", true))
          .finally(() => {
            resetButton.disabled = false;
            updateActions();
          });
      });

      shell.querySelector('[data-action="close"]')?.addEventListener("click", close);
      renderDraft();
      return () => {
        activePreview = null;
        applyTheme(saved);
      };
    });
  };

  const reconcile = () => {
    if (!loaded) return;
    applyTheme(activePreview ?? saved);
    mountNavigationButton("themes", "Themes", THEME_ICON, openThemes);
  };
  const unsubscribe = runtime.lifecycle.onReconcile(reconcile);
  void refreshSavedTheme()
    .then(reconcile)
    .catch((error) => {
      runtime.diagnostics.report("themes", error);
      loaded = true;
      saved = { ...DEFAULT_THEME };
      reconcile();
    });
  return () => {
    unsubscribe();
    runtime.ui.closeOverlay();
    removeOwned("themes");
  };
}

function colorPreviewName(key: ColorKey): string {
  if (key === "backgroundStart") return "start";
  if (key === "backgroundEnd") return "end";
  return key;
}
