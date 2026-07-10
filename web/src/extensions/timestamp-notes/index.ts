import styles from "./styles.css";
import { findSeekContainer, isPlayerRoute } from "../../runtime/compatibility";
import { isLikelyLiveState } from "../../runtime/stremioAdapter";
import type { JStremioRuntime, MediaTarget, PlaybackSnapshot } from "../../runtime/types";
import {
  addStyles,
  formatTimestamp,
  mediaLabel,
  mountNavigationButton,
  mountPlayerButton,
  removeOwned,
  requireRuntime,
  targetPayload,
  viewInStremio,
} from "../shared";
import { clusterMarkers } from "./markers";
import { shouldResumePlayback } from "./playbackResume";

type Note = ReturnType<typeof targetPayload> & {
  id: string;
  mediaKey: string;
  timestampMs: number;
  durationMsAtCreation: number | null;
  text: string;
  createdAt: string;
  updatedAt: string;
};

const manifest = {
  schemaVersion: 1,
  id: "timestamp-notes",
  name: "Timestamp Notes",
  version: "1.0.0",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 110,
} as const;

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let target: MediaTarget | null = null;
  let snapshot: PlaybackSnapshot | null = null;
  let notes: Note[] = [];
  let isLive = false;
  let remotePlayback = false;
  let loadGeneration = 0;
  let reconcileGeneration = 0;
  let playerButton: HTMLButtonElement | null = null;
  let timeline: Timeline | null = null;
  let overlayRefresh: (() => void) | null = null;

  const refreshButton = () => {
    if (!playerButton) return;
    const reason = disabledReason(target, snapshot, isLive, remotePlayback);
    playerButton.disabled = reason !== null;
    playerButton.title = reason ?? "Add timestamp note";
    playerButton.setAttribute("aria-label", reason ? `Timestamp Notes unavailable: ${reason}` : "Add timestamp note");
    playerButton.style.opacity = reason ? ".48" : "1";
    playerButton.style.cursor = reason ? "not-allowed" : "pointer";
  };

  const loadForTarget = async (next: MediaTarget | null) => {
    const generation = ++loadGeneration;
    if (!next) {
      notes = [];
      timeline?.render(notes, snapshot?.durationMs ?? null);
      return;
    }
    try {
      const loaded = asNotes(
        await runtime.bridge.request("timestamp-notes", "listForMedia", { mediaKey: next.key }),
      );
      if (generation === loadGeneration && target?.key === next.key) {
        notes = loaded;
        timeline?.render(notes, snapshot?.durationMs ?? null);
      }
    } catch (error) {
      runtime.diagnostics.report("timestamp-notes", error);
    }
  };

  const reconcile = () => {
    mountNavigationButton("timestamp-notes", "Timestamp Notes", NOTE_ICON, () => openManagement());
    if (!isPlayerRoute()) {
      playerButton?.remove();
      playerButton = null;
      timeline?.destroy();
      timeline = null;
      return;
    }
    playerButton = mountPlayerButton("timestamp-notes", "Add timestamp note", NOTE_ICON, () => {
      void captureNote();
    });
    refreshButton();
    const generation = ++reconcileGeneration;
    void Promise.all([
      runtime.stremio.getCurrentMediaTarget(),
      runtime.stremio.getPlayerState().catch(() => null),
    ]).then(([nextTarget, state]) => {
      if (generation !== reconcileGeneration) return;
      const changed = nextTarget?.key !== target?.key;
      target = nextTarget;
      isLive = isLikelyLiveState(state);
      remotePlayback = isRemotePlaybackState(state);
      if (changed) void loadForTarget(target);
      refreshButton();
      const seekContainer = findSeekContainer();
      if (seekContainer && timeline?.container !== seekContainer) {
        timeline?.destroy();
        timeline = createTimeline(runtime, seekContainer, () => notes, () => {
          void loadForTarget(target);
          overlayRefresh?.();
        });
      }
      timeline?.render(notes, snapshot?.durationMs ?? null);
    });
  };

  const captureNote = async () => {
    const capturedTarget = await runtime.stremio.getCurrentMediaTarget();
    const capturedSnapshot = runtime.player.getSnapshot();
    const state = await runtime.stremio.getPlayerState().catch(() => null);
    const reason = disabledReason(
      capturedTarget,
      capturedSnapshot,
      isLikelyLiveState(state),
      isRemotePlaybackState(state),
    );
    if (reason || !capturedTarget || !capturedSnapshot?.durationMs || capturedSnapshot.positionMs === null) {
      refreshButton();
      return;
    }

    const pausedByExtension = capturedSnapshot.paused === false;
    let sawExpectedPause = !pausedByExtension;
    let manualPauseChange = false;
    const unsubscribePause = runtime.player.subscribe((current) => {
      if (!pausedByExtension || current?.paused == null) return;
      if (!sawExpectedPause && current.paused === true) sawExpectedPause = true;
      else if (sawExpectedPause && current.paused !== true) manualPauseChange = true;
    });
    if (pausedByExtension) {
      try {
        await runtime.player.setPaused(true);
      } catch (error) {
        unsubscribePause();
        runtime.diagnostics.report("timestamp-notes", error);
        return;
      }
    }

    openNoteDialog(
      runtime,
      capturedTarget,
      null,
      capturedSnapshot.positionMs,
      capturedSnapshot.durationMs,
      () => {
        void loadForTarget(target);
        overlayRefresh?.();
      },
      () => {
        unsubscribePause();
        void runtime.stremio.getCurrentMediaTarget().then((currentTarget) => {
          const current = runtime.player.getSnapshot();
          if (shouldResumePlayback({
            pausedByExtension,
            sawExpectedPause,
            manualPauseChange,
            capturedMediaKey: capturedTarget.key,
            currentMediaKey: currentTarget?.key ?? null,
            currentlyPaused: current?.paused ?? null,
          })) {
            return runtime.player.setPaused(false);
          }
        }).catch((error) => runtime.diagnostics.report("timestamp-notes", error));
      },
    );
  };

  const openManagement = () => {
    runtime.ui.openOverlay((container, close) => {
      addStyles(container, styles);
      const shell = document.createElement("main");
      shell.className = "notes-shell";
      shell.innerHTML = `
        <header class="notes-header"><div><h1>Timestamp Notes</h1><p>Private moments saved against absolute playback times on this computer.</p></div><button class="button icon-button" data-action="close" aria-label="Close Timestamp Notes">×</button></header>
        <div class="toolbar"><input class="search" type="search" placeholder="Search titles or note text" aria-label="Search timestamp notes"><button class="button" data-action="refresh">Refresh</button><button class="button" data-action="folder">Open data folder</button></div>
        <section class="status" role="status">Loading notes…</section><section class="groups" hidden></section>`;
      container.append(shell);
      const status = shell.querySelector<HTMLElement>(".status")!;
      const groups = shell.querySelector<HTMLElement>(".groups")!;
      const search = shell.querySelector<HTMLInputElement>(".search")!;
      let allNotes: Note[] = [];
      const render = () => {
        const query = search.value.trim().toLocaleLowerCase();
        const filtered = allNotes.filter((note) =>
          [note.name, note.title, note.text, note.videoId]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(query)),
        );
        renderGroups(runtime, groups, filtered, target, snapshot, () => void load());
        groups.hidden = filtered.length === 0;
        status.hidden = filtered.length > 0;
        status.textContent = allNotes.length
          ? filtered.length
            ? ""
            : "No timestamp notes match this search."
          : "No timestamp notes yet. Open an on-demand movie or episode and use the note button.";
      };
      const load = async () => {
        status.hidden = false;
        status.textContent = "Loading notes…";
        groups.hidden = true;
        try {
          allNotes = asNotes(await runtime.bridge.request("timestamp-notes", "listAll"));
          render();
        } catch (error) {
          showError(status, error);
        }
      };
      search.addEventListener("input", render);
      shell.querySelector('[data-action="close"]')?.addEventListener("click", close);
      shell.querySelector('[data-action="refresh"]')?.addEventListener("click", () => void load());
      shell.querySelector('[data-action="folder"]')?.addEventListener("click", () => {
        void runtime.bridge.request("timestamp-notes", "openDataFolder").catch((error) => showError(status, error));
      });
      overlayRefresh = () => void load();
      void load();
      return () => {
        overlayRefresh = null;
      };
    });
  };

  const unsubscribeLifecycle = runtime.lifecycle.onReconcile(reconcile);
  const unsubscribePlayer = runtime.player.subscribe((next) => {
    snapshot = next;
    refreshButton();
    timeline?.render(notes, snapshot?.durationMs ?? null);
  });
  return () => {
    unsubscribeLifecycle();
    unsubscribePlayer();
    timeline?.destroy();
    runtime.ui.closeOverlay();
    removeOwned("timestamp-notes");
  };
}

