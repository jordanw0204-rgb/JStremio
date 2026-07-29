import type { JStremioRuntime, MediaTarget, PlaybackSnapshot } from "../../runtime/types";

export type PhoneRemoteInterface = { name: string; address: string };
export type PhoneRemoteStatus = {
  running: boolean;
  interfaceIp: string | null;
  origin: string | null;
  connectedClients: number;
  pairedSessions: number;
  startedAt: string | null;
};
export type PairingCode = { url: string; qrDataUrl: string; expiresAt: string };
export type StartPhoneRemoteResult = { status: PhoneRemoteStatus; pairing: PairingCode };
export const PHONE_REMOTE_RUNNING_EVENT = "jstremio-phone-remote-running-changed";

export type RemotePlaybackState = {
  publisherId: string;
  revision: number;
  active: boolean;
  mediaSessionId: string | null;
  title: string | null;
  subtitle: string | null;
  season: number | null;
  episode: number | null;
  paused: boolean | null;
  positionMs: number | null;
  durationMs: number | null;
  volume: number | null;
  muted: boolean | null;
  updatedAt: number;
};

type PhoneRemoteRequest = (
  namespace: "phone-remote",
  operation: string,
  payload?: unknown,
  options?: { timeoutMs?: number },
) => Promise<unknown>;

export function phoneRemoteRequest(
  runtime: JStremioRuntime,
  operation: string,
  payload: unknown = {},
  timeoutMs = 7_500,
) {
  const request = runtime.bridge.request as unknown as PhoneRemoteRequest;
  return request("phone-remote", operation, payload, { timeoutMs });
}

export function playbackState(
  publisherId: string,
  revision: number,
  mediaSessionId: string | null,
  target: MediaTarget | null,
  snapshot: PlaybackSnapshot | null,
  volume: number | null,
  muted: boolean | null,
): RemotePlaybackState {
  const active = Boolean(target && snapshot);
  return {
    publisherId,
    revision,
    active,
    mediaSessionId: active ? mediaSessionId : null,
    title: active && target ? cleanText(target.name || target.title) : null,
    subtitle: active && target ? episodeLabel(target) : null,
    season: active && target ? finiteInteger(target.season) : null,
    episode: active && target ? finiteInteger(target.episode) : null,
    paused: active && typeof snapshot?.paused === "boolean" ? snapshot.paused : null,
    positionMs: active ? finiteMilliseconds(snapshot?.positionMs) : null,
    durationMs: active ? finiteMilliseconds(snapshot?.durationMs) : null,
    volume: finiteVolume(volume),
    muted: typeof muted === "boolean" ? muted : null,
    updatedAt: Date.now(),
  };
}

export function asInterfaces(value: unknown): PhoneRemoteInterface[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    return typeof candidate.name === "string" && typeof candidate.address === "string"
      ? [{ name: candidate.name, address: candidate.address }]
      : [];
  });
}

export function asStatus(value: unknown): PhoneRemoteStatus {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    running: item.running === true,
    interfaceIp: typeof item.interfaceIp === "string" ? item.interfaceIp : null,
    origin: typeof item.origin === "string" ? item.origin : null,
    connectedClients: safeCount(item.connectedClients),
    pairedSessions: safeCount(item.pairedSessions),
    startedAt: typeof item.startedAt === "string" ? item.startedAt : null,
  };
}

export function asPairing(value: unknown): PairingCode | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return typeof item.url === "string"
    && typeof item.qrDataUrl === "string"
    && item.qrDataUrl.startsWith("data:image/svg+xml;base64,")
    && typeof item.expiresAt === "string"
    ? { url: item.url, qrDataUrl: item.qrDataUrl, expiresAt: item.expiresAt }
    : null;
}

export function asStartResult(value: unknown): StartPhoneRemoteResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const pairing = asPairing(item.pairing);
  return pairing ? { status: asStatus(item.status), pairing } : null;
}

function episodeLabel(target: MediaTarget) {
  if (target.season === null || target.episode === null) return cleanText(target.title);
  const episode = `S${target.season} E${target.episode}`;
  return [episode, cleanText(target.title)].filter(Boolean).join(" · ");
}

function cleanText(value: string | null) {
  if (!value) return null;
  const cleaned = Array.from(value).filter((character) => !/\p{Cc}/u.test(character)).join("").trim();
  return cleaned ? Array.from(cleaned).slice(0, 512).join("") : null;
}

function finiteMilliseconds(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function finiteInteger(value: number | null) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function finiteVolume(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : null;
}

function safeCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
