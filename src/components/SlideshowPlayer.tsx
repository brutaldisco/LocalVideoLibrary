import { useEffect, useRef, useState } from "react";
import { isVideoPlayerTypingTarget } from "../lib/video-player-keys";
import {
  SLIDESHOW_FLASH_NOTICE_MS,
  nextIntervalStep,
} from "../lib/slideshow-timing";
import { IntervalSlider } from "./IntervalSlider";

export interface SlideshowSlide {
  url: string;
  label: string;
}

const IDLE_HIDE_MS = 1000;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function isRangeTarget(target: unknown): boolean {
  if (target == null || typeof target !== "object") {
    return false;
  }
  const el = target as { tagName?: string; type?: string };
  return (
    String(el.tagName ?? "").toUpperCase() === "INPUT" &&
    String(el.type ?? "") === "range"
  );
}

export function SlideshowPlayer({
  albumName,
  slides,
  startIndex,
  intervalMs,
  showFlashNote,
  onClose,
  onIntervalChange,
  onDismissFlashNote,
}: {
  albumName: string;
  slides: SlideshowSlide[];
  startIndex: number;
  intervalMs: number;
  showFlashNote: boolean;
  onClose: () => void;
  onIntervalChange: (intervalMs: number) => void;
  onDismissFlashNote: () => void;
}) {
  const reducedMotion = useRef(prefersReducedMotion()).current;
  const [index, setIndex] = useState(() =>
    slides.length === 0 ? 0 : Math.min(Math.max(startIndex, 0), slides.length - 1),
  );
  const [playing, setPlaying] = useState(() => !reducedMotion && slides.length > 0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [previousIndex, setPreviousIndex] = useState<number | null>(null);
  const [previousFading, setPreviousFading] = useState(false);
  const [clockEpoch, setClockEpoch] = useState(0);
  const indexRef = useRef(index);
  indexRef.current = index;
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  const intervalRef = useRef(intervalMs);
  intervalRef.current = intervalMs;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const readyRef = useRef(new Set<string>());
  const idleTimerRef = useRef<number | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onIntervalChangeRef = useRef(onIntervalChange);
  onIntervalChangeRef.current = onIntervalChange;

  const fadeMs =
    intervalMs >= 400 && !reducedMotion ? Math.min(120, intervalMs / 3) : 0;
  const fadeMsRef = useRef(fadeMs);
  fadeMsRef.current = fadeMs;

  useEffect(() => {
    shellRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (previousIndex == null || fadeMs === 0) {
      return;
    }
    setPreviousFading(false);
    const frame = window.requestAnimationFrame(() => setPreviousFading(true));
    const timer = window.setTimeout(() => {
      setPreviousIndex(null);
      setPreviousFading(false);
    }, fadeMs);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [previousIndex, fadeMs]);

  useEffect(() => {
    const ready = readyRef.current;
    const list = slidesRef.current;
    if (list.length === 0) {
      return;
    }
    let cancelled = false;
    for (let offset = 0; offset < Math.min(4, list.length); offset += 1) {
      const slide = list[(index + offset) % list.length];
      if (!slide || ready.has(slide.url)) {
        continue;
      }
      const image = new Image();
      image.onload = () => {
        if (!cancelled) {
          ready.add(slide.url);
        }
      };
      image.src = slide.url;
    }
    return () => {
      cancelled = true;
    };
  }, [index, slides]);

  function reveal(next: number) {
    const current = indexRef.current;
    if (next === current || slidesRef.current.length === 0) {
      return;
    }
    if (fadeMsRef.current > 0) {
      setPreviousIndex(current);
    } else {
      setPreviousIndex(null);
    }
    setIndex(next);
    if (playingRef.current) {
      setClockEpoch((epoch) => epoch + 1);
    }
  }

  useEffect(() => {
    if (!playing || slides.length === 0) {
      return;
    }
    let stopped = false;
    let advances = 0;
    const origin = performance.now();
    let timer = 0;

    const arm = () => {
      const interval = intervalRef.current;
      const deadline = origin + (advances + 1) * interval;
      const delay = Math.max(0, deadline - performance.now());
      timer = window.setTimeout(() => {
        if (stopped) {
          return;
        }
        advances += 1;
        const list = slidesRef.current;
        const length = list.length;
        if (length > 1) {
          const current = indexRef.current;
          let chosen: number | null = null;
          for (let hop = 1; hop < length; hop += 1) {
            const candidate = (current + hop) % length;
            if (readyRef.current.has(list[candidate]?.url ?? "")) {
              chosen = candidate;
              break;
            }
          }
          if (chosen != null && chosen !== current) {
            if (fadeMsRef.current > 0) {
              setPreviousIndex(current);
            }
            setIndex(chosen);
          }
        }
        arm();
      }, delay);
    };

    arm();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [playing, clockEpoch, slides.length, intervalMs]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (isVideoPlayerTypingTarget(event.target)) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (isRangeTarget(event.target)) {
        return;
      }
      const length = slidesRef.current.length;
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        setPlaying((current) => !current);
        return;
      }
      if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && length > 0) {
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const next = (indexRef.current + delta + length) % length;
        reveal(next);
        return;
      }
      if (event.key === "[") {
        event.preventDefault();
        onIntervalChangeRef.current(nextIntervalStep(intervalRef.current, -1));
        return;
      }
      if (event.key === "]") {
        event.preventDefault();
        onIntervalChangeRef.current(nextIntervalStep(intervalRef.current, 1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  function clearIdle() {
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }

  function scheduleHide() {
    clearIdle();
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      setChromeVisible(false);
    }, IDLE_HIDE_MS);
  }

  useEffect(() => {
    scheduleHide();
    return () => clearIdle();
  }, []);

  const slide = slides[index];
  const previous = previousIndex != null ? slides[previousIndex] : undefined;
  const flashVisible = showFlashNote && intervalMs < SLIDESHOW_FLASH_NOTICE_MS;

  function step(delta: number) {
    if (slides.length === 0) {
      return;
    }
    const next = (index + delta + slides.length) % slides.length;
    reveal(next);
  }

  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      className={`slideshow-shell ${chromeVisible ? "" : "slideshow-shell--chrome-hidden"}`}
      onPointerMove={() => {
        setChromeVisible(true);
        scheduleHide();
      }}
    >
      <div
        className={`slideshow-top ${chromeVisible ? "is-visible" : "is-hidden"}`}
        inert={!chromeVisible}
      >
        <div>
          <p className="video-player-title">{albumName}</p>
          <p className="video-player-subtitle">
            {slides.length === 0 ? "0 / 0" : `${index + 1} / ${slides.length}`}
          </p>
        </div>
        <button type="button" className="slideshow-text-btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="slideshow-stage">
        {previous && fadeMs > 0 ? (
          <img src={previous.url} alt="" className="slideshow-image" />
        ) : null}
        {slide ? (
          <img
            src={slide.url}
            alt={slide.label}
            className={`slideshow-image${
              previous != null && fadeMs > 0 ? " is-incoming" : ""
            }${previousFading ? " is-shown" : ""}`}
            style={
              previous != null && fadeMs > 0
                ? { transitionDuration: `${fadeMs}ms` }
                : undefined
            }
          />
        ) : null}
      </div>

      <div
        className={`slideshow-bottom ${chromeVisible ? "is-visible" : "is-hidden"}`}
        inert={!chromeVisible}
        onPointerDown={() => {
          setChromeVisible(true);
          clearIdle();
        }}
        onPointerUp={() => scheduleHide()}
      >
        <div className="slideshow-transport">
          <button type="button" className="slideshow-text-btn" onClick={() => step(-1)}>
            Previous
          </button>
          <button
            type="button"
            className="slideshow-text-btn"
            onClick={() => setPlaying((current) => !current)}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="slideshow-text-btn" onClick={() => step(1)}>
            Next
          </button>
          <span className="slideshow-loop">Repeats</span>
        </div>
        <IntervalSlider value={intervalMs} onChange={onIntervalChange} />
        {flashVisible ? (
          <p className="flash-note">
            Fast changes fill the screen. Pause if this feels uncomfortable.
            <button type="button" onClick={onDismissFlashNote}>
              Dismiss
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
