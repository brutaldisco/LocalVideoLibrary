import { describe, expect, it } from "vitest";
import {
  isPlaybackRateSliderTarget,
  videoPlayerKeyAction,
} from "./video-player-keys";

function keyEvent(
  init: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key">,
): Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "metaKey"> {
  return {
    code: "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...init,
  };
}

describe("videoPlayerKeyAction", () => {
  it("maps s to snapshot", () => {
    expect(videoPlayerKeyAction(keyEvent({ key: "s" }))).toBe("snapshot");
    expect(videoPlayerKeyAction(keyEvent({ key: "S" }))).toBe("snapshot");
  });

  it("ignores snapshot with modifiers", () => {
    expect(
      videoPlayerKeyAction(keyEvent({ key: "s", ctrlKey: true })),
    ).toBeNull();
    expect(
      videoPlayerKeyAction(keyEvent({ key: "s", metaKey: true })),
    ).toBeNull();
  });

  it("keeps existing player shortcuts", () => {
    expect(videoPlayerKeyAction(keyEvent({ key: "Escape" }))).toBe("close");
    expect(videoPlayerKeyAction(keyEvent({ key: "ArrowRight" }))).toBe("next");
    expect(videoPlayerKeyAction(keyEvent({ key: "ArrowLeft" }))).toBe("prev");
    expect(videoPlayerKeyAction(keyEvent({ key: " ", code: "Space" }))).toBe(
      "toggle",
    );
  });

  it("returns null for other keys", () => {
    expect(videoPlayerKeyAction(keyEvent({ key: "a" }))).toBeNull();
  });
});

describe("isPlaybackRateSliderTarget", () => {
  it("matches the speed slider and ignores other controls", () => {
    const slider = {
      closest: (selector: string) =>
        selector === "[data-playback-rate-slider]" ? slider : null,
    };
    expect(isPlaybackRateSliderTarget(slider)).toBe(true);
    expect(
      isPlaybackRateSliderTarget({ closest: () => null }),
    ).toBe(false);
    expect(isPlaybackRateSliderTarget(null)).toBe(false);
  });
});
