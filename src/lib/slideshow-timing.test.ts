import { describe, expect, it } from "vitest";
import {
  clampIntervalMs,
  formatInterval,
  intervalToSlider,
  nextDeadline,
  nextIntervalStep,
  sliderToInterval,
} from "./slideshow-timing";

describe("clampIntervalMs", () => {
  it("clamps below minimum and above maximum", () => {
    expect(clampIntervalMs(10)).toBe(30);
    expect(clampIntervalMs(9000)).toBe(5000);
  });

  it("uses default for non-finite values", () => {
    expect(clampIntervalMs(Number.NaN)).toBe(1000);
    expect(clampIntervalMs(Number.POSITIVE_INFINITY)).toBe(1000);
  });
});

describe("log slider", () => {
  it("maps endpoints", () => {
    expect(intervalToSlider(30)).toBe(0);
    expect(intervalToSlider(5000)).toBe(1);
    expect(sliderToInterval(0)).toBe(30);
    expect(sliderToInterval(1)).toBe(5000);
  });

  it("round-trips near 1000ms", () => {
    const back = sliderToInterval(intervalToSlider(1000));
    expect(Math.abs(back - 1000)).toBeLessThanOrEqual(2);
  });
});

describe("formatInterval", () => {
  it("formats milliseconds and seconds", () => {
    expect(formatInterval(80)).toBe("80 ms");
    expect(formatInterval(1000)).toBe("1 s");
    expect(formatInterval(1200)).toBe("1.2 s");
    expect(formatInterval(5000)).toBe("5 s");
  });
});

describe("nextIntervalStep", () => {
  it("nudges faster and slower within bounds", () => {
    const faster = nextIntervalStep(1000, -1);
    const slower = nextIntervalStep(1000, 1);
    expect(faster).toBeLessThan(1000);
    expect(slower).toBeGreaterThan(1000);
    expect(nextIntervalStep(30, -1)).toBe(30);
    expect(nextIntervalStep(5000, 1)).toBe(5000);
  });
});

describe("nextDeadline", () => {
  it("computes the next switch time with clamped interval", () => {
    expect(nextDeadline(1000, 0, 1000)).toBe(2000);
    expect(nextDeadline(1000, 9, 1000)).toBe(11000);
    expect(nextDeadline(1000, 0, 10)).toBe(1030);
  });
});
