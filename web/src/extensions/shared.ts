import {
  copyIntegrationClasses,
  findPlayerControls,
  findPrimaryNavigation,
  navigationTemplate,
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
  if (!controls) return null;
  const template = playerControlTemplate(controls);
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.jstremioExtension = extensionId;
  button.dataset.jstremioControl = "player";
  button.dataset.jstremioTestid = `${extensionId}-player-button`;
  button.setAttribute("aria-label", label);
  button.title = label;
  copyIntegrationClasses(button, template);
  button.style.cssText = "border:0;background:transparent;color:inherit;cursor:pointer;display:grid;place-items:center;min-width:40px;min-height:40px;";
  button.innerHTML = icon;
  button.addEventListener("click", onClick);
  controls.append(button);
  return button;
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
