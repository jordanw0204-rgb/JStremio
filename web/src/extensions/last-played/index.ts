import styles from "./styles.css";
import type { JStremioRuntime, MediaTarget } from "../../runtime/types";
import { extractLastPlayedInput } from "../../runtime/lastPlayedAdapter";
import { isRecord } from "../../runtime/nativeEvents";
import { requireRuntime } from "../shared";
import { mountMediaCardButtons, removeMediaCardButtons } from "./cards";

export type LastPlayedEntry = MediaTarget & {
  id: string;
  playerDeepLink: string;
  streamKey: string;
  addonName: string | null;
  streamName: string | null;
  streamDescription: string | null;
  positionMs: number | null;
  updatedAt: string;
};

const manifest = { schemaVersion:1,id:"last-played",name:"LastPlayed",version:"1.1.0",entry:"index.js",styles:"styles.css",enabledByDefault:true,loadOrder:120 } as const;
const OWNER = "last-played";

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  const style = document.createElement("style");
  style.dataset.jstremioExtension = OWNER;
  style.textContent = styles;
  document.head.append(style);
  let entries: LastPlayedEntry[] = [];
  let lastSavedSignature = "";
  let captureRunning = false;
  let disposed = false;

  const refresh = async () => {
    try { entries = asEntries(await runtime.bridge.request("last-played", "list")); reconcile(); }
    catch (error) { runtime.diagnostics.report(OWNER, error); }
  };
  const capture = async () => {
    const playerRoute = location.hash;
    const snapshot = runtime.player.getSnapshot();
    if (captureRunning || !isPlayerRoute(playerRoute) || snapshot?.positionMs === null || !snapshot) return;
    captureRunning = true;
    try {
      const [state, target] = await Promise.all([runtime.stremio.getPlayerState(), runtime.stremio.getCurrentMediaTarget()]);
      if (!target || location.hash !== playerRoute) return;
      const input = extractLastPlayedInput(state, target, snapshot.positionMs);
      if (!input || playerRoute.length > 32_768) return;
      input.playerDeepLink = playerRoute;
      const signature = `${input.videoId}|${input.playerDeepLink}|${Math.floor((input.positionMs ?? 0) / 10_000)}`;
      if (signature === lastSavedSignature) return;
      const saved = await runtime.bridge.request("last-played", "upsert", input);
      const entry = asEntry(saved);
      if (entry) {
        lastSavedSignature = signature;
        entries = [entry, ...entries.filter((item) => item.id !== entry.id)];
        reconcile();
      }
    } catch (error) { runtime.diagnostics.report(OWNER, error); }
    finally { captureRunning = false; }
  };
  const reconcile = () => {
    if (disposed) return;
    mountMediaCardButtons(entries, play);
    mountStreamMenu(entries);
  };
  const unsubscribe = runtime.lifecycle.onReconcile(reconcile);
  const routeUnsubscribe = runtime.lifecycle.onRouteChange(() => { void refresh(); void capture(); });
  const playerUnsubscribe = runtime.player.subscribe((snapshot) => { if (snapshot && snapshot.positionMs !== null) void capture(); });
  const timer = window.setInterval(() => void capture(), 2_500);
  void refresh(); void capture();
  return () => {
    disposed = true; unsubscribe(); routeUnsubscribe(); playerUnsubscribe(); clearInterval(timer);
    removeMediaCardButtons();
    document.querySelectorAll(`[data-jstremio-extension="${OWNER}"]`).forEach((node) => node.remove());
    document.querySelectorAll("[data-jstremio-last-played-host]").forEach((node) => node.removeAttribute("data-jstremio-last-played-host"));
    document.querySelectorAll("[data-jstremio-last-played-badge]").forEach((node) => node.remove());
  };
}

function play(entry: LastPlayedEntry) { location.hash = entry.playerDeepLink.slice(1); }

function mountStreamMenu(entries: LastPlayedEntry[]) {
  const entry = entryForDetailRoute(entries);
  if (!entry) { cleanupStreamMenu(); return; }
  const match = findStreamList(entry);
  if (!match) { cleanupStreamMenu(); return; }
  const { exact, row, list, owner, playerRoute } = match;
  cleanupStreamMenu(owner, exact);
  if (!exact.querySelector("[data-jstremio-last-played-badge]")) {
    const badge = document.createElement("span"); badge.dataset.jstremioExtension = OWNER;
    badge.dataset.jstremioLastPlayedBadge = ""; badge.textContent = "Last played"; exact.append(badge);
  }
  if (row.parentElement === list && list.firstElementChild !== row) list.prepend(row);
  if (!owner.querySelector("[data-jstremio-last-played-resume]")) {
    const control = document.createElement("div");
    control.dataset.jstremioExtension = OWNER; control.dataset.jstremioLastPlayedStreamControl = "";
    const button = makeButton(`Resume last played${entry.addonName ? ` · ${entry.addonName}` : ""}`, () => playRoute(playerRoute));
    button.dataset.jstremioExtension = OWNER; button.dataset.jstremioLastPlayedResume = "";
    control.append(button); owner.insertBefore(control, list);
  }
}

