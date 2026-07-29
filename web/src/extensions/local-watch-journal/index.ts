import styles from "./styles.css";
import type { JStremioRuntime, MediaTarget } from "../../runtime/types";
import { addStyles, mountNavigationButton, removeOwned, requireRuntime, viewInStremio } from "../shared";
import { historyRequest, listAllPlaybackSessions } from "../playback-shared/historyClient";
import type { PlaybackSession } from "../playback-shared/model";
import { acquirePlaybackSessionTracker, mutateTrackedPlaybackHistory } from "../playback-shared/sessionTracker";
import { filterJournalSessions, groupJournalSessions, journalMediaLabel, normalizeTags, type JournalFilter } from "./model";

const manifest = {
  schemaVersion: 1,
  id: "local-watch-journal",
  name: "Local Watch Journal",
  version: "1.0.1",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 130,
} as const;
const OWNER = manifest.id;
const ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V3Z"/><path d="M8 7h8M8 11h8M8 15h5M5 18a2 2 0 0 1 2-2h12"/></svg>';

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  const releaseTracker = acquirePlaybackSessionTracker(runtime);
  const reconcile = () => mountNavigationButton(OWNER, "Watch Journal", ICON, () => openJournal(runtime));
  const unsubscribe = runtime.lifecycle.onReconcile(reconcile);
  reconcile();
  return () => {
    releaseTracker();
    unsubscribe();
    removeOwned(OWNER);
  };
}

function openJournal(runtime: JStremioRuntime) {
  runtime.ui.openPage(OWNER, (container) => {
    addStyles(container, styles);
    let sessions: PlaybackSession[] = [];
    let disposed = false;
    const page = document.createElement("section");
    page.className = "watch-journal-page";
    page.innerHTML = `
      <header><div><p class="eyebrow">Private and local</p><h1>Watch Journal</h1><p>A quiet record of what you watched and what you thought about it.</p></div></header>
      <div class="journal-toolbar"><label><span class="sr-only">Search journal</span><input type="search" data-search placeholder="Search titles, notes, or tags"></label><div role="group" aria-label="Journal filter"><button type="button" data-filter="all" aria-pressed="true">All</button><button type="button" data-filter="notes" aria-pressed="false">With notes</button><button type="button" data-filter="favorites" aria-pressed="false">Favorites</button></div></div>
      <p class="journal-status" role="status">Loading your journal…</p><div data-groups></div>`;
    container.append(page);
    const search = page.querySelector<HTMLInputElement>("[data-search]")!;
    let filter: JournalFilter = "all";
    const render = () => renderJournal(page, filterJournalSessions(sessions, search.value, filter), runtime, reload);
    search.addEventListener("input", render);
    page.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => button.addEventListener("click", () => {
      filter = button.dataset.filter as JournalFilter;
      page.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      render();
    }));
    async function reload() {
      const status = page.querySelector<HTMLElement>(".journal-status")!;
      status.hidden = false;
      status.textContent = "Loading your journal…";
      try {
        sessions = await listAllPlaybackSessions(runtime);
        if (disposed) return;
        render();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "The local journal could not be loaded.";
        runtime.diagnostics.report(OWNER, error);
      }
    }
    void reload();
    return () => { disposed = true; };
  });
}

function renderJournal(
  page: HTMLElement,
  sessions: PlaybackSession[],
  runtime: JStremioRuntime,
  reload: () => Promise<void>,
) {
  const status = page.querySelector<HTMLElement>(".journal-status")!;
  const host = page.querySelector<HTMLElement>("[data-groups]")!;
  host.replaceChildren();
  status.hidden = sessions.length > 0;
  status.textContent = "No journal entries match this view yet.";
  for (const group of groupJournalSessions(sessions)) {
    const section = document.createElement("section");
    section.className = "journal-day";
    const heading = document.createElement("h2");
    heading.textContent = group.label;
    const list = document.createElement("div");
    list.className = "journal-list";
    list.append(...group.sessions.map((session) => journalCard(session, () => openEntry(runtime, session, reload))));
    section.append(heading, list);
    host.append(section);
  }
}

