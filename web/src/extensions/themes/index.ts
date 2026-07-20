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
  version: "1.2.0",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 15,
} as const;

const THEME_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18h1.1a1.9 1.9 0 0 0 0-3.8h-.6a1.6 1.6 0 0 1 0-3.2H15A6 6 0 0 0 12 3Z"/><circle cx="7.5" cy="11.5" r=".8" fill="currentColor" stroke="none"/><circle cx="9" cy="7.5" r=".8" fill="currentColor" stroke="none"/><circle cx="13" cy="6.5" r=".8" fill="currentColor" stroke="none"/><circle cx="16.5" cy="9" r=".8" fill="currentColor" stroke="none"/></svg>';
const PLUS_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const REMOVE_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

type ColorKey = "backgroundStart" | "backgroundEnd" | "accent" | "surface" | "text";
type ThemePreset = { id: string; name: string; theme: ThemeSettings };

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
  { name: "Crimson", theme: { backgroundStart: "#120405", backgroundEnd: "#43090D", accent: "#E23D49", surface: "#1B080A", text: "#FFF1F2", gradientAngle: 135 } },
];

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let saved: ThemeSettings = { ...DEFAULT_THEME };
  let customPresets: ThemePreset[] = [];
  let activePreview: ThemeSettings | null = null;
  let loaded = false;

  const refreshSavedTheme = async () => {
    const [themeValue, presetValue] = await Promise.all([
      runtime.bridge.request("themes", "get"),
      runtime.bridge.request("themes", "getPresets"),
    ]);
    const theme = asThemeSettings(themeValue);
    saved = theme;
    customPresets = asThemePresets(presetValue);
    loaded = true;
    applyTheme(theme);
    return theme;
  };

  const openThemes = () => {
    runtime.ui.openPage("themes", (container) => {
      addStyles(container, styles);
      const shell = document.createElement("main");
      shell.className = "themes-shell";
      shell.innerHTML = `
        <header class="themes-header">
          <div><p class="eyebrow">Appearance</p><h1 tabindex="-1">Themes</h1><p>Make JStremio yours. Changes preview instantly and stay private on this computer.</p></div>
        </header>
        <div class="themes-layout">
          <section class="editor" aria-labelledby="theme-colors-heading">
            <div class="section-heading"><div><h2 id="theme-colors-heading">Colors</h2><p>Enter a six-digit hex color or use the color picker.</p></div></div>
            <div class="preset-list" aria-label="Theme presets"></div>
            <section class="custom-presets" aria-labelledby="custom-presets-heading">
              <div class="custom-presets-heading"><div><h3 id="custom-presets-heading">Custom Presets</h3><p>Save the colors currently shown in the editor.</p></div><button class="button add-preset" type="button" data-action="create-preset">${PLUS_ICON}<span>Add preset</span></button></div>
              <div class="custom-preset-list" aria-label="Custom theme presets"></div>
            </section>
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
      const customPresetList = shell.querySelector<HTMLElement>(".custom-preset-list")!;
      const preview = shell.querySelector<HTMLElement>(".theme-preview")!;
      const status = shell.querySelector<HTMLElement>(".status")!;
      const savedIndicator = shell.querySelector<HTMLElement>(".saved-indicator")!;
      const saveButton = shell.querySelector<HTMLButtonElement>('[data-action="save"]')!;
      const resetButton = shell.querySelector<HTMLButtonElement>('[data-action="reset"]')!;
      const createPresetButton = shell.querySelector<HTMLButtonElement>('[data-action="create-preset"]')!;
      const range = shell.querySelector<HTMLInputElement>('[data-angle="range"]')!;
      const angleNumber = shell.querySelector<HTMLInputElement>('[data-angle="number"]')!;
      let draft: ThemeSettings = { ...saved };
      let presetBusy = false;
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

      const renderCustomPresets = () => {
        customPresetList.replaceChildren();
        if (!customPresets.length) {
          const empty = document.createElement("p");
          empty.className = "custom-presets-empty";
          empty.textContent = "No custom presets saved yet.";
          customPresetList.append(empty);
          return;
        }
        for (const preset of customPresets) {
          const group = document.createElement("div");
          group.className = "custom-preset";
          const button = document.createElement("button");
          button.type = "button";
          button.className = "preset custom-preset-button";
          button.dataset.customPreset = preset.id;
          button.setAttribute("aria-label", `Preview ${preset.name}`);
          const swatches = document.createElement("span");
          swatches.className = "preset-swatches";
          swatches.setAttribute("aria-hidden", "true");
          for (const color of [preset.theme.backgroundStart, preset.theme.backgroundEnd, preset.theme.accent]) {
            const swatch = document.createElement("i");
            swatch.style.setProperty("--swatch", color);
            swatches.append(swatch);
          }
          const name = document.createElement("span");
          name.textContent = preset.name;
          button.append(swatches, name);
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "remove-preset";
          remove.dataset.removePreset = preset.id;
          remove.setAttribute("aria-label", `Delete ${preset.name}`);
          remove.innerHTML = REMOVE_ICON;
          group.append(button, remove);
          customPresetList.append(group);
        }
      };

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
        createPresetButton.disabled = presetBusy || invalidFields.size > 0 || customPresets.length >= 50;
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

      customPresetList.addEventListener("click", (event) => {
        const target = event.target as Element;
        const removeButton = target.closest<HTMLButtonElement>("[data-remove-preset]");
        if (removeButton) {
          const preset = customPresets.find((item) => item.id === removeButton.dataset.removePreset);
          if (!preset || presetBusy) return;
          presetBusy = true;
          removeButton.disabled = true;
          updateActions();
          setStatus(`Deleting ${preset.name}…`);
          void runtime.bridge.request("themes", "deletePreset", { id: preset.id })
            .then(() => {
              customPresets = customPresets.filter((item) => item.id !== preset.id);
              renderCustomPresets();
              setStatus(`${preset.name} was deleted.`);
            })
            .catch((error) => setStatus(error instanceof Error ? error.message : "The preset could not be deleted.", true))
            .finally(() => {
              presetBusy = false;
              updateActions();
            });
          return;
        }
        const button = target.closest<HTMLButtonElement>("[data-custom-preset]");
        const preset = button ? customPresets.find((item) => item.id === button.dataset.customPreset) : undefined;
        if (!preset) return;
        draft = { ...preset.theme };
        renderDraft();
        setStatus(`${preset.name} is ready to preview. Save to keep it.`);
      });

      createPresetButton.addEventListener("click", () => {
        if (presetBusy || invalidFields.size || customPresets.length >= 50) return;
        presetBusy = true;
        updateActions();
        setStatus("Saving a custom preset…");
        void runtime.bridge.request("themes", "createPreset", draft)
          .then((value) => {
            const preset = asThemePreset(value);
            customPresets = [...customPresets, preset];
            renderCustomPresets();
            setStatus(`${preset.name} was saved from the current colors.`);
          })
          .catch((error) => setStatus(error instanceof Error ? error.message : "The preset could not be saved.", true))
          .finally(() => {
            presetBusy = false;
            updateActions();
          });
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

      renderCustomPresets();
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
    runtime.ui.closePage();
    removeOwned("themes");
  };
}

function asThemePresets(value: unknown): ThemePreset[] {
  if (!Array.isArray(value)) throw new TypeError("The saved theme presets are invalid.");
  return value.map(asThemePreset);
}

function asThemePreset(value: unknown): ThemePreset {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("The saved theme preset is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id || typeof record.name !== "string" || !record.name.trim()) {
    throw new TypeError("The saved theme preset is invalid.");
  }
  return { id: record.id, name: record.name, theme: asThemeSettings(record.theme) };
}

function colorPreviewName(key: ColorKey): string {
  if (key === "backgroundStart") return "start";
  if (key === "backgroundEnd") return "end";
  return key;
}