function entryForDetailRoute(entries: LastPlayedEntry[]) {
  try {
    const [kind, mediaType, metaId, videoId] = location.hash.slice(2).split("/").map(decodeURIComponent);
    if (kind !== "detail" || !mediaType || !metaId || !videoId) return null;
    return entries.find((entry) => entry.mediaType === mediaType && entry.metaId === metaId && entry.videoId === videoId) ?? null;
  } catch { return null; }
}

type StreamListMatch = { exact: HTMLAnchorElement; row: HTMLElement; list: HTMLElement; owner: HTMLElement; playerRoute: string };

function findStreamList(entry: LastPlayedEntry): StreamListMatch | null {
  const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/player/"]'))
    .map(streamListForAnchor).filter((value): value is StreamListMatch => Boolean(value));
  const exact = candidates.find((candidate) => routesEqual(candidate.exact.href, entry.playerDeepLink));
  if (exact) return exact;
  const scored = candidates.map((candidate) => ({ candidate, score: streamMatchScore(candidate.exact, entry) }))
    .filter((value) => value.score > 0).sort((left, right) => right.score - left.score);
  const best = scored[0];
  if (!best || (scored[1] && best.score === scored[1].score)) return null;
  return best.candidate;
}

function streamListForAnchor(exact: HTMLAnchorElement): StreamListMatch | null {
  let row: HTMLElement = exact;
  for (let depth = 0; depth < 7; depth += 1) {
    const list: HTMLElement | null = row.parentElement;
    if (!list) break;
    const streamRows = Array.from(list.children).filter((child): child is HTMLElement =>
      child instanceof HTMLElement && playerLinkCount(child) === 1,
    );
    if (streamRows.length >= 2 && streamRows.includes(row)) {
      const playerRoute = routeFromAnchor(exact);
      return playerRoute ? { exact, row, list, owner: list.parentElement ?? list, playerRoute } : null;
    }
    row = list;
  }
  return null;
}

function playerLinkCount(element: HTMLElement) {
  return (element.matches('a[href*="/player/"]') ? 1 : 0) +
    element.querySelectorAll<HTMLAnchorElement>('a[href*="/player/"]').length;
}

function streamMatchScore(anchor: HTMLAnchorElement, entry: LastPlayedEntry) {
  const haystack = normalizedStreamText(anchor.textContent || "");
  const descriptionParts = (entry.streamDescription || "").split(/\r?\n/)
    .map(normalizedStreamText).filter((value) => value.length >= 12).slice(0, 2);
  if (!descriptionParts.length || descriptionParts.some((part) => !haystack.includes(part))) return 0;
  let score = descriptionParts.reduce((total, part) => total + part.length, 0);
  for (const value of [entry.streamName, entry.addonName]) {
    const part = normalizedStreamText(value || "");
    if (part && haystack.includes(part)) score += part.length;
  }
  return score;
}

function normalizedStreamText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function routeFromAnchor(anchor: HTMLAnchorElement) {
  try { const route = new URL(anchor.href, location.href).hash; return isPlayerRoute(route) ? route : null; }
  catch { return null; }
}

function cleanupStreamMenu(owner?: HTMLElement, exact?: HTMLAnchorElement) {
  document.querySelectorAll<HTMLElement>("[data-jstremio-last-played-stream-control]").forEach((node) => {
    if (!owner || node.parentElement !== owner) node.remove();
  });
  document.querySelectorAll<HTMLElement>("[data-jstremio-last-played-badge]").forEach((node) => {
    if (!exact || !exact.contains(node)) node.remove();
  });
}

function isPlayerRoute(route: string) {
  try { return decodeURIComponent(route).startsWith("#/player/"); }
  catch { return false; }
}

function playRoute(route: string) { location.hash = route.slice(1); }

function routesEqual(anchorHref: string, route: string) {
  try { return decodeURIComponent(new URL(anchorHref, location.href).hash) === decodeURIComponent(route); }
  catch { return false; }
}
function makeButton(label: string, action: () => void) {
  const button=document.createElement("button"); button.type="button"; button.className="jstremio-last-played-button"; button.textContent=label;
  button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); action(); }); return button;
}
function asEntries(value: unknown): LastPlayedEntry[] { return Array.isArray(value) ? value.map(asEntry).filter((v):v is LastPlayedEntry => Boolean(v)) : []; }
function asEntry(value: unknown): LastPlayedEntry | null { return isRecord(value) && typeof value.id === "string" && typeof value.playerDeepLink === "string" ? value as LastPlayedEntry : null; }
