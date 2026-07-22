import styles from "./styles.css";
import { findNextVideoPopup, isPlayerRoute } from "../../runtime/compatibility";
import { registerPluginHotkey } from "../../runtime/hotkeys";
import type { JStremioRuntime, MediaTarget } from "../../runtime/types";
import {
  addStyles,
  mediaCollectionKey,
  mediaCollectionTitle,
  mediaLabel,
  mountNavigationButton,
  mountPlayerButton,
  removeOwned,
  requireRuntime,
  targetPayload,
  viewInStremio,
} from "../shared";
import { MAX_RATING, normalizeRating, ratingAriaLabel, ratingStars } from "../ratings";

type Review = ReturnType<typeof targetPayload> & {
  id: string;
  rating: number;
  text: string;
  createdAt: string;
  updatedAt: string;
};

const manifest = {
  schemaVersion: 1,
  id: "reviews",
  name: "Local Reviews",
  version: "1.5.1",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 100,
} as const;

const REVIEW_SETTINGS_CHANGED = "jstremio-review-settings-changed";

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let overlayRefresh: (() => void) | null = null;
  let playerRoute = "";
  let resolvedPlayerTarget: MediaTarget | null = null;
  let autoOpenAtEnd = true;
  let settingsLoaded = false;
  let endPromptWasVisible = false;
  const reviewCache = new Map<string, Review | null>();
  const reviewLoads = new Map<string, Promise<Review | null>>();
  const loadReview = (target: MediaTarget): Promise<Review | null> => {
    if (reviewCache.has(target.key)) return Promise.resolve(reviewCache.get(target.key)!);
    const active = reviewLoads.get(target.key);
    if (active) return active;
    const pending = runtime.bridge.request("reviews", "get", { id: target.key })
      .then((value) => {
        const review = asReview(value);
        reviewCache.set(target.key, review);
        return review;
      })
      .finally(() => reviewLoads.delete(target.key));
    reviewLoads.set(target.key, pending);
    return pending;
  };
  const openPlayerReview = () => {
    const target = resolvedPlayerTarget;
    if (!target) return;
    const source = reviewCache.has(target.key) ? reviewCache.get(target.key)! : loadReview(target);
    openReviewDialog(runtime, target, source, () => {
      reviewCache.delete(target.key);
      overlayRefresh?.();
    });
  };
  const maybeOpenEndReview = () => {
    const promptVisible = isPlayerRoute() && findNextVideoPopup() !== null;
    if (!promptVisible) {
      endPromptWasVisible = false;
      return;
    }
    if (!settingsLoaded || !autoOpenAtEnd || endPromptWasVisible || !resolvedPlayerTarget) return;
    endPromptWasVisible = true;
    openPlayerReview();
  };
  const unregisterHotkey = registerPluginHotkey(
    runtime,
    "reviews",
    openPlayerReview,
    () => isPlayerRoute() && Boolean(document.querySelector(
      '[data-jstremio-extension="reviews"][data-jstremio-control="player"]:not([disabled])',
    )),
  );

  const openPage = () => {
    runtime.ui.openPage("reviews", (container) => {
      addStyles(container, styles);
      const shell = document.createElement("main");
      shell.className = "reviews-shell";
      shell.innerHTML = `
        <header class="reviews-header"><div><h1 tabindex="-1">Local Reviews</h1><p>Private ratings and notes stored only on this computer.</p></div></header>
        <div class="toolbar"><button class="button" data-action="back" hidden>← Back to titles</button><input class="search" type="search" placeholder="Search titles or review text" aria-label="Search local reviews"><button class="button" data-action="refresh">Refresh</button><button class="button" data-action="folder">Open data folder</button></div>
        <section class="status" role="status">Loading reviews…</section><section class="review-grid" hidden></section>`;
      container.append(shell);
      const status = shell.querySelector<HTMLElement>(".status")!;
      const grid = shell.querySelector<HTMLElement>(".review-grid")!;
      const heading = shell.querySelector<HTMLHeadingElement>("h1")!;
      const back = shell.querySelector<HTMLButtonElement>('[data-action="back"]')!;
      const search = shell.querySelector<HTMLInputElement>(".search")!;
      let reviews: Review[] = [];
      let selectedCollection: string | null = null;
      const render = () => {
        if (selectedCollection && !reviews.some((review) => mediaCollectionKey(review) === selectedCollection)) {
          selectedCollection = null;
        }
        const query = search.value.trim().toLocaleLowerCase();
        const filtered = reviews.filter((review) =>
          [review.name, review.title, review.text, review.videoId]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(query)),
        );
        const visible = selectedCollection
          ? filtered.filter((review) => mediaCollectionKey(review) === selectedCollection)
          : filtered;
        if (selectedCollection) {
          const first = reviews.find((review) => mediaCollectionKey(review) === selectedCollection)!;
          heading.textContent = mediaCollectionTitle(first);
          back.hidden = false;
          renderReviews(runtime, grid, visible, () => void load());
        } else {
          heading.textContent = "Local Reviews";
          back.hidden = true;
          renderReviewCollections(grid, visible, (key) => {
            selectedCollection = key;
            search.value = "";
            render();
            heading.focus();
          });
        }
        grid.hidden = visible.length === 0;
        status.hidden = visible.length > 0;
        status.textContent = reviews.length
          ? visible.length
            ? ""
            : "No reviews match this search."
          : "No reviews yet. Open a movie or episode and use the star button.";
      };
      back.addEventListener("click", () => {
        selectedCollection = null;
        search.value = "";
        render();
        heading.focus();
      });
      search.addEventListener("input", render);
      shell.querySelector('[data-action="refresh"]')?.addEventListener("click", () => void load());
      shell.querySelector('[data-action="folder"]')?.addEventListener("click", () => {
        void runtime.bridge.request("reviews", "openDataFolder").catch((error) => showError(status, error));
      });

      const load = async () => {
        status.hidden = false;
        status.textContent = "Loading reviews…";
        grid.hidden = true;
        try {
          reviews = asReviews(await runtime.bridge.request("reviews", "list"));
          render();
        } catch (error) {
          showError(status, error);
        }
      };
      overlayRefresh = () => void load();
      void load();
      return () => {
        overlayRefresh = null;
      };
    });
  };

  const reconcile = () => {
    mountNavigationButton("reviews", "Reviews", STAR_ICON, openPage);
    const existing = document.querySelector<HTMLButtonElement>(
      '[data-jstremio-extension="reviews"][data-jstremio-control="player"]',
    );
    if (!isPlayerRoute()) {
      existing?.remove();
      playerRoute = "";
      resolvedPlayerTarget = null;
      endPromptWasVisible = false;
      return;
    }
    const route = location.hash;
    if (route !== playerRoute) {
      playerRoute = route;
      resolvedPlayerTarget = null;
      endPromptWasVisible = false;
    }
    const button = mountPlayerButton("reviews", "Review this title", STAR_ICON, () => {
      void openPlayerReview();
    });
    setReviewButtonAvailability(button, resolvedPlayerTarget !== null);
    void runtime.stremio.getCurrentMediaTarget().then((target) => {
      if (route !== location.hash || !isPlayerRoute()) return;
      if (target) {
        resolvedPlayerTarget = target;
        setReviewButtonAvailability(button, true);
        void loadReview(target).catch((error) => runtime.diagnostics.report("reviews", error));
        maybeOpenEndReview();
      } else if (!resolvedPlayerTarget) {
        setReviewButtonAvailability(button, false);
      }
    });
    maybeOpenEndReview();
  };

  const onSettingsChanged = (event: Event) => {
    const value = (event as CustomEvent<{ autoOpenAtEnd?: unknown }>).detail?.autoOpenAtEnd;
    autoOpenAtEnd = value !== false;
    if (!autoOpenAtEnd) endPromptWasVisible = false;
    maybeOpenEndReview();
  };
  window.addEventListener(REVIEW_SETTINGS_CHANGED, onSettingsChanged);
  const unsubscribe = runtime.lifecycle.onReconcile(reconcile);
  void runtime.bridge.request("plugins", "getReviewSettings")
    .then((value) => {
      autoOpenAtEnd = !value || typeof value !== "object"
        ? true
        : (value as { autoOpenAtEnd?: unknown }).autoOpenAtEnd !== false;
      settingsLoaded = true;
      maybeOpenEndReview();
    })
    .catch((error) => runtime.diagnostics.report("reviews", error));
  return () => {
    unsubscribe();
    unregisterHotkey();
    window.removeEventListener(REVIEW_SETTINGS_CHANGED, onSettingsChanged);
    runtime.ui.closePage();
    removeOwned("reviews");
  };
}

