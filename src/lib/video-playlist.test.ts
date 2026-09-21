import { describe, expect, it } from "vitest";
import {
  folderPlaylist,
  parseRepeatMode,
  stepPlaylist,
  toggleRepeatMode,
} from "./video-playlist";

const library = [
  { id: "a", folderPath: "f1" },
  { id: "b", folderPath: "f1" },
  { id: "c", folderPath: "" },
  { id: "d", folderPath: "f2" },
];

describe("folderPlaylist", () => {
  it("keeps videos in the same folder, including root", () => {
    expect(folderPlaylist(library, library[0]).map((row) => row.id)).toEqual([
      "a",
      "b",
    ]);
    expect(folderPlaylist(library, library[2]).map((row) => row.id)).toEqual([
      "c",
    ]);
  });
});

describe("stepPlaylist", () => {
  it("wraps around the folder", () => {
    const list = folderPlaylist(library, library[0]);
    expect(stepPlaylist(list, "a", 1)?.id).toBe("b");
    expect(stepPlaylist(list, "b", 1)?.id).toBe("a");
    expect(stepPlaylist(list, "b", -1)?.id).toBe("a");
  });
});

describe("parseRepeatMode", () => {
  it("defaults to folder loop", () => {
    expect(parseRepeatMode(null)).toBe("folder");
    expect(parseRepeatMode("one")).toBe("one");
  });
});

describe("toggleRepeatMode", () => {
  it("turns the active mode off, and switches to the other", () => {
    expect(toggleRepeatMode("folder", "folder")).toBe("off");
    expect(toggleRepeatMode("off", "one")).toBe("one");
    expect(toggleRepeatMode("one", "folder")).toBe("folder");
  });
});
