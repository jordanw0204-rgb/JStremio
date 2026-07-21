import styles from "./styles.css";
import { accessibleName, findPlayerControls, isPlayerRoute } from "../../runtime/compatibility";
import type { JStremioRuntime } from "../../runtime/types";
import { removeOwned, requireRuntime } from "../shared";

type AudioDevice = { name: string; description: string };
type PreferredDevice = AudioDevice | null;

const manifest = {
  schemaVersion: 1,
  id: "easy-sound-output",
  name: "Easy Sound Output",
  version: "1.0.0",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 140,
} as const;

const SETTINGS_CHANGED = "jstremio-easy-sound-output-settings-changed";
const PLAYER_ACTIVITY = "jstremio-player-activity";

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let devices: AudioDevice[] = [];
  let activeDevice = "auto";
  let preferred: PreferredDevice = null;
  let soundButton: HTMLElement | null = null;
  let appliedRoute = "";
  const style = document.createElement("style");
  style.dataset.jstremioExtension = manifest.id;
  style.textContent = styles;
  document.head.append(style);

  const closeMenus = () => {
    document.querySelectorAll(`[data-jstremio-extension="${manifest.id}"][role="menu"]`).forEach((node) => node.remove());
  };

  const persistPreferred = async (device: PreferredDevice) => {
    const value = await runtime.bridge.request("plugins", "setEasySoundOutput", { preferredDevice: device });
    preferred = asPreferred(value);
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED, { detail: { preferredDevice: preferred } }));
  };

  const openDeviceSubmenu = (device: AudioDevice, anchor: HTMLElement) => {
    document.querySelectorAll<HTMLElement>(`.easy-sound-submenu`).forEach((node) => node.remove());
    const menu = document.createElement("div");
    menu.dataset.jstremioExtension = manifest.id;
    menu.className = "easy-sound-menu easy-sound-submenu";
    menu.setAttribute("role", "menu");
    const action = document.createElement("button");
    action.type = "button";
    action.className = "easy-sound-always";
    action.setAttribute("role", "menuitem");
    action.textContent = preferred?.name === device.name
      ? "Stop always using this device"
      : "Always use this Device to play sound";
    action.addEventListener("click", () => {
      void persistPreferred(preferred?.name === device.name ? null : device)
        .catch((error) => runtime.diagnostics.report(manifest.id, error));
      closeMenus();
    });
    menu.append(action);
    document.body.append(menu);
    placeMenu(menu, anchor.getBoundingClientRect(), true);
  };

  const openMenu = (anchor: HTMLElement, refresh = true) => {
    closeMenus();
    if (refresh) runtime.player.refreshProperty("audio-device-list");
    window.dispatchEvent(new Event(PLAYER_ACTIVITY));
    const menu = document.createElement("div");
    menu.dataset.jstremioExtension = manifest.id;
    menu.className = "easy-sound-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Audio output devices");
    const heading = document.createElement("div");
    heading.className = "easy-sound-heading";
    heading.textContent = "Audio output";
    menu.append(heading);
    if (!devices.length) {
      const empty = document.createElement("div");
      empty.className = "easy-sound-empty";
      empty.textContent = "Loading audio output devices…";
      menu.append(empty);
    }
    for (const device of devices) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "easy-sound-device";
      row.dataset.active = String(device.name === activeDevice);
      row.setAttribute("role", "menuitemradio");
      row.setAttribute("aria-checked", String(device.name === activeDevice));
      row.title = `${device.description}\nRight-click for preferred-device options`;
      const check = document.createElement("span");
      check.className = "easy-sound-check";
      check.textContent = device.name === activeDevice ? "✓" : "";
      const label = document.createElement("span");
      label.className = "easy-sound-label";
      label.textContent = device.description || device.name;
      row.append(check, label);
      row.addEventListener("click", () => {
        void runtime.player.setProperty("audio-device", device.name)
          .catch((error) => runtime.diagnostics.report(manifest.id, error));
        closeMenus();
      });
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openDeviceSubmenu(device, row);
      });
      menu.append(row);
    }
    document.body.append(menu);
    placeMenu(menu, anchor.getBoundingClientRect(), false);
  };

  const onSoundContextMenu = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (soundButton) openMenu(soundButton);
  };

  const reconcile = () => {
    if (!isPlayerRoute()) {
      soundButton?.removeEventListener("contextmenu", onSoundContextMenu);
      soundButton = null;
      appliedRoute = "";
      closeMenus();
      return;
    }
    const next = findSoundButton();
    if (next !== soundButton) {
      soundButton?.removeEventListener("contextmenu", onSoundContextMenu);
      soundButton = next;
      soundButton?.addEventListener("contextmenu", onSoundContextMenu);
      if (soundButton) soundButton.title = `${soundButton.title || accessibleName(soundButton)} · Right-click to choose audio output`;
    }
    if (preferred && devices.some((device) => device.name === preferred?.name) && appliedRoute !== location.hash) {
      appliedRoute = location.hash;
      void runtime.player.setProperty("audio-device", preferred.name)
        .catch((error) => runtime.diagnostics.report(manifest.id, error));
    }
  };

  const unsubscribeDevices = runtime.player.observeProperty("audio-device-list", (value) => {
    devices = asDevices(value);
    if (soundButton && document.querySelector(`.easy-sound-menu:not(.easy-sound-submenu)`)) openMenu(soundButton, false);
    reconcile();
  });
  const unsubscribeActive = runtime.player.observeProperty("audio-device", (value) => {
    if (typeof value === "string") activeDevice = value;
  });
  const unsubscribeLifecycle = runtime.lifecycle.onReconcile(reconcile);
  const onSettings = (event: Event) => {
    preferred = asPreferred((event as CustomEvent).detail);
    appliedRoute = "";
    reconcile();
  };
  window.addEventListener(SETTINGS_CHANGED, onSettings);
  const dismiss = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(`[data-jstremio-extension="${manifest.id}"][role="menu"]`)) return;
    closeMenus();
  };
  document.addEventListener("pointerdown", dismiss, true);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenus(); }, true);
  void runtime.bridge.request("plugins", "getEasySoundOutput").then((value) => {
    preferred = asPreferred(value);
    reconcile();
  }).catch((error) => runtime.diagnostics.report(manifest.id, error));

  return () => {
    unsubscribeDevices();
    unsubscribeActive();
    unsubscribeLifecycle();
    soundButton?.removeEventListener("contextmenu", onSoundContextMenu);
    window.removeEventListener(SETTINGS_CHANGED, onSettings);
    document.removeEventListener("pointerdown", dismiss, true);
    closeMenus();
    removeOwned(manifest.id);
  };
}

