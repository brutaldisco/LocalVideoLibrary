import {
  clampIntervalMs,
  formatInterval,
  SLIDESHOW_INTERVAL_MAX_MS,
  SLIDESHOW_INTERVAL_MIN_MS,
  SLIDESHOW_INTERVAL_STEP_MS,
} from "../lib/slideshow-timing";

export function IntervalSlider({
  value,
  onChange,
  labelledBy,
}: {
  value: number;
  onChange: (intervalMs: number) => void;
  labelledBy?: string;
}) {
  const position = clampIntervalMs(value);
  const label = formatInterval(position);

  return (
    <label className="interval-control">
      <span id={labelledBy}>Interval</span>
      <input
        type="range"
        min={SLIDESHOW_INTERVAL_MIN_MS}
        max={SLIDESHOW_INTERVAL_MAX_MS}
        step={SLIDESHOW_INTERVAL_STEP_MS}
        value={position}
        aria-label={`Interval, ${label}`}
        aria-valuemin={SLIDESHOW_INTERVAL_MIN_MS}
        aria-valuemax={SLIDESHOW_INTERVAL_MAX_MS}
        aria-valuenow={position}
        aria-valuetext={label}
        onChange={(event) => {
          onChange(clampIntervalMs(Number(event.target.value)));
        }}
      />
      <span className="interval-readout">{label}</span>
    </label>
  );
}
