import { describe, expect, it } from "vitest";
import {
  createMinimalBmff,
  createThumbBox,
  embedThumbSeek,
  parseThumbBox,
  playbackBlobFromFile,
  playbackEndOffset,
  readThumbSeek,
  videoContentType,
  THUMB_BOX_SIZE,
  UnsupportedMediaContainerError,
} from "./video-thumb-box";

class MemoryFile {
  bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes.slice();
  }

  read = async (offset: number, length: number): Promise<Uint8Array> => {
    if (offset >= this.bytes.length) {
      return new Uint8Array();
    }
    return this.bytes.slice(offset, Math.min(this.bytes.length, offset + length));
  };

  write = async (offset: number, data: Uint8Array): Promise<void> => {
    const size = Math.max(this.bytes.length, offset + data.length);
    const next = new Uint8Array(size);
    next.set(this.bytes);
    next.set(data, offset);
    this.bytes = next;
  };

  truncate = async (size: number): Promise<void> => {
    this.bytes = this.bytes.slice(0, size);
  };

  embed(seconds: number) {
    return embedThumbSeek(this.bytes.length, this.read, this.write, seconds, {
      truncate: this.truncate,
    });
  }

  seek() {
    return readThumbSeek(this.bytes.length, this.read);
  }
}

function renameFolder(
  files: Map<string, MemoryFile>,
  fromFolder: string,
  toFolder: string,
): Map<string, MemoryFile> {
  const fromPrefix = `${fromFolder}/`;
  const toPrefix = `${toFolder}/`;
  const next = new Map<string, MemoryFile>();
  for (const [filePath, file] of files) {
    if (filePath.startsWith(fromPrefix)) {
      next.set(`${toPrefix}${filePath.slice(fromPrefix.length)}`, file);
      continue;
    }
    next.set(filePath, file);
  }
  return next;
}

function ascii(value: string): Uint8Array {
  return Uint8Array.from(value, (char) => char.charCodeAt(0));
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left);
  out.set(right, left.length);
  return out;
}

function encodeFreeBox(): Uint8Array {
  const payload = new Uint8Array(8);
  const out = new Uint8Array(16);
  new DataView(out.buffer).setUint32(0, 16, false);
  out.set(ascii("free"), 4);
  out.set(payload, 8);
  return out;
}

function bmffWithTrailingFree(): Uint8Array {
  const base = createMinimalBmff();
  const free = encodeFreeBox();
  const out = new Uint8Array(base.length + free.length);
  out.set(base, 0);
  out.set(free, base.length);
  return out;
}

