const OWNED = "[data-jstremio-extension]";

export function isPlayerRoute(): boolean {
  return /(?:#|\/)\/player(?:\/|$)/i.test(location.href);
}

export function findPrimaryNavigation(): HTMLElement | null {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
  const anchor = links.find((link) => /#\/(library|calendar)(?:\/|$)/i.test(link.getAttribute("href") ?? ""));
  if (anchor?.parentElement) return anchor.parentElement;
  return document.querySelector<HTMLElement>('nav, [role="navigation"]');
}

export function navigationTemplate(): HTMLElement | null {
  return document.querySelector<HTMLElement>('a[href*="#/library"], a[href*="#/calendar"]');
}

export function findPlayerControls(): HTMLElement | null {
  if (!isPlayerRoute()) return null;
  const toolbar = document.querySelector<HTMLElement>('[role="toolbar"]');
  if (toolbar) return toolbar;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter(
    (button) => !button.closest(OWNED),
  );
  const known = buttons.find((button) => /next|fullscreen|play|pause/i.test(accessibleName(button)));
  if (!known) return null;
  let candidate: HTMLElement | null = known.parentElement;
  while (candidate && candidate !== document.body) {
    if (candidate.querySelectorAll("button").length >= 3) return candidate;
    candidate = candidate.parentElement;
  }
  return known.parentElement;
}

export function findSeekContainer(): HTMLElement | null {
  if (!isPlayerRoute()) return null;
  const semantic = Array.from(
    document.querySelectorAll<HTMLElement>('[role="slider"], input[type="range"]'),
  ).find((element) => /seek|progress|position|time/i.test(accessibleName(element)));
  const slider = semantic ?? document.querySelector<HTMLElement>('[role="slider"], input[type="range"]');
  if (!slider) return null;
  return slider.parentElement;
}

export function copyIntegrationClasses(target: HTMLElement, template: HTMLElement | null) {
  if (template?.className && typeof template.className === "string") target.className = template.className;
}

export function accessibleName(element: Element): string {
  return [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.textContent,
  ]
    .filter(Boolean)
    .join(" ");
}