function openNoteDialog(
  runtime: JStremioRuntime,
  target: MediaTarget,
  existing: Note | null,
  initialTimestampMs: number,
  durationMs: number | null,
  changed: () => void,
  onClosed: () => void = () => undefined,
) {
  runtime.ui.openDialog((container, close) => {
    addStyles(container, styles);
    let timestampMs = initialTimestampMs;
    const capturedTimestampMs = initialTimestampMs;
    const form = document.createElement("form");
    form.className = "dialog";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    form.setAttribute("aria-labelledby", "jstremio-note-title");
    form.innerHTML = `
      <h2 id="jstremio-note-title">${existing ? "Update timestamp note" : "Add timestamp note"}</h2><p class="subtitle"></p>
      <div class="captured"><button type="button" class="button" data-adjust="-5000" aria-label="Move timestamp back 5 seconds">−5s</button><strong></strong><button type="button" class="button" data-adjust="5000" aria-label="Move timestamp forward 5 seconds">+5s</button><button type="button" class="button" data-action="reset">Reset</button></div>
      <label class="field">Note (required)<textarea required maxlength="5000"></textarea><span class="count">0 / 5000</span></label><div class="alert" role="alert" aria-live="polite"></div>
      <div class="dialog-actions">${existing ? '<button type="button" class="button danger" data-action="delete">Delete</button>' : ""}<button type="button" class="button" data-action="cancel">Cancel</button><button type="submit" class="button primary">${existing ? "Update" : "Save"}</button></div>`;
    form.querySelector<HTMLElement>(".subtitle")!.textContent = mediaLabel(target);
    const time = form.querySelector<HTMLElement>(".captured strong")!;
    const textarea = form.querySelector<HTMLTextAreaElement>("textarea")!;
    const count = form.querySelector<HTMLElement>(".count")!;
    const alert = form.querySelector<HTMLElement>(".alert")!;
    textarea.value = existing?.text ?? "";
    const render = () => {
      time.textContent = formatTimestamp(timestampMs);
      count.textContent = `${Array.from(textarea.value).length} / 5000`;
    };
    form.querySelectorAll<HTMLElement>("[data-adjust]").forEach((button) => {
      button.addEventListener("click", () => {
        const adjustment = Number(button.dataset.adjust);
        timestampMs = Math.max(0, Math.min(durationMs ?? Number.MAX_SAFE_INTEGER, timestampMs + adjustment));
        render();
      });
    });
    form.querySelector('[data-action="reset"]')?.addEventListener("click", () => {
      timestampMs = capturedTimestampMs;
      render();
    });
    textarea.addEventListener("input", render);
    form.querySelector('[data-action="cancel"]')?.addEventListener("click", close);
    form.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
      if (!existing || !confirm("Delete this timestamp note?")) return;
      void runtime.bridge.request("timestamp-notes", "delete", { id: existing.id }).then(() => {
        changed();
        close();
      }).catch((error) => showError(alert, error));
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!textarea.value.trim()) {
        alert.textContent = "Enter a note.";
        return;
      }
      const operation = existing ? "update" : "create";
      const payload = existing
        ? { id: existing.id, timestampMs: Math.round(timestampMs), text: textarea.value }
        : {
            ...targetPayload(target),
            timestampMs: Math.round(timestampMs),
            durationMsAtCreation: durationMs === null ? null : Math.round(durationMs),
            text: textarea.value,
          };
      void runtime.bridge.request("timestamp-notes", operation, payload).then(() => {
        changed();
        close();
      }).catch((error) => showError(alert, error));
    });
    render();
    container.append(form);
    return onClosed;
  });
}

