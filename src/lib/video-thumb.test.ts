import { describe, expect, it } from "vitest";
import {
  defaultThumbSeekSeconds,
  resolveThumbSeekSeconds,
} from "./video-thumb";

describe("defaultThumbSeekSeconds", () => {
  it("uses 10% of duration when available", () => {
    expect(defaultThumbSeekSeconds(100)).toBe(10);
  });

  it("falls back when duration is missing", () => {
    expect(defaultThumbSeekSeconds(undefined)).toBe(1.5);
  });
});

describe("resolveThumbSeekSeconds", () => {
  it("prefers a custom seek position", () => {
    expect(resolveThumbSeekSeconds(100, 42)).toBe(42);
  });

  it("clamps custom seek to just before duration end", () => {
    expect(resolveThumbSeekSeconds(10, 20)).toBe(9.9);
  });

  it("falls back to default when custom seek is absent", () => {
    expect(resolveThumbSeekSeconds(100)).toBe(10);
  });
});
