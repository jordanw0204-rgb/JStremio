import styles from "./styles.css";
import type { JStremioRuntime, MediaTarget } from "../../runtime/types";
import {
  addStyles,
  mediaLabel,
  mountNavigationButton,
  mountPlayerButton,
  removeOwned,
  requireRuntime,
  targetPayload,
  viewInStremio,
} from "../shared";

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
  version: "1.0.0",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 100,
} as const;

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  let overlayRefresh: (() => void) | null = null;
  let targetGeneration = 0;

  const openOverlay = () => {
    runtime.ui.openOverlay((container, close) => {
      addStyles(container, styles);
      const shell = document.createElement("main");
      shell.className = "reviews-shell";
      shell.innerHTML = `
        <header class="reviews-header"><div><h1>Local Reviews</h1><p>Private ratings and notes stored only on this computer.</p></div><button class="button icon-button" data-action="close" aria-label="Close Reviews">×</button></header>
        <div class="toolbar"><button class="button" data-action="refresh">Refresh</button><button class="button" data-action="folder">Open data folder</button></div>
        <section class="status" role="status">Loading reviews…</section><section class="review-grid" hidden></section>`;
      container.append(shell);
      const status = shell.querySelector<HTMLElement>(".status")!;
      const grid = shell.querySelector<HTMLElement>(".review-grid")!;
      shell.querySelector('[data-action="close"]')?.addEventListener("click", close);
      shell.querySelector('[data-action="refresh"]')?.addEventListener("click", () => void load());
      shell.querySelector('[data-action="folder"]')?.addEventListener("click", () => {
        void runtime.bridge.request("reviews", "openDataFolder").catch((error) => showError(status, error));
      });

      const load = async () => {
        status.hidden = false;
        status.textContent = "Loading reviews…";
        grid.hidden = true;
        try {
          const reviews = asReviews(await runtime.bridge.request("reviews", "list"));
          renderReviews(runtime, grid, reviews, () => void load());
          grid.hidden = reviews.length === 0;
          status.hidden = reviews.length > 0;
          status.textContent = reviews.length ? "" : "No reviews yet. Open a movie or episode and use the star button.";
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
    mountNavigationButton("reviews", "Reviews", STAR_ICON, openOverlay);
    const generation = ++targetGeneration;
    void runtime.stremio.getCurrentMediaTarget().then((target) => {
      if (generation !== targetGeneration) return;
      const existing = document.querySelector<HTMLButtonElement>(
        '[data-jstremio-extension="reviews"][data-jstremio-control="player"]',
      );
      if (!target) {
        existing?.remove();
        return;
      }
      mountPlayerButton("reviews", "Review this title", STAR_ICON, () => {
        void openCurrentReview(runtime, () => overlayRefresh?.());
      });
    });
  };

  const unsubscribe = runtime.lifecycle.onReconcile(reconcile);
  return () => {
    unsubscribe();
    runtime.ui.closeOverlay();
    removeOwned("reviews");
  };
}

async function openCurrentReview(runtime: JStremioRuntime, changed: () => void) {
  const target = await runtime.stremio.getCurrentMediaTarget();
  if (!target) return;
  const existing = asReview(await runtime.bridge.request("reviews", "get", { id: target.key }));
  openReviewDialog(runtime, target, existing, changed);
}

function openReviewDialog(
  runtime: JStremioRuntime,
  target: MediaTarget,
  existing: Review | null,
  changed: () => void,
) {
  runtime.ui.openDialog((container, close) => {
    addStyles(container, styles);
    const form = document.createElement("form");
    form.className = "dialog";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    form.setAttribute("aria-labelledby", "jstremio-review-title");
    form.innerHTML = `
      <h2 id="jstremio-review-title">${existing ? "Update review" : "Add review"}</h2>
      <p class="subtitle"></p>
      <fieldset class="field"><legend>Rating (required)</legend><div class="stars" role="radiogroup"></div></fieldset>
      <label class="field">Private review<textarea maxlength="5000"></textarea><span class="count">0 / 5000</span></label>
      <div class="alert" role="alert" aria-live="polite"></div>
      <div class="dialog-actions">${existing ? '<button type="button" class="button danger" data-action="delete">Delete</button>' : ""}<button type="button" class="button" data-action="cancel">Cancel</button><button class="button primary" type="submit">${existing ? "Update" : "Save"}</button></div>`;
    form.querySelector<HTMLElement>(".subtitle")!.textContent = mediaLabel(target);
    const stars = form.querySelector<HTMLElement>(".stars")!;
    for (let rating = 1; rating <= 5; rating += 1) {
      const label = document.createElement("label");
      label.className = "star-option";
      label.innerHTML = `<input type="radio" name="rating" value="${rating}" aria-label="${rating} star${rating === 1 ? "" : "s"}"><span aria-hidden="true">★</span>`;
      stars.append(label);
    }
    if (existing) {
      const radio = form.querySelector<HTMLInputElement>(`input[value="${existing.rating}"]`);
      if (radio) radio.checked = true;
    }
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
      if (!existing || !confirm("Delete this local review?")) return;
      void runtime.bridge.request("reviews", "delete", { id: existing.id }).then(() => {
        changed();
        close();
      }).catch((error) => showError(alert, error));
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const rating = Number(new FormData(form).get("rating"));
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        alert.textContent = "Choose a rating from 1 to 5.";
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
    container.append(form);
  });
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
    title.textContent = review.name || review.title || review.videoId;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = mediaLabel(target);
    const rating = document.createElement("div");
    rating.className = "rating";
    rating.setAttribute("aria-label", `${review.rating} out of 5 stars`);
    rating.textContent = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
    const text = document.createElement("p");
    text.className = "review-text";
    text.textContent = review.text || "No written review.";
    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      action("View in Stremio", () => viewInStremio(runtime, target)),
      action("Edit", () => openReviewDialog(runtime, target, review, refresh)),
      action("Delete", () => {
        if (!confirm("Delete this local review?")) return;
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
  return typeof review.id === "string" && typeof review.rating === "number" ? (review as Review) : null;
}

function showError(target: HTMLElement, error: unknown) {
  target.hidden = false;
  target.textContent = error instanceof Error ? error.message : "The local review operation failed.";
}

const STAR_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="m12 2.3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.1l6.5-.9L12 2.3Z"/></svg>';
