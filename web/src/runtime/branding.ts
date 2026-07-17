import jstremioLogoSource from "../../../images/jstremio.png";

const BRAND_ATTRIBUTE = "data-jstremio-brand-logo";
const OFFICIAL_LOGO_FILE = "/images/stremio_symbol.png";

type OriginalLogo = {
  alt: string | null;
  src: string;
};

type ReconcileSubscriber = (callback: () => void) => () => void;

/**
 * Replaces only Stremio's application mark while preserving the official
 * image element, its layout, and the link/navigation behavior around it.
 */
export function createBrandingAdapter(
  onReconcile: ReconcileSubscriber,
  replacementSource = jstremioLogoSource,
) {
  const originals = new Map<HTMLImageElement, OriginalLogo>();
  let destroyed = false;
  let observing = false;

  const reconcile = () => {
    if (destroyed) return;
    if (!observing && document.documentElement) {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["src"],
        childList: true,
        subtree: true,
      });
      observing = true;
    }

    for (const image of document.querySelectorAll<HTMLImageElement>(
      `img[src], img[${BRAND_ATTRIBUTE}]`,
    )) {
      if (!isOfficialLogo(image) && !image.hasAttribute(BRAND_ATTRIBUTE)) continue;
      if (!originals.has(image)) {
        originals.set(image, {
          alt: image.getAttribute("alt"),
          src: image.getAttribute("src") ?? "",
        });
      }
      image.setAttribute(BRAND_ATTRIBUTE, "");
      if (image.getAttribute("src") !== replacementSource) image.setAttribute("src", replacementSource);
      if (image.getAttribute("alt") !== "JStremio") image.setAttribute("alt", "JStremio");
    }

    for (const image of originals.keys()) {
      if (!image.isConnected) originals.delete(image);
    }
  };

  const observer = new MutationObserver(reconcile);
  const unsubscribe = onReconcile(reconcile);
  reconcile();

  return {
    destroy() {
      destroyed = true;
      unsubscribe();
      observer.disconnect();
      for (const [image, original] of originals) {
        if (!image.isConnected || !image.hasAttribute(BRAND_ATTRIBUTE)) continue;
        image.setAttribute("src", original.src);
        if (original.alt === null) image.removeAttribute("alt");
        else image.setAttribute("alt", original.alt);
        image.removeAttribute(BRAND_ATTRIBUTE);
      }
      originals.clear();
    },
  };
}

function isOfficialLogo(image: HTMLImageElement): boolean {
  const source = image.getAttribute("src");
  if (!source) return false;
  try {
    return new URL(source, location.href).pathname.endsWith(OFFICIAL_LOGO_FILE);
  } catch {
    return false;
  }
}
