import { describe, expect, it } from "vitest";
import {
  maskEpisodeLabel,
  maskNextVideoEpisodeLabel,
  maskPlayerEpisodeLabel,
  maskSpoilerText,
} from "../src/extensions/no-spoilers/masking";

describe("No Spoilers episode masking", () => {
  it("preserves season/episode numbering and reveals 30 percent of the episode name", () => {
    expect(maskEpisodeLabel("S6E13 Robert Vesco", 70)).toBe("S6E13 Robe** *****");
  });

  it("preserves episode-list numbering while masking only the episode name", () => {
    expect(maskEpisodeLabel("7. General Shiro", 70)).toBe("7. Gene*** *****");
    expect(maskEpisodeLabel("14. The Osterman Umbrella Company", 70)).toBe("14. The Oster*** ******** *******");
  });

  it("does not treat a series or movie title as an episode label", () => {
    expect(maskEpisodeLabel("The Blacklist", 70)).toBeNull();
    expect(maskEpisodeLabel("Robert Vesco", 70)).toBeNull();
  });

  it("preserves the series and episode number in the player header", () => {
    expect(maskPlayerEpisodeLabel("The Blacklist - Robert Vesco (6x13)", 70))
      .toBe("The Blacklist - Robe** ***** (6x13)");
    expect(maskPlayerEpisodeLabel("Fixture Movie", 70)).toBeNull();
  });

  it("preserves the season and episode suffix in the next-video popup", () => {
    expect(maskNextVideoEpisodeLabel("General Shiro (S6E7)", 70)).toBe("Gene*** ***** (S6E7)");
    expect(maskNextVideoEpisodeLabel("Fixture Movie", 70)).toBeNull();
  });

  it("keeps spacing stable when masking spoiler text", () => {
    expect(maskSpoilerText("A  Two Word Title", 70)).toMatch(/^A  Two/);
  });
});
