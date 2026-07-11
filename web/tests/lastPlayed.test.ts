import { describe, expect, it } from "vitest";
import { createStreamKey, extractLastPlayedInput, normalizePlayerRoute } from "../src/runtime/lastPlayedAdapter";

const target = { key:"series:tt1:1:2",videoId:"tt1:1:2",metaId:"tt1",mediaType:"series" as const,name:"Series",title:"Episode",season:1,episode:2,poster:null };

describe("LastPlayed stream identity", () => {
  it("captures the official exact player route and torrent identity", () => {
    const result=extractLastPlayedInput({ selected:{stream:{infoHash:"ABC",fileIdx:4,name:"1080p",deepLinks:{player:"#/player/stream/exact"}}}, addon:{manifest:{name:"MediaFusion"}} },target,12_345);
    expect(result).toMatchObject({playerDeepLink:"#/player/stream/exact",streamKey:"torrent:abc:4",addonName:"MediaFusion",positionMs:12345});
  });
  it("rejects remote routes and distinguishes direct URLs", () => {
    expect(normalizePlayerRoute("https://evil.invalid/video")).toBeNull();
    expect(createStreamKey({url:"https://media.invalid/a.m3u8"},"#/player/a")).toBe("url:https://media.invalid/a.m3u8");
  });
});
