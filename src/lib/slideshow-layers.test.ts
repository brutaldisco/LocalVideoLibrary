import { describe, expect, it } from "vitest";
import {
  nextSlideshowIndex,
  slideshowLayers,
} from "./slideshow-layers";

const slides = [
  { url: "a" },
  { url: "b" },
  { url: "c" },
  { url: "d" },
  { url: "e" },
];

describe("nextSlideshowIndex", () => {
  it("wraps to the first slide", () => {
    expect(nextSlideshowIndex(4, 5)).toBe(0);
    expect(nextSlideshowIndex(0, 5)).toBe(1);
    expect(nextSlideshowIndex(0, 1)).toBe(0);
  });
});

describe("slideshowLayers", () => {
  it("keeps the first slide mounted before the loop returns to it", () => {
    const layers = slideshowLayers(slides, 4, null, false);
    expect(layers.find((layer) => layer.index === 0)?.role).toBe("upcoming");
    expect(layers.find((layer) => layer.role === "current")?.index).toBe(4);
  });

  it("keeps the outgoing slide visible when it is also the next loop", () => {
    const pair = [{ url: "a" }, { url: "b" }];
    const layers = slideshowLayers(pair, 1, 0, true);
    expect(layers).toEqual([
      { item: pair[0], role: "outgoing", index: 0 },
      { item: pair[1], role: "current", index: 1 },
    ]);
  });
});