type Timeline = {
  container: HTMLElement;
  render(notes: Note[], durationMs: number | null): void;
  destroy(): void;
};

function createTimeline(
  runtime: JStremioRuntime,
  container: HTMLElement,
  getNotes: () => Note[],
  changed: () => void,
): Timeline {
  const previousPosition = container.style.position;
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  const layer = document.createElement("div");
  layer.className = "jstremio-marker-layer";
  layer.dataset.jstremioExtension = "timestamp-notes";
  layer.dataset.jstremioControl = "timeline-markers";
  layer.dataset.jstremioTestid = "timestamp-note-markers";
  const style = document.createElement("style");
  style.textContent = styles;
  layer.append(style);
  container.append(layer);
  let currentDuration: number | null = null;
  let lastRenderSignature = "";
  const resize = new ResizeObserver(() => {
    lastRenderSignature = "";
    render(getNotes(), currentDuration);
  });
  resize.observe(container);

  const render = (notes: Note[], durationMs: number | null) => {
    currentDuration = durationMs;
    const width = container.getBoundingClientRect().width;
    const ratio = devicePixelRatio || 1;
    const signature = `${durationMs ?? "none"}|${Math.round(width * 10) / 10}|${ratio}|${notes
      .map((note) => `${note.id}:${note.timestampMs}`)
      .join(",")}`;
    if (signature === lastRenderSignature) return;
    lastRenderSignature = signature;
    layer.querySelectorAll(".jstremio-marker,.marker-popover").forEach((element) => element.remove());
    if (!durationMs || durationMs <= 0) return;
    const clusters = clusterMarkers(notes, durationMs, width, ratio);
    for (const cluster of clusters) {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = `jstremio-marker${cluster.notes.length > 1 ? " cluster" : ""}`;
      marker.style.left = `${cluster.leftPercent}%`;
      marker.title = cluster.notes.length > 1
        ? `${cluster.notes.length} notes near ${formatTimestamp(cluster.notes[0]!.timestampMs)}`
        : `${formatTimestamp(cluster.notes[0]!.timestampMs)} — ${preview(cluster.notes[0]!.text)}`;
      marker.setAttribute("aria-label", marker.title);
      if (cluster.notes.length > 1) marker.innerHTML = `<span aria-hidden="true">${cluster.notes.length}</span>`;
      marker.addEventListener("click", () => {
        if (cluster.notes.length === 1) {
          void runtime.player.seekTo(cluster.notes[0]!.timestampMs).catch((error) =>
            runtime.diagnostics.report("timestamp-notes", error),
          );
        }
        showMarkerPopover(runtime, layer, cluster.notes, changed);
      });
      layer.append(marker);
    }
  };
  return {
    container,
    render,
    destroy() {
      resize.disconnect();
      layer.remove();
      container.style.position = previousPosition;
    },
  };
}

