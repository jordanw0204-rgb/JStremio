export type MiniPlayerUiState = {
  enabled: boolean;
  busy: boolean;
};

export function syncMiniPlayerUiState(
  root: HTMLElement,
  playerButton: HTMLButtonElement | null,
  restoreButton: HTMLButtonElement | null,
  state: MiniPlayerUiState,
) {
  syncFlag(root, "data-jstremio-mini-player", state.enabled);

  if (playerButton) {
    const label = state.enabled ? "Return to full window" : "Open always-on-top mini player";
    syncDisabled(playerButton, state.busy);
    syncAttribute(playerButton, "aria-pressed", String(state.enabled));
    syncAttribute(playerButton, "aria-label", label);
    if (playerButton.title !== label) playerButton.title = label;
  }

  if (restoreButton) syncDisabled(restoreButton, state.busy);
}

function syncFlag(element: HTMLElement, name: string, enabled: boolean) {
  if (element.hasAttribute(name) === enabled) return;
  if (enabled) element.setAttribute(name, "");
  else element.removeAttribute(name);
}

function syncAttribute(element: HTMLElement, name: string, value: string) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function syncDisabled(button: HTMLButtonElement, disabled: boolean) {
  if (button.disabled !== disabled) button.disabled = disabled;
}
