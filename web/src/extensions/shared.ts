import {
  copyIntegrationClasses,
  copyNavigationPresentation,
  findPlayerControls,
  findPrimaryNavigation,
  navigationTemplate,
  PLAYER_OVERLAY_HIDDEN_SELECTOR,
  playerControlTemplate,
} from "../runtime/compatibility";
import { canonicalDetailHash } from "../runtime/stremioAdapter";
import type { JStremioRuntime, MediaTarget } from "../runtime/types";

export function requireRuntime(): JStremioRuntime {
  if (!window.JStremio) throw new Error("JStremio runtime is unavailable");
  return window.JStremio;
}

export function targetPayload(target: MediaTarget) {
  return {
    videoId: target.videoId,
    metaId: target.metaId,
    mediaType: target.mediaType,
    name: target.name,
    title: target.title,
    season: target.season,
    episode: target.episode,
    poster: target.poster,
  };
}

export function viewInStremio(runtime: JStremioRuntime, target: MediaTarget) {
  runtime.ui.closePage();
  runtime.ui.closeOverlay();
  location.hash = canonicalDetailHash(target);
}

export function mountNavigationButton(
  extensionId: string,
  label: string,
  icon: string,
  onClick: () => void,
): HTMLButtonElement | null {
  const selector = `[data-jstremio-extension="${extensionId}"][data-jstremio-control="navigation"]`;
  const navigation = findPrimaryNavigation();
  const existing = Array.from(document.querySelectorAll<HTMLButtonElement>(selector));
  const current = navigation ? existing.find((button) => button.parentElement === navigation) : undefined;
  existing.filter((button) => button !== current).forEach((button) => button.remove());
  if (current) {
    syncNavigationActiveState(current, extensionId);
    return current;
  }
  if (!navigation) return null;
  const template = navigationTemplate(navigation);
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.jstremioExtension = extensionId;
  button.dataset.jstremioControl = "navigation";
  button.dataset.jstremioTestid = `${extensionId}-navigation`;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.style.cssText = "border:0;padding:0;font:inherit;appearance:none;cursor:pointer;";
  button.innerHTML = `${icon}<div data-jstremio-navigation-label>${escapeHtml(label)}</div>`;
  button.querySelector("svg")?.setAttribute("data-jstremio-navigation-icon", "");
  copyNavigationPresentation(button, template);
  if (!template) {
    button.style.cssText += "display:flex;flex-direction:column;align-items:center;justify-content:center;width:3.5rem;height:3.5rem;border-radius:.75rem;background:transparent;color:#b8b6c5;";
    button.querySelector<SVGElement>("svg")?.style.setProperty("width", "2.2rem");
    button.querySelector<SVGElement>("svg")?.style.setProperty("height", "2.2rem");
    button.querySelector<HTMLElement>("[data-jstremio-navigation-label]")!.hidden = true;
  }
  button.addEventListener("click", onClick);
  syncNavigationActiveState(button, extensionId);
  navigation.append(button);
  return button;
}

function syncNavigationActiveState(button: HTMLButtonElement, extensionId: string) {
  const active = document.documentElement.dataset.jstremioActivePage === extensionId;
  button.classList.toggle("selected", active);
  if (active) button.setAttribute("aria-current", "page");
  else button.removeAttribute("aria-current");
}

