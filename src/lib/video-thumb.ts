import type { VideoFileEntry, VideoMeta } from "./types";

const THUMB_SEEK_RATIO = 0.1;
const THUMB_SEEK_FALLBACK_SECONDS = 1.5;
const THUMB_WIDTH = 320;
const THUMB_JPEG_QUALITY = 0.72;

export function defaultThumbSeekSeconds(duration?: number): number {
  if (duration != null && Number.isFinite(duration) && duration > 0) {
    return duration * THUMB_SEEK_RATIO;
  }
  return THUMB_SEEK_FALLBACK_SECONDS;
}

export function resolveThumbSeekSeconds(
  duration: number | undefined,
  customSeek?: number,
): number {
  if (customSeek != null && Number.isFinite(customSeek) && customSeek >= 0) {
    if (duration != null && Number.isFinite(duration) && duration > 0) {
      return Math.min(customSeek, Math.max(0, duration - 0.1));
    }
    return customSeek;
  }
  return defaultThumbSeekSeconds(duration);
}

function waitForEvent(
  target: EventTarget,
  eventName: string,
  timeoutMs = 15000,
): Promise<Event> {
  return new Promise((resolve, reject) => {
    const onSuccess = (event: Event) => {
      cleanup();
      resolve(event);
    };
    const onError = () => {
      cleanup();
      reject(new Error(`${eventName} failed`));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${eventName} timed out`));
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(eventName, onSuccess);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(eventName, onSuccess, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

async function loadVideoMetaFromUrl(
  objectUrl: string,
  seekSeconds?: number,
): Promise<{
  duration?: number;
  thumbUrl?: string;
  thumbSeekSeconds?: number;
  customThumb?: boolean;
}> {
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    await waitForEvent(video, "loadedmetadata");
    const duration = Number.isFinite(video.duration) ? video.duration : undefined;
    const resolvedSeek = resolveThumbSeekSeconds(duration, seekSeconds);
    const customThumb = seekSeconds != null;

    let thumbUrl: string | undefined;
    try {
      video.currentTime = resolvedSeek;
      await waitForEvent(video, "seeked");
      const width = THUMB_WIDTH;
      const height = Math.max(
        1,
        Math.round((video.videoHeight / Math.max(video.videoWidth, 1)) * width),
      );
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        thumbUrl = canvas.toDataURL("image/jpeg", THUMB_JPEG_QUALITY);
      }
    } catch {
      // Preview failure should not drop the item from the list.
    }

    return {
      duration,
      thumbUrl,
      thumbSeekSeconds: resolvedSeek,
      customThumb,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

export async function loadVideoMeta(
  entry: VideoFileEntry,
  createObjectUrl: (entry: VideoFileEntry) => Promise<string>,
  options?: { seekSeconds?: number },
): Promise<VideoMeta> {
  let objectUrl: string | null = null;
  try {
    objectUrl = await createObjectUrl(entry);
    const meta = await loadVideoMetaFromUrl(objectUrl, options?.seekSeconds);
    return meta;
  } catch {
    return { failed: true };
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

export async function loadVideoMetaBatch(
  entries: VideoFileEntry[],
  createObjectUrl: (entry: VideoFileEntry) => Promise<string>,
  onUpdate: (id: string, meta: VideoMeta) => void,
  isCancelled: () => boolean,
  getSeekSeconds?: (entry: VideoFileEntry) => number | undefined,
): Promise<void> {
  for (const entry of entries) {
    if (isCancelled()) {
      return;
    }
    const meta = await loadVideoMeta(entry, createObjectUrl, {
      seekSeconds: getSeekSeconds?.(entry),
    });
    if (isCancelled()) {
      return;
    }
    onUpdate(entry.id, meta);
  }
}
