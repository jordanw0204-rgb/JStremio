import styles from "./styles.css";
import {
  asPluginHotkeys,
  captureHotkey,
  displayHotkey,
  notifyHotkeysChanged,
  type ConfigurablePluginId,
  type PluginHotkeys,
} from "../../runtime/hotkeys";
import type { JStremioRuntime } from "../../runtime/types";
import { addStyles, mountNavigationButton, removeOwned, requireRuntime } from "../shared";
import {
  CAPTION_PRESETS,
  COMMON_CAPTION_FONTS,
  DEFAULT_CUSTOM_CAPTIONS,
  hexToRgba,
  matchingCaptionPreset,
  normalizeCustomCaptions,
  validateCustomCaptions,
  type CustomCaptionsSettings,
} from "../custom-captions/model";

type Plugin = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  builtIn: boolean;
  enabled: boolean;
  core: boolean;
  error: string | null;
};

type BegoneMouseSettings = {
  idleMs: number;
};

type QuickSeekSettings = {
  backwardSeconds: number;
  forwardSeconds: number;
};

type ReviewSettings = {
  autoOpenAtEnd: boolean;
};

type PreferredAudioDevice = { name: string; description: string };
type EasySoundOutputSettings = { preferredDevice: PreferredAudioDevice | null };
type QolThingsSettings = { rememberVolume: boolean; savedVolume: number | null };
type NoSpoilersSettings = {
  blurSummary: boolean;
  blurArtwork: boolean;
  titleMaskPercent: number;
  guardSeeks: boolean;
  maxSkipMinutes: number;
};

const DEFAULT_BEGONE_MOUSE_IDLE_MS = 1_000;
const MAX_BEGONE_MOUSE_IDLE_MS = 600_000;
const BEGONE_MOUSE_SETTINGS_CHANGED = "jstremio-begone-mouse-settings-changed";
const DEFAULT_QUICK_SEEK_SECONDS = 5;
const MIN_QUICK_SEEK_SECONDS = 0.05;
const MAX_QUICK_SEEK_SECONDS = 3_600;
const QUICK_SEEK_SETTINGS_CHANGED = "jstremio-quick-seek-settings-changed";
const REVIEW_SETTINGS_CHANGED = "jstremio-review-settings-changed";
const EASY_SOUND_SETTINGS_CHANGED = "jstremio-easy-sound-output-settings-changed";
const QOL_SETTINGS_CHANGED = "jstremio-qol-things-settings-changed";
const NO_SPOILERS_SETTINGS_CHANGED = "jstremio-no-spoilers-settings-changed";
const CUSTOM_CAPTIONS_SETTINGS_CHANGED = "jstremio-custom-captions-settings-changed";

const manifest = {
  schemaVersion: 1,
  id: "plugin-manager",
  name: "Plugins",
  version: "1.6.0",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 10,
} as const;

const PLUGIN_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 3.5h2V6a2 2 0 0 0 4 0V3.5h2a2 2 0 0 1 2 2v2h-2.5a2 2 0 0 0 0 4H18.5v2a2 2 0 0 1-2 2h-2V18a2 2 0 0 1-4 0v-2.5h-2a2 2 0 0 1-2-2v-2H4a2 2 0 0 1 0-4h2.5v-2a2 2 0 0 1 2-2Z"/></svg>';

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  const openManager = () => {
    runtime.ui.openPage("plugin-manager", (container) => {
      addStyles(container, styles);
      const shell = document.createElement("main");
      shell.className = "plugins-shell";
      shell.innerHTML = `
        <header class="plugins-header"><div><h1>Plugins</h1><p>Enable built-in features and trusted local plugins.</p></div></header>
        <section class="warning"><strong>Local plugins are trusted code.</strong><span>They run inside Stremio's WebView and can access the page. Install plugins only from authors you trust.</span></section>
        <div class="toolbar"><button class="button" data-action="folder">Open plugins folder</button><button class="button" data-action="refresh">Refresh status</button></div>
        <div class="restart" role="status" hidden><span>Plugin changes were saved. Fully restart JStremio to apply them.</span><button class="button restart-button" data-action="restart">Restart JStremio</button></div>
        <section class="status" role="status">Loading plugins…</section><section class="plugin-grid" hidden></section>
        <section class="install-help"><h2>Add a local plugin</h2><ol><li>Create a folder under <code>%LOCALAPPDATA%\\JStremio\\plugins</code>.</li><li>Add <code>manifest.json</code>, <code>index.js</code>, and <code>styles.css</code>.</li><li>Restart JStremio, enable the plugin here, then restart once more.</li></ol><p>User plugins start disabled, even if their manifest requests otherwise.</p></section>`;
      container.append(shell);
      const grid = shell.querySelector<HTMLElement>(".plugin-grid")!;
      const status = shell.querySelector<HTMLElement>(".status")!;
      const restart = shell.querySelector<HTMLElement>(".restart")!;
      const load = async () => {
        status.hidden = false;
        grid.hidden = true;
        status.textContent = "Loading plugins…";
        try {
          const [pluginValue, hotkeyValue, reviewValue, begoneMouseValue, quickSeekValue, easySoundValue, qolValue, noSpoilersValue, customCaptionsValue] = await Promise.all([
            runtime.bridge.request("plugins", "list"),
            runtime.bridge.request("plugins", "getHotkeys"),
            runtime.bridge.request("plugins", "getReviewSettings"),
            runtime.bridge.request("plugins", "getBegoneMouse"),
            runtime.bridge.request("plugins", "getQuickSeek"),
            runtime.bridge.request("plugins", "getEasySoundOutput"),
            runtime.bridge.request("plugins", "getQolThings"),
            runtime.bridge.request("plugins", "getNoSpoilers"),
            runtime.bridge.request("plugins", "getCustomCaptions"),
          ]);
          const plugins = asPlugins(pluginValue);
          renderPlugins(
            runtime,
            grid,
            plugins,
            asPluginHotkeys(hotkeyValue),
            asReviewSettings(reviewValue),
            asBegoneMouseSettings(begoneMouseValue),
            asQuickSeekSettings(quickSeekValue),
            asEasySoundOutputSettings(easySoundValue),
            asQolThingsSettings(qolValue),
            asNoSpoilersSettings(noSpoilersValue),
            normalizeCustomCaptions(customCaptionsValue),
            restart,
          );
          status.hidden = plugins.length > 0;
          grid.hidden = plugins.length === 0;
          status.textContent = plugins.length ? "" : "No plugins were discovered.";
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : "Plugin state is unavailable.";
        }
      };
      shell.querySelector('[data-action="refresh"]')?.addEventListener("click", () => void load());
      shell.querySelector('[data-action="folder"]')?.addEventListener("click", () => {
        void runtime.bridge.request("plugins", "openPluginsFolder").catch((error) => {
          status.hidden = false;
          status.textContent = error instanceof Error ? error.message : "The plugins folder could not be opened.";
        });
      });
      shell.querySelector<HTMLButtonElement>('[data-action="restart"]')?.addEventListener("click", (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        button.textContent = "Restarting…";
        void runtime.bridge.request("plugins", "restart", {}, { timeoutMs: 2_000 }).catch((error) => {
          button.disabled = false;
          button.textContent = "Restart JStremio";
          status.hidden = false;
          status.textContent = error instanceof Error ? error.message : "JStremio could not restart.";
        });
      });
      void load();
    });
  };
  const reconcile = () => mountNavigationButton("plugin-manager", "Plugins", PLUGIN_ICON, openManager);
  const unsubscribe = runtime.lifecycle.onReconcile(reconcile);
  return () => {
    unsubscribe();
    runtime.ui.closePage();
    removeOwned("plugin-manager");
  };
}

