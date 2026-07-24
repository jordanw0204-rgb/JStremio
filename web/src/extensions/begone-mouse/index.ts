import styles from "./styles.css";
import { findPlayerControls, isPlayerRoute, PLAYER_OVERLAY_HIDDEN_SELECTOR } from "../../runtime/compatibility";
import type { JStremioRuntime } from "../../runtime/types";
import { removeOwned, requireRuntime } from "../shared";
import { DEFAULT_IDLE_MS, isBottomProtected, normalizeIdleDelay, overlayHiddenTokens } from "./idle";

const manifest = {
  schemaVersion: 1,
  id: "begone-mouse",
  name: "BegoneMouse",
  version: "1.1.0",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 120,
} as const;

const SETTINGS_CHANGED = "jstremio-begone-mouse-settings-changed";
const PLAYER_ACTIVITY_EVENT = "jstremio-player-activity";

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let idleMs = DEFAULT_IDLE_MS;
  let hideAt = 0;
  let timer: number | null = null;
  let overlayRoot: HTMLElement | null = null;
  let applying = false;
  let pointerX: number | null = null;
  let pointerY: number | null = null;
  const hiddenTokens = new Set<string>();
  const style = document.createElement("style");
  style.dataset.jstremioExtension = "begone-mouse";
  style.textContent = styles;
  document.head.append(style);
  discoverHiddenTokens(hiddenTokens);

  const clearTimer = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const findOverlayRoot = () => {
    const naturallyHidden = document.querySelector<HTMLElement>(PLAYER_OVERLAY_HIDDEN_SELECTOR);
    if (naturallyHidden) return naturallyHidden;
    const controls = findPlayerControls();
    return controls?.closest<HTMLElement>("main")
      ?? controls?.parentElement?.parentElement
      ?? document.querySelector<HTMLElement>("main");
  };

  const captureHiddenState = () => {
    document.querySelectorAll<HTMLElement>(PLAYER_OVERLAY_HIDDEN_SELECTOR).forEach((element) => {
      overlayHiddenTokens(element).forEach((token) => hiddenTokens.add(token));
      if (!overlayRoot || !overlayRoot.isConnected) overlayRoot = element;
    });
  };

  const setFallbackHidden = (hidden: boolean) => {
    if (hidden) document.documentElement.dataset.jstremioBegoneMouseHidden = "";
    else delete document.documentElement.dataset.jstremioBegoneMouseHidden;
  };

  const showInterface = () => {
    applying = true;
    setFallbackHidden(false);
    captureHiddenState();
    document.querySelectorAll<HTMLElement>(PLAYER_OVERLAY_HIDDEN_SELECTOR).forEach((element) => {
      overlayHiddenTokens(element).forEach((token) => element.classList.remove(token));
    });
    applying = false;
  };

  const pointerIsProtected = () => {
    if (isBottomProtected(pointerY, window.innerHeight)) return true;
    if (pointerX === null || pointerY === null) return false;
    const target = document.elementFromPoint(pointerX, pointerY);
    return Boolean(target?.closest("[data-jstremio-player-protected]"));
  };

  const hideInterface = () => {
    timer = null;
    if (!isPlayerRoute()) return;
    if (pointerIsProtected()) {
      showInterface();
      timer = window.setTimeout(hideInterface, 100);
      return;
    }
    overlayRoot = overlayRoot?.isConnected ? overlayRoot : findOverlayRoot();
    applying = true;
    setFallbackHidden(true);
    const token = hiddenTokens.values().next().value as string | undefined;
    if (overlayRoot && token) overlayRoot.classList.add(token);
    applying = false;
  };

  const scheduleHide = () => {
    clearTimer();
    if (!isPlayerRoute()) return;
    const remaining = Math.max(0, hideAt - performance.now());
    timer = window.setTimeout(hideInterface, remaining);
  };

  const recordActivity = (event?: Event) => {
    if (!isPlayerRoute()) return;
    if (event instanceof PointerEvent) {
      pointerX = event.clientX;
      pointerY = event.clientY;
    }
    overlayRoot = overlayRoot?.isConnected ? overlayRoot : findOverlayRoot();
    hideAt = performance.now() + idleMs;
    showInterface();
    scheduleHide();
  };

  const enforceDeadline = () => {
    if (applying || !isPlayerRoute()) return;
    captureHiddenState();
    if (!document.querySelector(PLAYER_OVERLAY_HIDDEN_SELECTOR)) return;
    if (performance.now() < hideAt || pointerIsProtected()) {
      showInterface();
      scheduleHide();
    } else {
      setFallbackHidden(true);
    }
  };

  const observer = new MutationObserver(enforceDeadline);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true,
  });

  const onSettingsChanged = (event: Event) => {
    const detail = (event as CustomEvent<{ idleMs?: unknown }>).detail;
    idleMs = normalizeIdleDelay(detail?.idleMs);
    recordActivity();
  };
  window.addEventListener(SETTINGS_CHANGED, onSettingsChanged);
  window.addEventListener(PLAYER_ACTIVITY_EVENT, recordActivity);
  for (const eventName of ["pointermove", "pointerdown", "wheel", "touchstart"] as const) {
    document.addEventListener(eventName, recordActivity, { capture: true, passive: true });
  }
  const onPointerOut = (event: PointerEvent) => {
    if (event.relatedTarget) return;
    pointerX = null;
    pointerY = null;
    scheduleHide();
  };
  window.addEventListener("pointerout", onPointerOut);

  const reconcile = () => {
    if (isPlayerRoute()) {
      overlayRoot = overlayRoot?.isConnected ? overlayRoot : findOverlayRoot();
      if (!hideAt) recordActivity();
      else enforceDeadline();
    } else {
      clearTimer();
      hideAt = 0;
      overlayRoot = null;
      pointerX = null;
      pointerY = null;
      setFallbackHidden(false);
    }
  };
  const unsubscribe = runtime.lifecycle.onReconcile(reconcile);
  void runtime.bridge.request("plugins", "getBegoneMouse")
    .then((value) => {
      idleMs = normalizeIdleDelay(
        value && typeof value === "object" ? (value as { idleMs?: unknown }).idleMs : undefined,
      );
      recordActivity();
    })
    .catch((error) => runtime.diagnostics.report("begone-mouse", error));

  return () => {
    unsubscribe();
    observer.disconnect();
    clearTimer();
    window.removeEventListener(SETTINGS_CHANGED, onSettingsChanged);
    window.removeEventListener(PLAYER_ACTIVITY_EVENT, recordActivity);
    window.removeEventListener("pointerout", onPointerOut);
    for (const eventName of ["pointermove", "pointerdown", "wheel", "touchstart"] as const) {
      document.removeEventListener(eventName, recordActivity, true);
    }
    showInterface();
    removeOwned("begone-mouse");
  };
}

function discoverHiddenTokens(target: Set<string>) {
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      for (const match of rule.cssText.matchAll(/\.([A-Za-z0-9_-]*overlayHidden[A-Za-z0-9_-]*)/g)) {
        if (match[1]) target.add(match[1]);
      }
      const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
      if (nested) visit(nested);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (sheet.cssRules) visit(sheet.cssRules);
    } catch {
      // Cross-origin stylesheets are learned from the DOM when Stremio first hides its overlay.
    }
  }
}
