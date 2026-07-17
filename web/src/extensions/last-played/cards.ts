export type LastPlayedCardEntry = {
  id: string;
  playerDeepLink: string;
  videoId: string;
  metaId: string;
  mediaType: "movie" | "series";
  name: string | null;
  title: string | null;
  season: number | null;
  episode: number | null;
  addonName: string | null;
  streamName: string | null;
  streamDescription: string | null;
  positionMs: number | null;
  updatedAt: string;
};

const CARD_SELECTOR = "[data-jstremio-last-played-card]";
const DETAILS_SELECTOR = "[data-jstremio-last-played-details]";
let detailsSequence = 0;
let openEntryId: string | null = null;
let hideTimer: number | null = null;

export function mountMediaCardButtons<T extends LastPlayedCardEntry>(entries: T[], play: (entry: T) => void) {
  if (!entries.length) {
    removeMediaCardButtons();
    return;
  }

  const seen = new Set<HTMLElement>();
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
  for (const link of links) {
    if (link.closest('[data-jstremio-extension="last-played"]') || !isMediaCardLink(link)) continue;
    const entry = entryForCardHref(entries, link.getAttribute("href") || "");
    if (!entry) continue;
    const host = mediaCardHost(link);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    mountCardAction(host, entry, play);
  }

  document.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach((wrapper) => {
    const host = wrapper.parentElement;
    if (!host || !seen.has(host)) removeCardAction(wrapper);
  });
  removeOrphanedDetails();
}

export function removeMediaCardButtons() {
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = null;
  openEntryId = null;
  document.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach(removeCardAction);
  document.querySelectorAll<HTMLElement>(DETAILS_SELECTOR).forEach((details) => details.remove());
}

export function entryForCardHref<T extends LastPlayedCardEntry>(entries: T[], href: string): T | null {
  const route = decodedRoute(href);
  if (!route) return null;
  const [kind, mediaType, metaId, videoId] = route.slice(2).split("/").map(safeDecode);
  if (kind !== "detail" || (mediaType !== "movie" && mediaType !== "series") || !metaId) return null;
  const mediaEntries = entries.filter((entry) => entry.mediaType === mediaType && entry.metaId === metaId);
  if (!mediaEntries.length) return null;
  const exact = videoId ? mediaEntries.filter((entry) => entry.videoId === videoId) : [];
  return newestEntry(exact.length ? exact : mediaEntries);
}

export function mediaLabel(entry: LastPlayedCardEntry) {
  const mediaName = entry.name || (entry.mediaType === "movie" ? entry.title : null) || "Saved video";
  const episode = entry.mediaType === "series" && entry.season !== null && entry.episode !== null
    ? `S${String(entry.season).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}`
    : null;
  const episodeTitle = entry.title && entry.title !== mediaName ? entry.title : null;
  const detail = [episode, episodeTitle].filter(Boolean).join(" · ");
  return detail ? `${mediaName} — ${detail}` : mediaName;
}

export function formatPosition(positionMs: number | null) {
  if (positionMs === null || !Number.isFinite(positionMs) || positionMs < 0) return null;
  const seconds = Math.floor(positionMs / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function mountCardAction<T extends LastPlayedCardEntry>(host: HTMLElement, entry: T, play: (entry: T) => void) {
  const current = Array.from(host.children).find((child): child is HTMLElement =>
    child instanceof HTMLElement && child.hasAttribute("data-jstremio-last-played-card"),
  );
  const entryVersion = `${entry.id}|${entry.playerDeepLink}|${entry.updatedAt}`;
  if (
    current?.dataset.entryVersion === entryVersion &&
    current.dataset.detailsId &&
    document.getElementById(current.dataset.detailsId)
  ) return;
  if (current) removeCardAction(current);

  host.dataset.jstremioLastPlayedHost = "";
  if (getComputedStyle(host).position === "static") {
    host.dataset.jstremioLastPlayedPositioned = "";
    host.style.position = "relative";
  }

  const wrapper = document.createElement("div");
  wrapper.dataset.jstremioExtension = "last-played";
  wrapper.dataset.jstremioLastPlayedCard = "";
  wrapper.dataset.mediaId = entry.id;
  wrapper.dataset.entryVersion = entryVersion;

  const detailsId = `jstremio-last-played-details-${++detailsSequence}`;
  wrapper.dataset.detailsId = detailsId;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "jstremio-last-played-button";
  button.textContent = "Last played";
  button.setAttribute("aria-label", `Resume last played ${mediaLabel(entry)}`);
  button.setAttribute("aria-describedby", detailsId);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    play(entry);
  });

  const details = document.createElement("div");
  details.id = detailsId;
  details.className = "jstremio-last-played-details";
  details.dataset.jstremioExtension = "last-played";
  details.dataset.jstremioLastPlayedDetails = "";
  details.dataset.mediaId = entry.id;
  details.setAttribute("role", "tooltip");
  appendDetail(details, "jstremio-last-played-details-title", mediaLabel(entry));
  appendDetail(details, "jstremio-last-played-details-meta", entry.addonName ? `Provider · ${entry.addonName}` : null);
  appendDetail(details, "jstremio-last-played-details-meta", entry.streamName ? `Stream · ${entry.streamName}` : null);
  appendDetail(details, "jstremio-last-played-details-description", entry.streamDescription);
  const position = formatPosition(entry.positionMs);
  appendDetail(details, "jstremio-last-played-details-meta", position ? `Resume at ${position}` : "Resume from saved playback");
  appendDetail(details, "jstremio-last-played-details-saved", formattedSavedTime(entry.updatedAt));

  const showDetails = () => {
    cancelScheduledHide();
    openEntryId = entry.id;
    document.querySelectorAll<HTMLElement>(DETAILS_SELECTOR).forEach((candidate) => {
      if (candidate !== details) delete candidate.dataset.open;
    });
    details.dataset.open = "";
    positionDetails(button, details);
  };
  const hideDetails = () => scheduleHide(entry.id);
  button.addEventListener("pointerenter", showDetails);
  wrapper.addEventListener("pointerleave", hideDetails);
  button.addEventListener("focus", showDetails);
  button.addEventListener("blur", hideDetails);
  details.addEventListener("pointerenter", showDetails);
  details.addEventListener("pointerleave", hideDetails);

  wrapper.append(button);
  host.append(wrapper);
  document.body.append(details);
  if (openEntryId === entry.id) queueMicrotask(showDetails);
}

