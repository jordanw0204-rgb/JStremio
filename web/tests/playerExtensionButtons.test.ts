import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountNavigationButton, mountPlayerButton } from "../src/extensions/shared";

describe("shared player extension buttons", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("uses live theme variables and remains above pointer-intercepting player layers", () => {
    const button = mountPlayerButton("timestamp-notes", "Add timestamp note", "<svg></svg>", vi.fn());

    expect(button).not.toBeNull();
    expect(button?.getAttribute("style")).toContain("--jstremio-surface-color");
    expect(button?.getAttribute("style")).toContain("--jstremio-text-color");
    expect(button?.style.pointerEvents).toBe("auto");
    expect(button?.style.zIndex).toBe("1");
    expect(document.querySelector('[data-jstremio-control="player-dock"] style')?.textContent).toContain(
      "--jstremio-accent-color",
    );
  });

  it("retains one clickable control across repeated reconciliations", () => {
    const onClick = vi.fn();
    const first = mountPlayerButton("timestamp-notes", "Add timestamp note", "<svg></svg>", onClick);
    const second = mountPlayerButton("timestamp-notes", "Add timestamp note", "<svg></svg>", onClick);

    expect(second).toBe(first);
    expect(document.querySelectorAll('[data-jstremio-extension="timestamp-notes"]')).toHaveLength(1);
    first?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("moves navigation controls from a stale rail into the active Settings rail", () => {
    document.body.innerHTML = '<nav id="old"><a href="#/library">Library</a><a href="#/calendar">Calendar</a></nav>';
    const first = mountNavigationButton("reviews", "Reviews", "<svg></svg>", vi.fn());
    expect(first?.parentElement?.id).toBe("old");

    document.body.insertAdjacentHTML("beforeend", `
      <aside id="settings-rail" role="navigation">
        <button aria-label="Home"></button><button aria-label="Discover"></button>
        <button aria-label="Library"></button><button aria-label="Calendar"></button>
        <button aria-label="Addons"></button><button aria-label="Settings"></button>
      </aside>`);
    document.querySelector<HTMLElement>("#old")!.style.display = "none";
    const second = mountNavigationButton("reviews", "Reviews", "<svg></svg>", vi.fn());

    expect(second).not.toBe(first);
    expect(first?.isConnected).toBe(false);
    expect(second?.parentElement?.id).toBe("settings-rail");
    expect(document.querySelectorAll('[data-jstremio-testid="reviews-navigation"]')).toHaveLength(1);
  });
});
