const OWNED = "[data-jstremio-extension]";
const INTERACTIVE = 'button, [role="button"], [tabindex], a[href]';
const STRUCTURAL_SLIDER_SIGNAL = '[style*="--mask-width"], [style*="margin-left"]';
export const PLAYER_OVERLAY_HIDDEN_SELECTOR = '[class*="overlayHidden"]';

export function isPlayerRoute(): boolean {
  return /(?:#|\/)\/player(?:\/|$)/i.test(location.href);
}

export function isPlayerOverlayHidden(): boolean {
  return document.querySelector(PLAYER_OVERLAY_HIDDEN_SELECTOR) !== null;
}

export function findPrimaryNavigation(): HTMLElement | null {
  const controls = Array.from(document.querySelectorAll<HTMLElement>(INTERACTIVE)).filter(
    (element) => !element.closest(OWNED),
  );
  const routeAnchor = controls.find((control) => {
    const href = control.getAttribute("href") ?? "";
    return /#\/(?:library|calendar)(?:\/|$)/i.test(href) && !isHiddenInTree(control);
  });
  if (routeAnchor?.parentElement) return routeAnchor.parentElement;

  const signals = controls.filter((control) => {
    const href = control.getAttribute("href") ?? "";
    return !isHiddenInTree(control) && (
      /#\/(?:home|board|discover|library|calendar|addons?|settings)(?:\/|$)/i.test(href)
      || /\b(?:home|board|discover|library|calendar|addons?|settings)\b/i.test(navigationSignalName(control))
    );
  });
  const semantic = Array.from(document.querySelectorAll<HTMLElement>('nav, [role="navigation"]'))
    .filter((candidate) => !isHiddenInTree(candidate) && signals.some((signal) => candidate.contains(signal)))
    .map((candidate) => ({ candidate, score: navigationScore(candidate, signals) }))
    .sort((left, right) => right.score - left.score)[0]?.candidate;
  if (semantic && navigationScore(semantic, signals) > 0) return semantic;

  return closestCommonAncestor(signals);
}

export function navigationTemplate(navigation: ParentNode | null = findPrimaryNavigation()): HTMLElement | null {
  if (!navigation) return null;
  return navigation.querySelector<HTMLElement>(
    'a[href*="#/library"], a[href*="#/calendar"], a[href*="#/home"], button:not([data-jstremio-extension]), [role="button"]:not([data-jstremio-extension])',
  );
}

export function copyNavigationPresentation(target: HTMLElement, template: HTMLElement | null) {
  copyIntegrationClasses(target, template);
  target.classList.remove("selected");
  const sourceIcon = template?.querySelector("svg, [class*=\"icon\"]") ?? null;
  const targetIcon = target.querySelector('[data-jstremio-navigation-icon]');
  copyIntegrationClasses(targetIcon, sourceIcon);
  const sourceLabel = template
    ? Array.from(template.children).find((child) => child.getAttribute("class")?.includes("label")) ?? null
    : null;
  const targetLabel = target.querySelector('[data-jstremio-navigation-label]');
  copyIntegrationClasses(targetLabel, sourceLabel);
}

export function findPlayerControls(): HTMLElement | null {
  if (!isPlayerRoute()) return null;
  // Stremio's player control bar uses a CSS-module class, while its top
  // navigation may expose role="toolbar". Prefer the player-specific class so
  // extensions do not mount beside the back/fullscreen navigation controls.
  const stremioControlBar = document.querySelector<HTMLElement>(
    '[class*="control-bar-buttons-container"]',
  );
  if (stremioControlBar) return stremioControlBar;
  const related = findControlsBesideStructuralSeek();
  if (related) return related;
  const controls = interactiveElements(document);
  const known = controls.find((control) =>
    /\b(?:play|pause|next video|mute|unmute)\b/i.test(accessibleName(control)),
  );
  if (known) {
    let candidate: HTMLElement | null = known.parentElement;
    while (candidate && candidate !== document.body) {
      if (interactiveElements(candidate).length >= 3) return candidate;
      candidate = candidate.parentElement;
    }
  }
  return document.querySelector<HTMLElement>('[role="toolbar"]');
}

export function findSeekContainer(): HTMLElement | null {
  if (!isPlayerRoute()) return null;
  const semantic = Array.from(
    document.querySelectorAll<HTMLElement>('[role="slider"], input[type="range"]'),
  ).find((element) => /seek|progress|position|time/i.test(accessibleName(element)));
  const slider = semantic ?? document.querySelector<HTMLElement>('[role="slider"], input[type="range"]');
  if (slider) return slider.parentElement;

  const controls = findPlayerControls();
  const root = controls?.parentElement ?? document;
  const candidates = structuralSliderCandidates(root);
  const outsideControls = controls
    ? candidates.filter((candidate) => !controls.contains(candidate))
    : candidates;
  const structural = highestScoringSlider(outsideControls.length ? outsideControls : candidates);
  if (structural) return structural;

  return document.querySelector<HTMLElement>(
    '[class*="seek-bar"] [class*="slider-container"], [class*="seek-bar"] [class*="slider"]',
  );
}

export function playerControlTemplate(controls: HTMLElement): HTMLElement | null {
  return interactiveElements(controls)[0] ?? null;
}

export function copyIntegrationClasses(target: Element | null, template: Element | null) {
  const className = template?.getAttribute("class");
  if (target && className) target.setAttribute("class", className);
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

export function findNextVideoPopup(): HTMLElement | null {
  if (!isPlayerRoute()) return null;
  const official = Array.from(
    document.querySelectorAll<HTMLElement>('[class*="next-video-popup-container"]'),
  ).find((element) => !element.closest(OWNED) && !isHiddenInTree(element));
  if (official) return official;

  const controls = interactiveElements(document);
  const watch = controls.find((element) => /^watch now$/i.test(accessibleName(element).trim()));
  const dismiss = controls.find((element) => /^dismiss$/i.test(accessibleName(element).trim()));
  if (!watch || !dismiss) return null;
  let host = watch.parentElement;
  while (host && host !== document.body) {
    const bounds = host.getBoundingClientRect();
    if (
      host.contains(dismiss)
      && /\b(?:coming up )?next on\b/i.test(host.textContent ?? "")
      && bounds.width > 0
      && bounds.height > 0
      && !isHiddenInTree(host)
    ) {
      return host;
    }
    host = host.parentElement;
  }
  return null;
}

export function findNextVideoTitle(popup: HTMLElement | null = findNextVideoPopup()): HTMLElement | null {
  if (!popup) return null;
  const official = popup.querySelector<HTMLElement>(
    '[class*="details-container"] > [class*="title"]',
  );
  if (official) return official;
  return Array.from(popup.querySelectorAll<HTMLElement>("*")).find((element) =>
    element.children.length === 0 && /\(\s*S\d+\s*E\d+\s*\)\s*$/i.test(element.textContent ?? ""),
  ) ?? null;
}

function interactiveElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(INTERACTIVE)).filter(
    (element) => !element.closest(OWNED),
  );
}