function renderPlugins(
  runtime: JStremioRuntime,
  grid: HTMLElement,
  plugins: Plugin[],
  hotkeys: PluginHotkeys,
  reviewSettings: ReviewSettings,
  begoneMouse: BegoneMouseSettings,
  quickSeek: QuickSeekSettings,
  easySound: EasySoundOutputSettings,
  qol: QolThingsSettings,
  noSpoilers: NoSpoilersSettings,
  customCaptions: CustomCaptionsSettings,
  restart: HTMLElement,
) {
  grid.replaceChildren();
  for (const plugin of plugins) {
    const card = document.createElement("article");
    card.className = `plugin-card${plugin.error ? " invalid" : ""}`;
    const heading = document.createElement("div");
    heading.className = "plugin-heading";
    const title = document.createElement("h2");
    title.textContent = plugin.name;
    const badges = document.createElement("div");
    badges.className = "badges";
    badges.textContent = plugin.builtIn ? "Built-in" : "Local";
    heading.append(title, badges);
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = [plugin.version && `v${plugin.version}`, plugin.author].filter(Boolean).join(" · ");
    const description = document.createElement("p");
    description.textContent = plugin.error || plugin.description || "No description provided.";
    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle-row";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = plugin.enabled;
    toggle.disabled = plugin.core || Boolean(plugin.error);
    toggle.setAttribute("aria-label", `${plugin.enabled ? "Disable" : "Enable"} ${plugin.name}`);
    const toggleText = document.createElement("span");
    toggleText.textContent = plugin.core ? "Required" : plugin.enabled ? "Enabled" : "Disabled";
    toggle.addEventListener("change", () => {
      toggle.disabled = true;
      void runtime.bridge.request("plugins", "setEnabled", { id: plugin.id, enabled: toggle.checked })
        .then(() => {
          plugin.enabled = toggle.checked;
          toggleText.textContent = plugin.enabled ? "Enabled" : "Disabled";
          restart.hidden = false;
          toggle.disabled = false;
        })
        .catch(() => {
          toggle.checked = plugin.enabled;
          toggle.disabled = false;
        });
    });
    toggleLabel.append(toggle, toggleText);
    card.append(heading, meta, description, toggleLabel);
    if (hasPluginSettings(plugin.id) && plugin.builtIn && !plugin.error) {
      const actions = document.createElement("div");
      actions.className = "plugin-actions";
      const settings = document.createElement("button");
      settings.type = "button";
      settings.className = "button settings-button";
      settings.textContent = "Settings";
      settings.setAttribute("aria-label", `Settings for ${plugin.name}`);
      const summary = document.createElement("span");
      summary.className = "hotkey-summary";
      const renderSummary = () => {
        if (plugin.id === "reviews") summary.textContent = `Hotkey: ${displayHotkey(hotkeys.reviews)} · End prompt: ${reviewSettings.autoOpenAtEnd ? "On" : "Off"}`;
        else if (isHotkeyPluginId(plugin.id)) summary.textContent = `Hotkey: ${displayHotkey(hotkeys[plugin.id])}`;
        else if (plugin.id === "begone-mouse") summary.textContent = `Idle delay: ${formatIdleDelay(begoneMouse.idleMs)}`;
        else if (plugin.id === "quick-seek") summary.textContent = `Back ${formatSeekSeconds(quickSeek.backwardSeconds)} · Forward ${formatSeekSeconds(quickSeek.forwardSeconds)}`;
        else if (plugin.id === "easy-sound-output") summary.textContent = easySound.preferredDevice?.description ?? "Preferred device: System default";
        else if (plugin.id === "qol-things") summary.textContent = qol.rememberVolume ? `Remember volume: On${qol.savedVolume === null ? "" : ` · ${Number(qol.savedVolume.toFixed(1))}%`}` : "Remember volume: Off";
        else if (plugin.id === "custom-captions") summary.textContent = `${matchingCaptionPreset(customCaptions)?.name ?? "Custom"} · ${customCaptions.fontFamily} · ${Number(customCaptions.fontSize.toFixed(1))}px`;
        else summary.textContent = `Mask ${noSpoilers.titleMaskPercent}% · Max skip ${Number(noSpoilers.maxSkipMinutes.toFixed(2))} min`;
      };
      renderSummary();
      settings.addEventListener("click", () => {
        if (isHotkeyPluginId(plugin.id)) {
          openHotkeySettings(runtime, plugin, hotkeys, reviewSettings, renderSummary);
        } else if (plugin.id === "begone-mouse") {
          openBegoneMouseSettings(runtime, plugin, begoneMouse, renderSummary);
        } else if (plugin.id === "quick-seek") {
          openQuickSeekSettings(runtime, plugin, quickSeek, renderSummary);
        } else if (plugin.id === "easy-sound-output") {
          openEasySoundSettings(runtime, plugin, easySound, renderSummary);
        } else if (plugin.id === "qol-things") {
          openQolSettings(runtime, plugin, qol, renderSummary);
        } else if (plugin.id === "custom-captions") {
          openCustomCaptionsSettings(runtime, plugin, customCaptions, renderSummary);
        } else {
          openNoSpoilersSettings(runtime, plugin, noSpoilers, renderSummary);
        }
      });
      actions.append(settings, summary);
      card.append(actions);
    }
    grid.append(card);
  }
}