describe("thumb box", () => {
  it("appends a seek position without changing the media bytes", async () => {
    const original = bmffWithTrailingFree();
    const file = new MemoryFile(original);
    await file.embed(304.989895);
    expect(file.bytes.length).toBe(original.length + THUMB_BOX_SIZE);
    expect(file.bytes.slice(0, original.length)).toEqual(original);
    expect(await file.seek()).toBe(304.989895);
  });

  it("appends after mdat and omits that box during playback", async () => {
    const original = createMinimalBmff();
    const file = new MemoryFile(original);
    await file.embed(12);
    expect(file.bytes.length).toBe(original.length + THUMB_BOX_SIZE);
    expect(file.bytes.slice(0, original.length)).toEqual(original);
    expect(await file.seek()).toBe(12);
    const end = await playbackEndOffset(file.bytes.length, file.read);
    expect(end).toBe(original.length);
  });

  it("uses the shared uuid layout", () => {
    const box = createThumbBox(1.5);
    expect(box.length).toBe(280);
    expect(String.fromCharCode(...box.subarray(4, 8))).toBe("uuid");
    expect([...box.subarray(8, 24)]).toEqual([
      0x3f, 0x6a, 0x0c, 0x1e, 0x8b, 0x24, 0x4d, 0x7a, 0x9f, 0x50, 0x6c, 0x1e,
      0x8a, 0x4b, 0x2d, 0x90,
    ]);
    expect(new DataView(box.buffer).getFloat64(32, false)).toBe(1.5);
  });

  it("moves a legacy 64-byte box into the shared box", async () => {
    const media = createMinimalBmff();
    const legacy = new Uint8Array(64);
    const view = new DataView(legacy.buffer);
    view.setUint32(0, 64, false);
    legacy.set(ascii("uuid"), 4);
    legacy.set(ascii("lvl-thumb-seek01"), 8);
    legacy[24] = 1;
    legacy[25] = 1;
    view.setFloat64(28, 9, false);
    const file = new MemoryFile(concatBytes(media, legacy));
    expect(await file.seek()).toBe(9);
    await file.embed(9);
    expect(file.bytes.length).toBe(media.length + THUMB_BOX_SIZE);
    expect(file.bytes.slice(0, media.length)).toEqual(media);
    expect(new TextDecoder().decode(file.bytes)).not.toContain("lvl-thumb-seek01");
    expect(await file.seek()).toBe(9);
  });

  it("strips a trailing thumb box for playback", async () => {
    const original = bmffWithTrailingFree();
    const file = new MemoryFile(original);
    await file.embed(42);
    const end = await playbackEndOffset(file.bytes.length, file.read);
    expect(end).toBe(original.length);
    expect(file.bytes.slice(0, end)).toEqual(original);
  });

  it("overwrites an existing box in place", async () => {
    const file = new MemoryFile(bmffWithTrailingFree());
    await file.embed(1.5);
    const length = file.bytes.length;
    await file.embed(0);
    expect(file.bytes.length).toBe(length);
    expect(await file.seek()).toBe(0);
  });

  it("rejects a non-video container", async () => {
    const file = new MemoryFile(ascii("not-a-video-file!!"));
    await expect(file.embed(1)).rejects.toBeInstanceOf(UnsupportedMediaContainerError);
    expect(file.bytes.length).toBe("not-a-video-file!!".length);
  });

  it("rejects an open-ended box instead of appending metadata", async () => {
    const open = new Uint8Array(16);
    new DataView(open.buffer).setUint32(0, 0, false);
    open.set(ascii("mdat"), 4);
    const file = new MemoryFile(open);
    await expect(file.embed(2)).rejects.toBeInstanceOf(UnsupportedMediaContainerError);
    expect(file.bytes).toEqual(open);
  });

  it("ignores a box with a different user type", () => {
    const box = createThumbBox(4);
    box[8] = box[8] ^ 0xff;
    expect(parseThumbBox(box)).toBeUndefined();
  });
});

describe("renames", () => {
  it("keeps the seek position when the pikpak folder is renamed", async () => {
    const clip = new MemoryFile(bmffWithTrailingFree());
    await clip.embed(18.5);
    const library = renameFolder(
      new Map([["Movies/pikpak/clip.mp4", clip]]),
      "Movies/pikpak",
      "Movies/pikpak-renamed",
    );
    const moved = library.get("Movies/pikpak-renamed/clip.mp4");
    expect(moved).toBe(clip);
    expect(library.has("Movies/pikpak/clip.mp4")).toBe(false);
    expect(await moved?.seek()).toBe(18.5);
  });

  it("keeps the seek position when a folder inside Music is renamed", async () => {
    const clip = new MemoryFile(bmffWithTrailingFree());
    await clip.embed(7.25);
    const library = renameFolder(
      new Map([["Movies/Music/live/show.mp4", clip]]),
      "Movies/Music/live",
      "Movies/Music/live-renamed",
    );
    expect(await library.get("Movies/Music/live-renamed/show.mp4")?.seek()).toBe(
      7.25,
    );
  });

  it("keeps the seek position when the folder and the video are both renamed", async () => {
    const clip = new MemoryFile(bmffWithTrailingFree());
    await clip.embed(3);
    const renamedFolder = renameFolder(
      new Map([["Movies/pikpak/nested/clip.mp4", clip]]),
      "Movies/pikpak",
      "Movies/archive",
    );
    renamedFolder.set("Movies/archive/nested/scene.mp4", clip);
    renamedFolder.delete("Movies/archive/nested/clip.mp4");
    expect(await renamedFolder.get("Movies/archive/nested/scene.mp4")?.seek()).toBe(
      3,
    );
  });
});

describe("videoContentType", () => {
  it("keeps a video type and fills in an empty one from the file name", () => {
    expect(videoContentType("clip.mp4", "video/mp4")).toBe("video/mp4");
    expect(videoContentType("clip.mov", "")).toBe("video/quicktime");
    expect(videoContentType("clip.webm", "application/octet-stream")).toBe(
      "video/webm",
    );
  });
});

describe("playbackBlobFromFile", () => {
  it("gives a typeless file a video type without dropping bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = new File([bytes], "phone.mp4", { type: "" });
    const blob = await playbackBlobFromFile(file);
    expect(blob.type).toBe("video/mp4");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });
});
