import {
  formatPlaybackRate,
  indexForPlaybackRate,
  PLAYBACK_RATES,
  playbackRateAt,
} from "../lib/playback-rate";

export function PlaybackSpeedSlider({
  rate,
  onChange,
  compact = false,
}: {
  rate: number;
  onChange: (rate: number) => void;
  compact?: boolean;
}) {
  const index = indexForPlaybackRate(rate);
  const label = formatPlaybackRate(rate);

  return (
    <label
      className={
        compact ? "video-player-speed-compact" : "video-player-speed"
      }
    >
      {compact ? (
        <span className="video-player-speed-compact-label">Speed</span>
      ) : (
        <span className="video-player-speed-label">Speed</span>
      )}
      <input
        className="video-player-speed-slider"
        data-playback-rate-slider=""
        type="range"
        min={0}
        max={PLAYBACK_RATES.length - 1}
        step={1}
        value={index}
        aria-label="Playback speed"
        aria-valuemin={0}
        aria-valuemax={PLAYBACK_RATES.length - 1}
        aria-valuenow={index}
        aria-valuetext={label}
        onChange={(event) => {
          onChange(playbackRateAt(Number(event.target.value)));
        }}
      />
      <span
        className={
          compact
            ? "video-player-speed-compact-value"
            : "video-player-speed-value"
        }
      >
        {label}
      </span>
    </label>
  );
}
