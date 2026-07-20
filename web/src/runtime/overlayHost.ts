import type { RenderHost } from "./types";
import { findPrimaryNavigation } from "./compatibility";

type Mounted = {
  element: HTMLElement;
  cleanup: (() => void) | undefined;
  restoreFocus: Element | null;
};

const BASE_STYLE = `
:host { all: initial; color-scheme: dark; font-family: Inter, "Segoe UI", sans-serif; }
*, *::before, *::after { box-sizing: border-box; }
.surface { position: fixed; inset: 0; z-index: 2147483000; color: var(--jstremio-text-color, var(--primary-foreground-color, #fff)); }
.page { background: linear-gradient(var(--jstremio-gradient-angle, 41deg), var(--jstremio-background-start, #0c0b11), var(--jstremio-background-end, #1a173e)); overflow: auto; z-index: 2147482900; }
.overlay { background: linear-gradient(var(--jstremio-gradient-angle, 41deg), var(--jstremio-background-start, #0c0b11), var(--jstremio-background-end, #1a173e)); overflow: auto; }
.dialog-layer { display: grid; place-items: center; padding: 24px; background: transparent; z-index: 2147483100; }
button, input, textarea { font: inherit; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;

const stopKeyboardPropagation = (event: Event) => event.stopPropagation();

export function createOverlayHost() {
  let rootHost: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let page: Mounted | null = null;
  let overlay: Mounted | null = null;
  let dialog: Mounted | null = null;
  let activePageId: string | null = null;
  let pageLocation = "";

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

  const mount = (kind: "page" | "overlay" | "dialog", renderer: RenderHost, extensionId?: string) => {
    const target = ensure();
    if (kind === "page") {
      closeOverlay();
      closePage();
    } else if (kind === "overlay") {
      closePage();
      closeOverlay();
    } else closeDialog();
    const element = document.createElement("div");
    element.className = `surface ${kind === "dialog" ? "dialog-layer" : kind}`;
    element.dataset.jstremioTestid = kind;
    if (kind === "dialog") {
      element.setAttribute("role", "presentation");
      element.addEventListener("mousedown", (event) => {
        if (event.target === element) closeDialog();
      });
    }
    target.append(element);
    const mounted: Mounted = { element, cleanup: undefined, restoreFocus: document.activeElement };
    if (kind === "page") {
      page = mounted;
      activePageId = extensionId ?? null;
      pageLocation = location.href;
      if (activePageId) {
        element.dataset.jstremioPage = activePageId;
        document.documentElement.dataset.jstremioActivePage = activePageId;
      }
      syncNavigationSelection();
    } else if (kind === "overlay") overlay = mounted;
    else dialog = mounted;
    const close = kind === "page" ? closePage : kind === "overlay" ? closeOverlay : closeDialog;
    const positionCleanup = kind === "page" ? keepPageBesideNavigation(element) : undefined;
    const renderCleanup = renderer(element, close) || undefined;
    mounted.cleanup = () => {
      renderCleanup?.();
      positionCleanup?.();
    };
    queueMicrotask(() => focusFirst(element));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const active = dialog ?? overlay ?? page;
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (dialog) closeDialog();
      else if (overlay) closeOverlay();
      else closePage();
      return;
    }
    if (page && !dialog && !overlay) return;
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
  const onRouteChange = () => {
    if (page && location.href !== pageLocation) closePage();
  };
  const onNavigationClick = (event: MouseEvent) => {
    if (!page || !(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLElement>('a[href], button, [role="button"], [tabindex]');
    if (!control || control.closest('[data-jstremio-extension]')) return;
    const navigation = findPrimaryNavigation();
    if (!navigation?.contains(control)) return;
    // Stremio can change its route through application state/history APIs that
    // do not emit hashchange or popstate. Let its click handler finish first,
    // then reveal the selected official page without restoring focus to the
    // custom button that opened this surface.
    queueMicrotask(() => {
      if (page) closePage(false);
    });
  };
  window.addEventListener("hashchange", onRouteChange);
  window.addEventListener("popstate", onRouteChange);
  document.addEventListener("click", onNavigationClick, true);

  function closeMounted(mounted: Mounted | null, restoreFocus = true): null {
    if (!mounted) return null;
    mounted.cleanup?.();
    mounted.element.remove();
    if (restoreFocus && mounted.restoreFocus instanceof HTMLElement && mounted.restoreFocus.isConnected) {
      mounted.restoreFocus.focus();
    }
    return null;
  }

  function closeOverlay() {
    dialog = closeMounted(dialog);
    overlay = closeMounted(overlay);
  }

  function closePage(restoreFocus = true) {
    dialog = closeMounted(dialog);
    page = closeMounted(page, restoreFocus);
    activePageId = null;
    pageLocation = "";
    delete document.documentElement.dataset.jstremioActivePage;
    syncNavigationSelection();
  }

  function closeDialog() {
    dialog = closeMounted(dialog);
  }

  return {
    publicApi: {
      openPage: (extensionId: string, renderer: RenderHost) => mount("page", renderer, extensionId),
      closePage,
      openOverlay: (renderer: RenderHost) => mount("overlay", renderer),
      closeOverlay,
      openDialog: (renderer: RenderHost) => mount("dialog", renderer),
      closeDialog,
    },
    destroy() {
      closeOverlay();
      closePage();
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("click", onNavigationClick, true);
      window.removeEventListener("hashchange", onRouteChange);
      window.removeEventListener("popstate", onRouteChange);
      rootHost?.remove();
      rootHost = null;
      shadow = null;
    },
  };

  function syncNavigationSelection() {
    document.querySelectorAll<HTMLElement>('[data-jstremio-control="navigation"][data-jstremio-extension]').forEach((button) => {
      const active = Boolean(activePageId && button.dataset.jstremioExtension === activePageId);
      button.classList.toggle("selected", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }
}

function keepPageBesideNavigation(element: HTMLElement): () => void {
  let resizeObserver: ResizeObserver | null = null;
  let observedNavigation: HTMLElement | null = null;
  let scheduled = false;
  const sync = () => {
    scheduled = false;
    const navigation = findPrimaryNavigation();
    if (navigation !== observedNavigation) {
      resizeObserver?.disconnect();
      observedNavigation = navigation;
      if (navigation && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(navigation);
      }
    }
    const inset = navigation ? navigationInset(navigation) : 0;
    element.style.left = `${inset}px`;
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 16)))(sync);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", schedule);
  sync();
  return () => {
    observer.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener("resize", schedule);
  };
}

function navigationInset(navigation: HTMLElement): number {
  const bounds = navigation.getBoundingClientRect();
  const maximumRailWidth = Math.min(240, window.innerWidth * 0.35);
  if (bounds.width > 0 && bounds.width <= maximumRailWidth && bounds.left <= 32) {
    return Math.max(0, Math.ceil(bounds.right));
  }
  const controlEdges = Array.from(
    navigation.querySelectorAll<HTMLElement>('a[href], button, [role="button"]'),
  )
    .map((control) => control.getBoundingClientRect())
    .filter((control) => control.width > 0 && control.left <= 32 && control.right <= maximumRailWidth)
    .map((control) => control.right);
  return Math.max(0, Math.ceil(controlEdges.length ? Math.max(...controlEdges) : 0));
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
