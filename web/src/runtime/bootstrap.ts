import { createLifecycle } from "./lifecycle";
import { createNativeBridge } from "./nativeBridge";
import { createOverlayHost } from "./overlayHost";
import { createPlayerAdapter } from "./player";
import { getCurrentMediaTarget, getPlayerState } from "./stremioAdapter";
import type { ExtensionManifest, JStremioRuntime } from "./types";

const GUARD = Symbol.for("JStremio.runtime.v1");

function bootstrap() {
  const globalRecord = window as unknown as Record<PropertyKey, unknown>;
  if (globalRecord[GUARD]) return;
  globalRecord[GUARD] = true;

  const bridge = createNativeBridge();
  const lifecycle = createLifecycle();
  const overlays = createOverlayHost();
  const player = createPlayerAdapter(getCurrentMediaTarget);
  const cleanups = new Map<string, () => void>();
  const registered = new Set<string>();
  let reconcileGeneration = 0;

  const diagnostics = Object.freeze({
    report(extensionId: string, error: unknown) {
      const name = error instanceof Error ? error.name : "UnknownError";
      console.warn(`[JStremio:${extensionId}] extension failure (${name})`);
    },
  });

  let runtime!: JStremioRuntime;
  const registerExtension = (
    manifest: ExtensionManifest,
    activate: (runtime: JStremioRuntime) => void | (() => void) | Promise<void | (() => void)>,
  ) => {
    if (!validManifest(manifest) || registered.has(manifest.id) || typeof activate !== "function") {
      diagnostics.report(manifest?.id ?? "unknown", new TypeError("Invalid extension registration"));
      return;
    }
    registered.add(manifest.id);
    const start = async () => {
      try {
        const cleanup = await activate(runtime);
        if (typeof cleanup === "function") cleanups.set(manifest.id, cleanup);
      } catch (error) {
        diagnostics.report(manifest.id, error);
      }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void start(), { once: true });
    else void start();
  };

  runtime = Object.freeze({
    registerExtension,
    bridge: Object.freeze({ request: bridge.request }),
    stremio: Object.freeze({ getPlayerState, getCurrentMediaTarget }),
    player: Object.freeze(player.publicApi),
    lifecycle: Object.freeze(lifecycle.publicApi),
    ui: Object.freeze(overlays.publicApi),
    diagnostics,
  });

  Object.defineProperty(window, "JStremio", {
    value: runtime,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  lifecycle.publicApi.onReconcile(() => {
    const generation = ++reconcileGeneration;
    void getCurrentMediaTarget().then((target) => {
      if (generation === reconcileGeneration) player.setMediaKey(target?.key ?? null);
    });
  });

  window.addEventListener(
    "unload",
    () => {
      for (const cleanup of cleanups.values()) {
        try {
          cleanup();
        } catch {
          // Teardown is best-effort and content-free.
        }
      }
      bridge.destroy();
      player.destroy();
      lifecycle.destroy();
      overlays.destroy();
    },
    { once: true },
  );
}

function validManifest(manifest: ExtensionManifest): boolean {
  return (
    manifest?.schemaVersion === 1 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id) &&
    manifest.id.length <= 64
  );
}

bootstrap();

export type { JStremioRuntime, MediaTarget, PlaybackSnapshot } from "./types";
