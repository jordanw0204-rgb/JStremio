import type { JStremioRuntime } from "../../runtime/types";
import {
  asInterfaces,
  asPairing,
  asStartResult,
  asStatus,
  PHONE_REMOTE_RUNNING_EVENT,
  phoneRemoteRequest,
  type PairingCode,
  type PhoneRemoteInterface,
  type PhoneRemoteStatus,
} from "./model";

export function mountPhoneRemotePage(container: HTMLElement, runtime: JStremioRuntime) {
  const page = document.createElement("section");
  page.className = "jstremio-phone-remote-page";
  page.innerHTML = `
    <header><div><p class="eyebrow">Built-in plugin</p><h1>Phone Remote</h1><p>Control the active player from a phone on the same private network.</p></div><span class="status-pill" data-status>Stopped</span></header>
    <div class="security-note"><strong>Trusted networks only</strong><span>The connection stays on your local network, but it is not encrypted. Do not use it on public Wi-Fi.</span></div>
    <div class="remote-grid">
      <section class="remote-card remote-setup"><h2>Connection</h2><label>Network interface<select data-interface aria-label="Network interface"></select></label><label class="trust"><input type="checkbox" data-trusted><span>I am on a trusted private network</span></label><div class="actions"><button type="button" class="primary" data-start>Start Remote</button><button type="button" data-stop disabled>Stop</button></div><p class="message" data-message aria-live="polite"></p></section>
      <section class="remote-card remote-pairing"><h2>Pair a phone</h2><div class="pair-placeholder" data-placeholder>Start the remote to generate a private pairing code.</div><div class="pair-content" data-pair hidden><img data-qr alt="Phone Remote pairing QR code"><p class="pair-url" data-url></p><p class="expires" data-expires></p><div class="actions"><button type="button" data-copy>Copy address</button><button type="button" data-new-code>New code</button></div></div></section>
      <section class="remote-card remote-sessions"><h2>Sessions</h2><dl><div><dt>Connected now</dt><dd data-clients>0</dd></div><div><dt>Paired sessions</dt><dd data-sessions>0</dd></div></dl><button type="button" data-disconnect disabled>Disconnect all</button></section>
    </div>
    <details><summary>Connection troubleshooting</summary><p>Allow JStremio through Windows Firewall on private networks, and make sure both devices are connected to the same Wi-Fi. JStremio never adds a firewall rule automatically.</p></details>`;
  container.append(page);

  const interfaceSelect = required<HTMLSelectElement>(page, "[data-interface]");
  const trusted = required<HTMLInputElement>(page, "[data-trusted]");
  const start = required<HTMLButtonElement>(page, "[data-start]");
  const stop = required<HTMLButtonElement>(page, "[data-stop]");
  const disconnect = required<HTMLButtonElement>(page, "[data-disconnect]");
  const newCode = required<HTMLButtonElement>(page, "[data-new-code]");
  const copy = required<HTMLButtonElement>(page, "[data-copy]");
  const pair = required<HTMLElement>(page, "[data-pair]");
  const placeholder = required<HTMLElement>(page, "[data-placeholder]");
  const qr = required<HTMLImageElement>(page, "[data-qr]");
  const url = required<HTMLElement>(page, "[data-url]");
  const expires = required<HTMLElement>(page, "[data-expires]");
  const message = required<HTMLElement>(page, "[data-message]");
  const statusLabel = required<HTMLElement>(page, "[data-status]");
  const clients = required<HTMLElement>(page, "[data-clients]");
  const sessions = required<HTMLElement>(page, "[data-sessions]");
  let status = asStatus(null);
  let pairing: PairingCode | null = null;
  let interfaces: PhoneRemoteInterface[] = [];
  let busy = false;
  let disposed = false;

  const setStatus = (next: PhoneRemoteStatus) => {
    status = next;
    window.dispatchEvent(new CustomEvent(PHONE_REMOTE_RUNNING_EVENT, { detail: status.running }));
  };

  const showError = (error: unknown) => {
    message.textContent = error instanceof Error ? error.message : "The local remote operation failed.";
    message.dataset.error = "";
  };
  const setMessage = (value: string) => {
    message.textContent = value;
    delete message.dataset.error;
  };
  const render = () => {
    statusLabel.textContent = status.running ? "Running" : "Stopped";
    statusLabel.toggleAttribute("data-running", status.running);
    clients.textContent = String(status.connectedClients);
    sessions.textContent = String(status.pairedSessions);
    interfaceSelect.disabled = busy || status.running;
    trusted.disabled = busy || status.running;
    start.disabled = busy || status.running || !trusted.checked || !interfaces.length;
    stop.disabled = busy || !status.running;
    disconnect.disabled = busy || !status.running || status.pairedSessions === 0;
    newCode.disabled = busy || !status.running;
    copy.disabled = busy || !pairing;
    pair.hidden = !pairing;
    placeholder.hidden = Boolean(pairing);
    if (pairing) {
      qr.src = pairing.qrDataUrl;
      url.textContent = redactPairingUrl(pairing.url);
      const remaining = Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - Date.now()) / 1_000));
      expires.textContent = remaining > 0 ? `Code expires in ${remaining}s` : "Code expired — generate a new one.";
    }
  };
  const refreshStatus = async () => {
    try {
      setStatus(asStatus(await phoneRemoteRequest(runtime, "status")));
      if (!status.running) pairing = null;
      render();
    } catch (error) {
      if (!disposed) showError(error);
    }
  };

  trusted.addEventListener("change", render);
  start.addEventListener("click", () => void run(async () => {
    const interfaceIp = interfaceSelect.value;
    if (!trusted.checked || !interfaces.some((item) => item.address === interfaceIp)) return;
    const result = asStartResult(await phoneRemoteRequest(runtime, "start", { interfaceIp }, 15_000));
    if (!result) throw new Error("The local remote returned an invalid response.");
    setStatus(result.status);
    pairing = result.pairing;
    setMessage("Remote started. Scan the code with your phone.");
  }));
  stop.addEventListener("click", () => void run(async () => {
    setStatus(asStatus(await phoneRemoteRequest(runtime, "stop", {}, 15_000)));
    pairing = null;
    setMessage("Remote stopped and all sessions were revoked.");
  }));
  disconnect.addEventListener("click", () => void run(async () => {
    setStatus(asStatus(await phoneRemoteRequest(runtime, "disconnectAll")));
    pairing = null;
    setMessage("All phone sessions were disconnected.");
  }));
  newCode.addEventListener("click", () => void run(async () => {
    pairing = asPairing(await phoneRemoteRequest(runtime, "newPairing"));
    if (!pairing) throw new Error("A new pairing code could not be created.");
    setMessage("The previous pairing code is no longer valid.");
  }));
  copy.addEventListener("click", () => void run(async () => {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.url);
    setMessage("Pairing address copied.");
  }), false);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    render();
    try { await action(); } catch (error) { showError(error); }
    finally { busy = false; render(); }
  }

  void phoneRemoteRequest(runtime, "interfaces")
    .then((value) => {
      interfaces = asInterfaces(value);
      interfaceSelect.replaceChildren(...interfaces.map((item) => {
        const option = document.createElement("option");
        option.value = item.address;
        option.textContent = `${item.name} · ${item.address}`;
        return option;
      }));
      if (!interfaces.length) setMessage("No private IPv4 network interface is available.");
      render();
    })
    .catch(showError);
  void refreshStatus();
  const poll = window.setInterval(() => void refreshStatus(), 2_000);
  const countdown = window.setInterval(render, 1_000);
  render();

  return () => {
    disposed = true;
    window.clearInterval(poll);
    window.clearInterval(countdown);
  };
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const value = root.querySelector<T>(selector);
  if (!value) throw new Error(`Phone Remote UI is missing ${selector}`);
  return value;
}

function redactPairingUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}/ · private one-time code`;
  } catch {
    return "Private one-time pairing address";
  }
}
