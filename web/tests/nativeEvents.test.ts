import { describe, expect, it } from "vitest";
import { unwrapNativeEvent } from "../src/runtime/nativeEvents";
import { parseMpvPropertyEvent } from "../src/runtime/player";

describe("native MPV events", () => {
  it("unwraps string and object shell envelopes", () => {
    expect(unwrapNativeEvent(JSON.stringify({ args: ["event", { ok: true }] }))).toEqual([
      "event",
      { ok: true },
    ]);
    expect(unwrapNativeEvent(["event", 1])).toEqual(["event", 1]);
  });

  it("converts MPV seconds to rounded integer milliseconds", () => {
    expect(parseMpvPropertyEvent(["mpv-prop-change", { name: "time-pos", data: 754.281 }])).toEqual({
      positionMs: 754_281,
    });
    expect(parseMpvPropertyEvent({ args: ["mpv-prop-change", { name: "duration", data: 2700 }] })).toEqual({
      durationMs: 2_700_000,
    });
  });

  it("ignores unrelated and invalid property changes", () => {
    expect(parseMpvPropertyEvent(["other", {}])).toBeNull();
    expect(parseMpvPropertyEvent(["mpv-prop-change", { name: "time-pos", data: -1 }])).toBeNull();
  });
});