function setReviewButtonAvailability(button: HTMLButtonElement | null, available: boolean) {
  if (!button) return;
  button.disabled = !available;
  const reason = "No stable movie or episode is active.";
  button.title = available ? "Review this title" : reason;
  button.setAttribute("aria-label", available ? "Review this title" : `Reviews unavailable: ${reason}`);
  button.style.opacity = available ? "1" : ".48";
  button.style.cursor = available ? "pointer" : "not-allowed";
}

function openReviewDialog(
  runtime: JStremioRuntime,
  target: MediaTarget,
  source: Review | null | Promise<Review | null>,
  changed: () => void,
) {
  runtime.ui.openDialog((container, close) => {
    addStyles(container, styles);
    const form = document.createElement("form");
    form.className = "dialog";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    form.setAttribute("aria-labelledby", "jstremio-review-title");
    container.append(form);

    const renderEditor = (existing: Review | null) => {
      if (!form.isConnected) return;
      form.removeAttribute("aria-busy");
      form.innerHTML = `
        <h2 id="jstremio-review-title">${existing ? "Update review" : "Add review"}</h2>
        <p class="subtitle"></p>
        <fieldset class="field"><legend>Rating (required)</legend><div class="stars" role="radiogroup"></div></fieldset>
        <label class="field">Private review<textarea maxlength="5000"></textarea><span class="count">0 / 5000</span></label>
        <div class="alert" role="alert" aria-live="polite"></div>
        <div class="dialog-actions">${existing ? '<button type="button" class="button danger" data-action="delete">Delete</button>' : ""}<button type="button" class="button" data-action="cancel">Cancel</button><button class="button primary" type="submit">${existing ? "Update" : "Save"}</button></div>`;
      form.querySelector<HTMLElement>(".subtitle")!.textContent = mediaLabel(target);
      const stars = form.querySelector<HTMLElement>(".stars")!;
      for (let rating = 1; rating <= MAX_RATING; rating += 1) {
        const label = document.createElement("label");
        label.className = "star-option";
        label.innerHTML = `<input type="radio" name="rating" value="${rating}" aria-label="${rating} star${rating === 1 ? "" : "s"}"><span aria-hidden="true">★</span>`;
        stars.append(label);
      }
      if (existing) {
        const radio = form.querySelector<HTMLInputElement>(`input[value="${existing.rating}"]`);
        if (radio) radio.checked = true;
      }
      const syncStars = () => {
        const selected = normalizeRating(Number(new FormData(form).get("rating"))) ?? 0;
        stars.querySelectorAll<HTMLElement>(".star-option").forEach((option, index) => {
          option.classList.toggle("selected", index < selected);
        });
      };
      stars.addEventListener("change", syncStars);
      syncStars();
      const textarea = form.querySelector<HTMLTextAreaElement>("textarea")!;
      const count = form.querySelector<HTMLElement>(".count")!;
      const alert = form.querySelector<HTMLElement>(".alert")!;
      textarea.value = existing?.text ?? "";
      const updateCount = () => {
        count.textContent = `${Array.from(textarea.value).length} / 5000`;
      };
      textarea.addEventListener("input", updateCount);
      updateCount();
      form.querySelector('[data-action="cancel"]')?.addEventListener("click", close);
      form.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
        if (!existing) return;
        void runtime.bridge.request("reviews", "delete", { id: existing.id }).then(() => {
          changed();
          close();
        }).catch((error) => showError(alert, error));
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const rating = normalizeRating(Number(new FormData(form).get("rating")));
        if (rating === null) {
          alert.textContent = `Choose a rating from 1 to ${MAX_RATING}.`;
          return;
        }
        alert.textContent = "";
        void runtime.bridge
          .request("reviews", "upsert", { ...targetPayload(target), rating, text: textarea.value })
          .then(() => {
            changed();
            close();
          })
          .catch((error) => showError(alert, error));
      });
    };

    if (source instanceof Promise) {
      form.setAttribute("aria-busy", "true");
      form.innerHTML = `
        <div class="dialog-loading" role="status">
          <span class="loading-indicator" aria-hidden="true"></span>
          <strong id="jstremio-review-title">Loading your review…</strong>
          <button type="button" class="button" data-action="cancel">Cancel</button>
        </div>`;
      form.querySelector('[data-action="cancel"]')?.addEventListener("click", close);
      void source.then(renderEditor).catch((error) => {
        if (!form.isConnected) return;
        form.removeAttribute("aria-busy");
        form.innerHTML = `
          <div class="dialog-loading">
            <strong id="jstremio-review-title">Review unavailable</strong>
            <div class="alert" role="alert"></div>
            <button type="button" class="button" data-action="cancel">Close</button>
          </div>`;
        showError(form.querySelector<HTMLElement>(".alert")!, error);
        form.querySelector('[data-action="cancel"]')?.addEventListener("click", close);
      });
    } else {
      renderEditor(source);
    }
  });
}