function openHotkeySettings(
  runtime: JStremioRuntime,
  plugin: Plugin,
  hotkeys: PluginHotkeys,
  reviewSettings: ReviewSettings,
  saved: () => void,
) {
  if (!isHotkeyPluginId(plugin.id)) return;
  const pluginId = plugin.id;
  runtime.ui.openDialog((container, close) => {
    addStyles(container, styles);
    const dialog = document.createElement("section");
    dialog.className = "plugin-settings-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "jstremio-plugin-settings-title");
    dialog.innerHTML = `
      <h2 id="jstremio-plugin-settings-title"></h2>
      <p class="settings-description">Choose a hotkey that opens this plugin's player popout. It works only while the matching player action is available.</p>
      <label class="hotkey-field">Hotkey<input class="hotkey-input" type="text" readonly spellcheck="false" autocomplete="off"></label>
      ${pluginId === "reviews" ? '<label class="settings-toggle"><input type="checkbox" data-review-auto-open><span><strong>Open automatically at episode end</strong><small>Show the review popout when Stremio displays its Next episode prompt.</small></span></label>' : ""}
      <p class="hotkey-help">Select the field, then press a letter, number, function key, or a combination using Ctrl, Alt, and Shift.</p>
      <div class="settings-status" role="status" aria-live="polite"></div>
      <div class="settings-actions"><button type="button" class="button" data-action="clear">Clear hotkey</button><span></span><button type="button" class="button" data-action="cancel">Cancel</button><button type="button" class="button primary" data-action="save">Save</button></div>`;
    dialog.querySelector<HTMLHeadingElement>("h2")!.textContent = `${plugin.name} settings`;
    const input = dialog.querySelector<HTMLInputElement>(".hotkey-input")!;
    input.setAttribute("aria-label", `Hotkey for ${plugin.name}`);
    const status = dialog.querySelector<HTMLElement>(".settings-status")!;
    const save = dialog.querySelector<HTMLButtonElement>('[data-action="save"]')!;
    const autoOpen = dialog.querySelector<HTMLInputElement>('[data-review-auto-open]');
    if (autoOpen) autoOpen.checked = reviewSettings.autoOpenAtEnd;
    let candidate = hotkeys[pluginId] ?? null;
    const showCandidate = () => {
      input.value = displayHotkey(candidate);
      delete input.dataset.recording;
    };
    const beginRecording = () => {
      input.dataset.recording = "true";
      input.value = "Press a key combination…";
      status.textContent = "Recording. Modifier keys must be followed by another key.";
    };
    input.addEventListener("focus", beginRecording);
    input.addEventListener("click", beginRecording);
    input.addEventListener("blur", showCandidate);
    input.addEventListener("keydown", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const captured = captureHotkey(event);
      if (captured.kind === "modifier") {
        input.value = "Now press another key…";
        status.textContent = "Keep holding the modifier, then press another key.";
        return;
      }
      if (captured.kind === "rejected") {
        status.textContent = captured.message;
        return;
      }
      const conflict = Object.entries(hotkeys).find(
        ([id, hotkey]) => id !== pluginId && hotkey === captured.value,
      );
      if (conflict) {
        status.textContent = `That hotkey is already assigned to ${pluginName(conflict[0])}.`;
        return;
      }
      candidate = captured.value;
      status.textContent = `${displayHotkey(candidate)} recorded. Choose Save to apply it.`;
      input.blur();
    });
    dialog.querySelector('[data-action="clear"]')?.addEventListener("click", () => {
      candidate = null;
      status.textContent = "The hotkey will be cleared when you choose Save.";
      showCandidate();
    });
    dialog.querySelector('[data-action="cancel"]')?.addEventListener("click", close);
    save.addEventListener("click", () => {
      save.disabled = true;
      status.textContent = "Saving…";
      const requests = [runtime.bridge.request("plugins", "setHotkey", { id: pluginId, hotkey: candidate })];
      if (pluginId === "reviews" && autoOpen) {
        requests.push(runtime.bridge.request("plugins", "setReviewSettings", { autoOpenAtEnd: autoOpen.checked }));
      }
      void Promise.all(requests)
        .then(() => {
          if (candidate) hotkeys[pluginId] = candidate;
          else delete hotkeys[pluginId];
          if (pluginId === "reviews" && autoOpen) {
            reviewSettings.autoOpenAtEnd = autoOpen.checked;
            window.dispatchEvent(new CustomEvent(REVIEW_SETTINGS_CHANGED, { detail: { ...reviewSettings } }));
          }
          notifyHotkeysChanged();
          saved();
          close();
        })
        .catch((error) => {
          save.disabled = false;
          status.textContent = error instanceof Error ? error.message : "The hotkey could not be saved.";
        });
    });
    showCandidate();
    container.append(dialog);
  });
}

