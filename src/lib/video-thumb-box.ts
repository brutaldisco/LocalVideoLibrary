/**
 * MP4 / MOV / M4V の末尾に、x-idea と同じ 280 バイトの uuid ボックスでサムネ秒数を置く。
 * 識別子は 3f6a0c1e-8b24-4d7a-9f50-6c1e8a4b2d90。映像と音声のバイトは書き換えない。
 * 以前の 64 バイト箱（lvl-thumb-seek01）は読み、書き込み時に共有形式へ移す。
 */

export const THUMB_BOX_SIZE = 280;
const LEGACY_BOX_SIZE = 64;
const LEGACY_USER_TYPE = ascii("lvl-thumb-seek01");
/** 3f6a0c1e-8b24-4d7a-9f50-6c1e8a4b2d90 */
const USER_TYPE_BYTES = Uint8Array.of(
  0x3f, 0x6a, 0x0c, 0x1e, 0x8b, 0x24, 0x4d, 0x7a, 0x9f, 0x50, 0x6c, 0x1e, 0x8a,
  0x4b, 0x2d, 0x90,
);
const UUID_HEADER = 8 + USER_TYPE_BYTES.byteLength;
const ROOT_BOX_TYPES = new Set([
  "ftyp",
  "moov",
  "mdat",
  "free",
  "skip",
  "wide",
  "uuid",
  "pnot",
  "udta",
]);

export class UnsupportedMediaContainerError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsupportedMediaContainerError";
  }
}

type Reader = (offset: number, length: number) => Promise<Uint8Array>;
type Writer = (offset: number, data: Uint8Array) => Promise<void>;

type Scan =
  | {
      kind: "ok";
      fileSize: number;
      canonical: number | null;
      legacy: number | null;
    }
  | { kind: "unsupported"; reason: string };

function ascii(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function encodeBox(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.byteLength);
  new DataView(out.buffer).setUint32(0, out.byteLength, false);
  out.set(ascii(type), 4);
  out.set(payload, 8);
  return out;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export function createThumbBox(seconds: number): Uint8Array {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("Invalid thumbnail seek position");
  }
  const box = new Uint8Array(THUMB_BOX_SIZE);
  const view = new DataView(box.buffer);
  view.setUint32(0, THUMB_BOX_SIZE, false);
  box.set(ascii("uuid"), 4);
  box.set(USER_TYPE_BYTES, 8);
  box[UUID_HEADER] = 1;
  box[UUID_HEADER + 1] = 1;
  view.setFloat64(UUID_HEADER + 8, seconds, false);
  return box;
}

export function parseThumbBox(bytes: Uint8Array): number | undefined {
  if (bytes.byteLength !== THUMB_BOX_SIZE) {
    return undefined;
  }
  const view = viewOf(bytes);
  if (view.getUint32(0, false) !== THUMB_BOX_SIZE) {
    return undefined;
  }
  if (fourcc(bytes, 4) !== "uuid") {
    return undefined;
  }
  if (!sameBytes(bytes.subarray(8, 24), USER_TYPE_BYTES)) {
    return undefined;
  }
  if (bytes[UUID_HEADER] !== 1 || (bytes[UUID_HEADER + 1] & 1) === 0) {
    return undefined;
  }
  const seconds = view.getFloat64(UUID_HEADER + 8, false);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return seconds;
}

function parseLegacyThumbBox(bytes: Uint8Array): number | undefined {
  if (bytes.byteLength < LEGACY_BOX_SIZE) {
    return undefined;
  }
  const view = viewOf(bytes);
  if (view.getUint32(0, false) !== LEGACY_BOX_SIZE) {
    return undefined;
  }
  if (fourcc(bytes, 4) !== "uuid") {
    return undefined;
  }
  if (!sameBytes(bytes.subarray(8, 24), LEGACY_USER_TYPE)) {
    return undefined;
  }
  if (bytes[24] !== 1 || (bytes[25] & 1) === 0) {
    return undefined;
  }
  const seconds = view.getFloat64(28, false);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return seconds;
}

