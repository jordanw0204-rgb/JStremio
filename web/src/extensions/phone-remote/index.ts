import styles from "./styles.css";
import type { JStremioRuntime, MediaTarget } from "../../runtime/types";
import { addStyles, mountNavigationButton, removeOwned, requireRuntime } from "../shared";
import { mountPhoneRemotePage } from "./page";
import {
  asStatus,
  PHONE_REMOTE_RUNNING_EVENT,
  phoneRemoteRequest,
  playbackState,
} from "./model";

const manifest = {
  schemaVersion: 1,
  id: "phone-remote",
  name: "Phone Remote",
  version: "1.0.2",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 185,
} as const;

const PHONE_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="2" width="11" height="20" rx="2.4"/><path d="M10 5h4M11 18.5h2"/><path d="M9.2 11.4a4 4 0 0 1 5.6 0M10.8 13a1.8 1.8 0 0 1 2.4 0"/></svg>';
const POSITION_PUBLISH_INTERVAL_MS = 1_000;

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let target: MediaTarget | null = null;
  let targetKey: string | null = null;
  let mediaSessionId: string | null = null;
  let volume: number | null = null;
  let muted: boolean | null = null;
  const publisherId = newMediaSessionId();
  let revision = 0;
  let publishTimer = 0;
  let lastPublishedAt = 0;
  let remoteRunning = false;
  let previousPaused: boolean | null = null;
  let previousSeeking = false;
  let targetGeneration = 0;
  let disposed = false;

  const publish = (urgent = false) => {
    if (!remoteRunning) return;
    const delay = urgent ? 0 : Math.max(0, POSITION_PUBLISH_INTERVAL_MS - (Date.now() - lastPublishedAt));
    if (publishTimer) {
      if (!urgent) return;
      window.clearTimeout(publishTimer);
    }
    publishTimer = window.setTimeout(() => {
      publishTimer = 0;
      if (!remoteRunning) return;
      lastPublishedAt = Date.now();
      const state = playbackState(publisherId, ++revision, mediaSessionId, target, runtime.player.getSnapshot(), volume, muted);
      void phoneRemoteRequest(runtime, "updateState", state)
        .catch((error) => runtime.diagnostics.report(manifest.id, error));
    }, delay);
  };
  const setRemoteRunning = (running: boolean) => {
    if (remoteRunning === running) return;
    remoteRunning = running;
    if (!running) {
      window.clearTimeout(publishTimer);
      publishTimer = 0;
      return;
    }
    void refreshTarget();
    publish(true);
  };
  const refreshTarget = async () => {
    const generation = ++targetGeneration;
    try {
      const next = await runtime.stremio.getCurrentMediaTarget();
      if (disposed || generation !== targetGeneration) return;
      target = next;
      if (next?.key !== targetKey) {
        targetKey = next?.key ?? null;
        mediaSessionId = next ? newMediaSessionId() : null;
      }
      publish();
    } catch (error) {
      runtime.diagnostics.report(manifest.id, error);
    }
  };
  const open = () => runtime.ui.openPage(manifest.id, (container) => {
    // Built-in pages live in the runtime's ShadowRoot. Styles added to the
    // document head cannot cross that boundary, so keep this stylesheet with
    // the page it owns.
    addStyles(container, styles);
    mountPhoneRemotePage(container, runtime);
  });
  const reconcile = () => mountNavigationButton(manifest.id, "Phone Remote", PHONE_ICON, open);
  const unsubscribeReconcile = runtime.lifecycle.onReconcile(reconcile);
  const unsubscribeRoute = runtime.lifecycle.onRouteChange(() => void refreshTarget());
  const unsubscribePlayer = runtime.player.subscribe((snapshot) => {
    const paused = snapshot?.paused ?? null;
    const seeking = snapshot?.seeking ?? false;
    const urgent = paused !== previousPaused || seeking !== previousSeeking;
    previousPaused = paused;
    previousSeeking = seeking;
    publish(urgent);
  });
  const unsubscribeVolume = runtime.player.observeProperty("volume", (value) => {
    volume = typeof value === "number" && Number.isFinite(value) ? value : null;
    publish();
  });
  const unsubscribeMute = runtime.player.observeProperty("mute", (value) => {
    muted = typeof value === "boolean" ? value : null;
    publish();
  });
  const heartbeat = window.setInterval(() => {
    if (remoteRunning) void phoneRemoteRequest(runtime, "heartbeat").catch(() => undefined);
  }, 5_000);
  const onRunningChanged = (event: Event) => {
    setRemoteRunning((event as CustomEvent<unknown>).detail === true);
  };
  window.addEventListener(PHONE_REMOTE_RUNNING_EVENT, onRunningChanged);
  reconcile();
  void refreshTarget();
  void phoneRemoteRequest(runtime, "status")
    .then((value) => setRemoteRunning(asStatus(value).running))
    .catch(() => undefined);

  return () => {
    disposed = true;
    targetGeneration += 1;
    window.clearTimeout(publishTimer);
    window.clearInterval(heartbeat);
    window.removeEventListener(PHONE_REMOTE_RUNNING_EVENT, onRunningChanged);
    unsubscribeReconcile();
    unsubscribeRoute();
    unsubscribePlayer();
    unsubscribeVolume();
    unsubscribeMute();
    void phoneRemoteRequest(runtime, "stop", {}, 15_000).catch(() => undefined);
    removeOwned(manifest.id);
  };
}

function newMediaSessionId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
