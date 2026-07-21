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

const DEFAULT_BEGONE_MOUSE_IDLE_MS = 1_000;
const MAX_BEGONE_MOUSE_IDLE_MS = 600_000;
const BEGONE_MOUSE_SETTINGS_CHANGED = "jstremio-begone-mouse-settings-changed";
const DEFAULT_QUICK_SEEK_SECONDS = 5;
const MIN_QUICK_SEEK_SECONDS = 0.05;
const MAX_QUICK_SEEK_SECONDS = 3_600;
const QUICK_SEEK_SETTINGS_CHANGED = "jstremio-quick-seek-settings-changed";

const manifest = {
  schemaVersion: 1,
  id: "plugin-manager",
  name: "Plugins",
  version: "1.4.0",
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
          const [pluginValue, hotkeyValue, begoneMouseValue, quickSeekValue] = await Promise.all([
            runtime.bridge.request("plugins", "list"),
            runtime.bridge.request("plugins", "getHotkeys"),
            runtime.bridge.request("plugins", "getBegoneMouse"),
            runtime.bridge.request("plugins", "getQuickSeek"),
          ]);
          const plugins = asPlugins(pluginValue);
          renderPlugins(
            runtime,
            grid,
            plugins,
            asPluginHotkeys(hotkeyValue),
            asBegoneMouseSettings(begoneMouseValue),
            asQuickSeekSettings(quickSeekValue),
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
  begoneMouse: BegoneMouseSettings,
  quickSeek: QuickSeekSettings,
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
        summary.textContent = isHotkeyPluginId(plugin.id)
          ? `Hotkey: ${displayHotkey(hotkeys[plugin.id])}`
          : plugin.id === "begone-mouse"
            ? `Idle delay: ${formatIdleDelay(begoneMouse.idleMs)}`
            : `Back ${formatSeekSeconds(quickSeek.backwardSeconds)} · Forward ${formatSeekSeconds(quickSeek.forwardSeconds)}`;
      };
      renderSummary();
      settings.addEventListener("click", () => {
        if (isHotkeyPluginId(plugin.id)) {
          openHotkeySettings(runtime, plugin, hotkeys, renderSummary);
        } else if (plugin.id === "begone-mouse") {
          openBegoneMouseSettings(runtime, plugin, begoneMouse, renderSummary);
        } else {
          openQuickSeekSettings(runtime, plugin, quickSeek, renderSummary);
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
      <p class="hotkey-help">Select the field, then press a letter, number, function key, or a combination using Ctrl, Alt, and Shift.</p>
      <div class="settings-status" role="status" aria-live="polite"></div>
      <div class="settings-actions"><button type="button" class="button" data-action="clear">Clear hotkey</button><span></span><button type="button" class="button" data-action="cancel">Cancel</button><button type="button" class="button primary" data-action="save">Save</button></div>`;
    dialog.querySelector<HTMLHeadingElement>("h2")!.textContent = `${plugin.name} settings`;
    const input = dialog.querySelector<HTMLInputElement>(".hotkey-input")!;
    input.setAttribute("aria-label", `Hotkey for ${plugin.name}`);
    const status = dialog.querySelector<HTMLElement>(".settings-status")!;
    const save = dialog.querySelector<HTMLButtonElement>('[data-action="save"]')!;
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
      void runtime.bridge.request("plugins", "setHotkey", { id: pluginId, hotkey: candidate })
        .then(() => {
          if (candidate) hotkeys[pluginId] = candidate;
          else delete hotkeys[pluginId];
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

function hasPluginSettings(id: string): boolean {
  return isHotkeyPluginId(id) || id === "begone-mouse" || id === "quick-seek";
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
