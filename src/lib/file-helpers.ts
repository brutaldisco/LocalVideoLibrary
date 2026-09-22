import {
  browserFileNameBlockReason,
  toBrowserSafeFileName,
} from "./browser-file-name";
import type { SortDirection, SortKey, VideoFileEntry } from "./types";

export const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".ogv",
  ".ogg",
]);

export const PAGE_SIZE = 180;

export function normalizeFolderPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function splitFolderPath(path: string): string[] {
  const normalized = normalizeFolderPath(path);
  return normalized ? normalized.split("/") : [];
}

export function parentFolderPath(path: string): string {
  const parts = splitFolderPath(path);
  parts.pop();
  return parts.join("/");
}

export function folderNameFromPath(path: string): string {
  const parts = splitFolderPath(path);
  return parts[parts.length - 1] ?? "";
}

export function joinFolderPath(parent: string, name: string): string {
  const base = normalizeFolderPath(parent);
  const leaf = name.trim();
  if (!base) {
    return leaf;
  }
  if (!leaf) {
    return base;
  }
  return `${base}/${leaf}`;
}

export function isVideoFileName(name: string): boolean {
  const lower = name.toLowerCase();
  for (const ext of VIDEO_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

export function validateEntryName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Name cannot be empty";
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return "Path separators are not allowed";
  }
  if (trimmed === "." || trimmed === "..") {
    return "Invalid name";
  }
  const blocked = browserFileNameBlockReason(trimmed);
  if (blocked) {
    return `Chrome cannot modify "${trimmed}" because it ${blocked}. Rename it to "${toBrowserSafeFileName(trimmed)}".`;
  }
  return null;
}

export function validateVideoFileName(name: string): string | null {
  const base = validateEntryName(name);
  if (base) {
    return base;
  }
  if (!isVideoFileName(name)) {
    return "Unsupported video extension";
  }
  return null;
}

export function validateFolderPath(path: string): string | null {
  const normalized = normalizeFolderPath(path);
  if (!normalized) {
    return null;
  }
  for (const part of splitFolderPath(normalized)) {
    const err = validateEntryName(part);
    if (err) {
      return err;
    }
  }
  return null;
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const VIDEO_QUALITY_LEVELS = [
  { shortSide: 4320, longSide: 7680, label: "8K" },
  { shortSide: 2160, longSide: 3840, label: "4K" },
  { shortSide: 1440, longSide: 2560, label: "1440p" },
  { shortSide: 1080, longSide: 1920, label: "1080p" },
  { shortSide: 720, longSide: 1280, label: "720p" },
  { shortSide: 480, longSide: 854, label: "480p" },
  { shortSide: 360, longSide: 640, label: "360p" },
] as const;

export function formatVideoQuality(width?: number, height?: number): string | undefined {
  if (
    width == null ||
    height == null ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  for (const level of VIDEO_QUALITY_LEVELS) {
    if (shortSide >= level.shortSide * 0.94 || longSide >= level.longSide * 0.94) {
      return level.label;
    }
  }
  return `${Math.round(shortSide)}p`;
}

export function formatDate(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) {
    return "—";
  }
  return new Date(ms).toLocaleString();
}

export function formatDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return "—";
  }
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function matchesSearch(
  entry: VideoFileEntry,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return (
    entry.name.toLowerCase().includes(q) ||
    entry.folderPath.toLowerCase().includes(q) ||
    entry.path.toLowerCase().includes(q)
  );
}

export function filterVideos(
  videos: VideoFileEntry[],
  options: {
    query: string;
    folderPath: string | null;
  },
): VideoFileEntry[] {
  return videos.filter((entry) => {
    if (options.folderPath != null && entry.folderPath !== options.folderPath) {
      return false;
    }
    return matchesSearch(entry, options.query);
  });
}

export function sortVideos(
  videos: VideoFileEntry[],
  key: SortKey,
  direction: SortDirection,
  durations: ReadonlyMap<string, number | undefined>,
): VideoFileEntry[] {
  const sorted = [...videos];
  const sign = direction === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "name":
        cmp = naturalCompare(a.name, b.name);
        break;
      case "folder":
        cmp = naturalCompare(a.folderPath, b.folderPath);
        if (cmp === 0) {
          cmp = naturalCompare(a.name, b.name);
        }
        break;
      case "modified":
        cmp = (a.lastModified ?? 0) - (b.lastModified ?? 0);
        break;
      case "size":
        cmp = a.size - b.size;
        break;
      case "duration": {
        const da = durations.get(a.id) ?? -1;
        const db = durations.get(b.id) ?? -1;
        cmp = da - db;
        break;
      }
      default:
        cmp = 0;
    }
    if (cmp === 0) {
      cmp = naturalCompare(a.path, b.path);
    }
    return cmp * sign;
  });
  return sorted;
}

export function buildFolderEntries(
  videos: VideoFileEntry[],
  folders: string[],
): Array<{ path: string; name: string; count: number; totalSize: number }> {
  const map = new Map<string, { count: number; totalSize: number }>();
  for (const folder of folders) {
    map.set(folder, { count: 0, totalSize: 0 });
  }
  for (const video of videos) {
    const current = map.get(video.folderPath) ?? { count: 0, totalSize: 0 };
    current.count += 1;
    current.totalSize += video.size;
    map.set(video.folderPath, current);
  }
  return [...map.entries()]
    .map(([path, stats]) => ({
      path,
      name: path ? folderNameFromPath(path) : "(root)",
      count: stats.count,
      totalSize: stats.totalSize,
    }))
    .sort((a, b) => naturalCompare(a.path, b.path));
}
