export const SLIDESHOW_INTERVAL_MIN_MS = 30;
export const SLIDESHOW_INTERVAL_MAX_MS = 5000;
export const SLIDESHOW_INTERVAL_DEFAULT_MS = 1000;
export const SLIDESHOW_FLASH_NOTICE_MS = 333;

const LOG_MIN = Math.log(SLIDESHOW_INTERVAL_MIN_MS);
const LOG_MAX = Math.log(SLIDESHOW_INTERVAL_MAX_MS);
const LOG_RANGE = LOG_MAX - LOG_MIN;
const KEYBOARD_STEP = 1 / 24;

export function clampIntervalMs(ms: number): number {
  if (!Number.isFinite(ms)) {
    return SLIDESHOW_INTERVAL_DEFAULT_MS;
  }
  const rounded = Math.round(ms);
  return Math.min(
    SLIDESHOW_INTERVAL_MAX_MS,
    Math.max(SLIDESHOW_INTERVAL_MIN_MS, rounded),
  );
}

export function intervalToSlider(ms: number): number {
  const clamped = clampIntervalMs(ms);
  if (clamped <= SLIDESHOW_INTERVAL_MIN_MS) {
    return 0;
  }
  if (clamped >= SLIDESHOW_INTERVAL_MAX_MS) {
    return 1;
  }
  return (Math.log(clamped) - LOG_MIN) / LOG_RANGE;
}

export function sliderToInterval(t: number): number {
  const clampedT = Math.min(1, Math.max(0, t));
  const raw = Math.exp(LOG_MIN + clampedT * LOG_RANGE);
  return clampIntervalMs(raw);
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
  return `${seconds.toFixed(1)} s`;
}

export function nextIntervalStep(ms: number, direction: 1 | -1): number {
  const slider = intervalToSlider(ms);
  return sliderToInterval(slider + direction * KEYBOARD_STEP);
}

export function nextDeadline(
  startMs: number,
  index: number,
  intervalMs: number,
): number {
  const interval = clampIntervalMs(intervalMs);
  return startMs + (index + 1) * interval;
}