function showMarkerPopover(runtime: JStremioRuntime, layer: HTMLElement, notes: Note[], changed: () => void) {
  layer.querySelector(".marker-popover")?.remove();
  const popover = document.createElement("div");
  popover.className = "marker-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Timestamp notes");
  for (const note of notes) {
    const item = document.createElement("div");
    item.className = "marker-note";
    const seek = document.createElement("button");
    seek.type = "button";
    seek.className = "seek";
    seek.innerHTML = `<strong>${formatTimestamp(note.timestampMs)}</strong>`;
    seek.append(document.createTextNode(preview(note.text)));
    seek.addEventListener("click", () => {
      void runtime.player.seekTo(note.timestampMs).catch((error) => runtime.diagnostics.report("timestamp-notes", error));
    });
    const actions = document.createElement("div");
    actions.className = "marker-actions";
    actions.append(
      smallAction("Edit", () => openNoteDialog(runtime, noteTarget(note), note, note.timestampMs, note.durationMsAtCreation, changed)),
      smallAction("Delete", () => {
        if (!confirm("Delete this timestamp note?")) return;
        void runtime.bridge.request("timestamp-notes", "delete", { id: note.id }).then(() => {
          popover.remove();
          changed();
        });
      }),
    );
    item.append(seek, actions);
    popover.append(item);
  }
  layer.append(popover);
  popover.querySelector<HTMLElement>("button")?.focus();
}

