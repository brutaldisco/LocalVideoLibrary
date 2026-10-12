import { toBrowserSafeFileName } from "./browser-file-name";
import { VIDEO_EXTENSIONS } from "./file-helpers";
import { clampIntervalMs } from "./slideshow-timing";

export interface AlbumItem {
  file: string;
  capturedAt: string;
  sourceLibraryId?: string;
  sourceLibraryName?: string;
  sourcePath: string;
  sourceTimeSeconds: number;
}

export interface AlbumManifest {
  version: 1;
  intervalMs: number;
  items: AlbumItem[];
}

export const ALBUM_MANIFEST_FILE = "album.json";
export const SNAPSHOT_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]);

const MAX_FILE_NAME_LENGTH = 120;

function stripVideoExtension(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of VIDEO_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return name.slice(0, name.length - ext.length);
    }
  }
  return name;
}

function formatSnapshotTimeStamp(timeSeconds: number): string {
  const safeSeconds = Math.max(0, timeSeconds);
  const totalMs = Math.round(safeSeconds * 1000);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const mmm = String(millis).padStart(3, "0");
  return `${mm}-${ss}-${mmm}`;
}

function truncateBaseForFileName(base: string, suffix: string): string {
  const maxBase = MAX_FILE_NAME_LENGTH - suffix.length;
  if (maxBase <= 0) {
    return "";
  }
  if (base.length <= maxBase) {
    return base;
  }
  return base.slice(0, maxBase);
}

export function isSnapshotImageName(name: string): boolean {
  if (name.toLowerCase() === ALBUM_MANIFEST_FILE) {
    return false;
  }
  const lower = name.toLowerCase();
  for (const ext of SNAPSHOT_IMAGE_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

export function buildSnapshotFileName(
  videoBaseName: string,
  timeSeconds: number,
  existingNames: ReadonlySet<string>,
): string {
  const stripped = stripVideoExtension(videoBaseName);
  let safeBase = stripped.trim()
    ? toBrowserSafeFileName(stripped).trim()
    : "";
  if (!safeBase) {
    safeBase = "frame";
  }
  const stamp = formatSnapshotTimeStamp(timeSeconds);
  const coreSuffix = `__${stamp}.jpg`;
  safeBase = truncateBaseForFileName(safeBase, coreSuffix);
  if (!safeBase) {
    safeBase = "frame";
  }

  let candidate = `${safeBase}${coreSuffix}`;
  if (!existingNames.has(candidate)) {
    return candidate;
  }
  let n = 2;
  while (n < 10000) {
    const collisionSuffix = `__${stamp}-${n}.jpg`;
    const collisionBase = stripped.trim()
      ? toBrowserSafeFileName(stripped).trim()
      : "";
    const base = truncateBaseForFileName(collisionBase || "frame", collisionSuffix);
    candidate = `${base || "frame"}${collisionSuffix}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
    n += 1;
  }
  return candidate;
}

export function emptyAlbumManifest(): AlbumManifest {
  return {
    version: 1,
    intervalMs: clampIntervalMs(1000),
    items: [],
  };
}

function parseAlbumItem(value: unknown): AlbumItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.file !== "string" || !row.file) {
    return null;
  }
  const item: AlbumItem = {
    file: row.file,
    capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : "",
    sourcePath: typeof row.sourcePath === "string" ? row.sourcePath : "",
    sourceTimeSeconds:
      typeof row.sourceTimeSeconds === "number" &&
      Number.isFinite(row.sourceTimeSeconds) &&
      row.sourceTimeSeconds >= 0
        ? row.sourceTimeSeconds
        : 0,
  };
  if (typeof row.sourceLibraryId === "string") {
    item.sourceLibraryId = row.sourceLibraryId;
  }
  if (typeof row.sourceLibraryName === "string") {
    item.sourceLibraryName = row.sourceLibraryName;
  }
  return item;
}

export function parseAlbumManifest(raw: unknown): AlbumManifest {
  if (!raw || typeof raw !== "object") {
    return emptyAlbumManifest();
  }
  const row = raw as Record<string, unknown>;
  const intervalMs =
    typeof row.intervalMs === "number"
      ? clampIntervalMs(row.intervalMs)
      : clampIntervalMs(1000);
  const itemsRaw = Array.isArray(row.items) ? row.items : [];
  const items: AlbumItem[] = [];
  for (const entry of itemsRaw) {
    const parsed = parseAlbumItem(entry);
    if (parsed) {
      items.push(parsed);
    }
  }
  return {
    version: 1,
    intervalMs,
    items,
  };
}

export function reconcileAlbumManifest(
  manifest: AlbumManifest,
  fileNames: readonly string[],
): AlbumManifest {
  const nameSet = new Set(fileNames);
  const kept = manifest.items.filter((item) => nameSet.has(item.file));
  const known = new Set(kept.map((item) => item.file));
  const appended = fileNames
    .filter((name) => isSnapshotImageName(name) && !known.has(name))
    .sort((a, b) => a.localeCompare(b))
    .map(
      (file): AlbumItem => ({
        file,
        capturedAt: "",
        sourcePath: "",
        sourceTimeSeconds: 0,
      }),
    );
  return {
    version: 1,
    intervalMs: clampIntervalMs(manifest.intervalMs),
    items: [...kept, ...appended],
  };
}

export function moveAlbumFileOrder(
  files: readonly string[],
  fromFile: string,
  toFile: string,
): string[] {
  const from = files.indexOf(fromFile);
  const to = files.indexOf(toFile);
  if (from < 0 || to < 0 || from === to) {
    return [...files];
  }
  const next = [...files];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function orderAlbumItems(
  items: readonly AlbumItem[],
  fileOrder: readonly string[],
): AlbumItem[] {
  const byFile = new Map(items.map((item) => [item.file, item]));
  const ordered: AlbumItem[] = [];
  const seen = new Set<string>();
  for (const file of fileOrder) {
    const item = byFile.get(file);
    if (!item || seen.has(file)) {
      continue;
    }
    ordered.push(item);
    seen.add(file);
  }
  for (const item of items) {
    if (!seen.has(item.file)) {
      ordered.push(item);
    }
  }
  return ordered;
}

export function serializeAlbumManifest(manifest: AlbumManifest): string {
  const payload: AlbumManifest = {
    version: 1,
    intervalMs: clampIntervalMs(manifest.intervalMs),
    items: manifest.items,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
