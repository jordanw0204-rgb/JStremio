import styles from "./styles.css";
import {
  accessibleName,
  copyIntegrationClasses,
  findPlayerControls,
  isPlayerRoute,
  playerControlTemplate,
} from "../../runtime/compatibility";
import type { JStremioRuntime, PlaybackSnapshot } from "../../runtime/types";
import { removeOwned, requireRuntime } from "../shared";
import {
  HOLD_START_DELAY_MS,
  HOLD_TICK_MS,
  holdSeekStepMs,
  relativeSeekTarget,
} from "./seek";

const manifest = {
  schemaVersion: 1,
  id: "quick-seek",
  name: "Quick Seek",
  version: "1.2.2",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 130,
} as const;

const DEFAULT_SECONDS = 5;
const MIN_SECONDS = 0.05;
const MAX_SECONDS = 3_600;
const PLAYER_ACTIVITY_EVENT = "jstremio-player-activity";
const SETTINGS_CHANGED_EVENT = "jstremio-quick-seek-settings-changed";

type Direction = "back" | "forward";
type QuickSeekSettings = { backwardSeconds: number; forwardSeconds: number };
type HoldState = {
  button: HTMLButtonElement;
  direction: -1 | 1;
  pointerId: number;
  startedAt: number;
  targetMs: number;
  active: boolean;
};

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let snapshot: PlaybackSnapshot | null = runtime.player.getSnapshot();
  let settings: QuickSeekSettings = { backwardSeconds: DEFAULT_SECONDS, forwardSeconds: DEFAULT_SECONDS };
  let sideContainer: HTMLElement | null = null;
  let sideBack: HTMLButtonElement | null = null;
  let sideForward: HTMLButtonElement | null = null;
  let barBack: HTMLButtonElement | null = null;
  let barForward: HTMLButtonElement | null = null;
  let hold: HoldState | null = null;
  let holdStartTimer: number | null = null;
  let holdTickTimer: number | null = null;
  let suppressClick: HTMLButtonElement | null = null;
  const style = document.createElement("style");
  style.dataset.jstremioExtension = "quick-seek";
  style.textContent = styles;
  document.head.append(style);

  const buttons = () => [sideBack, sideForward, barBack, barForward]
    .filter((button): button is HTMLButtonElement => Boolean(button?.isConnected));

  const secondsFor = (direction: -1 | 1) => direction < 0
    ? settings.backwardSeconds
    : settings.forwardSeconds;

  const setDisplayedSeconds = (button: HTMLButtonElement, seconds: number) => {
    const amount = button.querySelector<SVGTextElement>("[data-quick-seek-amount]");
    if (amount) amount.textContent = formatSeconds(seconds);
  };

  const updateLabels = () => {
    for (const button of buttons()) {
      if (hold?.active && hold.button === button) continue;
      const direction = button.dataset.direction === "back" ? -1 : 1;
      const seconds = secondsFor(direction);
      setDisplayedSeconds(button, seconds);
      const action = direction < 0 ? "Rewind" : "Fast forward";
      button.title = `${action} ${formatSeconds(seconds)} seconds`;
      button.setAttribute("aria-label", button.title);
    }
  };

  const updateAvailability = () => {
    const position = snapshot?.positionMs;
    for (const button of buttons()) {
      const direction = button.dataset.direction === "back" ? -1 : 1;
      button.disabled = direction < 0
        ? position === null || position === undefined || position <= 0
        : position === null || position === undefined
          || (snapshot?.durationMs !== null && snapshot?.durationMs !== undefined && position >= snapshot.durationMs);
    }
  };

  const seekTarget = (target: number, button: HTMLButtonElement) => {
    button.dataset.activated = "";
    window.setTimeout(() => delete button.dataset.activated, 220);
    void runtime.player.seekTo(target).catch((error) => runtime.diagnostics.report("quick-seek", error));
  };

  const seek = (direction: -1 | 1, button: HTMLButtonElement) => {
    const target = relativeSeekTarget(snapshot, direction * secondsFor(direction) * 1_000);
    if (target !== null) seekTarget(target, button);
  };

  const clearHoldTimers = () => {
    if (holdStartTimer !== null) window.clearTimeout(holdStartTimer);
    if (holdTickTimer !== null) window.clearTimeout(holdTickTimer);
    holdStartTimer = null;
    holdTickTimer = null;
  };

  const stopHold = (pointerId?: number, suppressReleaseClick = false) => {
    if (!hold || (pointerId !== undefined && hold.pointerId !== pointerId)) return;
    const current = hold;
    hold = null;
    clearHoldTimers();
    delete current.button.dataset.holding;
    setDisplayedSeconds(current.button, secondsFor(current.direction));
    if (suppressReleaseClick && current.active) suppressClick = current.button;
    else if (!suppressReleaseClick) suppressClick = null;
    if (current.button.hasPointerCapture(current.pointerId)) current.button.releasePointerCapture(current.pointerId);
  };

  const runHoldTick = () => {
    const current = hold;
    if (!current?.active) return;
    const deltaMs = holdSeekStepMs(
      performance.now() - current.startedAt,
      current.direction,
      secondsFor(current.direction) * 1_000,
    );
    const optimisticSnapshot = snapshot ? { ...snapshot, positionMs: current.targetMs } : null;
    const target = relativeSeekTarget(optimisticSnapshot, deltaMs);
    if (target !== null && target !== current.targetMs) {
      current.targetMs = target;
      setDisplayedSeconds(current.button, Math.abs(deltaMs) / 1_000);
      window.dispatchEvent(new CustomEvent(PLAYER_ACTIVITY_EVENT));
      seekTarget(target, current.button);
    }
    holdTickTimer = window.setTimeout(runHoldTick, HOLD_TICK_MS);
  };

  const startHold = (event: PointerEvent, direction: -1 | 1, button: HTMLButtonElement) => {
    if (!event.isTrusted || !event.isPrimary || event.button !== 0 || button.disabled || snapshot?.positionMs === null || !snapshot) return;
    event.preventDefault();
    stopHold();
    suppressClick = null;
    button.setPointerCapture(event.pointerId);
    hold = {
      button,
      direction,
      pointerId: event.pointerId,
      startedAt: performance.now(),
      targetMs: snapshot.positionMs,
      active: false,
    };
    holdStartTimer = window.setTimeout(() => {
      if (!hold || hold.pointerId !== event.pointerId) return;
      hold.active = true;
      hold.button.dataset.holding = "";
      runHoldTick();
    }, HOLD_START_DELAY_MS);
  };

  const createButton = (direction: Direction, placement: "side" | "bar", template?: HTMLElement | null) => {
    const button = document.createElement("button");
    button.type = "button";
    if (placement === "bar") copyIntegrationClasses(button, template ?? null);
    button.classList.add("quick-seek-button", `quick-seek-${placement}-button`, `quick-seek-${direction}`);
    button.dataset.jstremioExtension = "quick-seek";
    button.dataset.jstremioControl = `quick-seek-${placement}-${direction}`;
    button.dataset.jstremioTestid = placement === "side" ? `quick-seek-${direction}` : `quick-seek-bar-${direction}`;
    button.dataset.jstremioClickOnly = "";
    button.dataset.direction = direction;
    button.tabIndex = -1;
    button.innerHTML = iconMarkup(direction);
    const deltaDirection = direction === "back" ? -1 : 1;
    button.addEventListener("pointerdown", (event) => startHold(event, deltaDirection, button));
    button.addEventListener("pointerup", (event) => stopHold(event.pointerId, true));
    button.addEventListener("pointercancel", (event) => stopHold(event.pointerId));
    button.addEventListener("lostpointercapture", (event) => stopHold(event.pointerId));
    button.addEventListener("focus", () => button.blur());
    button.addEventListener("keydown", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    });
    button.addEventListener("click", (event) => {
      if (suppressClick === button) {
        suppressClick = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.detail === 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      seek(deltaDirection, button);
    });
    return button;
  };

  const mountSideButtons = () => {
    if (sideContainer?.isConnected) return;
    sideContainer = document.createElement("div");
    sideContainer.className = "quick-seek-controls";
    sideContainer.dataset.jstremioExtension = "quick-seek";
    sideContainer.dataset.jstremioTestid = "quick-seek-controls";
    sideContainer.setAttribute("aria-label", "Quick Seek video controls");
    sideContainer.setAttribute("role", "group");
    sideBack = createButton("back", "side");
    sideForward = createButton("forward", "side");
    sideContainer.append(sideBack, sideForward);
    document.body.append(sideContainer);
  };

  const mountBarButtons = () => {
    const controls = findPlayerControls();
    if (!controls) return;
    const official = Array.from(controls.querySelectorAll<HTMLElement>('button,[role="button"],[tabindex]'))
      .filter((element) => !element.closest('[data-jstremio-extension]'));
    const play = official.find((element) => /\b(?:play|pause)\b/i.test(accessibleName(element))) ?? official[0];
    const host = play?.parentElement ?? controls;
    const correctlyMounted = Boolean(
      play
      && barBack?.isConnected
      && barForward?.isConnected
      && barBack.parentElement === host
      && barForward.parentElement === host
      && barBack.nextElementSibling === play
      && play.nextElementSibling === barForward,
    );
    if (correctlyMounted) return;
    barBack?.remove();
    barForward?.remove();
    const template = play ?? playerControlTemplate(controls);
    barBack = createButton("back", "bar", template);
    barForward = createButton("forward", "bar", template);
    if (play?.parentElement === host) {
      host.insertBefore(barBack, play);
      play.insertAdjacentElement("afterend", barForward);
    } else {
      host.prepend(barBack, barForward);
    }
  };

  const reconcile = () => {
    if (!isPlayerRoute()) {
      sideContainer?.remove();
      barBack?.remove();
      barForward?.remove();
      sideContainer = null;
      sideBack = null;
      sideForward = null;
      barBack = null;
      barForward = null;
      stopHold();
      return;
    }
    mountSideButtons();
    mountBarButtons();
    updateLabels();
    updateAvailability();
  };

  const onSettingsChanged = (event: Event) => {
    settings = asSettings((event as CustomEvent<unknown>).detail);
    stopHold();
    updateLabels();
  };
  window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
  const unsubscribeLifecycle = runtime.lifecycle.onReconcile(reconcile);
  const unsubscribePlayer = runtime.player.subscribe((value) => {
    snapshot = value;
    updateAvailability();
  });
  const cancelHold = () => stopHold();
  window.addEventListener("blur", cancelHold);
  document.addEventListener("visibilitychange", cancelHold);
  void runtime.bridge.request("plugins", "getQuickSeek")
    .then((value) => {
      settings = asSettings(value);
      updateLabels();
    })
    .catch((error) => runtime.diagnostics.report("quick-seek", error));

  return () => {
    stopHold();
    unsubscribeLifecycle();
    unsubscribePlayer();
    window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
    window.removeEventListener("blur", cancelHold);
    document.removeEventListener("visibilitychange", cancelHold);
    removeOwned("quick-seek");
  };
}

function iconMarkup(direction: Direction) {
  const path = direction === "back"
    ? "M94 14v42H18m0 0 17-14M18 56l17 14"
    : "M26 14v42h76m0 0L85 42m17 14L85 70";
  return `<svg class="quick-seek-icon" aria-hidden="true" viewBox="0 0 120 82"><path d="${path}"/><text data-quick-seek-amount x="60" y="46">5</text></svg>`;
}

function formatSeconds(value: number) {
  return String(Number(value.toFixed(3)));
}

function asSettings(value: unknown): QuickSeekSettings {
  const source = value && typeof value === "object"
    ? value as { backwardSeconds?: unknown; forwardSeconds?: unknown }
    : {};
  const valid = (candidate: unknown) => {
    const seconds = Number(candidate);
    return Number.isFinite(seconds) && seconds >= MIN_SECONDS && seconds <= MAX_SECONDS
      ? seconds
      : DEFAULT_SECONDS;
  };
  return {
    backwardSeconds: valid(source.backwardSeconds),
    forwardSeconds: valid(source.forwardSeconds),
  };
}
