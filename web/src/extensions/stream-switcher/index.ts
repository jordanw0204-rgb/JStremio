import styles from "./styles.css";
import {
  accessibleName,
  copyIntegrationClasses,
  findPlayerControls,
  isPlayerRoute,
  playerControlTemplate,
} from "../../runtime/compatibility";
import type { JStremioRuntime, MediaTarget, StreamOption } from "../../runtime/types";
import { requireRuntime } from "../shared";
import {
  currentStreamFromState,
  isCurrentStream,
  selectNextStream,
  streamLabel,
  type CurrentStream,
} from "./model";

const manifest = {
  schemaVersion: 1,
  id: "stream-switcher",
  name: "Stream Switcher",
  version: "1.0.0",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 135,
} as const;

const OWNER = "stream-switcher";
const ACTIVITY_EVENT = "jstremio-player-activity";

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  const style = document.createElement("style");
  style.dataset.jstremioExtension = OWNER;
  style.textContent = styles;
  document.head.append(style);
  let button: HTMLButtonElement | null = null;
  let menu: HTMLElement | null = null;
  let toast: HTMLElement | null = null;
  let toastTimer: number | null = null;
  let cacheKey: string | null = null;
  let cachedOptions: StreamOption[] = [];
  let cacheLoaded = false;
  let loadPromise: Promise<StreamOption[]> | null = null;
  let switching = false;
  let prefetchTimer: number | null = null;

  const clearToast = () => {
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = null;
    toast?.remove();
    toast = null;
  };

  const showToast = (message: string) => {
    clearToast();
    toast = document.createElement("div");
    toast.className = "stream-switcher-toast";
    toast.dataset.jstremioExtension = OWNER;
    toast.dataset.jstremioPlayerProtected = "";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.append(toast);
    const anchor = button?.getBoundingClientRect();
    const bounds = toast.getBoundingClientRect();
    toast.style.left = `${clamp((anchor?.left ?? 12) - bounds.width / 2, 12, innerWidth - bounds.width - 12)}px`;
    toast.style.top = `${Math.max(12, (anchor?.top ?? innerHeight - 70) - bounds.height - 10)}px`;
    toastTimer = window.setTimeout(clearToast, 3_500);
  };

  const closeMenu = () => {
    menu?.remove();
    menu = null;
  };

  const loadOptions = async (): Promise<{ target: MediaTarget; options: StreamOption[] }> => {
    const target = await runtime.stremio.getCurrentMediaTarget();
    if (!target) throw new Error("No active video was found.");
    if (cacheKey !== target.key) {
      cacheKey = target.key;
      cachedOptions = [];
      cacheLoaded = false;
      loadPromise = null;
    }
    if (!cacheLoaded) {
      loadPromise ??= runtime.stremio.getStreamOptions(target)
        .then((options) => {
          if (cacheKey === target.key) {
            cachedOptions = options;
            cacheLoaded = true;
          }
          return options;
        })
        .finally(() => { loadPromise = null; });
      await loadPromise;
    }
    return { target, options: cachedOptions };
  };

  const activeStream = async () => currentStreamFromState(
    await runtime.stremio.getPlayerState(),
    location.hash,
  );

  const resumeOnReplacement = async (
    route: string,
    target: MediaTarget,
    positionMs: number | null,
    paused: boolean | null,
  ) => {
    if (positionMs === null) return;
    const startedAt = Date.now();
    const retryAt = [800, 1_700, 3_200, 5_500, 8_000];
    for (const elapsed of retryAt) {
      await delay(Math.max(0, startedAt + elapsed - Date.now()));
      if (!routesEqual(location.hash, route)) return;
      const [currentTarget, current] = await Promise.all([
        runtime.stremio.getCurrentMediaTarget(),
        activeStream(),
      ]);
      const snapshot = runtime.player.getSnapshot();
      if (
        currentTarget?.key !== target.key ||
        !current ||
        !routesEqual(current.route, route) ||
        !snapshot ||
        snapshot.updatedAt < startedAt
      ) continue;
      try {
        await runtime.player.restorePosition(positionMs);
        if (paused === true) await runtime.player.setPaused(true);
        return;
      } catch {
        // A later retry handles streams that are still opening or buffering.
      }
    }
  };

  const switchTo = async (option: StreamOption, target: MediaTarget, current: CurrentStream | null) => {
    if (switching || isCurrentStream(option, current)) {
      closeMenu();
      return;
    }
    switching = true;
    if (button) button.dataset.switching = "";
    closeMenu();
    window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT));
    const snapshot = runtime.player.getSnapshot();
    try {
      location.hash = option.route.slice(1);
      await resumeOnReplacement(option.route, target, snapshot?.positionMs ?? null, snapshot?.paused ?? null);
    } finally {
      switching = false;
      if (button) delete button.dataset.switching;
    }
  };

  const renderMenu = (list: HTMLElement, target: MediaTarget, options: StreamOption[], current: CurrentStream | null) => {
    list.replaceChildren();
    if (!options.length) {
      list.innerHTML = '<div class="stream-switcher-status">No alternate streams are available for this video.</div>';
      return;
    }
    for (const option of options) {
      const label = streamLabel(option);
      const item = document.createElement("button");
      item.type = "button";
      item.className = "stream-switcher-option";
      item.dataset.jstremioStreamRoute = option.route;
      const currentOption = isCurrentStream(option, current);
      if (currentOption) item.dataset.current = "";
      const provider = document.createElement("span");
      provider.className = "stream-switcher-provider";
      provider.textContent = label.provider;
      item.append(provider);
      if (currentOption) {
        const badge = document.createElement("span");
        badge.className = "stream-switcher-current";
        badge.textContent = "Current";
        item.append(badge);
      }
      const title = document.createElement("span");
      title.className = "stream-switcher-title";
      title.textContent = label.title;
      const detail = document.createElement("span");
      detail.className = "stream-switcher-detail";
      detail.textContent = label.detail;
      item.append(title, detail);
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void switchTo(option, target, current).catch((error) => {
          runtime.diagnostics.report(OWNER, error);
          showToast("That stream could not be opened.");
        });
      });
      list.append(item);
    }
  };

  const openMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT));
    menu = document.createElement("section");
    menu.className = "stream-switcher-menu";
    menu.dataset.jstremioExtension = OWNER;
    menu.dataset.jstremioPlayerProtected = "";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Choose a stream");
    menu.innerHTML = '<header class="stream-switcher-menu-header"><strong>Switch stream</strong><span>Playback position is preserved</span></header><div class="stream-switcher-list"><div class="stream-switcher-status">Loading stream options…</div></div>';
    document.body.append(menu);
    positionMenu(menu, button);
    const list = menu.querySelector<HTMLElement>(".stream-switcher-list")!;
    void Promise.all([loadOptions(), activeStream()])
      .then(([loaded, current]) => {
        if (!menu?.contains(list)) return;
        renderMenu(list, loaded.target, loaded.options, current);
        positionMenu(menu, button);
      })
      .catch((error) => {
        runtime.diagnostics.report(OWNER, error);
        if (menu?.contains(list)) list.innerHTML = '<div class="stream-switcher-status">Stream options could not be loaded.</div>';
      });
  };

  const activateNext = async () => {
    if (switching) return;
    if (button) button.dataset.switching = "";
    try {
      const [{ target, options }, current] = await Promise.all([loadOptions(), activeStream()]);
      const next = selectNextStream(options, current);
      if (!next) {
        showToast("No alternate stream matches this video.");
        return;
      }
      await switchTo(next, target, current);
    } catch (error) {
      runtime.diagnostics.report(OWNER, error);
      showToast("Stream options could not be loaded.");
    } finally {
      if (!switching && button) delete button.dataset.switching;
    }
  };

  const createButton = (template: HTMLElement | null) => {
    const control = document.createElement("button");
    control.type = "button";
    copyIntegrationClasses(control, template);
    control.classList.remove("disabled");
    control.classList.add("stream-switcher-button");
    control.dataset.jstremioExtension = OWNER;
    control.dataset.jstremioControl = "stream-switcher";
    control.dataset.jstremioTestid = "stream-switcher";
    control.dataset.jstremioPlayerProtected = "";
    control.tabIndex = -1;
    control.title = "Switch to the next matching stream · Right-click to choose";
    control.setAttribute("aria-label", control.title);
    control.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 6.5h10.5a3.5 3.5 0 0 1 0 7H8"/><path d="m10.5 10.5-3.5 3 3.5 3"/><path d="M6.5 4v5M4 6.5h5"/></svg>';
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      void activateNext();
    });
    control.addEventListener("contextmenu", openMenu);
    control.addEventListener("pointerenter", () => {
      window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT));
      void loadOptions().catch(() => undefined);
    });
    return control;
  };

  const mountButton = () => {
    if (!isPlayerRoute()) {
      button?.remove();
      button = null;
      closeMenu();
      return;
    }
    const controls = findPlayerControls();
    if (!controls) return;
    const official = Array.from(controls.querySelectorAll<HTMLElement>('button,[role="button"],[tabindex]'))
      .filter((element) => !element.closest("[data-jstremio-extension]"));
    const next = official.find((element) => /\bnext\s+video\b/i.test(accessibleName(element)));
    const volume = official.find((element) => /\b(?:mute|unmute|volume)\b/i.test(accessibleName(element)));
    const play = official.find((element) => /\b(?:play|pause)\b/i.test(accessibleName(element))) ?? official[0];
    const anchor = next ?? volume;
    const host = anchor?.parentElement ?? play?.parentElement ?? controls;
    if (button?.isConnected && button.parentElement === host && button.nextElementSibling === anchor) return;
    button?.remove();
    button = createButton(anchor ?? play ?? playerControlTemplate(controls));
    if (anchor?.parentElement === host) host.insertBefore(button, anchor);
    else host.append(button);
  };

  const reconcile = () => {
    mountButton();
    if (isPlayerRoute() && !cacheLoaded && !loadPromise && prefetchTimer === null) {
      prefetchTimer = window.setTimeout(() => {
        prefetchTimer = null;
        void loadOptions().catch(() => undefined);
      }, 900);
    }
  };

  const onDocumentPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (menu && target && !menu.contains(target) && !button?.contains(target)) closeMenu();
  };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeMenu(); };
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  const unsubscribe = runtime.lifecycle.onReconcile(reconcile);

  return () => {
    unsubscribe();
    if (prefetchTimer !== null) window.clearTimeout(prefetchTimer);
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    button?.remove();
    closeMenu();
    clearToast();
    style.remove();
  };
}

function positionMenu(menu: HTMLElement, anchor: HTMLElement | null) {
  const anchorBounds = anchor?.getBoundingClientRect();
  const bounds = menu.getBoundingClientRect();
  const left = clamp((anchorBounds?.left ?? 12) - bounds.width * 0.25, 8, innerWidth - bounds.width - 8);
  const above = (anchorBounds?.top ?? innerHeight) - bounds.height - 10;
  const top = above >= 8 ? above : Math.min(innerHeight - bounds.height - 8, (anchorBounds?.bottom ?? 8) + 10);
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function routesEqual(left: string, right: string) {
  try { return decodeURIComponent(left) === decodeURIComponent(right); }
  catch { return left === right; }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
