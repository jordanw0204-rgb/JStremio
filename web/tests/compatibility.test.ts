import { beforeEach, describe, expect, it } from "vitest";
import {
  findPlayerControls,
  findPrimaryNavigation,
  findSeekContainer,
  isPlayerOverlayHidden,
} from "../src/runtime/compatibility";

describe("central DOM compatibility adapter", () => {
  beforeEach(() => {
    location.hash = "#/player/movie/tt123";
    document.body.innerHTML = `
      <nav class="hash-a"><a class="hash-b" href="#/library">Library</a><a href="#/calendar">Calendar</a></nav>
      <div class="control-bar-container_hash-c">
        <div class="seek-bar-container_hash-d">
          <div>00:59</div>
          <div class="slider-container_hash-e">
            <div><div></div></div><div><div style="width: 20%"></div></div>
            <div><div style="--mask-width: calc(.023 * 100%)"></div></div>
            <div><div style="margin-left: calc(100% * .023)"></div></div>
          </div>
          <div tabindex="-1"><div>43:03</div></div>
        </div>
        <div class="control-bar-buttons-container_hash-f">
          <div class="control-bar-button_hash-g" title="Pause" tabindex="-1"></div>
          <div class="control-bar-button_hash-g" title="Next video" tabindex="-1"></div>
          <div class="control-bar-button_hash-g" title="Mute" tabindex="-1"></div>
        </div>
      </div>`;
  });

  it("discovers the current Stremio div controls and layered slider despite hashed class changes", () => {
    expect(findPrimaryNavigation()?.tagName).toBe("NAV");
    expect(findPlayerControls()?.className).toBe("control-bar-buttons-container_hash-f");
    expect(findSeekContainer()?.className).toBe("slider-container_hash-e");
  });

  it("discovers replacements after a React-style remount", () => {
    const replacement = document.createElement("div");
    replacement.innerHTML = '<div class="new-hash"><div role="slider" aria-label="Playback progress"></div></div>';
    document.querySelector(".seek-bar-container_hash-d")?.replaceWith(replacement.firstElementChild!);
    expect(findSeekContainer()?.className).toBe("new-hash");
  });

  it("retains semantic toolbar and slider support", () => {
    document.body.innerHTML = '<div class="toolbar" role="toolbar"><button>One</button></div><div class="seek"><input type="range" aria-label="Seek position"></div>';
    expect(findPlayerControls()?.className).toBe("toolbar");
    expect(findSeekContainer()?.className).toBe("seek");
  });

  it("detects the current official immersed-player class without a complete hash", () => {
    expect(isPlayerOverlayHidden()).toBe(false);
    document.querySelector(".control-bar-container_hash-c")?.classList.add("overlayHidden_changedHash");
    expect(isPlayerOverlayHidden()).toBe(true);
  });
});
