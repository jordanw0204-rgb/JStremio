import styles from "./styles.css";
import type { JStremioRuntime } from "../../runtime/types";
import { addStyles, mountNavigationButton, removeOwned, requireRuntime } from "../shared";
import { listAllPlaybackSessions } from "../playback-shared/historyClient";
import { acquirePlaybackSessionTracker, mutateTrackedPlaybackHistory } from "../playback-shared/sessionTracker";
import { calculatePlaybackStatistics, type StatisticsRange } from "./analytics";

const manifest = {
  schemaVersion: 1,
  id: "playback-statistics",
  name: "Playback Statistics",
  version: "1.0.1",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 125,
} as const;
const OWNER = manifest.id;

const ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>';

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  const releaseTracker = acquirePlaybackSessionTracker(runtime);
  const reconcile = () => mountNavigationButton(OWNER, "Playback Statistics", ICON, () => openStatistics(runtime));
  const unsubscribe = runtime.lifecycle.onReconcile(reconcile);
  reconcile();
  return () => {
    releaseTracker();
    unsubscribe();
    removeOwned(OWNER);
  };
}

function openStatistics(runtime: JStremioRuntime) {
  runtime.ui.openPage(OWNER, (container) => {
    addStyles(container, styles);
    let disposed = false;
    const page = document.createElement("section");
    page.className = "playback-statistics-page";
    page.innerHTML = `
      <header><div><p class="eyebrow">Stored only on this device</p><h1>Playback Statistics</h1><p>See where your watch time went without sending it anywhere.</p></div>
        <div class="statistics-actions"><label>Range<select data-range><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="all">All time</option></select></label><button type="button" data-clear>Clear history</button></div>
      </header>
      <p class="statistics-status" role="status">Loading your local history…</p>
      <div class="statistics-content" hidden><div class="stat-grid" data-cards></div><section class="chart-panel"><h2>Watch time by day</h2><div class="watch-chart" data-chart></div></section><section class="top-panel"><h2>Most watched</h2><ol data-top></ol></section></div>`;
    container.append(page);
    const range = page.querySelector<HTMLSelectElement>("[data-range]")!;
    const status = page.querySelector<HTMLElement>(".statistics-status")!;
    const content = page.querySelector<HTMLElement>(".statistics-content")!;
    const load = async () => {
      status.hidden = false;
      status.textContent = "Loading your local history…";
      try {
        const selected = range.value === "all" ? "all" : Number(range.value) as StatisticsRange;
        const now = new Date();
        const sessions = await listAllPlaybackSessions(runtime, selected === "all" ? {} : {
          since: new Date(now.getTime() - selected * 24 * 60 * 60 * 1_000).toISOString(),
        });
        if (disposed) return;
        renderStatistics(page, calculatePlaybackStatistics(sessions, { range: selected, now }));
        status.hidden = sessions.length > 0;
        status.textContent = sessions.length ? "" : "Watch something and your private stats will appear here.";
        content.hidden = false;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Playback statistics could not be loaded.";
        runtime.diagnostics.report(OWNER, error);
      }
    };
    range.addEventListener("change", () => void load());
    page.querySelector<HTMLButtonElement>("[data-clear]")!.addEventListener("click", () => confirmClear(runtime, load));
    void load();
    return () => { disposed = true; };
  });
}

function renderStatistics(page: HTMLElement, statistics: ReturnType<typeof calculatePlaybackStatistics>) {
  const cards = [
    ["Watch time", formatDuration(statistics.totalWatchedMs)],
    ["Sessions", String(statistics.sessions)],
    ["Completed", String(statistics.completed)],
    ["Unique videos", String(statistics.uniqueTitles)],
    ["Current streak", `${statistics.currentStreak} day${statistics.currentStreak === 1 ? "" : "s"}`],
    ["Longest streak", `${statistics.longestStreak} day${statistics.longestStreak === 1 ? "" : "s"}`],
  ] satisfies Array<readonly [string, string]>;
  const cardHost = page.querySelector<HTMLElement>("[data-cards]")!;
  cardHost.replaceChildren(...cards.map(([label, value]) => {
    const card = document.createElement("article");
    const number = document.createElement("strong");
    const caption = document.createElement("span");
    number.textContent = value;
    caption.textContent = label;
    card.append(number, caption);
    return card;
  }));
  const chart = page.querySelector<HTMLElement>("[data-chart]")!;
  const daily = statistics.daily.slice(-30);
  const maximum = Math.max(...daily.map((day) => day.watchedMs), 1);
  chart.replaceChildren(...daily.map((day) => {
    const column = document.createElement("div");
    column.className = "watch-column";
    column.title = `${day.date}: ${formatDuration(day.watchedMs)}`;
    const bar = document.createElement("i");
    bar.style.height = `${Math.max(3, day.watchedMs / maximum * 100)}%`;
    const label = document.createElement("span");
    label.textContent = day.date.slice(5);
    column.append(bar, label);
    return column;
  }));
  if (!daily.length) chart.textContent = "No watch time in this range.";
  const top = page.querySelector<HTMLOListElement>("[data-top]")!;
  top.replaceChildren(...statistics.topTitles.map((title) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const time = document.createElement("strong");
    label.textContent = title.label;
    time.textContent = formatDuration(title.watchedMs);
    item.append(label, time);
    return item;
  }));
  if (!statistics.topTitles.length) top.textContent = "No titles in this range.";
}

function confirmClear(runtime: JStremioRuntime, reload: () => Promise<void>) {
  runtime.ui.openDialog((container, close) => {
    addStyles(container, styles);
    const dialog = document.createElement("section");
    dialog.className = "statistics-confirm";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "statistics-clear-title");
    dialog.innerHTML = '<h2 id="statistics-clear-title">Clear playback history?</h2><p>This removes statistics and journal entries stored by these plugins on this device.</p><div><button type="button" data-cancel>Cancel</button><button type="button" data-confirm>Clear history</button></div>';
    dialog.querySelector<HTMLButtonElement>("[data-cancel]")!.addEventListener("click", close);
    dialog.querySelector<HTMLButtonElement>("[data-confirm]")!.addEventListener("click", async () => {
      try {
        await mutateTrackedPlaybackHistory(runtime, "clear");
        close();
        await reload();
      } catch (error) {
        runtime.diagnostics.report(OWNER, error);
      }
    });
    container.append(dialog);
  });
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
