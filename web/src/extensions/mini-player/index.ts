import type { JStremioRuntime } from "../../runtime/types";
import { unwrapNativeEvent } from "../../runtime/nativeEvents";
import { mountPlayerButton, removeOwned, requireRuntime } from "../shared";
import { asMiniPlayerState, isPlayerRoute, type MiniPlayerState } from "./model";
import { syncMiniPlayerUiState } from "./ui";

const manifest = {
  schemaVersion: 1,
  id: "mini-player",
  name: "Always-on-Top Mini Player",
  version: "1.0.2",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 170,
} as const;

const MINI_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1"/><path d="M8 9h5M8 13h2"/></svg>`;
const RESTORE_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>`;

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let state: MiniPlayerState | null = null;
  let busy = false;
  let refreshInFlight: Promise<void> | null = null;
  let playerButton: HTMLButtonElement | null = null;
  let restoreButton: HTMLButtonElement | null = null;

  const syncUi = () => {
    const enabled = state?.enabled === true;
    if (enabled && isPlayerRoute()) {
      if (!restoreButton?.isConnected) {
        restoreButton = document.createElement("button");
        restoreButton.type = "button";
        restoreButton.className = "mini-player-restore";
        restoreButton.dataset.jstremioExtension = "mini-player";
        restoreButton.dataset.jstremioControl = "mini-player-restore";
        restoreButton.dataset.jstremioTestid = "mini-player-restore";
        restoreButton.dataset.jstremioClickOnly = "";
        restoreButton.innerHTML = `${RESTORE_ICON}<span>Full window</span>`;
        restoreButton.addEventListener("click", () => void setEnabled(false));
        document.body.append(restoreButton);
      }
    } else {
      restoreButton?.remove();
      restoreButton = null;
    }
    syncMiniPlayerUiState(document.documentElement, playerButton, restoreButton, { enabled, busy });
  };

  const apply = (value: unknown) => {
    const next = asMiniPlayerState(value);
    if (!next) throw new Error("The native mini-player returned an invalid state.");
    state = next;
    syncUi();
  };

  const refresh = () => {
    if (refreshInFlight) return refreshInFlight;
    const pending = (async () => {
      try {
        apply(await runtime.bridge.request("mini-player", "get"));
        if (state?.enabled && !isPlayerRoute()) await setEnabled(false);
      } catch (error) {
        runtime.diagnostics.report("mini-player", error);
      }
    })();
    refreshInFlight = pending.finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  };

  const setEnabled = async (enabled: boolean) => {
    if (busy || state?.enabled === enabled) return;
    busy = true;
    syncUi();
    try {
      apply(await runtime.bridge.request("mini-player", "set", { enabled }));
    } catch (error) {
      runtime.diagnostics.report("mini-player", error);
      await refresh();
    } finally {
      busy = false;
      syncUi();
      if (state?.enabled && !isPlayerRoute()) void setEnabled(false);
    }
  };

  const onNativeWindowState = (event: MessageEvent) => {
    const nativeEvent = unwrapNativeEvent(event.data);
    if (nativeEvent?.[0] === "win-state-changed" || nativeEvent?.[0] === "win-visibility-changed") {
      void refresh();
    }
  };
  window.chrome?.webview?.addEventListener("message", onNativeWindowState);

  const reconcile = () => {
    if (!isPlayerRoute()) {
      playerButton?.remove();
      playerButton = null;
      restoreButton?.remove();
      restoreButton = null;
      if (state?.enabled) void setEnabled(false);
      return;
    }
    playerButton = mountPlayerButton(
      "mini-player",
      state?.enabled ? "Return to full window" : "Always-on-top mini player",
      MINI_ICON,
      () => void setEnabled(state?.enabled !== true),
    );
    syncUi();
  };

  const stopReconcile = runtime.lifecycle.onReconcile(reconcile);
  const stopRoute = runtime.lifecycle.onRouteChange(() => reconcile());
  reconcile();
  void refresh();

  return () => {
    stopReconcile();
    stopRoute();
    window.chrome?.webview?.removeEventListener("message", onNativeWindowState);
    removeOwned("mini-player");
    delete document.documentElement.dataset.jstremioMiniPlayer;
    if (state?.enabled) {
      void runtime.bridge.request("mini-player", "set", { enabled: false }).catch(() => {});
    }
  };
}