function journalCard(session: PlaybackSession, open: () => void): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "journal-card";
  const poster = document.createElement("div");
  poster.className = "journal-poster";
  if (session.poster) {
    const image = document.createElement("img");
    image.src = session.poster;
    image.alt = "";
    poster.append(image);
  }
  const content = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = journalMediaLabel(session);
  const meta = document.createElement("span");
  meta.textContent = `${formatDuration(session.watchedMs)} watched${session.completed ? " · Completed" : ""}`;
  const note = document.createElement("p");
  note.textContent = session.journal?.text || "Add a note…";
  const tags = document.createElement("div");
  tags.className = "journal-tags";
  tags.append(...(session.journal?.tags ?? []).map((value) => {
    const tag = document.createElement("i");
    tag.textContent = value;
    return tag;
  }));
  content.append(title, meta, note, tags);
  const favorite = document.createElement("span");
  favorite.className = "journal-favorite";
  favorite.textContent = session.journal?.favorite ? "★" : "";
  button.append(poster, content, favorite);
  button.addEventListener("click", open);
  return button;
}

function openEntry(runtime: JStremioRuntime, session: PlaybackSession, reload: () => Promise<void>) {
  runtime.ui.openDialog((container, close) => {
    addStyles(container, styles);
    const dialog = document.createElement("section");
    dialog.className = "journal-editor";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "journal-editor-title");
    dialog.innerHTML = `
      <header><div><p>Watch entry</p><h2 id="journal-editor-title"></h2></div><button type="button" data-close aria-label="Close journal entry">×</button></header>
      <label>Note<textarea data-note maxlength="4000" rows="7" placeholder="What did you think?"></textarea></label>
      <label>Tags<input data-tags maxlength="395" placeholder="comfort watch, mystery, great ending"></label>
      <label class="favorite-toggle"><input type="checkbox" data-favorite><span>Mark as a favorite</span></label>
      <p class="editor-error" role="alert" hidden></p>
      <footer><button type="button" data-delete>Delete entry</button><span></span><button type="button" data-view>View in Stremio</button><button type="button" data-save>Save</button></footer>`;
    dialog.querySelector<HTMLElement>("h2")!.textContent = journalMediaLabel(session);
    const note = dialog.querySelector<HTMLTextAreaElement>("[data-note]")!;
    const tags = dialog.querySelector<HTMLInputElement>("[data-tags]")!;
    const favorite = dialog.querySelector<HTMLInputElement>("[data-favorite]")!;
    const error = dialog.querySelector<HTMLElement>(".editor-error")!;
    note.value = session.journal?.text ?? "";
    tags.value = session.journal?.tags.join(", ") ?? "";
    favorite.checked = session.journal?.favorite ?? false;
    dialog.querySelector<HTMLButtonElement>("[data-close]")!.addEventListener("click", close);
    dialog.querySelector<HTMLButtonElement>("[data-view]")!.addEventListener("click", () => viewInStremio(runtime, sessionTarget(session)));
    dialog.querySelector<HTMLButtonElement>("[data-save]")!.addEventListener("click", async () => {
      try {
        await historyRequest(runtime, "updateJournal", {
          id: session.id,
          text: note.value,
          tags: normalizeTags(tags.value),
          favorite: favorite.checked,
        });
        close();
        await reload();
      } catch (cause) {
        error.hidden = false;
        error.textContent = cause instanceof Error ? cause.message : "The journal entry could not be saved.";
      }
    });
    const remove = dialog.querySelector<HTMLButtonElement>("[data-delete]")!;
    remove.addEventListener("click", async () => {
      if (remove.dataset.confirm !== "true") {
        remove.dataset.confirm = "true";
        remove.textContent = "Confirm delete";
        return;
      }
      try {
        await mutateTrackedPlaybackHistory(runtime, "delete", { id: session.id });
        close();
        await reload();
      } catch (cause) {
        error.hidden = false;
        error.textContent = cause instanceof Error ? cause.message : "The journal entry could not be deleted.";
      }
    });
    container.append(dialog);
  });
}

function sessionTarget(session: PlaybackSession): MediaTarget {
  return {
    key: `${session.mediaType}:${session.videoId}`,
    videoId: session.videoId,
    metaId: session.metaId,
    mediaType: session.mediaType,
    name: session.name,
    title: session.title,
    season: session.season,
    episode: session.episode,
    poster: session.poster,
  };
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
