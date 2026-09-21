import { idbDel, idbGet } from "./idb";
import type { VideoFileEntry, VideoStorageAdapter } from "./types";

export const THUMB_SIDECAR_SUFFIX = ".lvl.json";
const LEGACY_THUMB_POSITIONS_KEY = "video-thumb-positions";
const YIELD_EVERY = 48;

export interface ThumbSidecarData {
  version: 1;
  thumbSeekSeconds: number;
}

export function thumbSidecarName(videoFileName: string): string {
  return `${videoFileName}${THUMB_SIDECAR_SUFFIX}`;
}

export function isThumbSidecarFileName(name: string): boolean {
  return name.endsWith(THUMB_SIDECAR_SUFFIX);
}

export function parseThumbSidecar(text: string): number | undefined {
  try {
    const data = JSON.parse(text) as Partial<ThumbSidecarData>;
    const seconds = data.thumbSeekSeconds;
    if (
      typeof seconds === "number" &&
      Number.isFinite(seconds) &&
      seconds >= 0
    ) {
      return seconds;
    }
  } catch {
    // Invalid sidecar content is ignored.
  }
  return undefined;
}

export function serializeThumbSidecar(seconds: number): string {
  const payload: ThumbSidecarData = {
    version: 1,
    thumbSeekSeconds: seconds,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

export async function loadThumbPositionsFromVideos(
  adapter: VideoStorageAdapter,
  videos: VideoFileEntry[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (let index = 0; index < videos.length; index += 1) {
    if (index % YIELD_EVERY === 0) {
      await yieldToMain();
    }
    const entry = videos[index];
    const seconds = await adapter.loadThumbSeekSeconds(entry);
    if (seconds != null) {
      map.set(entry.id, seconds);
    }
  }
  return map;
}

type LegacyThumbPositionMap = Record<string, number>;

async function readLegacyThumbMap(): Promise<LegacyThumbPositionMap> {
  return (await idbGet<LegacyThumbPositionMap>(LEGACY_THUMB_POSITIONS_KEY)) ?? {};
}

async function clearLegacyThumbMap(): Promise<void> {
  await idbDel(LEGACY_THUMB_POSITIONS_KEY);
}

export async function migrateLegacyThumbPositionsToSidecars(
  adapter: VideoStorageAdapter,
  videos: VideoFileEntry[],
  current: Map<string, number>,
): Promise<Map<string, number>> {
  if (!adapter.writable) {
    return current;
  }

  const legacy = await readLegacyThumbMap();
  const entries = Object.entries(legacy);
  if (entries.length === 0) {
    return current;
  }

  const next = new Map(current);
  const videoById = new Map(videos.map((entry) => [entry.id, entry]));
  let migrated = 0;

  for (const [id, seconds] of entries) {
    if (
      typeof seconds !== "number" ||
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      continue;
    }
    const video = videoById.get(id);
    if (!video || next.has(id)) {
      continue;
    }
    await adapter.saveThumbSeekSeconds(video, seconds);
    next.set(id, seconds);
    migrated += 1;
  }

  if (migrated > 0) {
    await clearLegacyThumbMap();
  }

  return next;
}
