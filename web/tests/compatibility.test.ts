import { beforeEach, describe, expect, it } from "vitest";
import {
  findPlayerControls,
  findPrimaryNavigation,
  findSeekContainer,
} from "../src/runtime/compatibility";

describe("central DOM compatibility adapter", () => {
  beforeEach(() => {
    location.hash = "#/player/movie/tt123";
    document.body.innerHTML = `
      <nav class="hash-a"><a class="hash-b" href="#/library">Library</a><a href="#/calendar">Calendar</a></nav>
      <div class="hash-c"><button aria-label="Play">Play</button><button aria-label="Next video">Next</button><button aria-label="Fullscreen">Full</button></div>
      <div class="hash-d"><div role="slider" aria-label="Seek position"></div></div>`;
  });

  it("discovers semantic structures despite hashed class changes", () => {
    expect(findPrimaryNavigation()?.tagName).toBe("NAV");
    expect(findPlayerControls()?.className).toBe("hash-c");
    expect(findSeekContainer()?.className).toBe("hash-d");
  });

  it("discovers replacements after a React-style remount", () => {
    const replacement = document.createElement("div");
    replacement.innerHTML = '<div class="new-hash"><div role="slider" aria-label="Playback progress"></div></div>';
    document.querySelector(".hash-d")?.replaceWith(replacement.firstElementChild!);
    expect(findSeekContainer()?.className).toBe("new-hash");
  });
});
