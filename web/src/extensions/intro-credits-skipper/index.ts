import styles from "./styles.css";
import type { JStremioRuntime, MediaTarget, PlaybackSnapshot } from "../../runtime/types";
import { isPlayerRoute } from "../../runtime/compatibility";
import { addStyles, formatTimestamp, mountPlayerButton, removeOwned, requireRuntime, targetPayload } from "../shared";
import { activeSkipKind, asResolvedProfile, asSkipProfiles, profileForScope, resolveRangeForDuration, scopeOptions, type ProfileScope, type ResolvedProfile, type SkipProfile, type SkipRange } from "./model";

type AnyBridgeRequest = (namespace: string, operation: string, payload?: unknown) => Promise<unknown>;

const manifest = {
  schemaVersion: 1,
  id: "intro-credits-skipper",
  name: "Intro & Credits Skipper",
  version: "1.0.3",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 140,
} as const;
const OWNER = manifest.id;
const ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 5 9 7-9 7V5Z"/><path d="M19 5v14"/></svg>';

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  const globalStyle = document.createElement("style");
  globalStyle.dataset.jstremioExtension = OWNER;
  globalStyle.textContent = styles;
  document.head.append(globalStyle);
  let target: MediaTarget | null = null;
  let snapshot: PlaybackSnapshot | null = null;
  let resolved: ResolvedProfile | null = null;
  let resolutionSignature = "";
  let resolving = false;
  let refreshPending = false;
  let resolutionGeneration = 0;
  let retryAfter = 0;
  let skipRunning = false;
  let suppressedKind: "intro" | "credits" | null = null;
  let prompt: HTMLButtonElement | null = null;
  let promptKey = "";

  const refreshResolution = async () => {
    if (target && `${target.key}|${snapshot?.durationMs ?? "unknown"}` === resolutionSignature) return;
    if (resolving) {
      refreshPending = true;
      return;
    }
    if (!isPlayerRoute() || Date.now() < retryAfter) return;
    resolving = true;
    const generation = resolutionGeneration;
    const requestDurationMs = snapshot?.durationMs ?? null;
    try {
      const nextTarget = target ?? await runtime.stremio.getCurrentMediaTarget();
      if (!nextTarget || generation !== resolutionGeneration || !isPlayerRoute()) return;
      const signature = `${nextTarget.key}|${requestDurationMs ?? "unknown"}`;
      target = nextTarget;
      if (signature === resolutionSignature) return;
      if (nextTarget.mediaType !== "series") {
        resolved = null;
        resolutionSignature = signature;
        renderSkipControl();
        reconcile();
        return;
      }
      const nextResolved = asResolvedProfile(await request(runtime, "resolve", {
        ...targetPayload(nextTarget),
        durationMs: requestDurationMs,
      }));
      if (generation !== resolutionGeneration || !isPlayerRoute()) return;
      resolved = nextResolved;
      resolutionSignature = signature;
      retryAfter = 0;
      renderSkipControl();
      reconcile();
    } catch (error) {
      retryAfter = Date.now() + 2_000;
      runtime.diagnostics.report(OWNER, error);
    } finally {
      resolving = false;
      if (refreshPending) {
        refreshPending = false;
        queueMicrotask(() => void refreshResolution());
      }
    }
  };
  const removePrompt = () => {
    prompt?.remove();
    prompt = null;
    promptKey = "";
  };
  const renderSkipControl = () => {
    if (!isPlayerRoute()) {
      removePrompt();
      return;
    }
    const active = activeSkipKind(resolved, snapshot?.positionMs ?? null);
    if (!active) {
      removePrompt();
      suppressedKind = null;
      skipRunning = false;
      return;
    }
    if (skipRunning || suppressedKind === active.kind) {
      removePrompt();
      return;
    }
    const nextPromptKey = `${active.kind}:${active.range.startMs}:${active.range.endMs}`;
    if (prompt?.isConnected && promptKey === nextPromptKey) return;
    removePrompt();
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.jstremioExtension = OWNER;
    button.dataset.jstremioSkipPrompt = active.kind;
    button.className = "skip-segment-prompt";
    button.textContent = active.kind === "intro" ? "Skip intro" : "Skip credits";
    button.addEventListener("click", async () => {
      skipRunning = true;
      suppressedKind = active.kind;
      button.disabled = true;
      button.textContent = "Skipping…";
      try {
        await runtime.player.seekTo(active.range.endMs, { bypassGuards: true });
      } catch (error) {
        runtime.diagnostics.report(OWNER, error);
        skipRunning = false;
        suppressedKind = null;
      }
      button.remove();
      if (prompt === button) {
        prompt = null;
        promptKey = "";
      }
    });
    prompt = button;
    promptKey = nextPromptKey;
    document.body.append(button);
  };
  const reconcile = () => {
    if (isPlayerRoute() && target?.mediaType === "series") {
      mountPlayerButton(OWNER, "Edit intro and credits", ICON, () => {
        if (target) openEditor(runtime, target, runtime.player.getSnapshot() ?? snapshot, () => {
          resolutionSignature = "";
          void refreshResolution();
        });
      });
    } else {
      document
        .querySelector(`[data-jstremio-extension="${OWNER}"][data-jstremio-control="player"]`)
        ?.remove();
      removePrompt();
    }
    renderSkipControl();
  };
  const unsubscribePlayer = runtime.player.subscribe((value) => {
    snapshot = value;
    void refreshResolution();
    renderSkipControl();
  });
  const unsubscribeReconcile = runtime.lifecycle.onReconcile(reconcile);
  const unsubscribeRoute = runtime.lifecycle.onRouteChange(() => {
    resolutionGeneration += 1;
    target = null;
    resolved = null;
    suppressedKind = null;
    skipRunning = false;
    resolutionSignature = "";
    retryAfter = 0;
    removePrompt();
    reconcile();
    void refreshResolution();
  });
  reconcile();
  void refreshResolution();
  return () => {
    unsubscribePlayer();
    unsubscribeReconcile();
    unsubscribeRoute();
    removeOwned(OWNER);
    removePrompt();
  };
}

