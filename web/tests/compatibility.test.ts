import { beforeEach, describe, expect, it } from "vitest";
import {
  copyNavigationPresentation,
  findPlayerControls,
  findPrimaryNavigation,
  findSeekContainer,
  isPlayerOverlayHidden,
  navigationTemplate,
} from "../src/runtime/compatibility";

describe("central DOM compatibility adapter", () => {
  beforeEach(() => {
    location.hash = "#/player/movie/tt123";
    document.body.innerHTML = `
      <nav class="hash-a"><a class="hash-b selected" href="#/library"><svg class="icon_hash"></svg><div class="label_hash">Library</div></a><a href="#/calendar">Calendar</a></nav>
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

  it("prefers the bottom Stremio player controls over an earlier navigation toolbar", () => {
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<header id="top-navigation" role="toolbar"><button title="Back"></button><button title="Fullscreen"></button></header>',
    );

    expect(findPlayerControls()?.className).toBe("control-bar-buttons-container_hash-f");
    expect(findPlayerControls()?.id).not.toBe("top-navigation");
  });

  it("copies official navigation container, icon, and hover-label classes without selected state", () => {
    const button = document.createElement("button");
    button.innerHTML = '<svg data-jstremio-navigation-icon></svg><div data-jstremio-navigation-label>Reviews</div>';
    copyNavigationPresentation(button, navigationTemplate());
    expect(button.classList.contains("hash-b")).toBe(true);
    expect(button.classList.contains("selected")).toBe(false);
    expect(button.querySelector("svg")?.classList.contains("icon_hash")).toBe(true);
    expect(button.querySelector("div")?.classList.contains("label_hash")).toBe(true);
  });

  it("discovers replacements after a React-style remount", () => {
    const replacement = document.createElement("div");
    replacement.innerHTML = '<div class="new-hash"><div role="slider" aria-label="Playback progress"></div></div>';
    document.querySelector(".seek-bar-container_hash-d")?.replaceWith(replacement.firstElementChild!);
    expect(findSeekContainer()?.className).toBe("new-hash");
  });

  it("uses the route-link container instead of a broader branded sidebar wrapper", () => {
    document.body.innerHTML = `
      <aside id="sidebar"><a href="#/" title="JStremio">J</a>
        <nav id="route-items"><a href="#/board">Board</a><a href="#/library">Library</a><a href="#/calendar">Calendar</a></nav>
      </aside>`;
    expect(findPrimaryNavigation()?.id).toBe("route-items");
  });

  it("retains semantic toolbar and slider support", () => {
    document.body.innerHTML = '<div class="toolbar" role="toolbar"><button>One</button></div><div class="seek"><input type="range" aria-label="Seek position"></div>';
    expect(findPlayerControls()?.className).toBe("toolbar");
    expect(findSeekContainer()?.className).toBe("seek");
  });

  it("finds the left application rail when a Settings layout has no route anchors", () => {
    document.body.innerHTML = `
      <aside id="app-rail">
        <button aria-label="Home"></button><button aria-label="Discover"></button>
        <button aria-label="Library"></button><button aria-label="Calendar"></button>
        <button aria-label="Addons"></button><button aria-label="Settings"></button>
      </aside>
      <nav id="settings-tabs"><button>General</button><button>Interface</button><button>Player</button></nav>`;
    const rail = document.querySelector<HTMLElement>("#app-rail")!;
    rail.getBoundingClientRect = () => ({ left: 0, right: 82, top: 0, bottom: 720, width: 82, height: 720, x: 0, y: 0, toJSON() {} });
    const tabs = document.querySelector<HTMLElement>("#settings-tabs")!;
    tabs.getBoundingClientRect = () => ({ left: 100, right: 300, top: 80, bottom: 500, width: 200, height: 420, x: 100, y: 80, toJSON() {} });

    expect(findPrimaryNavigation()).toBe(rail);
    expect(navigationTemplate(rail)?.getAttribute("aria-label")).toBe("Home");
  });

  it("detects the current official immersed-player class without a complete hash", () => {
    expect(isPlayerOverlayHidden()).toBe(false);
    document.querySelector(".control-bar-container_hash-c")?.classList.add("overlayHidden_changedHash");
    expect(isPlayerOverlayHidden()).toBe(true);
  });
});
