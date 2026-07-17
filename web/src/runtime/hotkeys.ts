import type { JStremioRuntime } from "./types";

export type ConfigurablePluginId = "reviews" | "timestamp-notes";
export type PluginHotkeys = Partial<Record<ConfigurablePluginId, string>>;

export const HOTKEY_SETTINGS_CHANGED_EVENT = "jstremio-plugin-hotkeys-changed";

const CONFIGURABLE_PLUGIN_IDS: ConfigurablePluginId[] = ["reviews", "timestamp-notes"];
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);
const RESERVED_CODES = new Set([
  "Escape",
  "Tab",
  "Enter",
  "Space",
  "Backspace",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);
const NAMED_CODES = new Set([
  "Comma",
  "Period",
  "Slash",
  "Semicolon",
  "Quote",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Backquote",
  "Minus",
  "Equal",
  "IntlBackslash",
  "Insert",
]);

export type HotkeyCapture =
  | { kind: "hotkey"; value: string }
  | { kind: "modifier" }
  | { kind: "rejected"; message: string };

export function captureHotkey(event: KeyboardEvent): HotkeyCapture {
  const code = normalizedEventCode(event);
  if (event.metaKey || code.startsWith("Meta")) {
    return {
      kind: "rejected",
      message: "Windows-key shortcuts cannot be captured reliably. Use Ctrl, Alt, or Shift instead.",
    };
  }
  if (MODIFIER_CODES.has(code)) return { kind: "modifier" };
  if (RESERVED_CODES.has(code)) {
    return {
      kind: "rejected",
      message: `${displayCode(code)} is reserved for playback or navigation. Choose another key.`,
    };
  }
  if (!validKeyCode(code)) {
    return { kind: "rejected", message: "That key cannot be used as a JStremio hotkey." };
  }
  if (event.altKey && code === "F4") {
    return { kind: "rejected", message: "Alt + F4 is reserved by Windows." };
  }
  if (event.altKey && !event.ctrlKey && !event.shiftKey) {
    return {
      kind: "rejected",
      message: "Alt-only shortcuts are handled inconsistently by Windows. Add Ctrl or Shift.",
    };
  }
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(code);
  return { kind: "hotkey", value: parts.join("+") };
}

export function isValidHotkey(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64 || !/^[\x20-\x7E]+$/.test(value)) {
    return false;
  }
  const parts = value.split("+");
  const code = parts.pop();
  if (
    !code
    || !validKeyCode(code)
    || (code === "F4" && parts.includes("Alt"))
    || (parts.length === 1 && parts[0] === "Alt")
  ) return false;
  let previousModifier = -1;
  for (const modifier of parts) {
    const index = ["Ctrl", "Alt", "Shift"].indexOf(modifier);
    if (index < 0 || index <= previousModifier) return false;
    previousModifier = index;
  }
  return true;
}

export function asPluginHotkeys(value: unknown): PluginHotkeys {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const hotkeys: PluginHotkeys = {};
  for (const id of CONFIGURABLE_PLUGIN_IDS) {
    if (isValidHotkey(record[id])) hotkeys[id] = record[id];
  }
  return hotkeys;
}

export function displayHotkey(value: string | null | undefined): string {
  if (!value || !isValidHotkey(value)) return "Not set";
  const parts = value.split("+");
  const code = parts.pop()!;
  return [...parts, displayCode(code)].join(" + ");
}

export function notifyHotkeysChanged() {
  window.dispatchEvent(new Event(HOTKEY_SETTINGS_CHANGED_EVENT));
}

export function registerPluginHotkey(
  runtime: JStremioRuntime,
  pluginId: ConfigurablePluginId,
  trigger: () => void | Promise<void>,
  available: () => boolean,
): () => void {
  let disposed = false;
  let generation = 0;
  let hotkey: string | null = null;
  const reload = async () => {
    const currentGeneration = ++generation;
    try {
      const hotkeys = asPluginHotkeys(await runtime.bridge.request("plugins", "getHotkeys"));
      if (!disposed && currentGeneration === generation) hotkey = hotkeys[pluginId] ?? null;
    } catch (error) {
      if (!disposed) runtime.diagnostics.report(pluginId, error);
    }
  };
  const onSettingsChanged = () => void reload();
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      !hotkey
      || event.defaultPrevented
      || event.repeat
      || event.isComposing
      || hasOpenJStremioSurface()
      || isEditableEvent(event)
      || !available()
    ) {
      return;
    }
    const captured = captureHotkey(event);
    if (captured.kind !== "hotkey" || captured.value !== hotkey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void Promise.resolve(trigger()).catch((error) => runtime.diagnostics.report(pluginId, error));
  };
  window.addEventListener(HOTKEY_SETTINGS_CHANGED_EVENT, onSettingsChanged);
  window.addEventListener("keydown", onKeyDown, true);
  void reload();
  return () => {
    disposed = true;
    generation += 1;
    window.removeEventListener(HOTKEY_SETTINGS_CHANGED_EVENT, onSettingsChanged);
    window.removeEventListener("keydown", onKeyDown, true);
  };
}

function normalizedEventCode(event: KeyboardEvent): string {
  if (event.code) return event.code;
  if (/^[a-z]$/i.test(event.key)) return `Key${event.key.toUpperCase()}`;
  if (/^[0-9]$/.test(event.key)) return `Digit${event.key}`;
  return event.key;
}

function validKeyCode(code: string): boolean {
  if (/^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code)) return true;
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return true;
  if (/^Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal)$/.test(code)) return true;
  return NAMED_CODES.has(code);
}

function displayCode(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Numpad ${code.slice(6)}`;
  const labels: Record<string, string> = {
    Space: "Space",
    ArrowUp: "Up Arrow",
    ArrowDown: "Down Arrow",
    ArrowLeft: "Left Arrow",
    ArrowRight: "Right Arrow",
    PageUp: "Page Up",
    PageDown: "Page Down",
    NumpadAdd: "Numpad +",
    NumpadSubtract: "Numpad -",
    NumpadMultiply: "Numpad *",
    NumpadDivide: "Numpad /",
    NumpadDecimal: "Numpad .",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    IntlBackslash: "International \\",
  };
  return labels[code] ?? code;
}

function hasOpenJStremioSurface(): boolean {
  const host = document.querySelector<HTMLElement>('[data-jstremio-testid="overlay-host"]');
  return Boolean(host?.shadowRoot?.querySelector(".surface"));
}

function isEditableEvent(event: KeyboardEvent): boolean {
  return event.composedPath().some((target) => {
    if (!(target instanceof HTMLElement)) return false;
    return target.matches("input, textarea, select") || target.isContentEditable;
  });
}