function navigationScore(candidate: HTMLElement, signals: HTMLElement[]): number {
  const containedSignals = signals.filter((signal) => candidate.contains(signal)).length;
  const officialControls = interactiveElements(candidate).length;
  const bounds = candidate.getBoundingClientRect();
  const hasLayout = bounds.width > 0 || bounds.height > 0;
  let score = containedSignals * 100 - Math.max(0, officialControls - containedSignals) * 12;
  if (candidate.matches('nav, [role="navigation"]')) score += 25;
  if (hasLayout) {
    if (bounds.left <= 24) score += 35;
    if (bounds.width > 0 && bounds.width <= 180) score += 35;
    else if (bounds.width > 320) score -= 120;
    if (bounds.height >= window.innerHeight * 0.45) score += 20;
    const presentation = getComputedStyle(candidate);
    if (presentation.display === "none" || presentation.visibility === "hidden") score -= 500;
  }
  return score;
}

function navigationSignalName(control: HTMLElement): string {
  const explicit = [control.getAttribute("aria-label"), control.getAttribute("title")].filter(Boolean).join(" ");
  if (explicit) return explicit;
  const text = control.textContent?.trim() ?? "";
  return text.length <= 40 ? text : "";
}

function isHiddenInTree(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return true;
    current = current.parentElement;
  }
  return false;
}

function closestCommonAncestor(elements: HTMLElement[]): HTMLElement | null {
  if (!elements.length) return null;
  let candidate = elements[0]!.parentElement;
  while (candidate && candidate !== document.body) {
    if (elements.every((element) => candidate!.contains(element))) return candidate;
    candidate = candidate.parentElement;
  }
  return null;
}

function structuralSliderCandidates(root: ParentNode): HTMLElement[] {
  const candidates = new Set<HTMLElement>();
  root.querySelectorAll<HTMLElement>(STRUCTURAL_SLIDER_SIGNAL).forEach((signal) => {
    const candidate = signal.parentElement?.parentElement;
    if (candidate && candidate.children.length >= 3) candidates.add(candidate);
  });
  root.querySelectorAll<HTMLElement>('[class*="slider-container"]').forEach((candidate) => {
    if (candidate.children.length >= 3) candidates.add(candidate);
  });
  return Array.from(candidates);
}

function highestScoringSlider(candidates: HTMLElement[]): HTMLElement | null {
  return candidates
    .map((candidate) => ({ candidate, score: sliderScore(candidate) }))
    .sort((left, right) => right.score - left.score)[0]?.candidate ?? null;
}

function sliderScore(candidate: HTMLElement): number {
  const context = candidate.parentElement;
  const timeLabels = context?.textContent?.match(/\b\d{1,3}:\d{2}(?::\d{2})?\b/g)?.length ?? 0;
  const classHint = `${candidate.className} ${context?.className ?? ""}`;
  return timeLabels * 100 + (/seek/i.test(classHint) ? 50 : 0) + candidate.getBoundingClientRect().width;
}

function findControlsBesideStructuralSeek(): HTMLElement | null {
  const sliders = structuralSliderCandidates(document).sort(
    (left, right) => sliderScore(right) - sliderScore(left),
  );
  for (const slider of sliders) {
    const seekBar = slider.parentElement;
    const controlBar = seekBar?.parentElement;
    if (!seekBar || !controlBar) continue;
    const sibling = Array.from(controlBar.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== seekBar)
      .sort((left, right) => interactiveElements(right).length - interactiveElements(left).length)
      .find((element) => interactiveElements(element).length >= 3);
    if (sibling) return sibling;
  }
  return null;
}
