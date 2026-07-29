import styles from "./styles.css";
import {
  findNextVideoPopup,
  findNextVideoTitle,
  findSeekContainer,
  isPlayerRoute,
} from "../../runtime/compatibility";
import type { JStremioRuntime } from "../../runtime/types";
import { addStyles, removeOwned, requireRuntime } from "../shared";
import {
  maskEpisodeLabel,
  maskNextVideoEpisodeLabel,
  maskPlayerEpisodeLabel,
  maskSpoilerText,
} from "./masking";

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
  version: "1.0.5",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 160,
} as const;
const SETTINGS_CHANGED = "jstremio-no-spoilers-settings-changed";

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let settings: Settings = defaults();
  let seekPointer: { id: number; targetMs: number } | null = null;
  let suppressClickUntil = 0;
  let promptOpen = false;
  let summaryPromptOpen = false;
  let summaryPromptRoute: string | null = null;
  let dismissSummaryPrompt: (() => void) | null = null;
  let revealedSummaryRoute: string | null = null;
  let revealedPlayerTitleRoute: string | null = null;
  let revealedNextVideoTitleRoute: string | null = null;
  let appliedRoute: string | null = null;
  let appliedSettings = "";
  let pendingSeekMs = 0;
  let observer: MutationObserver | null = null;
  const maskedText = new Map<HTMLElement, string>();
  const maskedPlayerText = new Map<HTMLElement, string>();
  const maskedNextVideoText = new Map<HTMLElement, string>();
  const maskedTitles = new Map<HTMLElement, string>();
  const wrappedSummaryText = new Map<HTMLElement, Text>();
  const blurred = new Set<HTMLElement>();
  const protectedSummaries = new Set<HTMLElement>();
  const protectedPlayerTitles = new Set<HTMLElement>();
  const protectedNextVideoTitles = new Set<HTMLElement>();
  const style = document.createElement("style");
  style.dataset.jstremioExtension = manifest.id;
  style.textContent = styles;
  document.head.append(style);

  const restore = () => {
    for (const [element, original] of maskedText) {
      if (element.isConnected) element.textContent = original;
    }
    maskedText.clear();
    for (const [element, original] of maskedPlayerText) {
      if (element.isConnected) element.textContent = original;
    }
    maskedPlayerText.clear();
    for (const [element, original] of maskedNextVideoText) {
      if (element.isConnected) element.textContent = original;
    }
    maskedNextVideoText.clear();
    for (const [element, original] of maskedTitles) {
      if (element.isConnected) element.setAttribute("title", original);
    }
    maskedTitles.clear();
    for (const [wrapper, text] of wrappedSummaryText) {
      if (wrapper.isConnected) wrapper.replaceWith(text);
    }
    wrappedSummaryText.clear();
    for (const element of blurred) element.classList.remove("no-spoilers-blur");
    blurred.clear();
    for (const element of protectedSummaries) element.classList.remove("no-spoilers-summary-protected");
    protectedSummaries.clear();
    for (const element of protectedPlayerTitles) element.classList.remove("no-spoilers-player-title-protected");
    protectedPlayerTitles.clear();
    for (const element of protectedNextVideoTitles) element.classList.remove("no-spoilers-next-video-title-protected");
    protectedNextVideoTitles.clear();
  };

  const blur = (element: HTMLElement | null) => {
    if (!element) return;
    element.classList.add("no-spoilers-blur");
    blurred.add(element);
  };

  const maskElement = (element: HTMLElement | null) => {
    if (!element) return;
    const original = element.textContent?.trim();
    if (!original || original.length < 2) return;
    const previous = maskedText.get(element);
    if (previous && original === maskEpisodeLabel(previous, settings.titleMaskPercent)) return;
    const masked = maskEpisodeLabel(original, settings.titleMaskPercent);
    if (!masked) return;
    maskedText.set(element, original);
    element.textContent = masked;
  };

  const maskPlayerTitle = (element: HTMLElement | null) => {
    if (!element) return;
    const original = element.textContent?.trim();
    if (!original || original.length < 2) return;
    const previous = maskedPlayerText.get(element);
    if (previous && original === maskPlayerEpisodeLabel(previous, settings.titleMaskPercent)) return;
    const masked = maskPlayerEpisodeLabel(original, settings.titleMaskPercent);
    if (!masked) return;
    maskedPlayerText.set(element, original);
    element.textContent = masked;
    element.classList.add("no-spoilers-player-title-protected");
    protectedPlayerTitles.add(element);
  };

  const maskNextVideoTitle = (element: HTMLElement | null) => {
    if (!element) return;
    const original = element.textContent?.trim();
    if (!original || original.length < 2) return;
    const previous = maskedNextVideoText.get(element);
    if (previous && original === maskNextVideoEpisodeLabel(previous, settings.titleMaskPercent)) return;
    const masked = maskNextVideoEpisodeLabel(original, settings.titleMaskPercent);
    if (!masked) return;
    maskedNextVideoText.set(element, original);
    element.textContent = masked;
    element.classList.add("no-spoilers-next-video-title-protected");
    protectedNextVideoTitles.add(element);
  };

  const blurSummaries = () => {
    const protect = (element: HTMLElement) => {
      element.classList.add("no-spoilers-summary-protected");
      protectedSummaries.add(element);
      blur(element);
    };
    for (const container of document.querySelectorAll<HTMLElement>('[class*="description-container"]')) {
      const children = Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
      const label = children.find((child) => /^\s*summary\s*$/i.test(child.textContent ?? ""));
      const playerSideDrawerSummary = isPlayerRoute() && Boolean(container.closest('[class*="side-drawer"]'));
      if (!label && !playerSideDrawerSummary) continue;
      const bodies = children.filter((child) => child !== label && Boolean(child.textContent?.trim()));
      bodies.forEach(protect);
      const textNodes = Array.from(container.childNodes)
        .filter((node): node is Text => node instanceof Text && Boolean(node.textContent?.trim()));
      for (const text of textNodes) {
        const wrapper = document.createElement("span");
        wrapper.dataset.jstremioExtension = manifest.id;
        wrapper.className = "no-spoilers-summary-text";
        container.insertBefore(wrapper, text);
        wrapper.append(text);
        wrappedSummaryText.set(wrapper, text);
        protect(wrapper);
      }
      if (!bodies.length && !textNodes.length) protect(container);
    }
  };

  const episodeListRoots = () => Array.from(document.querySelectorAll<HTMLElement>(
    '[class*="videos-list"], [class*="videos-container"], [class*="side-drawer"], [class*="videos-menu-container"]',
  ));

  const episodeRows = () => episodeListRoots().flatMap((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('[class*="video-container"]')),
  );

  const episodeListTitles = () => episodeRows().flatMap((row) => {
    const title = row.querySelector<HTMLElement>('[class*="title-container"]');
    return title ? [title] : [];
  });

  const blurEpisodeThumbnails = () => {
    episodeRows().forEach((row) => {
      const title = row.querySelector<HTMLElement>('[class*="title-container"]');
      if (!title || !maskEpisodeLabel(title.textContent?.trim() ?? "", settings.titleMaskPercent)) return;
      row.querySelectorAll<HTMLElement>('[class*="thumbnail-container"] img, img[class*="thumbnail"]').forEach(blur);
    });
  };

  const maskEpisodeTooltips = () => {
    episodeRows().filter((row) => row.hasAttribute("title")).forEach((row) => {
      const title = row.getAttribute("title")?.trim();
      const label = row.querySelector<HTMLElement>('[class*="title-container"]')?.textContent?.trim() ?? "";
      if (!title || !maskEpisodeLabel(label, settings.titleMaskPercent)) return;
      const previous = maskedTitles.get(row);
      if (previous && title === maskSpoilerText(previous, settings.titleMaskPercent)) return;
      maskedTitles.set(row, title);
      row.setAttribute("title", maskSpoilerText(title, settings.titleMaskPercent));
    });
  };

  const applyProtection = (forceReset = false) => {
    const route = location.hash;
    const settingsKey = `${settings.blurSummary}|${settings.blurArtwork}|${settings.titleMaskPercent}`;
    if (revealedSummaryRoute && revealedSummaryRoute !== route) revealedSummaryRoute = null;
    if (revealedPlayerTitleRoute && revealedPlayerTitleRoute !== route) revealedPlayerTitleRoute = null;
    if (revealedNextVideoTitleRoute && revealedNextVideoTitleRoute !== route) revealedNextVideoTitleRoute = null;
    if (summaryPromptOpen && summaryPromptRoute !== route) dismissSummaryPrompt?.();
    observer?.disconnect();
    if (forceReset || appliedRoute !== route || appliedSettings !== settingsKey) restore();
    appliedRoute = route;
    appliedSettings = settingsKey;
    if (!isProtectedRoute()) {
      observer?.observe(document.body, { childList: true, subtree: true, characterData: true });
      return;
    }
    if (settings.blurSummary && revealedSummaryRoute !== route) blurSummaries();
    if (settings.blurArtwork) {
      document.querySelectorAll<HTMLElement>(
        '[class*="background-image"],img[class*="poster"],[class*="poster-container"] img,[class*="episode-poster"] img',
      ).forEach(blur);
      blurEpisodeThumbnails();
    }
    document.querySelectorAll<HTMLElement>('[class*="episode-title"]').forEach(maskElement);
    episodeListTitles().forEach(maskElement);
    maskEpisodeTooltips();
    if (isPlayerRoute() && revealedPlayerTitleRoute !== route) {
      document.querySelectorAll<HTMLElement>('span[class*="player-title"]').forEach(maskPlayerTitle);
    }
    if (isPlayerRoute() && revealedNextVideoTitleRoute !== route) {
      maskNextVideoTitle(findNextVideoTitle(findNextVideoPopup()));
    }
    observer?.observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  const showReveal = (kind: "summary" | "episode" | "nextEpisode") => {
    if (summaryPromptOpen) return;
    summaryPromptOpen = true;
    summaryPromptRoute = location.hash;
    runtime.ui.openDialog((container, closeHost) => {
      addStyles(container, styles);
      const close = () => {
        if (!summaryPromptOpen) return;
        summaryPromptOpen = false;
        summaryPromptRoute = null;
        dismissSummaryPrompt = null;
        closeHost();
      };
      dismissSummaryPrompt = close;
      const dialog = document.createElement("section");
      dialog.className = "no-spoilers-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      const titleId = kind === "summary"
        ? "no-spoilers-summary-title"
        : kind === "episode"
          ? "no-spoilers-episode-title"
          : "no-spoilers-next-episode-title";
      const heading = kind === "summary" ? "Reveal summary?" : "Reveal episode name?";
      const copy = kind === "summary"
        ? "This summary may contain plot details. Are you sure you want to show it?"
        : "This episode name may contain plot details. Are you sure you want to show it?";
      const keepLabel = kind === "summary" ? "Keep hidden" : "Keep episode hidden";
      const revealLabel = kind === "summary" ? "Reveal summary" : "Reveal episode name";
      dialog.setAttribute("aria-labelledby", titleId);
      dialog.innerHTML = `<h2 id="${titleId}">${heading}</h2><p>${copy}</p><div class="no-spoilers-actions"><button type="button" class="no-spoilers-action" data-action="cancel">${keepLabel}</button><button type="button" class="no-spoilers-action primary" data-action="reveal">${revealLabel}</button></div>`;
      dialog.querySelector('[data-action="cancel"]')?.addEventListener("click", close);
      dialog.querySelector('[data-action="reveal"]')?.addEventListener("click", () => {
        const route = summaryPromptRoute;
        close();
        if (route === location.hash) {
          if (kind === "summary") revealedSummaryRoute = route;
          else if (kind === "episode") revealedPlayerTitleRoute = route;
          else revealedNextVideoTitleRoute = route;
          applyProtection(true);
        }
      });
      container.append(dialog);
      return () => {
        summaryPromptOpen = false;
        summaryPromptRoute = null;
        dismissSummaryPrompt = null;
      };
    });
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
    const summary = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".no-spoilers-summary-protected")
      : null;
    if (summary) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showReveal("summary");
      return;
    }
    const playerTitle = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".no-spoilers-player-title-protected")
      : null;
    if (playerTitle) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showReveal("episode");
      return;
    }
    const nextVideoTitle = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".no-spoilers-next-video-title-protected")
      : null;
    if (nextVideoTitle) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showReveal("nextEpisode");
      return;
    }
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

  const reconcile = () => applyProtection();
  const unsubscribe = runtime.lifecycle.onReconcile(reconcile);
  const onSettings = (event: Event) => {
    settings = asSettings((event as CustomEvent).detail);
    applyProtection(true);
  };
  window.addEventListener(SETTINGS_CHANGED, onSettings);
  observer = new MutationObserver(() => applyProtection());
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  void runtime.bridge.request("plugins", "getNoSpoilers").then((value) => {
    settings = asSettings(value);
    applyProtection(true);
  }).catch((error) => runtime.diagnostics.report(manifest.id, error));

  return () => {
    dismissSummaryPrompt?.();
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

function isProtectedRoute() {
  try {
    const route = decodeURIComponent(location.hash);
    return route.startsWith("#/detail/") || route.startsWith("#/player/");
  } catch {
    return false;
  }
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
