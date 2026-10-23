import {
  formatPlaybackRate,
  indexForPlaybackRate,
  PLAYBACK_RATES,
  playbackRateAt,
} from "../lib/playback-rate";

export function PlaybackSpeedSlider({
  rate,
  onChange,
}: {
  rate: number;
  onChange: (rate: number) => void;
}) {
  const index = indexForPlaybackRate(rate);
  const label = formatPlaybackRate(rate);

  return (
    <label className="video-player-speed">
      <span className="video-player-speed-label">Speed</span>
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
      <span className="video-player-speed-value">{label}</span>
    </label>
  );
}
