import styles from "./styles.css";
import { findSeekContainer, isPlayerRoute } from "../../runtime/compatibility";
import type { JStremioRuntime, MediaTarget } from "../../runtime/types";
import { addStyles, removeOwned, requireRuntime } from "../shared";

type Settings = {
  blurSummary: boolean;
  blurArtwork: boolean;
  titleMaskPercent: number;
  guardSeeks: boolean;
  maxSkipMinutes: number;
};

const manifest = {
  schemaVersion: 1,
  id: "no-spoilers",
  name: "No Spoilers",
  version: "1.0.0",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 160,
} as const;
const SETTINGS_CHANGED = "jstremio-no-spoilers-settings-changed";

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let settings: Settings = defaults();
  let target: MediaTarget | null = null;
  let generation = 0;
  let seekPointer: { id: number; targetMs: number } | null = null;
  let suppressClickUntil = 0;
  let promptOpen = false;
  let pendingSeekMs = 0;
  let observer: MutationObserver | null = null;
  const maskedText = new Map<HTMLElement, string>();
  const blurred = new Set<HTMLElement>();
  const maskedLogos = new Map<HTMLElement, HTMLElement>();
  const style = document.createElement("style");
  style.dataset.jstremioExtension = manifest.id;
  style.textContent = styles;
  document.head.append(style);

  const restore = () => {
    for (const [element, original] of maskedText) {
      if (element.isConnected) element.textContent = original;
    }
    maskedText.clear();
    for (const element of blurred) element.classList.remove("no-spoilers-blur");
    blurred.clear();
    for (const [logo, replacement] of maskedLogos) {
      logo.classList.remove("no-spoilers-logo-hidden");
      replacement.remove();
    }
    maskedLogos.clear();
  };

  const blur = (element: HTMLElement | null) => {
    if (!element) return;
    element.classList.add("no-spoilers-blur");
    blurred.add(element);
  };

  const maskElement = (element: HTMLElement | null) => {
    if (!element || maskedText.has(element)) return;
    const original = element.textContent?.trim();
    if (!original || original.length < 2) return;
    maskedText.set(element, original);
    element.textContent = maskTitle(original, settings.titleMaskPercent);
  };

  const applyProtection = () => {
    observer?.disconnect();
    restore();
    if (settings.blurSummary) {
      const summary = Array.from(document.querySelectorAll<HTMLElement>('[class*="description-container"]'))
        .find((element) => /^\s*summary\b/i.test(element.textContent ?? ""));
      blur(summary ?? null);
    }
    if (settings.blurArtwork) {
      document.querySelectorAll<HTMLElement>(
        '[class*="background-image"],img[class*="poster"],[class*="poster-container"] img,[class*="episode-poster"] img',
      ).forEach(blur);
    }
    document.querySelectorAll<HTMLElement>('[class*="episode-title"]').forEach(maskElement);
    const names = [target?.title, target?.name].filter((value): value is string => Boolean(value && value.length > 1));
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("div,span,h1,h2,h3"))) {
      if (element.closest('[data-jstremio-extension], [class*="subtitle"]')) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || (isPlayerRoute() && rect.top > 150)) continue;
      const text = element.textContent?.trim() ?? "";
      if (names.some((name) => text === name || text.endsWith(name))) maskElement(element);
    }
    document.querySelectorAll<HTMLElement>('img[class*="logo"][title]').forEach((logo) => {
      const title = logo.getAttribute("title")?.trim();
      if (!title || maskedLogos.has(logo)) return;
      const replacement = document.createElement("span");
      replacement.dataset.jstremioExtension = manifest.id;
      replacement.className = "no-spoilers-masked-logo";
      replacement.textContent = maskTitle(title, settings.titleMaskPercent);
      logo.classList.add("no-spoilers-logo-hidden");
      logo.insertAdjacentElement("afterend", replacement);
      maskedLogos.set(logo, replacement);
    });
    observer?.observe(document.body, { childList: true, subtree: true });
  };

  const refreshTarget = () => {
    const current = ++generation;
    void runtime.stremio.getCurrentMediaTarget().then((value) => {
      if (current !== generation) return;
      target = value;
      applyProtection();
    }).catch((error) => runtime.diagnostics.report(manifest.id, error));
  };

  const showBlockedSeek = (positionMs: number) => {
    pendingSeekMs = positionMs;
    if (promptOpen) return;
    promptOpen = true;
    runtime.ui.openDialog((container, closeHost) => {
      addStyles(container, styles);
      const close = () => {
        promptOpen = false;
        closeHost();
      };
      const dialog = document.createElement("section");
      dialog.className = "no-spoilers-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "no-spoilers-seek-title");
      dialog.innerHTML = `<h2 id="no-spoilers-seek-title">Large skip blocked</h2><p>No Spoilers allows forward skips of up to ${formatMinutes(settings.maxSkipMinutes)} at once. Choose Skip if you intended to jump to that point.</p><div class="no-spoilers-actions"><button type="button" class="no-spoilers-action" data-action="cancel">Cancel</button><button type="button" class="no-spoilers-action primary" data-action="skip">Skip</button></div>`;
      dialog.querySelector('[data-action="cancel"]')?.addEventListener("click", close);
      dialog.querySelector('[data-action="skip"]')?.addEventListener("click", () => {
        const destination = pendingSeekMs;
        close();
        void runtime.player.seekTo(destination, { bypassGuards: true })
          .catch((error) => runtime.diagnostics.report(manifest.id, error));
      });
      container.append(dialog);
      return () => { promptOpen = false; };
    });
  };

  const removeGuard = runtime.player.addSeekGuard((positionMs, snapshot) => {
    if (!settings.guardSeeks || !isPlayerRoute() || snapshot.positionMs === null) return true;
    if (positionMs - snapshot.positionMs <= settings.maxSkipMinutes * 60_000) return true;
    showBlockedSeek(positionMs);
    return false;
  });

  const targetFromPointer = (event: PointerEvent) => {
    const seek = findSeekContainer();
    const snapshot = runtime.player.getSnapshot();
    if (!seek || !snapshot?.durationMs) return null;
    const rect = seek.getBoundingClientRect();
    if (!rect.width) return null;
    return Math.max(0, Math.min(snapshot.durationMs, ((event.clientX - rect.left) / rect.width) * snapshot.durationMs));
  };
  const eventIsOnSeek = (event: Event) => {
    const seek = findSeekContainer();
    return Boolean(seek && event.composedPath().some((node) => node === seek || (node instanceof Node && seek.contains(node))));
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!settings.guardSeeks || !isPlayerRoute() || !event.isPrimary || event.button !== 0 || !eventIsOnSeek(event)) return;
    const position = targetFromPointer(event);
    if (position === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    seekPointer = { id: event.pointerId, targetMs: position };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (seekPointer?.id !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const position = targetFromPointer(event);
    if (position !== null) seekPointer.targetMs = position;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (seekPointer?.id !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const position = targetFromPointer(event) ?? seekPointer.targetMs;
    seekPointer = null;
    suppressClickUntil = performance.now() + 500;
    void runtime.player.seekTo(position).catch((error) => runtime.diagnostics.report(manifest.id, error));
  };
  const onClick = (event: MouseEvent) => {
    if (performance.now() <= suppressClickUntil && eventIsOnSeek(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  window.addEventListener("click", onClick, true);

  const reconcile = () => refreshTarget();
  const unsubscribe = runtime.lifecycle.onReconcile(reconcile);
  const onSettings = (event: Event) => {
    settings = asSettings((event as CustomEvent).detail);
    applyProtection();
  };
  window.addEventListener(SETTINGS_CHANGED, onSettings);
  observer = new MutationObserver(() => applyProtection());
  observer.observe(document.body, { childList: true, subtree: true });
  void runtime.bridge.request("plugins", "getNoSpoilers").then((value) => {
    settings = asSettings(value);
    refreshTarget();
  }).catch((error) => runtime.diagnostics.report(manifest.id, error));

  return () => {
    generation += 1;
    unsubscribe();
    removeGuard();
    observer?.disconnect();
    window.removeEventListener(SETTINGS_CHANGED, onSettings);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerUp, true);
    window.removeEventListener("click", onClick, true);
    restore();
    removeOwned(manifest.id);
  };
}

function maskTitle(value: string, percent: number) {
  const visible = Math.max(1, Math.ceil(Array.from(value).filter((character) => !/\s/.test(character)).length * (1 - percent / 100)));
  let remaining = visible;
  return Array.from(value).map((character) => {
    if (/\s/.test(character)) return character;
    if (remaining > 0) { remaining -= 1; return character; }
    return "*";
  }).join("");
}

function defaults(): Settings {
  return { blurSummary: true, blurArtwork: true, titleMaskPercent: 70, guardSeeks: true, maxSkipMinutes: 10 };
}

function asSettings(value: unknown): Settings {
  if (!value || typeof value !== "object") return defaults();
  const source = value as Partial<Record<keyof Settings, unknown>>;
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

function formatMinutes(value: number) {
  return value === 1 ? "1 minute" : `${Number(value.toFixed(2))} minutes`;
}
