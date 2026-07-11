import styles from "./styles.css";
import type { JStremioRuntime, MediaTarget } from "../../runtime/types";
import { extractLastPlayedInput } from "../../runtime/lastPlayedAdapter";
import { isRecord } from "../../runtime/nativeEvents";
import { requireRuntime } from "../shared";

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

const manifest = { schemaVersion:1,id:"last-played",name:"LastPlayed",version:"1.0.0",entry:"index.js",styles:"styles.css",enabledByDefault:true,loadOrder:120 } as const;
const OWNER = "last-played";

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  const style = document.createElement("style");
  style.dataset.jstremioExtension = OWNER;
  style.textContent = styles;
  document.head.append(style);
  let entries: LastPlayedEntry[] = [];
  let lastSavedSignature = "";
  let disposed = false;

  const refresh = async () => {
    try { entries = asEntries(await runtime.bridge.request("last-played", "list")); reconcile(); }
    catch (error) { runtime.diagnostics.report(OWNER, error); }
  };
  const capture = async () => {
    try {
      const [state, target] = await Promise.all([runtime.stremio.getPlayerState(), runtime.stremio.getCurrentMediaTarget()]);
      if (!target) return;
      const input = extractLastPlayedInput(state, target, runtime.player.getSnapshot()?.positionMs ?? null);
      if (!input) return;
      const signature = `${input.videoId}|${input.playerDeepLink}|${Math.floor((input.positionMs ?? 0) / 10_000)}`;
      if (signature === lastSavedSignature) return;
      lastSavedSignature = signature;
      const saved = await runtime.bridge.request("last-played", "upsert", input);
      const entry = asEntry(saved);
      if (entry) entries = [entry, ...entries.filter((item) => item.id !== entry.id)];
    } catch (error) { runtime.diagnostics.report(OWNER, error); }
  };
  const reconcile = () => {
    if (disposed) return;
    mountContinueWatchingButtons(entries);
    void mountStreamMenu(runtime, entries);
  };
  const unsubscribe = runtime.lifecycle.onReconcile(reconcile);
  const routeUnsubscribe = runtime.lifecycle.onRouteChange(() => { void refresh(); void capture(); });
  const timer = window.setInterval(() => void capture(), 2_500);
  void refresh(); void capture();
  return () => {
    disposed = true; unsubscribe(); routeUnsubscribe(); clearInterval(timer);
    document.querySelectorAll(`[data-jstremio-extension="${OWNER}"]`).forEach((node) => node.remove());
    document.querySelectorAll("[data-jstremio-last-played-host]").forEach((node) => node.removeAttribute("data-jstremio-last-played-host"));
    document.querySelectorAll("[data-jstremio-last-played-badge]").forEach((node) => node.remove());
  };
}

function play(entry: LastPlayedEntry) { location.hash = entry.playerDeepLink.slice(1); }

function mountContinueWatchingButtons(entries: LastPlayedEntry[]) {
  if (!entries.length) return;
  const headings = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3,[role=heading]"));
  const heading = headings.find((node) => /continue watching/i.test(node.textContent || ""));
  const scope = heading?.parentElement?.parentElement ?? document;
  const links = Array.from(scope.querySelectorAll<HTMLAnchorElement>("a[href]"));
  for (const link of links) {
    if (link.closest(`[data-jstremio-extension="${OWNER}"]`)) continue;
    const href = decodeURIComponent(link.getAttribute("href") || "");
    const entry = entries.find((item) => href.includes(item.videoId) || href.includes(item.metaId));
    if (!entry) continue;
    const host = (link.closest<HTMLElement>("li,article") ?? link.parentElement) as HTMLElement | null;
    if (!host || host.querySelector(`[data-jstremio-last-played-card][data-media-id="${cssEscape(entry.id)}"]`)) continue;
    host.dataset.jstremioLastPlayedHost = "";
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const wrapper = document.createElement("div");
    wrapper.dataset.jstremioExtension = OWNER; wrapper.dataset.jstremioLastPlayedCard = ""; wrapper.dataset.mediaId = entry.id;
    const button = makeButton("Resume last played", () => play(entry));
    button.setAttribute("aria-label", `Resume last played ${entry.name || entry.title || "video"}`);
    wrapper.append(button); host.append(wrapper);
  }
}

async function mountStreamMenu(runtime: JStremioRuntime, entries: LastPlayedEntry[]) {
  const target = await runtime.stremio.getCurrentMediaTarget();
  if (!target) return;
  const entry = entries.find((item) => item.id === target.key);
  if (!entry) return;
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/player/"]'));
  if (!anchors.length) return;
  const exact = anchors.find((anchor) => routesEqual(anchor.href, entry.playerDeepLink));
  const streamContainer = (exact ?? anchors[0])?.parentElement;
  if (!streamContainer) return;
  const list = streamContainer.parentElement;
  if (!list) return;
  if (exact) {
    const row = exact.parentElement ?? exact;
    if (!row.querySelector("[data-jstremio-last-played-badge]")) {
      const badge = document.createElement("span"); badge.dataset.jstremioExtension = OWNER;
      badge.dataset.jstremioLastPlayedBadge = ""; badge.textContent = "Last played"; exact.append(badge);
    }
    if (row.parentElement === list && list.firstElementChild !== row) list.prepend(row);
  }
  const owner = list.parentElement ?? list;
  if (!owner.querySelector("[data-jstremio-last-played-resume]")) {
    const button = makeButton(`Resume last played${entry.addonName ? ` · ${entry.addonName}` : ""}`, () => play(entry));
    button.dataset.jstremioExtension = OWNER; button.dataset.jstremioLastPlayedResume = "";
    owner.insertBefore(button, list);
  }
}

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
function cssEscape(value: string) { return value.replace(/["\\]/g, "\\$&"); }
