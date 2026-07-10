const OWNED = "[data-jstremio-extension]";
const INTERACTIVE = 'button, [role="button"], [tabindex], a[href]';
const STRUCTURAL_SLIDER_SIGNAL = '[style*="--mask-width"], [style*="margin-left"]';

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
  const controls = interactiveElements(document);
  const known = controls.find((control) => /next|fullscreen|play|pause/i.test(accessibleName(control)));
  if (known) {
    let candidate: HTMLElement | null = known.parentElement;
    while (candidate && candidate !== document.body) {
      if (interactiveElements(candidate).length >= 3) return candidate;
      candidate = candidate.parentElement;
    }
  }
  const related = findControlsBesideStructuralSeek();
  if (related) return related;
  return document.querySelector<HTMLElement>('[class*="control-bar-buttons-container"]');
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

function interactiveElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(INTERACTIVE)).filter(
    (element) => !element.closest(OWNED),
  );
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