function openBegoneMouseSettings(
  runtime: JStremioRuntime,
  plugin: Plugin,
  settings: BegoneMouseSettings,
  saved: () => void,
) {
  runtime.ui.openDialog((container, close) => {
    addStyles(container, styles);
    const dialog = document.createElement("section");
    dialog.className = "plugin-settings-dialog begone-mouse-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "jstremio-plugin-settings-title");
    dialog.innerHTML = `
      <h2 id="jstremio-plugin-settings-title">${plugin.name} settings</h2>
      <p class="settings-description">Choose how long the pointer can remain idle before JStremio hides the player interface and cursor.</p>
      <label class="hotkey-field">Idle delay (milliseconds)<input class="hotkey-input delay-input" type="number" min="0" max="${MAX_BEGONE_MOUSE_IDLE_MS}" step="any" inputmode="decimal" autocomplete="off"></label>
      <div class="delay-presets" aria-label="Idle delay presets">
        ${[50, 250, 500, 1_000, 2_000, 5_000].map((value) => `<button type="button" class="delay-preset" data-delay="${value}">${value >= 1_000 ? `${value / 1_000}s` : `${value}ms`}</button>`).join("")}
      </div>
      <p class="hotkey-help">Decimal values such as 0.05 are accepted. Sub-millisecond delays run on WebView's next available timer tick.</p>
      <div class="settings-status" role="status" aria-live="polite"></div>
      <div class="settings-actions"><button type="button" class="button" data-action="default">Use 1000 ms</button><span></span><button type="button" class="button" data-action="cancel">Cancel</button><button type="button" class="button primary" data-action="save">Save</button></div>`;
    const input = dialog.querySelector<HTMLInputElement>(".delay-input")!;
    const status = dialog.querySelector<HTMLElement>(".settings-status")!;
    const save = dialog.querySelector<HTMLButtonElement>('[data-action="save"]')!;
    input.value = String(settings.idleMs);
    const candidate = () => Number(input.value);
    const validate = () => {
      const value = candidate();
      const valid = input.value.trim() !== ""
        && Number.isFinite(value)
        && value >= 0
        && value <= MAX_BEGONE_MOUSE_IDLE_MS;
      input.setAttribute("aria-invalid", String(!valid));
      save.disabled = !valid;
      status.textContent = valid
        ? `The player interface will hide after ${formatIdleDelay(value)} of pointer inactivity.`
        : "Enter a number from 0 through 600000 milliseconds.";
      return valid;
    };
    input.addEventListener("input", validate);
    dialog.querySelectorAll<HTMLButtonElement>("[data-delay]").forEach((button) => {
      button.addEventListener("click", () => {
        input.value = button.dataset.delay ?? String(DEFAULT_BEGONE_MOUSE_IDLE_MS);
        validate();
        input.focus();
      });
    });
    dialog.querySelector('[data-action="default"]')?.addEventListener("click", () => {
      input.value = String(DEFAULT_BEGONE_MOUSE_IDLE_MS);
      validate();
      input.focus();
    });
    dialog.querySelector('[data-action="cancel"]')?.addEventListener("click", close);
    save.addEventListener("click", () => {
      if (!validate()) return;
      const idleMs = candidate();
      save.disabled = true;
      status.textContent = "Saving…";
      void runtime.bridge.request("plugins", "setBegoneMouse", { idleMs })
        .then(() => {
          settings.idleMs = idleMs;
          window.dispatchEvent(new CustomEvent(BEGONE_MOUSE_SETTINGS_CHANGED, { detail: { idleMs } }));
          saved();
          close();
        })
        .catch((error) => {
          save.disabled = false;
          status.textContent = error instanceof Error ? error.message : "The idle delay could not be saved.";
        });
    });
    validate();
    container.append(dialog);
  });
}

