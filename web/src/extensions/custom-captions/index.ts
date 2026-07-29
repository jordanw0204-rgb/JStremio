import type { JStremioRuntime } from "../../runtime/types";
import { findSubtitleButton } from "../../runtime/compatibility";
import { requireRuntime } from "../shared";
import { mountCaptionEditor } from "./editor";
import { captionMpvProperties, normalizeCustomCaptions, type CustomCaptionsSettings } from "./model";

const manifest = {
  schemaVersion: 1,
  id: "custom-captions",
  name: "Custom Captions",
  version: "1.1.0",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 145,
} as const;

const SETTINGS_CHANGED = "jstremio-custom-captions-settings-changed";

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let settings: CustomCaptionsSettings | null = null;
  let applyGeneration = 0;
  let boundButton: HTMLElement | null = null;
  let reapplyTimer = 0;
  const propertyUnsubscribers: Array<() => void> = [];

  const apply = (candidate: CustomCaptionsSettings) => {
    settings = candidate;
    const generation = ++applyGeneration;
    void applyProperties(runtime, candidate, () => generation === applyGeneration)
      .catch((error) => runtime.diagnostics.report(manifest.id, error));
  };
  const scheduleReapply = () => {
    window.clearTimeout(reapplyTimer);
    reapplyTimer = window.setTimeout(() => { if (settings) apply(settings); }, 40);
  };
  for (const [name] of captionMpvProperties(normalizeCustomCaptions(null))) {
    propertyUnsubscribers.push(runtime.player.observeProperty(name, (value) => {
      if (!settings) return;
      const expected = captionMpvProperties(settings).find(([property]) => property === name)?.[1];
      if (expected !== undefined && !propertyValuesEqual(value, expected)) {
        void runtime.player.setProperty(name, expected)
          .catch((error) => runtime.diagnostics.report(manifest.id, error));
      }
    }));
  }
  propertyUnsubscribers.push(runtime.player.observeProperty("path", scheduleReapply));
  propertyUnsubscribers.push(runtime.player.observeProperty("sid", scheduleReapply));

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!settings || !boundButton) return;
    const anchor = boundButton;
    runtime.ui.openDialog((container, close) => mountCaptionEditor(container, {
      runtime,
      settings: settings!,
      anchor,
      liveApply: apply,
      close,
    }));
  };
  const reconcile = () => {
    const candidate = findSubtitleButton();
    if (candidate === boundButton) return;
    boundButton?.removeEventListener("contextmenu", onContextMenu);
    if (boundButton) delete boundButton.dataset.jstremioCustomCaptionsAnchor;
    boundButton = candidate;
    if (!boundButton) return;
    boundButton.dataset.jstremioCustomCaptionsAnchor = "true";
    boundButton.addEventListener("contextmenu", onContextMenu);
  };
  const onSettings = (event: Event) => apply(normalizeCustomCaptions((event as CustomEvent).detail));
  const onRoute = () => { if (settings) apply(settings); reconcile(); };
  window.addEventListener(SETTINGS_CHANGED, onSettings);
  const unsubscribeRoute = runtime.lifecycle.onRouteChange(onRoute);
  const unsubscribeReconcile = runtime.lifecycle.onReconcile(reconcile);
  reconcile();
  void runtime.bridge.request("plugins", "getCustomCaptions")
    .then((value) => apply(normalizeCustomCaptions(value)))
    .catch((error) => runtime.diagnostics.report(manifest.id, error));

  return () => {
    applyGeneration += 1;
    window.clearTimeout(reapplyTimer);
    boundButton?.removeEventListener("contextmenu", onContextMenu);
    if (boundButton) delete boundButton.dataset.jstremioCustomCaptionsAnchor;
    propertyUnsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribeReconcile();
    unsubscribeRoute();
    window.removeEventListener(SETTINGS_CHANGED, onSettings);
  };
}

function propertyValuesEqual(actual: unknown, expected: string | number | boolean): boolean {
  if (typeof expected === "number") {
    return typeof actual === "number" && Math.abs(actual - expected) < 0.001;
  }
  if (typeof expected === "string") {
    return typeof actual === "string" && actual.toLowerCase() === expected.toLowerCase();
  }
  return actual === expected;
}

async function applyProperties(runtime: JStremioRuntime, settings: CustomCaptionsSettings, active: () => boolean) {
  for (const [name, value] of captionMpvProperties(settings)) {
    if (!active()) return;
    await runtime.player.setProperty(name, value);
  }
}