function cancelScheduledHide() {
  if (hideTimer === null) return;
  window.clearTimeout(hideTimer);
  hideTimer = null;
}

function scheduleHide(entryId: string) {
  cancelScheduledHide();
  hideTimer = window.setTimeout(() => {
    hideTimer = null;
    if (openEntryId !== entryId) return;
    const stillHovered = Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR))
      .some((card) => card.dataset.mediaId === entryId && (card.matches(":hover") || card.contains(document.activeElement)));
    const tooltipHovered = Array.from(document.querySelectorAll<HTMLElement>(DETAILS_SELECTOR))
      .some((details) => details.dataset.mediaId === entryId && details.matches(":hover"));
    if (stillHovered || tooltipHovered) return;
    openEntryId = null;
    document.querySelectorAll<HTMLElement>(DETAILS_SELECTOR).forEach((details) => {
      if (details.dataset.mediaId === entryId) delete details.dataset.open;
    });
  }, 250);
}

function appendDetail(owner: HTMLElement, className: string, value: string | null) {
  if (!value) return;
  const row = document.createElement("div");
  row.className = className;
  row.textContent = value;
  owner.append(row);
}

function formattedSavedTime(value: string) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return null;
  try {
    return `Saved ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(time)}`;
  } catch {
    return `Saved ${time.toLocaleString()}`;
  }
}

function newestEntry<T extends LastPlayedCardEntry>(entries: T[]) {
  return entries.reduce((newest, entry) => updatedTime(entry) > updatedTime(newest) ? entry : newest);
}

function updatedTime(entry: LastPlayedCardEntry) {
  const value = Date.parse(entry.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

function decodedRoute(href: string) {
  try {
    const url = new URL(href, location.href);
    return safeDecode(url.hash);
  } catch {
    return null;
  }
}

function safeDecode(value: string) {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

function isMediaCardLink(link: HTMLAnchorElement) {
  const route = decodedRoute(link.getAttribute("href") || "");
  if (!route?.startsWith("#/detail/")) return false;
  if (link.querySelector("img,picture,video,[class*='poster' i],[class*='thumbnail' i]")) return true;
  if (link.matches("[class*='poster' i],[class*='thumbnail' i]")) return true;
  const rect = link.getBoundingClientRect();
  return rect.width >= 60 && rect.height >= 80;
}

function mediaCardHost(link: HTMLAnchorElement) {
  // Stremio's poster rows place every poster anchor directly inside one wide
  // scrolling container. Mount into the poster surface when it exists so the
  // action stays above the title bar and tracks each card's real dimensions.
  const posterSurface = Array.from(link.children).find((child): child is HTMLElement =>
    child instanceof HTMLElement &&
    !child.matches("img,picture,video") &&
    (child.matches('[class*="poster-container" i],[class*="thumbnail" i]') ||
      Boolean(child.querySelector("img,picture,video"))),
  );
  if (posterSurface) {
    posterSurface.dataset.jstremioLastPlayedPosterHost = "";
    return posterSurface;
  }
  return link.closest<HTMLElement>("li,article") ?? link;
}

function removeCardAction(wrapper: HTMLElement) {
  const host = wrapper.parentElement;
  const detailsId = wrapper.dataset.detailsId;
  if (detailsId) document.getElementById(detailsId)?.remove();
  wrapper.remove();
  if (!host || host.querySelector(CARD_SELECTOR)) return;
  delete host.dataset.jstremioLastPlayedHost;
  delete host.dataset.jstremioLastPlayedPosterHost;
  if (host.hasAttribute("data-jstremio-last-played-positioned")) {
    delete host.dataset.jstremioLastPlayedPositioned;
    host.style.removeProperty("position");
  }
}

function positionDetails(button: HTMLElement, details: HTMLElement) {
  const buttonRect = button.getBoundingClientRect();
  const detailsRect = details.getBoundingClientRect();
  const margin = 12;
  const halfWidth = detailsRect.width / 2;
  const center = buttonRect.left + buttonRect.width / 2;
  const left = Math.min(
    Math.max(center, margin + halfWidth),
    Math.max(margin + halfWidth, window.innerWidth - margin - halfWidth),
  );
  let top = buttonRect.top - detailsRect.height - 9;
  if (top < margin) top = buttonRect.bottom + 9;
  top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - detailsRect.height - margin));
  details.style.left = `${Math.round(left)}px`;
  details.style.top = `${Math.round(top)}px`;
}

function removeOrphanedDetails() {
  const connected = new Set(
    Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR))
      .map((wrapper) => wrapper.dataset.detailsId)
      .filter((value): value is string => Boolean(value)),
  );
  document.querySelectorAll<HTMLElement>(DETAILS_SELECTOR).forEach((details) => {
    if (!connected.has(details.id)) details.remove();
  });
}