function openQuickSeekSettings(
  runtime: JStremioRuntime,
  plugin: Plugin,
  settings: QuickSeekSettings,
  saved: () => void,
) {
  runtime.ui.openDialog((container, close) => {
    addStyles(container, styles);
    const dialog = document.createElement("section");
    dialog.className = "plugin-settings-dialog quick-seek-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "jstremio-plugin-settings-title");
    dialog.innerHTML = `
      <h2 id="jstremio-plugin-settings-title">${plugin.name} settings</h2>
      <p class="settings-description">Choose independent rewind and fast-forward amounts. These values apply to both the large video controls and the bottom player bar.</p>
      <div class="quick-seek-fields">
        <label class="hotkey-field">Rewind seconds<input class="hotkey-input delay-input" data-direction="backward" type="number" min="${MIN_QUICK_SEEK_SECONDS}" max="${MAX_QUICK_SEEK_SECONDS}" step="any" inputmode="decimal" autocomplete="off"></label>
        <label class="hotkey-field">Fast-forward seconds<input class="hotkey-input delay-input" data-direction="forward" type="number" min="${MIN_QUICK_SEEK_SECONDS}" max="${MAX_QUICK_SEEK_SECONDS}" step="any" inputmode="decimal" autocomplete="off"></label>
      </div>
      <div class="delay-presets" aria-label="Quick Seek presets">
        ${[5, 10, 15, 30].map((value) => `<button type="button" class="delay-preset" data-seconds="${value}">${value}s both</button>`).join("")}
      </div>
      <p class="hotkey-help">Enter decimal values from 0.05 through 3600 seconds. Holding a seek button accelerates from the configured amount.</p>
      <div class="settings-status" role="status" aria-live="polite"></div>
      <div class="settings-actions"><button type="button" class="button" data-action="default">Use 5s both</button><span></span><button type="button" class="button" data-action="cancel">Cancel</button><button type="button" class="button primary" data-action="save">Save</button></div>`;
    const backward = dialog.querySelector<HTMLInputElement>('[data-direction="backward"]')!;
    const forward = dialog.querySelector<HTMLInputElement>('[data-direction="forward"]')!;
    const status = dialog.querySelector<HTMLElement>(".settings-status")!;
    const save = dialog.querySelector<HTMLButtonElement>('[data-action="save"]')!;
    backward.value = String(settings.backwardSeconds);
    forward.value = String(settings.forwardSeconds);
    const values = () => ({ backwardSeconds: Number(backward.value), forwardSeconds: Number(forward.value) });
    const validValue = (input: HTMLInputElement, value: number) => {
      const valid = input.value.trim() !== ""
        && Number.isFinite(value)
        && value >= MIN_QUICK_SEEK_SECONDS
        && value <= MAX_QUICK_SEEK_SECONDS;
      input.setAttribute("aria-invalid", String(!valid));
      return valid;
    };
    const validate = () => {
      const candidate = values();
      const valid = validValue(backward, candidate.backwardSeconds)
        && validValue(forward, candidate.forwardSeconds);
      save.disabled = !valid;
      status.textContent = valid
        ? `Rewind ${formatSeekSeconds(candidate.backwardSeconds)} and fast-forward ${formatSeekSeconds(candidate.forwardSeconds)}.`
        : "Enter a number from 0.05 through 3600 seconds for both directions.";
      return valid;
    };
    backward.addEventListener("input", validate);
    forward.addEventListener("input", validate);
    dialog.querySelectorAll<HTMLButtonElement>("[data-seconds]").forEach((button) => {
      button.addEventListener("click", () => {
        backward.value = button.dataset.seconds ?? String(DEFAULT_QUICK_SEEK_SECONDS);
        forward.value = backward.value;
        validate();
      });
    });
    dialog.querySelector('[data-action="default"]')?.addEventListener("click", () => {
      backward.value = String(DEFAULT_QUICK_SEEK_SECONDS);
      forward.value = String(DEFAULT_QUICK_SEEK_SECONDS);
      validate();
    });
    dialog.querySelector('[data-action="cancel"]')?.addEventListener("click", close);
    save.addEventListener("click", () => {
      if (!validate()) return;
      const candidate = values();
      save.disabled = true;
      status.textContent = "Savingâ€¦";
      void runtime.bridge.request("plugins", "setQuickSeek", candidate)
        .then(() => {
          Object.assign(settings, candidate);
          window.dispatchEvent(new CustomEvent(QUICK_SEEK_SETTINGS_CHANGED, { detail: candidate }));
          saved();
          close();
        })
        .catch((error) => {
          save.disabled = false;
          status.textContent = error instanceof Error ? error.message : "The seek amounts could not be saved.";
        });
    });
    validate();
    container.append(dialog);
  });
}

function openEasySoundSettings(
  runtime: JStremioRuntime,
  plugin: Plugin,
  settings: EasySoundOutputSettings,
  saved: () => void,
) {
  runtime.ui.openDialog((container, close) => {
    addStyles(container, styles);
    const dialog = document.createElement("section");
    dialog.className = "plugin-settings-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.innerHTML = `<h2>${plugin.name} settings</h2><p class="settings-description">Right-click the player volume button to switch devices. A preferred device is selected automatically whenever playback starts.</p><label class="hotkey-field">Preferred audio output<input class="hotkey-input" type="text" readonly></label><div class="settings-status" role="status" aria-live="polite"></div><div class="settings-actions"><button type="button" class="button" data-action="clear">Clear preferred device</button><span></span><button type="button" class="button" data-action="cancel">Cancel</button><button type="button" class="button primary" data-action="save">Save</button></div>`;
    const input = dialog.querySelector<HTMLInputElement>("input")!;
    const status = dialog.querySelector<HTMLElement>(".settings-status")!;
    let candidate = settings.preferredDevice;
    const render = () => {
      input.value = candidate?.description ?? "System default / last selected";
      status.textContent = candidate ? candidate.name : "No preferred device is saved.";
    };
    dialog.querySelector('[data-action="clear"]')?.addEventListener("click", () => {
      candidate = null;
      render();
    });
    dialog.querySelector('[data-action="cancel"]')?.addEventListener("click", close);
    dialog.querySelector<HTMLButtonElement>('[data-action="save"]')!.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      void runtime.bridge.request("plugins", "setEasySoundOutput", { preferredDevice: candidate }).then(() => {
        settings.preferredDevice = candidate;
        window.dispatchEvent(new CustomEvent(EASY_SOUND_SETTINGS_CHANGED, { detail: { ...settings } }));
        saved();
        close();
      }).catch((error) => {
        button.disabled = false;
        status.textContent = error instanceof Error ? error.message : "The preferred device could not be saved.";
      });
    });
    render();
    container.append(dialog);
  });
}

