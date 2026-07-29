export type MediaType = "movie" | "series";

export type MediaTarget = {
  key: string;
  videoId: string;
  metaId: string;
  mediaType: MediaType;
  name: string | null;
  title: string | null;
  season: number | null;
  episode: number | null;
  poster: string | null;
};

export type PlaybackSnapshot = {
  positionMs: number | null;
  durationMs: number | null;
  paused: boolean | null;
  seeking: boolean;
  updatedAt: number;
};

export type StreamOption = {
  route: string;
  addonName: string | null;
  addonTransportUrl: string | null;
  name: string | null;
  description: string | null;
  infoHash: string | null;
  fileIdx: string | null;
  url: string | null;
  order: number;
};

export type PlayerPropertyName =
  | "volume"
  | "mute"
  | "audio-device"
  | "audio-device-list"
  | "path"
  | "sid"
  | Exclude<PlayerSettablePropertyName, "volume" | "audio-device">;
export type PlayerSettablePropertyName =
  | "volume"
  | "audio-device"
  | "sub-font"
  | "sub-font-size"
  | "sub-pos"
  | "sub-color"
  | "sub-border-color"
  | "sub-border-size"
  | "sub-back-color"
  | "sub-border-style"
  | "sub-shadow-color"
  | "sub-shadow-offset"
  | "sub-spacing"
  | "sub-bold"
  | "sub-italic"
  | "sub-ass-override";
export type PlayerSeekGuard = (
  positionMs: number,
  snapshot: PlaybackSnapshot,
) => boolean | Promise<boolean>;

export type ExtensionManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  entry: string;
  styles: string;
  enabledByDefault: boolean;
  loadOrder: number;
};

export type RenderHost = (
  container: HTMLElement,
  close: () => void,
) => void | (() => void);

export type JStremioRuntime = {
  registerExtension(
    manifest: ExtensionManifest,
    activate: (runtime: JStremioRuntime) => void | (() => void) | Promise<void | (() => void)>,
  ): void;
  bridge: Readonly<{
    request(
      namespace:
        | "reviews"
        | "timestamp-notes"
        | "plugins"
        | "last-played"
        | "themes"
        | "mini-player"
        | "playback-history"
        | "skip-segments"
        | "phone-remote",
      operation: string,
      payload?: unknown,
      options?: { timeoutMs?: number },
    ): Promise<unknown>;
  }>;
  stremio: Readonly<{
    getPlayerState(): Promise<unknown>;
    getCurrentMediaTarget(): Promise<MediaTarget | null>;
    getStreamOptions(target: MediaTarget): Promise<StreamOption[]>;
  }>;
  player: Readonly<{
    getSnapshot(): PlaybackSnapshot | null;
    subscribe(listener: (snapshot: PlaybackSnapshot | null) => void): () => void;
    seekTo(positionMs: number, options?: { bypassGuards?: boolean }): Promise<void>;
    restorePosition(positionMs: number): Promise<void>;
    setPaused(paused: boolean): Promise<void>;
    observeProperty(name: PlayerPropertyName, listener: (value: unknown) => void): () => void;
    refreshProperty(name: PlayerPropertyName): void;
    setProperty(name: PlayerSettablePropertyName, value: number | string | boolean): Promise<void>;
    addSeekGuard(guard: PlayerSeekGuard): () => void;
    captureFrame(): Promise<string>;
  }>;
  plugins: Readonly<{
    getStyles(id: string): string;
  }>;
  lifecycle: Readonly<{
    onReconcile(callback: () => void): () => void;
    onRouteChange(callback: (url: string) => void): () => void;
  }>;
  ui: Readonly<{
    openPage(extensionId: string, renderer: RenderHost): void;
    closePage(): void;
    openOverlay(renderer: RenderHost): void;
    closeOverlay(): void;
    openDialog(renderer: RenderHost): void;
    closeDialog(): void;
  }>;
  diagnostics: Readonly<{
    report(extensionId: string, error: unknown): void;
  }>;
};

declare global {
  interface Window {
    JStremio?: JStremioRuntime;
    core?: {
      getState(name: string): unknown;
      dispatch(action: unknown, model?: string): unknown;
    };
    chrome?: {
      webview?: {
        postMessage(message: string): void;
        addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
        removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
      };
    };
    __JSTREMIO_PLUGIN_STYLES__?: Readonly<Record<string, string>>;
  }
}
