export const SLIDESHOW_INTERVAL_MIN_MS = 30;
export const SLIDESHOW_INTERVAL_MAX_MS = 5000;
export const SLIDESHOW_INTERVAL_STEP_MS = 10;
export const SLIDESHOW_INTERVAL_DEFAULT_MS = 1000;
export const SLIDESHOW_FLASH_NOTICE_MS = 333;

export function clampIntervalMs(ms: number): number {
  if (!Number.isFinite(ms)) {
    return SLIDESHOW_INTERVAL_DEFAULT_MS;
  }
  const snapped =
    Math.round(ms / SLIDESHOW_INTERVAL_STEP_MS) * SLIDESHOW_INTERVAL_STEP_MS;
  return Math.min(
    SLIDESHOW_INTERVAL_MAX_MS,
    Math.max(SLIDESHOW_INTERVAL_MIN_MS, snapped),
  );
}

export function formatInterval(ms: number): string {
  const clamped = clampIntervalMs(ms);
  if (clamped < 1000) {
    return `${clamped} ms`;
  }
  const seconds = clamped / 1000;
  if (Number.isInteger(seconds)) {
    return `${seconds} s`;
  }
  const text = seconds.toFixed(2).replace(/0$/, "");
  return `${text} s`;
}

export function nextIntervalStep(ms: number, direction: 1 | -1): number {
  return clampIntervalMs(clampIntervalMs(ms) + direction * SLIDESHOW_INTERVAL_STEP_MS);
}

export function nextDeadline(
  startMs: number,
  index: number,
  intervalMs: number,
): number {
  const interval = clampIntervalMs(intervalMs);
  return startMs + (index + 1) * interval;
}