function openQolSettings(
  runtime: JStremioRuntime,
  plugin: Plugin,
  settings: QolThingsSettings,
  saved: () => void,
) {
  runtime.ui.openDialog((container, close) => {
    addStyles(container, styles);
    const dialog = document.createElement("section");
    dialog.className = "plugin-settings-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.innerHTML = `<h2>${plugin.name} settings</h2><p class="settings-description">Quality-of-life features are stored privately on this computer.</p><label class="settings-toggle"><input type="checkbox" data-remember-volume><span><strong>Remember player volume</strong><small>Restore the last volume after closing, restarting, or reopening JStremio.</small></span></label><p class="hotkey-help" data-saved-volume></p><div class="settings-status" role="status" aria-live="polite"></div><div class="settings-actions"><span></span><span></span><button type="button" class="button" data-action="cancel">Cancel</button><button type="button" class="button primary" data-action="save">Save</button></div>`;
    const toggle = dialog.querySelector<HTMLInputElement>('[data-remember-volume]')!;
    const status = dialog.querySelector<HTMLElement>(".settings-status")!;
    toggle.checked = settings.rememberVolume;
    dialog.querySelector<HTMLElement>('[data-saved-volume]')!.textContent = settings.savedVolume === null
      ? "No volume has been saved yet."
      : `Currently saved: ${Number(settings.savedVolume.toFixed(1))}%`;
    dialog.querySelector('[data-action="cancel"]')?.addEventListener("click", close);
    dialog.querySelector<HTMLButtonElement>('[data-action="save"]')!.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      const candidate = { rememberVolume: toggle.checked, savedVolume: settings.savedVolume };
      void runtime.bridge.request("plugins", "setQolThings", candidate).then(() => {
        Object.assign(settings, candidate);
        window.dispatchEvent(new CustomEvent(QOL_SETTINGS_CHANGED, { detail: { ...settings } }));
        saved();
        close();
      }).catch((error) => {
        button.disabled = false;
        status.textContent = error instanceof Error ? error.message : "The volume preference could not be saved.";
      });
    });
    container.append(dialog);
  });
}

function openNoSpoilersSettings(
  runtime: JStremioRuntime,
  plugin: Plugin,
  settings: NoSpoilersSettings,
  saved: () => void,
) {
  runtime.ui.openDialog((container, close) => {
    addStyles(container, styles);
    const dialog = document.createElement("section");
    dialog.className = "plugin-settings-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.innerHTML = `<h2>${plugin.name} settings</h2><p class="settings-description">Choose which details to conceal and how far the player may jump forward without confirmation.</p><label class="settings-toggle"><input type="checkbox" data-key="blurSummary"><span><strong>Blur summaries</strong><small>Hide plot descriptions on detail pages.</small></span></label><label class="settings-toggle"><input type="checkbox" data-key="blurArtwork"><span><strong>Blur thumbnails and backgrounds</strong><small>Conceal episode and title artwork.</small></span></label><label class="hotkey-field">Title characters hidden (%)<input class="hotkey-input delay-input" data-key="titleMaskPercent" type="number" min="0" max="100" step="1"></label><label class="settings-toggle"><input type="checkbox" data-key="guardSeeks"><span><strong>Confirm large forward skips</strong><small>Block accidental jumps while still providing an explicit Skip button.</small></span></label><label class="hotkey-field">Maximum forward skip (minutes)<input class="hotkey-input delay-input" data-key="maxSkipMinutes" type="number" min="0.05" max="1440" step="any"></label><div class="settings-status" role="status" aria-live="polite"></div><div class="settings-actions"><span></span><span></span><button type="button" class="button" data-action="cancel">Cancel</button><button type="button" class="button primary" data-action="save">Save</button></div>`;
    const blurSummary = dialog.querySelector<HTMLInputElement>('[data-key="blurSummary"]')!;
    const blurArtwork = dialog.querySelector<HTMLInputElement>('[data-key="blurArtwork"]')!;
    const titleMaskPercent = dialog.querySelector<HTMLInputElement>('[data-key="titleMaskPercent"]')!;
    const guardSeeks = dialog.querySelector<HTMLInputElement>('[data-key="guardSeeks"]')!;
    const maxSkipMinutes = dialog.querySelector<HTMLInputElement>('[data-key="maxSkipMinutes"]')!;
    const status = dialog.querySelector<HTMLElement>(".settings-status")!;
    const saveButton = dialog.querySelector<HTMLButtonElement>('[data-action="save"]')!;
    blurSummary.checked = settings.blurSummary;
    blurArtwork.checked = settings.blurArtwork;
    titleMaskPercent.value = String(settings.titleMaskPercent);
    guardSeeks.checked = settings.guardSeeks;
    maxSkipMinutes.value = String(settings.maxSkipMinutes);
    const values = () => ({
      blurSummary: blurSummary.checked,
      blurArtwork: blurArtwork.checked,
      titleMaskPercent: Number(titleMaskPercent.value),
      guardSeeks: guardSeeks.checked,
      maxSkipMinutes: Number(maxSkipMinutes.value),
    });
    const validate = () => {
      const candidate = values();
      const valid = Number.isFinite(candidate.titleMaskPercent) && candidate.titleMaskPercent >= 0 && candidate.titleMaskPercent <= 100
        && Number.isFinite(candidate.maxSkipMinutes) && candidate.maxSkipMinutes >= 0.05 && candidate.maxSkipMinutes <= 1_440;
      saveButton.disabled = !valid;
      status.textContent = valid ? "" : "Use 0–100% for title masking and 0.05–1440 minutes for the seek limit.";
      return valid;
    };
    titleMaskPercent.addEventListener("input", validate);
    maxSkipMinutes.addEventListener("input", validate);
    dialog.querySelector('[data-action="cancel"]')?.addEventListener("click", close);
    saveButton.addEventListener("click", () => {
      if (!validate()) return;
      const candidate = values();
      saveButton.disabled = true;
      void runtime.bridge.request("plugins", "setNoSpoilers", candidate).then(() => {
        Object.assign(settings, candidate);
        window.dispatchEvent(new CustomEvent(NO_SPOILERS_SETTINGS_CHANGED, { detail: { ...settings } }));
        saved();
        close();
      }).catch((error) => {
        saveButton.disabled = false;
        status.textContent = error instanceof Error ? error.message : "No Spoilers settings could not be saved.";
      });
    });
    validate();
    container.append(dialog);
  });
}