function openEditor(
  runtime: JStremioRuntime,
  target: MediaTarget,
  openingSnapshot: PlaybackSnapshot | null,
  saved: () => void,
) {
  runtime.ui.openDialog((container, close) => {
    addStyles(container, styles);
    let profiles: SkipProfile[] = [];
    const availableScopes = scopeOptions(target);
    if (availableScopes.length === 0) {
      close();
      return;
    }
    let scope: ProfileScope = availableScopes[0]!;
    let introStart: number | null = null;
    let introEnd: number | null = null;
    let creditsStart: number | null = null;
    let originalCredits: SkipRange | null = null;
    let creditsEdited = false;
    const dialog = document.createElement("section");
    dialog.className = "skip-editor";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "skip-editor-title");
    const options = availableScopes.map((value) => `<option value="${value}">${scopeLabel(value)}</option>`).join("");
    dialog.innerHTML = `
      <header><div><p>Local playback markers</p><h2 id="skip-editor-title">Intro & credits</h2><span data-media></span></div></header>
      <label class="scope-field">Apply these markers to<select data-scope>${options}</select></label>
      <div class="marker-grid">
        <section><h3>Intro</h3><p>Mark both ends of the opening.</p><div><button type="button" data-mark="intro-start">Set start</button><output data-value="intro-start">Not set</output></div><div><button type="button" data-mark="intro-end">Set end</button><output data-value="intro-end">Not set</output></div></section>
        <section><h3>Credits</h3><p>Mark where credits begin. The ending follows the video duration.</p><div><button type="button" data-mark="credits-start">Set start</button><output data-value="credits-start">Not set</output></div></section>
      </div>
      <p class="skip-current">Current player position: <strong data-current></strong></p><p class="skip-error" role="alert" hidden></p>
      <div class="legacy-profile" data-legacy hidden><span>This episode has older saved markers that override shared markers.</span><button type="button" data-clear-video>Clear episode markers</button></div>
      <footer><button type="button" data-delete hidden>Clear saved markers</button><span></span><button type="button" data-cancel>Cancel</button><button type="button" data-save>Save markers</button></footer>`;
    dialog.querySelector<HTMLElement>("[data-media]")!.textContent = [target.name, target.title].filter(Boolean).join(" · ") || target.videoId;
    const currentPosition = () => runtime.player.getSnapshot()?.positionMs ?? openingSnapshot?.positionMs ?? null;
    const duration = () => runtime.player.getSnapshot()?.durationMs ?? openingSnapshot?.durationMs ?? null;
    dialog.querySelector<HTMLElement>("[data-current]")!.textContent = formatTimestamp(currentPosition() ?? 0);
    const error = dialog.querySelector<HTMLElement>(".skip-error")!;
    const scopeSelect = dialog.querySelector<HTMLSelectElement>("[data-scope]")!;
    const remove = dialog.querySelector<HTMLButtonElement>("[data-delete]")!;
    const legacy = dialog.querySelector<HTMLElement>("[data-legacy]")!;
    const clearVideo = dialog.querySelector<HTMLButtonElement>("[data-clear-video]")!;
    const syncLegacyProfile = () => {
      legacy.hidden = !profileForScope(profiles, "video");
      delete clearVideo.dataset.confirm;
      clearVideo.textContent = "Clear episode markers";
    };
    const renderDraft = () => {
      const profile = profileForScope(profiles, scope);
      introStart = profile?.intro?.startMs ?? null;
      introEnd = profile?.intro?.endMs ?? null;
      originalCredits = profile?.credits ?? null;
      creditsEdited = false;
      creditsStart = resolveRangeForDuration(originalCredits, duration())?.startMs ?? null;
      setOutput(dialog, "intro-start", introStart);
      setOutput(dialog, "intro-end", introEnd);
      setOutput(dialog, "credits-start", creditsStart);
      remove.hidden = !profile;
      delete remove.dataset.confirm;
      remove.textContent = "Clear saved markers";
      syncLegacyProfile();
    };
    scopeSelect.addEventListener("change", () => {
      scope = scopeSelect.value as ProfileScope;
      renderDraft();
    });
    dialog.querySelectorAll<HTMLButtonElement>("[data-mark]").forEach((button) => button.addEventListener("click", () => {
      const position = currentPosition();
      if (position === null) return showError(error, "The player position is not ready yet.");
      if (button.dataset.mark === "intro-start") introStart = Math.round(position);
      if (button.dataset.mark === "intro-end") introEnd = Math.round(position);
      if (button.dataset.mark === "credits-start") {
        creditsStart = Math.round(position);
        creditsEdited = true;
      }
      setOutput(dialog, button.dataset.mark!, Math.round(position));
      error.hidden = true;
    }));
    dialog.querySelector<HTMLButtonElement>("[data-cancel]")!.addEventListener("click", close);
    dialog.querySelector<HTMLButtonElement>("[data-save]")!.addEventListener("click", async () => {
      const videoDuration = duration();
      const intro = validRange(introStart, introEnd, "absolute", null);
      const credits = creditsEdited
        ? (videoDuration === null ? null : validRange(creditsStart, videoDuration, "fromEnd", videoDuration))
        : originalCredits;
      if (!intro && !credits) return showError(error, "Set a complete intro or a credits start before saving.");
      try {
        await request(runtime, "upsert", { scope, ...targetPayload(target), intro, credits });
        close();
        saved();
      } catch (cause) {
        showError(error, cause instanceof Error ? cause.message : "The markers could not be saved.");
      }
    });
    remove.addEventListener("click", async () => {
      const profile = profileForScope(profiles, scope);
      if (!profile) return;
      if (remove.dataset.confirm !== "true") {
        remove.dataset.confirm = "true";
        remove.textContent = "Confirm clear";
        return;
      }
      try {
        await request(runtime, "delete", { id: profile.id });
        profiles = profiles.filter((item) => item.id !== profile.id);
        renderDraft();
        showStatus(error, `${scopeLabel(scope)} markers cleared.`);
        saved();
      } catch (cause) {
        showError(error, cause instanceof Error ? cause.message : "The profile could not be deleted.");
      }
    });
    clearVideo.addEventListener("click", async () => {
      const profile = profileForScope(profiles, "video");
      if (!profile) return syncLegacyProfile();
      if (clearVideo.dataset.confirm !== "true") {
        clearVideo.dataset.confirm = "true";
        clearVideo.textContent = "Confirm clear episode";
        return;
      }
      try {
        await request(runtime, "delete", { id: profile.id });
        profiles = profiles.filter((item) => item.id !== profile.id);
        syncLegacyProfile();
        showStatus(error, "Episode markers cleared. Shared markers now apply.");
        saved();
      } catch (cause) {
        showError(error, cause instanceof Error ? cause.message : "The episode markers could not be cleared.");
      }
    });
    container.append(dialog);
    void request(runtime, "listForMedia", targetPayload(target)).then((value) => {
      profiles = asSkipProfiles(value);
      renderDraft();
    }).catch((cause) => showError(error, cause instanceof Error ? cause.message : "Saved markers could not be loaded."));
  });
}

function request(runtime: JStremioRuntime, operation: string, payload: unknown = {}): Promise<unknown> {
  const bridge = runtime.bridge.request as unknown as AnyBridgeRequest;
  return bridge("skip-segments", operation, payload);
}

function validRange(
  startMs: number | null,
  endMs: number | null,
  anchor: "absolute" | "fromEnd",
  durationMsAtCreation: number | null,
): SkipRange | null {
  return startMs !== null && endMs !== null && startMs >= 0 && endMs > startMs
    ? { startMs, endMs, anchor, durationMsAtCreation }
    : null;
}

function setOutput(dialog: HTMLElement, key: string, value: number | null) {
  dialog.querySelector<HTMLOutputElement>(`[data-value="${key}"]`)!.textContent = value === null ? "Not set" : formatTimestamp(value);
}

function showError(element: HTMLElement, message: string) {
  element.hidden = false;
  element.dataset.kind = "error";
  element.textContent = message;
}

function showStatus(element: HTMLElement, message: string) {
  element.hidden = false;
  element.dataset.kind = "status";
  element.textContent = message;
}

function scopeLabel(scope: ProfileScope): string {
  if (scope === "video") return "This episode";
  if (scope === "season") return "This season";
  return "This series";
}
