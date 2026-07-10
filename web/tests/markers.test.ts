import { describe, expect, it } from "vitest";
import { clusterMarkers, markerPercent } from "../src/extensions/timestamp-notes/markers";

describe("timestamp markers", () => {
  it("calculates percentages and omits out-of-range notes", () => {
    expect(markerPercent(25_000, 100_000)).toBe(25);
    expect(markerPercent(101_000, 100_000)).toBeNull();
    expect(markerPercent(0, 0)).toBeNull();
  });

  it("clusters notes within ten physical pixels", () => {
    const clusters = clusterMarkers(
      [
        { id: "a", timestampMs: 10_000 },
        { id: "b", timestampMs: 10_500 },
        { id: "c", timestampMs: 80_000 },
      ],
      100_000,
      1_000,
      1,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.notes.map((note) => note.id)).toEqual(["a", "b"]);
    expect(clusters[1]?.notes.map((note) => note.id)).toEqual(["c"]);
  });
});
