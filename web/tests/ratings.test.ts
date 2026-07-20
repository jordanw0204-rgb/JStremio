import { describe, expect, it } from "vitest";
import { MAX_RATING, normalizeRating, ratingAriaLabel, ratingStars } from "../src/extensions/ratings";

describe("ten-star ratings", () => {
  it("accepts the full one-to-ten range", () => {
    expect(MAX_RATING).toBe(10);
    expect(normalizeRating(1)).toBe(1);
    expect(normalizeRating(10)).toBe(10);
    expect(normalizeRating(0)).toBeNull();
    expect(normalizeRating(11)).toBeNull();
  });

  it("renders and labels ratings against ten stars", () => {
    expect(ratingStars(7)).toBe("★★★★★★★☆☆☆");
    expect(ratingAriaLabel(7)).toBe("7 out of 10 stars");
  });
});
