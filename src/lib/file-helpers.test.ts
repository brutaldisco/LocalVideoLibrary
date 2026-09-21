import { describe, expect, it } from "vitest";
import {
  filterVideos,
  formatBytes,
  isVideoFileName,
  naturalCompare,
  sortVideos,
  validateEntryName,
  validateFolderPath,
  validateVideoFileName,
} from "./file-helpers";
import type { VideoFileEntry } from "./types";

const sampleVideos: VideoFileEntry[] = [
  {
    id: "a/2-b.mp4",
    name: "2-b.mp4",
    path: "a/2-b.mp4",
    folderPath: "a",
    size: 20,
    sourceMode: "directory",
  },
  {
    id: "a/10-a.mp4",
    name: "10-a.mp4",
    path: "a/10-a.mp4",
    folderPath: "a",
    size: 10,
    sourceMode: "directory",
  },
  {
    id: "b/live.webm",
    name: "live.webm",
    path: "b/live.webm",
    folderPath: "b",
    size: 30,
    sourceMode: "directory",
  },
];

describe("isVideoFileName", () => {
  it("accepts supported extensions", () => {
    expect(isVideoFileName("clip.mp4")).toBe(true);
    expect(isVideoFileName("clip.MOV")).toBe(true);
    expect(isVideoFileName("notes.txt")).toBe(false);
  });
});

describe("validateEntryName", () => {
  it("rejects empty and path-like names", () => {
    expect(validateEntryName("")).toMatch(/empty/i);
    expect(validateEntryName("a/b.mp4")).toMatch(/separator/i);
    expect(validateEntryName("..")).toMatch(/invalid/i);
  });
});

describe("validateVideoFileName", () => {
  it("requires a supported video extension", () => {
    expect(validateVideoFileName("clip.mp4")).toBeNull();
    expect(validateVideoFileName("clip.txt")).toMatch(/extension/i);
  });
});

describe("validateFolderPath", () => {
  it("accepts nested relative paths", () => {
    expect(validateFolderPath("music-videos/1997")).toBeNull();
    expect(validateFolderPath("bad/..")).toMatch(/invalid/i);
  });
});

describe("naturalCompare", () => {
  it("sorts numeric prefixes naturally", () => {
    expect(naturalCompare("2-b.mp4", "10-a.mp4")).toBeLessThan(0);
  });
});

describe("filterVideos", () => {
  it("matches file and folder paths", () => {
    const filtered = filterVideos(sampleVideos, {
      query: "live",
      folderPath: null,
    });
    expect(filtered.map((row) => row.id)).toEqual(["b/live.webm"]);
  });
});

describe("sortVideos", () => {
  it("sorts by name with natural order", () => {
    const sorted = sortVideos(sampleVideos, "name", "asc", new Map());
    expect(sorted.map((row) => row.name)).toEqual([
      "2-b.mp4",
      "10-a.mp4",
      "live.webm",
    ]);
  });

  it("uses duration metadata when sorting by duration", () => {
    const durations = new Map<string, number | undefined>([
      ["a/2-b.mp4", 120],
      ["a/10-a.mp4", 30],
      ["b/live.webm", 300],
    ]);
    const sorted = sortVideos(sampleVideos, "duration", "asc", durations);
    expect(sorted.map((row) => row.id)).toEqual([
      "a/10-a.mp4",
      "a/2-b.mp4",
      "b/live.webm",
    ]);
  });
});

describe("formatBytes", () => {
  it("formats common sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});