async function scanContainer(fileSize: number, read: Reader): Promise<Scan> {
  if (fileSize < 8) {
    return { kind: "unsupported", reason: "File is too small to be a video container" };
  }

  let offset = 0;
  let canonical: number | null = null;
  let legacy: number | null = null;
  let first = true;
  while (offset + 8 <= fileSize) {
    const header = await read(offset, 16);
    if (header.byteLength < 8) {
      return { kind: "unsupported", reason: "Truncated box header" };
    }
    const view = viewOf(header);
    const size32 = view.getUint32(0, false);
    const type = fourcc(header, 4);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (header.byteLength < 16) {
        return { kind: "unsupported", reason: "Truncated 64-bit box size" };
      }
      const large = view.getBigUint64(8, false);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) {
        return { kind: "unsupported", reason: "Box is too large" };
      }
      size = Number(large);
      headerSize = 16;
    } else if (size32 === 0) {
      return {
        kind: "unsupported",
        reason: "Open-ended box cannot be extended safely",
      };
    }
    if (size < headerSize || offset + size > fileSize) {
      return { kind: "unsupported", reason: `Invalid ${type} box size` };
    }
    if (first && !ROOT_BOX_TYPES.has(type)) {
      return { kind: "unsupported", reason: "Not a video container" };
    }
    first = false;
    if (type === "uuid" && size >= headerSize + USER_TYPE_BYTES.byteLength) {
      const userType = await read(offset + headerSize, USER_TYPE_BYTES.byteLength);
      if (userType.byteLength < USER_TYPE_BYTES.byteLength) {
        return { kind: "unsupported", reason: "Truncated box header" };
      }
      if (sameBytes(userType, USER_TYPE_BYTES)) {
        if (size !== THUMB_BOX_SIZE || canonical != null) {
          return { kind: "unsupported", reason: "Invalid uuid box size" };
        }
        canonical = offset;
      } else if (
        size === LEGACY_BOX_SIZE &&
        sameBytes(userType, LEGACY_USER_TYPE)
      ) {
        legacy = offset;
      }
    }
    offset += size;
  }

  if (offset !== fileSize) {
    return { kind: "unsupported", reason: "Container boxes do not cover the file" };
  }
  return { kind: "ok", fileSize, canonical, legacy };
}

function trailingPlaybackEnd(scan: Extract<Scan, { kind: "ok" }>): number {
  let end = scan.fileSize;
  const boxes = [
    scan.canonical == null
      ? null
      : { offset: scan.canonical, size: THUMB_BOX_SIZE },
    scan.legacy == null ? null : { offset: scan.legacy, size: LEGACY_BOX_SIZE },
  ]
    .filter((box): box is { offset: number; size: number } => box != null)
    .sort((left, right) => right.offset - left.offset);
  for (const box of boxes) {
    if (box.offset + box.size === end) {
      end = box.offset;
    }
  }
  return end;
}

/** Byte length browsers should read for playback, omitting a trailing thumb box. */
export async function playbackEndOffset(
  fileSize: number,
  read: Reader,
): Promise<number> {
  const scan = await scanContainer(fileSize, read);
  if (scan.kind !== "ok") {
    return fileSize;
  }
  return trailingPlaybackEnd(scan);
}

export async function playbackBlobFromFile(file: File): Promise<Blob> {
  const end = await playbackEndOffset(file.size, async (offset, length) => {
    const data = await file.slice(offset, offset + length).arrayBuffer();
    return new Uint8Array(data);
  });
  if (end >= file.size) {
    return file;
  }
  return file.slice(0, end);
}

