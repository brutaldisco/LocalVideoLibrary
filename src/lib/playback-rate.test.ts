import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYBACK_RATE,
  formatPlaybackRate,
  indexForPlaybackRate,
  parsePlaybackRate,
  PLAYBACK_RATES,
  playbackRateAt,
} from "./playback-rate";

describe("playback rates", () => {
  it("steps by 0.1 from 0.5 through 2, then by 1 through 5", () => {
    expect(PLAYBACK_RATES[0]).toBe(0.5);
    expect(PLAYBACK_RATES).toContain(1);
    expect(PLAYBACK_RATES).toContain(1.9);
    expect(PLAYBACK_RATES).toContain(2);
    expect(PLAYBACK_RATES.at(-1)).toBe(5);
    expect(PLAYBACK_RATES).not.toContain(2.1);
    expect(PLAYBACK_RATES).not.toContain(2.5);
    expect(PLAYBACK_RATES).not.toContain(6);

    const belowTwo = PLAYBACK_RATES.filter((rate) => rate < 2);
    for (let index = 1; index < belowTwo.length; index += 1) {
      expect(belowTwo[index] - belowTwo[index - 1]).toBeCloseTo(0.1);
    }
    const fromTwo = PLAYBACK_RATES.filter((rate) => rate >= 2);
    expect(fromTwo).toEqual([2, 3, 4, 5]);
  });

  it("maps slider indexes onto those rates without rewinding", () => {
    expect(playbackRateAt(0)).toBe(0.5);
    expect(playbackRateAt(indexForPlaybackRate(2))).toBe(2);
    expect(playbackRateAt(PLAYBACK_RATES.length - 1)).toBe(5);
    expect(playbackRateAt(-10)).toBe(0.5);
    expect(playbackRateAt(100)).toBe(5);
    expect(playbackRateAt(Number.NaN)).toBe(DEFAULT_PLAYBACK_RATE);
  });

  it("snaps stored values to the nearest allowed rate", () => {
    expect(parsePlaybackRate(null)).toBe(1);
    expect(parsePlaybackRate("nope")).toBe(1);
    expect(parsePlaybackRate("1.5")).toBe(1.5);
    expect(parsePlaybackRate(1.24)).toBe(1.2);
    expect(parsePlaybackRate(9)).toBe(5);
    expect(parsePlaybackRate(0)).toBe(0.5);
  });

  it("formats tenths below 2x and whole numbers from 2x", () => {
    expect(formatPlaybackRate(0.5)).toBe("0.5x");
    expect(formatPlaybackRate(1)).toBe("1.0x");
    expect(formatPlaybackRate(1.9)).toBe("1.9x");
    expect(formatPlaybackRate(2)).toBe("2x");
    expect(formatPlaybackRate(5)).toBe("5x");
  });
});
