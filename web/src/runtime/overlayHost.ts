import type { RenderHost } from "./types";

type Mounted = {
  element: HTMLElement;
  cleanup: (() => void) | undefined;
  restoreFocus: Element | null;
};

const BASE_STYLE = `
:host { all: initial; color-scheme: dark; font-family: Inter, "Segoe UI", sans-serif; }
*, *::before, *::after { box-sizing: border-box; }
.surface { position: fixed; inset: 0; z-index: 2147483000; color: #fff; }
.overlay { background: rgba(13, 8, 24, .97); overflow: auto; }
.dialog-layer { display: grid; place-items: center; padding: 24px; background: rgba(0,0,0,.68); z-index: 2147483100; }
button, input, textarea { font: inherit; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;

const stopKeyboardPropagation = (event: Event) => event.stopPropagation();

export function createOverlayHost() {
  let rootHost: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let overlay: Mounted | null = null;
  let dialog: Mounted | null = null;

  const ensure = () => {
    if (rootHost?.isConnected && shadow) return shadow;
    rootHost = document.createElement("div");
    rootHost.dataset.jstremioExtension = "runtime";
    rootHost.dataset.jstremioTestid = "overlay-host";
    shadow = rootHost.attachShadow({ mode: "open" });
    // Keyboard events are composed across a Shadow DOM boundary by default. Let
    // controls receive them, then stop them here before Stremio's document-level
    // playback shortcuts see text-entry keystrokes.
    shadow.addEventListener("keydown", stopKeyboardPropagation);
    shadow.addEventListener("keypress", stopKeyboardPropagation);
    shadow.addEventListener("keyup", stopKeyboardPropagation);
    const style = document.createElement("style");
    style.textContent = BASE_STYLE;
    shadow.append(style);
    document.body.append(rootHost);
    return shadow;
  };

  const mount = (kind: "overlay" | "dialog", renderer: RenderHost) => {
    const target = ensure();
    if (kind === "overlay") closeOverlay();
    else closeDialog();
    const element = document.createElement("div");
    element.className = `surface ${kind === "overlay" ? "overlay" : "dialog-layer"}`;
    element.dataset.jstremioTestid = kind;
    if (kind === "dialog") {
      element.setAttribute("role", "presentation");
      element.addEventListener("mousedown", (event) => {
        if (event.target === element) closeDialog();
      });
    }
    target.append(element);
    const mounted: Mounted = { element, cleanup: undefined, restoreFocus: document.activeElement };
    if (kind === "overlay") overlay = mounted;
    else dialog = mounted;
    const close = kind === "overlay" ? closeOverlay : closeDialog;
    mounted.cleanup = renderer(element, close) || undefined;
    queueMicrotask(() => focusFirst(element));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const active = dialog ?? overlay;
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      (dialog ? closeDialog : closeOverlay)();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = getFocusable(active.element);
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    const activeElement = (active.element.getRootNode() as Document | ShadowRoot).activeElement;
    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKeyDown, true);

  function closeMounted(mounted: Mounted | null): null {
    if (!mounted) return null;
    mounted.cleanup?.();
    mounted.element.remove();
    if (mounted.restoreFocus instanceof HTMLElement && mounted.restoreFocus.isConnected) {
      mounted.restoreFocus.focus();
    }
    return null;
  }

  function closeOverlay() {
    dialog = closeMounted(dialog);
    overlay = closeMounted(overlay);
  }

  function closeDialog() {
    dialog = closeMounted(dialog);
  }

  return {
    publicApi: {
      openOverlay: (renderer: RenderHost) => mount("overlay", renderer),
      closeOverlay,
      openDialog: (renderer: RenderHost) => mount("dialog", renderer),
      closeDialog,
    },
    destroy() {
      closeOverlay();
      document.removeEventListener("keydown", onKeyDown, true);
      rootHost?.remove();
      rootHost = null;
      shadow = null;
    },
  };
}

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hidden);
}

function focusFirst(root: HTMLElement) {
  (getFocusable(root)[0] ?? root).focus?.();
}