function renderGroups(
  runtime: JStremioRuntime,
  root: HTMLElement,
  notes: Note[],
  activeTarget: MediaTarget | null,
  snapshot: PlaybackSnapshot | null,
  refresh: () => void,
) {
  root.replaceChildren();
  const grouped = new Map<string, Note[]>();
  for (const note of notes) {
    const group = grouped.get(note.mediaKey) ?? [];
    group.push(note);
    grouped.set(note.mediaKey, group);
  }
  for (const groupNotes of grouped.values()) {
    const first = groupNotes[0]!;
    const target = noteTarget(first);
    const section = document.createElement("section");
    section.className = "group";
    const header = document.createElement("header");
    header.className = "group-header";
    const artwork = document.createElement("div");
    if (first.poster) {
      const image = document.createElement("img");
      image.src = first.poster;
      image.alt = "";
      image.loading = "lazy";
      artwork.append(image);
    }
    const heading = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = first.name || first.title || first.videoId;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = mediaLabel(target);
    heading.append(title, meta);
    header.append(artwork, heading);
    section.append(header);
    for (const note of groupNotes) {
      const row = document.createElement("article");
      row.className = "note-row";
      const time = document.createElement("div");
      time.className = "time";
      time.textContent = formatTimestamp(note.timestampMs);
      const body = document.createElement("div");
      const text = document.createElement("div");
      text.className = "preview";
      text.textContent = note.text;
      body.append(text);
      if (
        activeTarget?.key === note.mediaKey &&
        snapshot?.durationMs !== null &&
        snapshot?.durationMs !== undefined &&
        note.timestampMs > snapshot.durationMs
      ) {
        const warning = document.createElement("div");
        warning.className = "warning";
        warning.textContent = "Out of range for this version";
        body.append(warning);
      }
      const actions = document.createElement("div");
      actions.className = "row-actions";
      actions.append(
        smallAction("View in Stremio", () => viewInStremio(runtime, noteTarget(note))),
        smallAction("Edit", () => openNoteDialog(runtime, noteTarget(note), note, note.timestampMs, note.durationMsAtCreation, refresh)),
        smallAction("Delete", () => {
          if (!confirm("Delete this timestamp note?")) return;
          void runtime.bridge.request("timestamp-notes", "delete", { id: note.id }).then(refresh);
        }),
      );
      row.append(time, body, actions);
      section.append(row);
    }
    root.append(section);
  }
}

function disabledReason(
  target: MediaTarget | null,
  snapshot: PlaybackSnapshot | null,
  live: boolean,
  remote: boolean,
): string | null {
  if (!target?.videoId) return "No stable movie or episode is active.";
  if (remote) return "Timestamp notes require local MPV playback.";
  if (live) return "Timestamp notes are unavailable for live streams.";
  if (!snapshot || snapshot.positionMs === null || !Number.isFinite(snapshot.positionMs)) {
    return "The current playback time is unavailable.";
  }
  if (snapshot.durationMs === null || !Number.isFinite(snapshot.durationMs) || snapshot.durationMs <= 0) {
    return "This stream has no finite on-demand duration.";
  }
  if (Date.now() - snapshot.updatedAt > 5_000) return "The local MPV time signal is stale.";
  return null;
}

function isRemotePlaybackState(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;
  const value = state as Record<string, unknown>;
  return value.remoteDevice !== undefined || value.castState === "connected" || value.playingOnDevice === true;
}

function noteTarget(note: Note): MediaTarget {
  return {
    key: note.mediaKey,
    videoId: note.videoId,
    metaId: note.metaId,
    mediaType: note.mediaType,
    name: note.name,
    title: note.title,
    season: note.season,
    episode: note.episode,
    poster: note.poster,
  };
}

function smallAction(label: string, action: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function asNotes(value: unknown): Note[] {
  return Array.isArray(value)
    ? value.filter((item): item is Note => {
        if (!item || typeof item !== "object") return false;
        const note = item as Partial<Note>;
        return typeof note.id === "string" && typeof note.mediaKey === "string" && typeof note.timestampMs === "number";
      })
    : [];
}

function preview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 100 ? `${normalized.slice(0, 97)}…` : normalized;
}

function showError(target: HTMLElement, error: unknown) {
  target.hidden = false;
  target.textContent = error instanceof Error ? error.message : "The local timestamp-note operation failed.";
}

const NOTE_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4V3Z"/><path d="M9 8h6M9 12h4"/></svg>';
