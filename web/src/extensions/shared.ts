import {
  copyIntegrationClasses,
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
  const existing = document.querySelector<HTMLButtonElement>(selector);
  if (existing) return existing;
  const navigation = findPrimaryNavigation();
  if (!navigation) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.jstremioExtension = extensionId;
  button.dataset.jstremioControl = "navigation";
  button.dataset.jstremioTestid = `${extensionId}-navigation`;
  button.setAttribute("aria-label", label);
  button.title = label;
  copyIntegrationClasses(button, navigationTemplate());
  button.style.cssText = "border:0;background:transparent;color:inherit;cursor:pointer;display:flex;align-items:center;gap:.65rem;padding:.65rem 1rem;width:100%;";
  button.innerHTML = `<span aria-hidden="true" style="display:grid;place-items:center;width:1.25rem">${icon}</span><span>${escapeHtml(label)}</span>`;
  button.addEventListener("click", onClick);
  navigation.append(button);
  return button;
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
  button.setAttribute("aria-label", label);
  button.title = label;
  copyIntegrationClasses(button, template);
  button.style.cssText = "border:1px solid rgba(255,255,255,.22);border-radius:10px;background:rgba(19,14,45,.9);color:#fff;cursor:pointer;display:grid;place-items:center;width:44px;height:44px;min-width:44px;min-height:44px;padding:0;box-shadow:0 6px 20px rgba(0,0,0,.35);";
  button.innerHTML = icon;
  button.addEventListener("click", onClick);
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
    body:has(${PLAYER_OVERLAY_HIDDEN_SELECTOR}) [data-jstremio-control="player-dock"]:not(:hover):not(:focus-within){opacity:.16}
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