function openCustomCaptionsSettings(
  runtime: JStremioRuntime,
  plugin: Plugin,
  settings: CustomCaptionsSettings,
  saved: () => void,
) {
  runtime.ui.openDialog((container, close) => {
    addStyles(container, styles);
    const dialog = document.createElement("section");
    dialog.className = "plugin-settings-dialog custom-captions-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "custom-captions-title");
    const presetButtons = CAPTION_PRESETS.map((preset) => `
      <button type="button" class="caption-preset" data-caption-preset="${preset.id}">
        <span class="caption-preset-dots" aria-hidden="true">${preset.colors.map((color) => `<i style="background:${color}"></i>`).join("")}</span>
        <span>${preset.name}</span>
      </button>`).join("");
    const fontOptions = COMMON_CAPTION_FONTS.map((font) => `<option value="${font}"></option>`).join("");
    dialog.innerHTML = `
      <header class="caption-settings-header"><div><h2 id="custom-captions-title">${plugin.name} settings</h2><p class="settings-description">Style text captions in the native player. Changes apply immediately after Save.</p></div><span class="caption-live-badge">Live preview</span></header>
      <section class="caption-preview" aria-label="Caption preview"><div class="caption-preview-glow"></div><div class="caption-preview-text">The quick brown fox jumps over the lazy dog.</div></section>
      <section class="caption-section"><h3>Caption themes</h3><div class="caption-presets">${presetButtons}</div></section>
      <div class="caption-settings-grid">
        <section class="caption-section"><h3>Typography</h3>
          <label class="caption-field"><span>Font family</span><input class="caption-text-input" data-caption="fontFamily" list="caption-fonts" autocomplete="off" maxlength="128"><datalist id="caption-fonts">${fontOptions}</datalist></label>
          ${captionRange("Font size", "fontSize", 8, 120, 1, "px")}
          ${captionRange("Screen position", "position", 0, 150, 1, "")}
          ${captionRange("Letter spacing", "letterSpacing", -10, 20, 0.5, "px")}
          <div class="caption-toggle-pair"><label class="settings-toggle compact"><input type="checkbox" data-caption="bold"><span><strong>Bold</strong></span></label><label class="settings-toggle compact"><input type="checkbox" data-caption="italic"><span><strong>Italic</strong></span></label></div>
        </section>
        <section class="caption-section"><h3>Text and outline</h3>
          ${captionColor("Text", "textColor")}${captionRange("Text opacity", "textOpacity", 0, 100, 1, "%")}
          ${captionColor("Outline", "outlineColor")}${captionRange("Outline opacity", "outlineOpacity", 0, 100, 1, "%")}
          ${captionRange("Outline width", "outlineSize", 0, 10, 0.5, "px")}
        </section>
        <section class="caption-section"><h3>Background and shadow</h3>
          ${captionColor("Background", "backgroundColor")}${captionRange("Background opacity", "backgroundOpacity", 0, 100, 1, "%")}
          ${captionColor("Shadow", "shadowColor")}${captionRange("Shadow opacity", "shadowOpacity", 0, 100, 1, "%")}
          ${captionRange("Shadow offset / box padding", "shadowOffset", 0, 20, 0.5, "px")}
        </section>
        <section class="caption-section"><h3>Subtitle compatibility</h3>
          <label class="caption-field"><span>Embedded ASS styles</span><select class="caption-text-input" data-caption="assOverride"><option value="force">Force my custom style</option><option value="scale">Keep authored style, apply scale</option><option value="no">Respect authored style completely</option></select></label>
          <p class="hotkey-help">Force makes your design consistent. Respect preserves karaoke, signs, and carefully authored positioning. Image-based DVD/PGS subtitles cannot be restyled.</p>
        </section>
      </div>
      <div class="settings-status" role="status" aria-live="polite"></div>
      <div class="settings-actions caption-actions"><button type="button" class="button" data-action="default">Reset to Classic</button><span></span><button type="button" class="button" data-action="cancel">Cancel</button><button type="button" class="button primary" data-action="save">Save</button></div>`;
    container.append(dialog);

    const status = dialog.querySelector<HTMLElement>(".settings-status")!;
    const saveButton = dialog.querySelector<HTMLButtonElement>('[data-action="save"]')!;
    const preview = dialog.querySelector<HTMLElement>(".caption-preview-text")!;
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
    const render = () => {
      const raw = read();
      const error = validateCustomCaptions(raw);
      const candidate = normalizeCustomCaptions(raw);
      saveButton.disabled = Boolean(error);
      status.textContent = error ?? "Text subtitle styling is valid and ready to save.";
      preview.style.fontFamily = `"${candidate.fontFamily.replaceAll('"', "")}", sans-serif`;
      preview.style.fontSize = `${Math.max(15, candidate.fontSize * 0.44)}px`;
      preview.style.fontWeight = candidate.bold ? "800" : "500";
      preview.style.fontStyle = candidate.italic ? "italic" : "normal";
      preview.style.letterSpacing = `${candidate.letterSpacing * 0.44}px`;
      preview.style.color = hexToRgba(candidate.textColor, candidate.textOpacity);
      preview.style.webkitTextStroke = `${candidate.outlineSize * 0.44}px ${hexToRgba(candidate.outlineColor, candidate.outlineOpacity)}`;
      preview.style.background = hexToRgba(candidate.backgroundColor, candidate.backgroundOpacity);
      preview.style.textShadow = candidate.shadowOffset > 0 && candidate.shadowOpacity > 0
        ? `${candidate.shadowOffset * 0.44}px ${candidate.shadowOffset * 0.44}px ${Math.max(1, candidate.shadowOffset * 0.7)}px ${hexToRgba(candidate.shadowColor, candidate.shadowOpacity)}`
        : "none";
      preview.style.top = `${Math.min(84, Math.max(8, candidate.position / 150 * 80))}%`;
      dialog.querySelectorAll<HTMLButtonElement>("[data-caption-preset]").forEach((button) => {
        button.toggleAttribute("data-active", button.dataset.captionPreset === matchingCaptionPreset(candidate)?.id);
      });
      dialog.querySelectorAll<HTMLOutputElement>("[data-caption-output]").forEach((output) => {
        const key = output.dataset.captionOutput as keyof CustomCaptionsSettings;
        const suffix = output.dataset.suffix ?? "";
        output.value = `${candidate[key]}${suffix}`;
      });
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
    dialog.querySelector('[data-action="cancel"]')?.addEventListener("click", close);
    saveButton.addEventListener("click", () => {
      const candidate = read();
      const error = validateCustomCaptions(candidate);
      if (error) { status.textContent = error; return; }
      saveButton.disabled = true;
      status.textContent = "Saving…";
      void runtime.bridge.request("plugins", "setCustomCaptions", candidate).then(() => {
        Object.assign(settings, candidate);
        window.dispatchEvent(new CustomEvent(CUSTOM_CAPTIONS_SETTINGS_CHANGED, { detail: { ...candidate } }));
        saved();
        close();
      }).catch((error) => {
        saveButton.disabled = false;
        status.textContent = error instanceof Error ? error.message : "Caption settings could not be saved.";
      });
    });
    write({ ...settings });
  });
}

function captionRange(label: string, key: keyof CustomCaptionsSettings, min: number, max: number, step: number, suffix: string) {
  return `<label class="caption-range"><span>${label}</span><div><input type="range" data-caption="${key}" min="${min}" max="${max}" step="${step}"><output data-caption-output="${key}" data-suffix="${suffix}"></output></div></label>`;
}

function captionColor(label: string, key: "textColor" | "outlineColor" | "backgroundColor" | "shadowColor") {
  return `<label class="caption-color"><span>${label} color</span><div><input type="color" data-caption="${key}" aria-label="${label} color picker"><input class="caption-text-input" data-caption-color="${key}" maxlength="7" spellcheck="false" aria-label="${label} color hexadecimal value"></div></label>`;
}

function hasPluginSettings(id: string): boolean {
  return isHotkeyPluginId(id)
    || id === "begone-mouse"
    || id === "quick-seek"
    || id === "easy-sound-output"
    || id === "qol-things"
    || id === "custom-captions"
    || id === "no-spoilers";
}

function isHotkeyPluginId(id: string): id is ConfigurablePluginId {
  return id === "reviews" || id === "timestamp-notes";
}

function formatIdleDelay(value: number): string {
  return value >= 1_000
    ? `${Number((value / 1_000).toFixed(3))} s`
    : `${Number(value.toFixed(3))} ms`;
}

function formatSeekSeconds(value: number): string {
  return `${Number(value.toFixed(3))}s`;
}

function pluginName(id: string): string {
  return id === "reviews" ? "Local Reviews" : id === "timestamp-notes" ? "Timestamp Notes" : id;
}

function asPlugins(value: unknown): Plugin[] {
  return Array.isArray(value)
    ? value.filter((item): item is Plugin => Boolean(item && typeof item === "object" && typeof (item as Plugin).id === "string"))
    : [];
}

function asBegoneMouseSettings(value: unknown): BegoneMouseSettings {
  const idleMs = value && typeof value === "object" ? Number((value as { idleMs?: unknown }).idleMs) : NaN;
  return {
    idleMs: Number.isFinite(idleMs) && idleMs >= 0 && idleMs <= MAX_BEGONE_MOUSE_IDLE_MS
      ? idleMs
      : DEFAULT_BEGONE_MOUSE_IDLE_MS,
  };
}

function asQuickSeekSettings(value: unknown): QuickSeekSettings {
  const source = value && typeof value === "object"
    ? value as { backwardSeconds?: unknown; forwardSeconds?: unknown }
    : {};
  const valid = (candidate: unknown) => {
    const seconds = Number(candidate);
    return Number.isFinite(seconds)
      && seconds >= MIN_QUICK_SEEK_SECONDS
      && seconds <= MAX_QUICK_SEEK_SECONDS
      ? seconds
      : DEFAULT_QUICK_SEEK_SECONDS;
  };
  return {
    backwardSeconds: valid(source.backwardSeconds),
    forwardSeconds: valid(source.forwardSeconds),
  };
}

function asReviewSettings(value: unknown): ReviewSettings {
  return {
    autoOpenAtEnd: !value || typeof value !== "object"
      ? true
      : (value as { autoOpenAtEnd?: unknown }).autoOpenAtEnd !== false,
  };
}

function asEasySoundOutputSettings(value: unknown): EasySoundOutputSettings {
  const preferred = value && typeof value === "object"
    ? (value as { preferredDevice?: unknown }).preferredDevice
    : null;
  if (!preferred || typeof preferred !== "object") return { preferredDevice: null };
  const source = preferred as { name?: unknown; description?: unknown };
  return typeof source.name === "string" && typeof source.description === "string"
    ? { preferredDevice: { name: source.name, description: source.description } }
    : { preferredDevice: null };
}

function asQolThingsSettings(value: unknown): QolThingsSettings {
  const source = value && typeof value === "object"
    ? value as { rememberVolume?: unknown; savedVolume?: unknown }
    : {};
  const volume = Number(source.savedVolume);
  return {
    rememberVolume: source.rememberVolume !== false,
    savedVolume: source.savedVolume !== null && Number.isFinite(volume) && volume >= 0 && volume <= 130
      ? volume
      : null,
  };
}

function asNoSpoilersSettings(value: unknown): NoSpoilersSettings {
  const source = value && typeof value === "object"
    ? value as Partial<Record<keyof NoSpoilersSettings, unknown>>
    : {};
  const mask = Number(source.titleMaskPercent);
  const minutes = Number(source.maxSkipMinutes);
  return {
    blurSummary: source.blurSummary !== false,
    blurArtwork: source.blurArtwork !== false,
    titleMaskPercent: Number.isFinite(mask) && mask >= 0 && mask <= 100 ? mask : 70,
    guardSeeks: source.guardSeeks !== false,
    maxSkipMinutes: Number.isFinite(minutes) && minutes >= 0.05 && minutes <= 1_440 ? minutes : 10,
  };
}
