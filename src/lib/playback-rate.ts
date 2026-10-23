/** 0.5–1.9 by tenths, then 2, 3, 4, and 5. */
export const PLAYBACK_RATES: readonly number[] = [
  ...Array.from({ length: 15 }, (_, index) => (index + 5) / 10),
  2,
  3,
  4,
  5,
];

export const DEFAULT_PLAYBACK_RATE = 1;

const STORAGE_KEY = "lvl-video-playback-rate";

export function playbackRateAt(index: number): number {
  if (!Number.isFinite(index)) {
    return DEFAULT_PLAYBACK_RATE;
  }
  const clamped = Math.min(
    PLAYBACK_RATES.length - 1,
    Math.max(0, Math.round(index)),
  );
  return PLAYBACK_RATES[clamped] ?? DEFAULT_PLAYBACK_RATE;
}

export function indexForPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return PLAYBACK_RATES.indexOf(DEFAULT_PLAYBACK_RATE);
  }
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < PLAYBACK_RATES.length; index += 1) {
    const distance = Math.abs(PLAYBACK_RATES[index] - rate);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

export function parsePlaybackRate(value: unknown): number {
  if (value == null || value === "") {
    return DEFAULT_PLAYBACK_RATE;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_PLAYBACK_RATE;
  }
  return playbackRateAt(indexForPlaybackRate(numeric));
}

export function formatPlaybackRate(rate: number): string {
  const snapped = parsePlaybackRate(rate);
  if (snapped >= 2) {
    return `${snapped.toFixed(0)}x`;
  }
  return `${snapped.toFixed(1)}x`;
}

export function loadPlaybackRate(): number {
  if (typeof window === "undefined") {
    return DEFAULT_PLAYBACK_RATE;
  }
  try {
    return parsePlaybackRate(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_PLAYBACK_RATE;
  }
}

export function savePlaybackRate(rate: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(parsePlaybackRate(rate)));
  } catch {
    /* Ignore blocked storage. */
  }
}