function findSoundButton(): HTMLElement | null {
  const controls = findPlayerControls();
  if (!controls) return null;
  return Array.from(controls.querySelectorAll<HTMLElement>('button,[role="button"],[tabindex]'))
    .find((candidate) => /\b(?:mute|unmute|volume|sound)\b/i.test(accessibleName(candidate))) ?? null;
}

function asDevices(value: unknown): AudioDevice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const source = entry as { name?: unknown; description?: unknown };
    return typeof source.name === "string" && source.name
      ? [{ name: source.name, description: typeof source.description === "string" ? source.description : source.name }]
      : [];
  });
}

function asPreferred(value: unknown): PreferredDevice {
  const source = value && typeof value === "object" && "preferredDevice" in value
    ? (value as { preferredDevice?: unknown }).preferredDevice
    : value;
  if (!source || typeof source !== "object") return null;
  const device = source as { name?: unknown; description?: unknown };
  return typeof device.name === "string" && typeof device.description === "string"
    ? { name: device.name, description: device.description }
    : null;
}

function placeMenu(menu: HTMLElement, anchor: DOMRect, beside: boolean) {
  const bounds = menu.getBoundingClientRect();
  let left = beside ? anchor.right + 8 : anchor.left;
  let top = beside ? anchor.top : anchor.top - bounds.height - 10;
  if (left + bounds.width > innerWidth - 12) left = Math.max(12, anchor.right - bounds.width);
  if (top < 12) top = Math.min(innerHeight - bounds.height - 12, anchor.bottom + 8);
  menu.style.left = `${Math.max(12, left)}px`;
  menu.style.top = `${Math.max(12, top)}px`;
}
