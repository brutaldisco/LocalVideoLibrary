import { describe, expect, it } from "vitest";
import {
  ALBUM_MANIFEST_FILE,
  buildSnapshotFileName,
  isSnapshotImageName,
  parseAlbumManifest,
  reconcileAlbumManifest,
} from "./snapshot-manifest";

describe("buildSnapshotFileName", () => {
  it("builds a browser-safe jpeg name from a video title", () => {
    const name = buildSnapshotFileName("Song Title.mp4", 83.45, new Set());
    expect(name).toContain("__01-23-450.jpg");
    expect(name.toLowerCase()).not.toContain(".mp4");
  });

  it("appends -2 on collision", () => {
    const existing = new Set(["song__01-23-450.jpg"]);
    const name = buildSnapshotFileName("song.mp4", 83.45, existing);
    expect(name).toBe("song__01-23-450-2.jpg");
  });

  it("uses frame when the base is empty", () => {
    const name = buildSnapshotFileName(".mp4", 0, new Set());
    expect(name.startsWith("frame__")).toBe(true);
  });
});

describe("parseAlbumManifest", () => {
  it("rejects garbage and clamps interval", () => {
    expect(parseAlbumManifest(null).items).toEqual([]);
    expect(parseAlbumManifest({ intervalMs: 10 }).intervalMs).toBe(30);
    expect(parseAlbumManifest({ intervalMs: 9000 }).intervalMs).toBe(5000);
  });
});

describe("reconcileAlbumManifest", () => {
  it("drops missing files and appends unknown images in order", () => {
    const manifest = parseAlbumManifest({
      intervalMs: 2500,
      items: [
        { file: "gone.jpg", capturedAt: "", sourcePath: "", sourceTimeSeconds: 0 },
        { file: "keep.png", capturedAt: "", sourcePath: "", sourceTimeSeconds: 0 },
      ],
    });
    const next = reconcileAlbumManifest(manifest, [
      "keep.png",
      "zebra.jpg",
      "alpha.webp",
    ]);
    expect(next.intervalMs).toBe(2500);
    expect(next.items.map((item) => item.file)).toEqual([
      "keep.png",
      "alpha.webp",
      "zebra.jpg",
    ]);
  });
});

describe("isSnapshotImageName", () => {
  it("ignores album.json", () => {
    expect(isSnapshotImageName("photo.jpg")).toBe(true);
    expect(isSnapshotImageName(ALBUM_MANIFEST_FILE)).toBe(false);
    expect(isSnapshotImageName("Album.JSON")).toBe(false);
  });
});