export async function readThumbSeek(
  fileSize: number,
  read: Reader,
): Promise<number | undefined> {
  const scan = await scanContainer(fileSize, read);
  if (scan.kind !== "ok") {
    return undefined;
  }
  if (scan.canonical != null) {
    return parseThumbBox(await read(scan.canonical, THUMB_BOX_SIZE));
  }
  if (scan.legacy != null) {
    return parseLegacyThumbBox(await read(scan.legacy, LEGACY_BOX_SIZE));
  }
  return undefined;
}

export async function readThumbSeekFromBlob(
  blob: Blob,
): Promise<number | undefined> {
  return readThumbSeek(blob.size, async (offset, length) => {
    const data = await blob.slice(offset, offset + length).arrayBuffer();
    return new Uint8Array(data);
  });
}

export async function hasLegacyThumbBox(
  fileSize: number,
  read: Reader,
): Promise<boolean> {
  const scan = await scanContainer(fileSize, read);
  return scan.kind === "ok" && scan.legacy != null;
}

export async function hasLegacyThumbBoxFromBlob(blob: Blob): Promise<boolean> {
  return hasLegacyThumbBox(blob.size, async (offset, length) => {
    const data = await blob.slice(offset, offset + length).arrayBuffer();
    return new Uint8Array(data);
  });
}

async function removeBox(
  read: Reader,
  write: Writer,
  truncate: (size: number) => Promise<void>,
  offset: number,
  boxSize: number,
  fileSize: number,
): Promise<void> {
  const tailStart = offset + boxSize;
  const tailLength = fileSize - tailStart;
  if (tailLength < 0) {
    throw new Error("Thumbnail metadata could not be verified");
  }
  if (tailLength === 0) {
    await truncate(offset);
    return;
  }
  const chunkSize = 1024 * 1024;
  let copied = 0;
  while (copied < tailLength) {
    const length = Math.min(chunkSize, tailLength - copied);
    const bytes = await read(tailStart + copied, length);
    if (bytes.byteLength !== length) {
      throw new Error("Thumbnail metadata could not be verified");
    }
    await write(offset + copied, bytes);
    copied += length;
  }
  await truncate(fileSize - boxSize);
}

export async function embedThumbSeek(
  fileSize: number,
  read: Reader,
  write: Writer,
  seconds: number,
  options?: { truncate?: (size: number) => Promise<void> },
): Promise<"appended" | "overwritten"> {
  const scan = await scanContainer(fileSize, read);
  if (scan.kind === "unsupported") {
    throw new UnsupportedMediaContainerError(scan.reason);
  }

  const box = createThumbBox(seconds);
  const mode = scan.canonical == null ? "appended" : "overwritten";
  const writeOffset = scan.canonical ?? fileSize;
  const previous =
    mode === "overwritten" ? await read(writeOffset, THUMB_BOX_SIZE) : null;

  try {
    await write(writeOffset, box);
    const stored = await read(writeOffset, THUMB_BOX_SIZE);
    if (!sameBytes(stored, box)) {
      throw new Error("Thumbnail metadata could not be verified");
    }
  } catch (error) {
    if (mode === "appended" && options?.truncate) {
      await options.truncate(fileSize).catch(() => undefined);
    } else if (previous && previous.byteLength === THUMB_BOX_SIZE) {
      await write(writeOffset, previous).catch(() => undefined);
    }
    throw error;
  }

  if (scan.legacy != null && options?.truncate) {
    const sizeAfterWrite = mode === "appended" ? fileSize + THUMB_BOX_SIZE : fileSize;
    await removeBox(
      read,
      write,
      options.truncate,
      scan.legacy,
      LEGACY_BOX_SIZE,
      sizeAfterWrite,
    );
  }
  return mode;
}

/** Small ISO BMFF file used by tests and the migration rehearsal. */
export function createMinimalBmff(extra: Uint8Array = new Uint8Array()): Uint8Array {
  const ftyp = encodeBox(
    "ftyp",
    concat([ascii("isom"), new Uint8Array(4), ascii("isom")]),
  );
  const mdat = encodeBox("mdat", ascii("testdata"));
  return concat([ftyp, mdat, extra]);
}
