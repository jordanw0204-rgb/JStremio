import type { JStremioRuntime } from "../../runtime/types";
import { requireRuntime } from "../shared";

type Settings = { rememberVolume: boolean; savedVolume: number | null };

const manifest = {
  schemaVersion: 1,
  id: "qol-things",
  name: "QOL Things",
  version: "1.0.0",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 150,
} as const;

const SETTINGS_CHANGED = "jstremio-qol-things-settings-changed";

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let settings: Settings = { rememberVolume: true, savedVolume: null };
  let loaded = false;
  let appliedSavedVolume = false;
  let saveTimer: number | null = null;
  let lastVolume: number | null = null;

  const persist = (volume: number) => {
    if (!loaded || !settings.rememberVolume) return;
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      if (settings.savedVolume !== null && Math.abs(settings.savedVolume - volume) < 0.01) return;
      void runtime.bridge.request("plugins", "setQolThings", {
        rememberVolume: true,
        savedVolume: volume,
      }).then(() => {
        settings.savedVolume = volume;
      }).catch((error) => runtime.diagnostics.report(manifest.id, error));
    }, 350);
  };

  const applySavedVolume = () => {
    if (!loaded || appliedSavedVolume || !settings.rememberVolume || settings.savedVolume === null) return;
    appliedSavedVolume = true;
    void runtime.player.setProperty("volume", settings.savedVolume)
      .catch((error) => runtime.diagnostics.report(manifest.id, error));
  };

  const unsubscribeVolume = runtime.player.observeProperty("volume", (value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 130) return;
    lastVolume = value;
    if (!appliedSavedVolume && settings.savedVolume !== null) {
      applySavedVolume();
      return;
    }
    persist(value);
  });
  const onSettings = (event: Event) => {
    settings = asSettings((event as CustomEvent).detail);
    appliedSavedVolume = false;
    if (settings.rememberVolume && settings.savedVolume === null && lastVolume !== null) persist(lastVolume);
    else applySavedVolume();
  };
  window.addEventListener(SETTINGS_CHANGED, onSettings);
  void runtime.bridge.request("plugins", "getQolThings").then((value) => {
    settings = asSettings(value);
    loaded = true;
    if (settings.savedVolume === null && lastVolume !== null) persist(lastVolume);
    else applySavedVolume();
  }).catch((error) => runtime.diagnostics.report(manifest.id, error));

  return () => {
    unsubscribeVolume();
    window.removeEventListener(SETTINGS_CHANGED, onSettings);
    if (saveTimer !== null) window.clearTimeout(saveTimer);
  };
}

function asSettings(value: unknown): Settings {
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
