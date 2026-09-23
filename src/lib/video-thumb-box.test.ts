import { describe, expect, it } from "vitest";
import {
  createMinimalBmff,
  createThumbBox,
  embedThumbSeek,
  parseThumbBox,
  playbackEndOffset,
  readThumbSeek,
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

  it("rejects append after mdat so browsers can keep playing the file", async () => {
    const file = new MemoryFile(createMinimalBmff());
    await expect(file.embed(12)).rejects.toBeInstanceOf(
      UnsupportedMediaContainerError,
    );
    expect(file.bytes.length).toBe(createMinimalBmff().length);
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
