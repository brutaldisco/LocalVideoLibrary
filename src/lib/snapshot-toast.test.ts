import { describe, expect, it } from "vitest";
import { nextSnapshotToast } from "./snapshot-toast";

describe("nextSnapshotToast", () => {
  it("starts a burst with the album name", () => {
    expect(nextSnapshotToast(null, "Summer", 1000)).toEqual({
      album: "Summer",
      count: 1,
      at: 1000,
      message: "Saved to Summer",
    });
  });

  it("counts saves to the same album inside the window", () => {
    const first = nextSnapshotToast(null, "Summer", 1000);
    expect(nextSnapshotToast(first, "Summer", 2500).message).toBe(
      "Saved 2 to Summer",
    );
  });

  it("starts over after the window or for another album", () => {
    const first = nextSnapshotToast(null, "Summer", 1000);
    expect(nextSnapshotToast(first, "Summer", 3001).count).toBe(1);
    expect(nextSnapshotToast(first, "Lights", 1200).message).toBe(
      "Saved to Lights",
    );
  });
});
