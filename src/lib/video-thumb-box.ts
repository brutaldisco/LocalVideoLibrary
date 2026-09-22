export const THUMB_BOX_SIZE = 64;
const USER_TYPE = "lvl-thumb-seek01";
const USER_TYPE_BYTES = ascii(USER_TYPE);
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

type Inspection =
  | { kind: "found"; offset: number }
  | { kind: "absent" }
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
  const box = new Uint8Array(THUMB_BOX_SIZE);
  const view = new DataView(box.buffer);
  view.setUint32(0, THUMB_BOX_SIZE, false);
  box.set(ascii("uuid"), 4);
  box.set(USER_TYPE_BYTES, 8);
  box[24] = 1;
  box[25] = 1;
  view.setFloat64(28, seconds, false);
  return box;
}

export function parseThumbBox(bytes: Uint8Array): number | undefined {
  if (bytes.byteLength < THUMB_BOX_SIZE) {
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
  if (bytes[24] !== 1 || (bytes[25] & 1) === 0) {
    return undefined;
  }
  const seconds = view.getFloat64(28, false);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return seconds;
}

function isThumbBox(bytes: Uint8Array): boolean {
  if (bytes.byteLength < THUMB_BOX_SIZE) {
    return false;
  }
  const view = viewOf(bytes);
  return (
    view.getUint32(0, false) === THUMB_BOX_SIZE &&
    fourcc(bytes, 4) === "uuid" &&
    sameBytes(bytes.subarray(8, 24), USER_TYPE_BYTES)
  );
}

async function inspectContainer(
  fileSize: number,
  read: Reader,
): Promise<Inspection> {
  if (fileSize < 8) {
    return { kind: "unsupported", reason: "File is too small to be a video container" };
  }

  let offset = 0;
  let found: number | null = null;
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
    if (type === "uuid" && size === THUMB_BOX_SIZE) {
      const box = await read(offset, THUMB_BOX_SIZE);
      if (isThumbBox(box)) {
        found = offset;
      }
    }
    offset += size;
  }

  if (offset !== fileSize) {
    return { kind: "unsupported", reason: "Container boxes do not cover the file" };
  }
  if (found == null) {
    return { kind: "absent" };
  }
  return { kind: "found", offset: found };
}

export async function readThumbSeek(
  fileSize: number,
  read: Reader,
): Promise<number | undefined> {
  const inspected = await inspectContainer(fileSize, read);
  if (inspected.kind !== "found") {
    return undefined;
  }
  return parseThumbBox(await read(inspected.offset, THUMB_BOX_SIZE));
}

export async function readThumbSeekFromBlob(
  blob: Blob,
): Promise<number | undefined> {
  return readThumbSeek(blob.size, async (offset, length) => {
    const data = await blob.slice(offset, offset + length).arrayBuffer();
    return new Uint8Array(data);
  });
}

export async function embedThumbSeek(
  fileSize: number,
  read: Reader,
  write: Writer,
  seconds: number,
  options?: { truncate?: (size: number) => Promise<void> },
): Promise<"appended" | "overwritten"> {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("Invalid thumbnail seek position");
  }
  const inspected = await inspectContainer(fileSize, read);
  if (inspected.kind === "unsupported") {
    throw new UnsupportedMediaContainerError(inspected.reason);
  }

  const box = createThumbBox(seconds);
  const offset = inspected.kind === "found" ? inspected.offset : fileSize;
  const mode = inspected.kind === "found" ? "overwritten" : "appended";
  const previous =
    mode === "overwritten" ? await read(offset, THUMB_BOX_SIZE) : null;

  try {
    await write(offset, box);
    const stored = parseThumbBox(await read(offset, THUMB_BOX_SIZE));
    if (stored !== seconds) {
      throw new Error("Thumbnail metadata could not be verified");
    }
    return mode;
  } catch (error) {
    if (mode === "appended" && options?.truncate) {
      await options.truncate(fileSize).catch(() => undefined);
    } else if (previous) {
      await write(offset, previous).catch(() => undefined);
    }
    throw error;
  }
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
