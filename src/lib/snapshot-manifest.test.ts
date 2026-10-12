import { describe, expect, it } from "vitest";
import {
  ALBUM_MANIFEST_FILE,
  buildSnapshotFileName,
  isSnapshotImageName,
  moveAlbumFileOrder,
  orderAlbumItems,
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

describe("moveAlbumFileOrder", () => {
  const files = ["a.jpg", "b.jpg", "c.jpg"];

  it("moves an item onto another index", () => {
    expect(moveAlbumFileOrder(files, "a.jpg", "c.jpg")).toEqual([
      "b.jpg",
      "c.jpg",
      "a.jpg",
    ]);
    expect(moveAlbumFileOrder(files, "c.jpg", "a.jpg")).toEqual([
      "c.jpg",
      "a.jpg",
      "b.jpg",
    ]);
  });

  it("leaves the list unchanged for a missing or identical target", () => {
    expect(moveAlbumFileOrder(files, "a.jpg", "a.jpg")).toEqual(files);
    expect(moveAlbumFileOrder(files, "missing.jpg", "b.jpg")).toEqual(files);
  });
});

describe("orderAlbumItems", () => {
  it("reorders known items and keeps the rest at the end", () => {
    const items = [
      { file: "a.jpg", capturedAt: "", sourcePath: "a", sourceTimeSeconds: 1 },
      { file: "b.jpg", capturedAt: "", sourcePath: "b", sourceTimeSeconds: 2 },
      { file: "c.jpg", capturedAt: "", sourcePath: "c", sourceTimeSeconds: 3 },
    ];
    expect(orderAlbumItems(items, ["c.jpg", "a.jpg"]).map((item) => item.file)).toEqual([
      "c.jpg",
      "a.jpg",
      "b.jpg",
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