function renderReviewCollections(
  grid: HTMLElement,
  reviews: Review[],
  select: (collectionKey: string) => void,
) {
  grid.replaceChildren();
  const collections = new Map<string, Review[]>();
  for (const review of reviews) {
    const key = mediaCollectionKey(review);
    const collection = collections.get(key) ?? [];
    collection.push(review);
    collections.set(key, collection);
  }
  for (const [key, collection] of collections) {
    const first = collection[0]!;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "collection-card";
    card.setAttribute("aria-label", `Open ${mediaCollectionTitle(first)}, ${collection.length} ${collection.length === 1 ? "review" : "reviews"}`);
    const artwork = document.createElement("span");
    artwork.className = "collection-artwork";
    if (first.poster) {
      const image = document.createElement("img");
      image.className = "collection-poster";
      image.src = first.poster;
      image.alt = "";
      image.loading = "lazy";
      artwork.append(image);
    }
    const body = document.createElement("span");
    body.className = "collection-body";
    const title = document.createElement("strong");
    title.textContent = mediaCollectionTitle(first);
    const count = document.createElement("span");
    count.textContent = `${collection.length} ${collection.length === 1 ? "review" : "reviews"}`;
    const episodes = new Set(collection.filter((review) => review.mediaType === "series").map((review) => review.videoId));
    const detail = document.createElement("span");
    detail.textContent = episodes.size ? `${episodes.size} ${episodes.size === 1 ? "episode" : "episodes"}` : "Movie";
    body.append(title, count, detail);
    card.append(artwork, body);
    card.addEventListener("click", () => select(key));
    grid.append(card);
  }
}

