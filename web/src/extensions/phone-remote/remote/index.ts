type RemoteState = {
  publisherId: string;
  revision: number;
  active: boolean;
  mediaSessionId: string | null;
  title: string | null;
  subtitle: string | null;
  paused: boolean | null;
  positionMs: number | null;
  durationMs: number | null;
  volume: number | null;
  muted: boolean | null;
};

const connection = required<HTMLElement>("[data-connection]");
const title = required<HTMLElement>("[data-title]");
const subtitle = required<HTMLElement>("[data-subtitle]");
const seek = required<HTMLInputElement>("[data-seek]");
const position = required<HTMLElement>("[data-position]");
const duration = required<HTMLElement>("[data-duration]");
const play = required<HTMLButtonElement>("[data-play]");
const playIcon = required<SVGPathElement>("[data-play-icon]");
const volume = required<HTMLInputElement>("[data-volume]");
const volumeLabel = required<HTMLOutputElement>("[data-volume-label]");
const mute = required<HTMLButtonElement>("[data-mute]");
const notice = required<HTMLElement>("[data-notice]");
const noticeTitle = required<HTMLElement>("[data-notice-title]");
const noticeMessage = required<HTMLElement>("[data-notice-message]");
let socket: WebSocket | null = null;
let state: RemoteState | null = null;
let requestId = 1;
let reconnectAttempt = 0;
let reconnectTimer = 0;
let explicitlyPaired = false;
let disposed = false;

void boot();

async function boot() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const token = fragment.get("pair");
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  if (token) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
      showNotice("Invalid pairing code", "Generate a new code from JStremio and scan it again.");
      setConnection("Not paired", false);
      return;
    }
    setConnection("Pairing", false);
    try {
      const response = await fetch("/api/pair", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error("pairing rejected");
      explicitlyPaired = true;
    } catch {
      showNotice("Pairing expired", "Generate a new code from JStremio and scan it again.");
      setConnection("Not paired", false);
      return;
    }
  }
  connect();
}

function connect() {
  window.clearTimeout(reconnectTimer);
  if (disposed) return;
  setConnection("Connecting", false);
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const next = new WebSocket(`${protocol}//${location.host}/ws`);
  socket = next;
  next.addEventListener("open", () => {
    if (socket !== next) return;
    reconnectAttempt = 0;
    hideNotice();
    setConnection("Connected", true);
  });
  next.addEventListener("message", (event) => {
    if (socket !== next || typeof event.data !== "string" || event.data.length > 64 * 1024) return;
    let message: unknown;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!isRecord(message) || message.type !== "state" || !isRemoteState(message.state)) return;
    if (
      state
      && message.state.publisherId === state.publisherId
      && message.state.revision < state.revision
    ) return;
    state = message.state;
    render();
  });
  next.addEventListener("close", () => {
    if (socket !== next || disposed) return;
    socket = null;
    setConnection("Disconnected", false);
    setControls(false);
    reconnectAttempt += 1;
    if (!explicitlyPaired && reconnectAttempt >= 2) {
      showNotice("Pairing required", "Scan a new code from the Phone Remote page in JStremio.");
      return;
    }
    if (reconnectAttempt >= 8) {
      showNotice("Remote unavailable", "Make sure JStremio is open and the Phone Remote is running.");
      return;
    }
    reconnectTimer = window.setTimeout(connect, Math.min(5_000, 400 * 2 ** reconnectAttempt));
  });
  next.addEventListener("error", () => next.close());
}

play.addEventListener("click", () => send("togglePaused", {}));
document.querySelectorAll<HTMLButtonElement>("[data-seek-by]").forEach((button) => {
  button.addEventListener("click", () => send("seekBy", { deltaMs: Number(button.dataset.seekBy) }));
});
seek.addEventListener("change", () => send("seekTo", { positionMs: Math.round(Number(seek.value)) }));
volume.addEventListener("input", () => {
  volumeLabel.value = `${Math.round(Number(volume.value))}%`;
});
volume.addEventListener("change", () => send("setVolume", { volume: Number(volume.value) }));
mute.addEventListener("click", () => send("setMuted", { muted: !(state?.muted ?? false) }));
window.addEventListener("pagehide", () => {
  disposed = true;
  window.clearTimeout(reconnectTimer);
  socket?.close();
}, { once: true });

function send(type: string, fields: Record<string, unknown>) {
  if (!state?.active || !state.mediaSessionId || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({
    type,
    requestId: requestId++,
    mediaSessionId: state.mediaSessionId,
    ...fields,
  }));
}

function render() {
  const active = Boolean(state?.active && state.mediaSessionId);
  title.textContent = active ? state?.title || "Playing" : "Nothing playing";
  subtitle.textContent = active ? state?.subtitle || "JStremio" : "Start a video in JStremio.";
  const currentPosition = active && typeof state?.positionMs === "number" ? state.positionMs : 0;
  const currentDuration = active && typeof state?.durationMs === "number" ? state.durationMs : 0;
  seek.max = String(Math.max(1, currentDuration));
  seek.value = String(Math.min(currentPosition, currentDuration || currentPosition));
  position.textContent = timestamp(currentPosition);
  duration.textContent = timestamp(currentDuration);
  const paused = state?.paused !== false;
  playIcon.setAttribute("d", paused ? "M8 5v14l11-7z" : "M7 5h4v14H7zm6 0h4v14h-4z");
  play.setAttribute("aria-label", paused ? "Play" : "Pause");
  if (typeof state?.volume === "number" && document.activeElement !== volume) {
    volume.value = String(Math.round(state.volume));
    volumeLabel.value = `${Math.round(state.volume)}%`;
  }
  mute.textContent = state?.muted ? "Muted" : "Sound";
  mute.toggleAttribute("data-muted", state?.muted === true);
  setControls(active && socket?.readyState === WebSocket.OPEN);
}

function setControls(enabled: boolean) {
  seek.disabled = !enabled;
  volume.disabled = !enabled;
  play.disabled = !enabled;
  mute.disabled = !enabled;
  document.querySelectorAll<HTMLButtonElement>("[data-seek-by]").forEach((button) => {
    button.disabled = !enabled;
  });
}

function setConnection(value: string, connected: boolean) {
  connection.textContent = value;
  connection.toggleAttribute("data-connected", connected);
}

function showNotice(heading: string, text: string) {
  noticeTitle.textContent = heading;
  noticeMessage.textContent = text;
  notice.hidden = false;
}

function hideNotice() {
  notice.hidden = true;
}

function timestamp(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function required<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Phone Remote is missing ${selector}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRemoteState(value: unknown): value is RemoteState {
  if (
    !isRecord(value)
    || typeof value.active !== "boolean"
    || typeof value.revision !== "number"
    || typeof value.publisherId !== "string"
    || value.publisherId.length === 0
    || value.publisherId.length > 512
  ) return false;
  return value.mediaSessionId === null || typeof value.mediaSessionId === "string";
}