export function mountPlayerButton(
  extensionId: string,
  label: string,
  icon: string,
  onClick: () => void,
): HTMLButtonElement | null {
  const selector = `[data-jstremio-extension="${extensionId}"][data-jstremio-control="player"]`;
  const existing = document.querySelector<HTMLButtonElement>(selector);
  if (existing) return existing;
  const controls = findPlayerControls();
  const template = controls ? playerControlTemplate(controls) : null;
  const dock = ensurePlayerDock();
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.jstremioExtension = extensionId;
  button.dataset.jstremioControl = "player";
  button.dataset.jstremioTestid = `${extensionId}-player-button`;
  button.dataset.jstremioClickOnly = "";
  button.tabIndex = -1;
  button.setAttribute("aria-label", label);
  button.title = label;
  copyIntegrationClasses(button, template);
  button.style.cssText = "border:1px solid var(--jstremio-accent-color,var(--primary-accent-color,#7b5bf5));border-radius:10px;background:var(--jstremio-surface-color,var(--modal-background-color,#130e2d));color:var(--jstremio-text-color,var(--primary-foreground-color,#fff));cursor:pointer;display:grid;place-items:center;width:44px;height:44px;min-width:44px;min-height:44px;padding:0;box-shadow:0 6px 20px color-mix(in srgb,var(--jstremio-background-start,#000) 60%,transparent);position:relative;z-index:1;pointer-events:auto;";
  button.innerHTML = icon;
  button.addEventListener("pointerdown", (event) => {
    if (event.isPrimary) event.preventDefault();
  });
  button.addEventListener("focus", () => button.blur());
  button.addEventListener("keydown", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  });
  button.addEventListener("click", (event) => {
    if (event.detail === 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    onClick();
  });
  dock.append(button);
  return button;
}

function ensurePlayerDock(): HTMLElement {
  const existing = document.querySelector<HTMLElement>('[data-jstremio-control="player-dock"]');
  if (existing) return existing;
  const dock = document.createElement("div");
  dock.dataset.jstremioControl = "player-dock";
  dock.dataset.jstremioTestid = "player-extension-dock";
  dock.setAttribute("aria-label", "JStremio player extensions");
  dock.setAttribute("role", "group");
  dock.style.cssText = "position:fixed;left:50%;bottom:0;z-index:2147483000;transform:translateX(-50%);display:flex;align-items:center;gap:7px;min-height:64px;padding:10px 18px;box-sizing:border-box;pointer-events:auto;transition:opacity 160ms ease;";
  const style = document.createElement("style");
  style.textContent = `
    [data-jstremio-control="player-dock"] > [data-jstremio-control="player"]:not(:disabled):hover,
    [data-jstremio-control="player-dock"] > [data-jstremio-control="player"]:not(:disabled):focus-visible{
      border-color:var(--jstremio-accent-color,var(--primary-accent-color,#7b5bf5))!important;
      box-shadow:0 0 0 2px color-mix(in srgb,var(--jstremio-accent-color,var(--primary-accent-color,#7b5bf5)) 30%,transparent),0 6px 20px color-mix(in srgb,var(--jstremio-background-start,#000) 60%,transparent)!important
    }
    body:has(${PLAYER_OVERLAY_HIDDEN_SELECTOR}) [data-jstremio-control="player-dock"]:not(:hover):not(:focus-within){opacity:0}
    body:has(${PLAYER_OVERLAY_HIDDEN_SELECTOR}) [data-jstremio-control="player-dock"]:hover,
    body:has(${PLAYER_OVERLAY_HIDDEN_SELECTOR}) [data-jstremio-control="player-dock"]:focus-within{opacity:1}
    @media (prefers-reduced-motion:reduce){[data-jstremio-control="player-dock"]{transition:none!important}}
  `;
  dock.append(style);
  document.body.append(dock);
  return dock;
}

export function addStyles(container: HTMLElement, styles: string) {
  const style = document.createElement("style");
  style.textContent = styles;
  container.append(style);
}

export function formatTimestamp(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remaining = seconds % 60;
  return hours
    ? `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
}

export function mediaLabel(target: MediaTarget): string {
  const episode =
    target.mediaType === "series" && target.season !== null && target.episode !== null
      ? `S${target.season} E${target.episode}`
      : "";
  return [target.name, episode, target.title].filter(Boolean).join(" · ") || target.videoId;
}

export function mediaCollectionKey(target: Pick<MediaTarget, "mediaType" | "metaId">): string {
  return `${target.mediaType}:${target.metaId}`;
}

export function mediaCollectionTitle(
  target: Pick<MediaTarget, "mediaType" | "name" | "title" | "metaId">,
): string {
  return target.name || target.title || target.metaId;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function removeOwned(extensionId: string) {
  document
    .querySelectorAll(`[data-jstremio-extension="${extensionId}"]`)
    .forEach((element) => element.remove());
}
