import {
  formatInterval,
  intervalToSlider,
  sliderToInterval,
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
  const position = Math.round(intervalToSlider(value) * 1000);
  const label = formatInterval(value);

  return (
    <label className="interval-control">
      <span id={labelledBy}>Interval</span>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={position}
        aria-label={`Interval, ${label}`}
        aria-valuemin={0}
        aria-valuemax={1000}
        aria-valuenow={position}
        aria-valuetext={label}
        onChange={(event) => {
          const next = sliderToInterval(Number(event.target.value) / 1000);
          onChange(next);
        }}
      />
      <span className="interval-readout">{label}</span>
    </label>
  );
}