function renderReviews(runtime: JStremioRuntime, grid: HTMLElement, reviews: Review[], refresh: () => void) {
  grid.replaceChildren();
  for (const review of reviews) {
    const target = reviewTarget(review);
    const card = document.createElement("article");
    card.className = "review-card";
    const poster = document.createElement("div");
    if (review.poster) {
      const image = document.createElement("img");
      image.className = "poster";
      image.alt = "";
      image.loading = "lazy";
      image.src = review.poster;
      poster.append(image);
    }
    const body = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = review.mediaType === "series"
      ? review.title || `Season ${review.season ?? "?"}, Episode ${review.episode ?? "?"}`
      : mediaCollectionTitle(review);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = review.mediaType === "series"
      ? `S${review.season ?? "?"} E${review.episode ?? "?"}`
      : "Movie";
    const rating = document.createElement("div");
    rating.className = "rating";
    rating.setAttribute("aria-label", ratingAriaLabel(review.rating));
    rating.textContent = ratingStars(review.rating);
    const text = document.createElement("p");
    text.className = "review-text";
    text.textContent = review.text || "No written review.";
    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      action("View in Stremio", () => viewInStremio(runtime, target)),
      action("Edit", () => openReviewDialog(runtime, target, review, refresh)),
      action("Delete", () => {
        void runtime.bridge.request("reviews", "delete", { id: review.id }).then(refresh);
      }, "danger"),
    );
    body.append(title, meta, rating, text, actions);
    card.append(poster, body);
    grid.append(card);
  }
}

function action(label: string, onClick: () => void, extra = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${extra}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function reviewTarget(review: Review): MediaTarget {
  return {
    key: review.id,
    videoId: review.videoId,
    metaId: review.metaId,
    mediaType: review.mediaType,
    name: review.name,
    title: review.title,
    season: review.season,
    episode: review.episode,
    poster: review.poster,
  };
}

function asReviews(value: unknown): Review[] {
  return Array.isArray(value) ? value.filter((item): item is Review => asReview(item) !== null) : [];
}

function asReview(value: unknown): Review | null {
  if (!value || typeof value !== "object") return null;
  const review = value as Partial<Review>;
  return typeof review.id === "string" && normalizeRating(review.rating) !== null ? (review as Review) : null;
}

function showError(target: HTMLElement, error: unknown) {
  target.hidden = false;
  target.textContent = error instanceof Error ? error.message : "The local review operation failed.";
}

const STAR_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="m12 2.3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.1l6.5-.9L12 2.3Z"/></svg>';
