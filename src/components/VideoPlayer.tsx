import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  exitFullscreen,
  getFullscreenElement,
  isFullscreen,
  requestFullscreen,
  subscribeFullscreen,
} from "../lib/video-fullscreen";
import {
  isVideoPlayerTypingTarget,
  videoPlayerKeyAction,
} from "../lib/video-player-keys";
import type { RepeatMode } from "../lib/types";
import {
  parseRepeatMode,
  REPEAT_TOGGLE_MODES,
  toggleRepeatMode,
} from "../lib/video-playlist";

const STORAGE_KEY = "lvl-video-repeat";
const SURFACE_CLICK_MS = 220;
const CONTROL_BAR_PX = 72;
const IDLE_HIDE_MS = 1000;
const CHROME_FADE_CLASS = "video-player-chrome-fade";

function toggleVideoPlayback(video: HTMLVideoElement | null): void {
  if (!video) {
    return;
  }
  if (video.paused) {
    void video.play().catch(() => undefined);
    return;
  }
  video.pause();
}

export function loadRepeatMode(): RepeatMode {
  if (typeof window === "undefined") {
    return "folder";
  }
  return parseRepeatMode(window.localStorage.getItem(STORAGE_KEY));
}

export function saveRepeatMode(mode: RepeatMode): void {
  window.localStorage.setItem(STORAGE_KEY, mode);
}

export function VideoPlayer({
  url,
  title,
  folderLabel,
  index,
  total,
  repeat,
  onRepeatChange,
  onClose,
  onPrev,
  onNext,
  onEnded,
  errorMessage,
  onUseCurrentFrameAsThumbnail,
  thumbnailSaved,
}: {
  url: string;
  title: string;
  folderLabel: string;
  index: number;
  total: number;
  repeat: RepeatMode;
  onRepeatChange: (mode: RepeatMode) => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onEnded: () => void;
  errorMessage?: string | null;
  onUseCurrentFrameAsThumbnail?: (currentTime: number) => void;
  thumbnailSaved?: boolean;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceClickRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [shellFullscreen, setShellFullscreen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!el) {
      return;
    }
    setPlaybackError(null);
    if (!url) {
      el.removeAttribute("src");
      el.load();
      return;
    }
    if (el.getAttribute("src") !== url) {
      el.src = url;
    }
  }, [url]);

  useEffect(() => {
    function sync() {
      const shell = shellRef.current;
      const video = videoRef.current;
      setShellFullscreen(Boolean(shell && getFullscreenElement() === shell));
      if (shell && video && getFullscreenElement() === video) {
        void exitFullscreen()
          .then(() => requestFullscreen(shell))
          .catch(() => undefined);
      }
    }
    sync();
    return subscribeFullscreen(sync);
  }, []);

  function focusShell() {
    shellRef.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!url) {
      return;
    }
    shellRef.current?.focus({ preventScroll: true });
  }, [url]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = videoPlayerKeyAction(event);
      if (!action) {
        return;
      }
      if (isVideoPlayerTypingTarget(event.target)) {
        return;
      }
      if (action === "close") {
        if (isFullscreen()) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (action === "next") {
        onNext();
        return;
      }
      if (action === "prev") {
        onPrev();
        return;
      }
      toggleVideoPlayback(videoRef.current);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const action = videoPlayerKeyAction(event);
      if (action !== "next" && action !== "prev") {
        return;
      }
      if (isVideoPlayerTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    const video = videoRef.current;
    video?.addEventListener("keydown", onKey, true);
    video?.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      video?.removeEventListener("keydown", onKey, true);
      video?.removeEventListener("keyup", onKeyUp, true);
    };
  }, [onClose, onNext, onPrev]);

  function clearIdleTimer() {
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }

  function scheduleChromeHide() {
    clearIdleTimer();
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      setChromeVisible(false);
    }, IDLE_HIDE_MS);
  }

  function onPointerActivity() {
    setChromeVisible(true);
    scheduleChromeHide();
  }

  useEffect(() => {
    setMenuOpen(false);
  }, [url]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      setChromeVisible(false);
    }, IDLE_HIDE_MS);
    return () => {
      if (idleTimerRef.current != null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      if (surfaceClickRef.current != null) {
        window.clearTimeout(surfaceClickRef.current);
      }
    };
  }, []);

  async function toggleFullscreen() {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    if (getFullscreenElement() === shell) {
      await exitFullscreen().catch(() => undefined);
      return;
    }
    await requestFullscreen(shell).catch(() => undefined);
  }

  function clearSurfaceClick() {
    if (surfaceClickRef.current != null) {
      window.clearTimeout(surfaceClickRef.current);
      surfaceClickRef.current = null;
    }
  }

  function onSurfaceClick() {
    if (surfaceClickRef.current != null) {
      clearSurfaceClick();
      return;
    }
    surfaceClickRef.current = window.setTimeout(() => {
      surfaceClickRef.current = null;
      toggleVideoPlayback(videoRef.current);
    }, SURFACE_CLICK_MS);
  }

  function onSurfaceDoubleClick() {
    clearSurfaceClick();
    void toggleFullscreen();
  }

  function handleUseCurrentFrameAsThumbnail() {
    const video = videoRef.current;
    if (!video || !onUseCurrentFrameAsThumbnail || !url) {
      return;
    }
    if (!Number.isFinite(video.currentTime)) {
      return;
    }
    onUseCurrentFrameAsThumbnail(video.currentTime);
  }

  const chromeHiddenClass = chromeVisible
    ? "video-player-chrome-visible"
    : "video-player-chrome-hidden";

  const displayError = errorMessage ?? playbackError;

  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      className={`video-player-shell ${chromeVisible ? "" : "video-player-shell--chrome-hidden"}`}
      onPointerMove={onPointerActivity}
      onPointerDown={onPointerActivity}
    >
      <div
        className={`video-player-top ${CHROME_FADE_CLASS} ${chromeHiddenClass}`}
        inert={!chromeVisible}
      >
        <div className="video-player-meta">
          <p className="video-player-title">{title}</p>
          <p className="video-player-subtitle">
            {folderLabel}
            {total > 0 ? ` · ${index + 1} / ${total}` : ""}
          </p>
        </div>
        <div className="video-player-top-actions">
          {onUseCurrentFrameAsThumbnail ? (
            <div className="video-player-menu-wrap" ref={menuRef}>
              <IconButton
                label="More options"
                pressed={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreVerticalIcon />
              </IconButton>
              {menuOpen ? (
                <div className="video-player-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className={`video-player-menu-item ${thumbnailSaved ? "is-saved" : ""}`}
                    disabled={!url}
                    onClick={() => {
                      handleUseCurrentFrameAsThumbnail();
                      setMenuOpen(false);
                    }}
                  >
                    {thumbnailSaved
                      ? "Thumbnail saved"
                      : "Use current frame as thumbnail"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <IconButton
            label={shellFullscreen ? "Exit fullscreen" : "Fullscreen"}
            pressed={shellFullscreen}
            onClick={() => void toggleFullscreen()}
          >
            {shellFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
          </IconButton>
          <IconButton label="Close" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
      </div>

      <div className="video-player-stage">
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          controlsList="nofullscreen"
          loop={repeat === "one"}
          tabIndex={-1}
          className="video-player-video"
          onFocus={focusShell}
          onPointerUp={focusShell}
          onError={() => {
            setPlaybackError(
              "This video could not be played. The file may be missing, moved, or use an unsupported codec.",
            );
          }}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onLoadedData={(event) => {
            void event.currentTarget.play().catch(() => undefined);
          }}
          onEnded={() => {
            if (repeat === "one") {
              return;
            }
            onEnded();
          }}
        >
          <track kind="captions" />
        </video>
        {displayError ? (
          <div className="video-player-error">{displayError}</div>
        ) : null}
        <button
          type="button"
          aria-label={paused ? "Play" : "Pause"}
          className={`video-player-surface ${chromeVisible ? "video-player-surface--active" : "video-player-surface--idle"}`}
          style={{ bottom: chromeVisible ? CONTROL_BAR_PX : 0 }}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={onSurfaceClick}
          onDoubleClick={onSurfaceDoubleClick}
        />
      </div>

      <div
        className={`video-player-bottom ${CHROME_FADE_CLASS} ${chromeHiddenClass}`}
        inert={!chromeVisible}
      >
        <div className="video-player-nav">
          <IconButton label="Previous" disabled={total < 2} onClick={onPrev}>
            <SkipBackIcon />
          </IconButton>
          <IconButton label="Next" disabled={total < 2} onClick={onNext}>
            <SkipForwardIcon />
          </IconButton>
        </div>
        <div className="video-player-repeat">
          {REPEAT_TOGGLE_MODES.map((mode, modeIndex) => {
            const active = repeat === mode.id;
            return (
              <IconButton
                key={mode.id}
                label={mode.label}
                tip
                soft
                tipAlign={
                  modeIndex === REPEAT_TOGGLE_MODES.length - 1 ? "end" : "center"
                }
                pressed={active}
                onClick={() =>
                  onRepeatChange(toggleRepeatMode(repeat, mode.id))
                }
              >
                {mode.id === "one" ? <RepeatOneIcon /> : <FolderLoopIcon />}
              </IconButton>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const TIP_SHOW_MS = 150;

function IconButton({
  label,
  children,
  disabled,
  pressed,
  tip,
  tipAlign = "center",
  soft,
  onClick,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  pressed?: boolean;
  tip?: boolean;
  tipAlign?: "center" | "end";
  soft?: boolean;
  onClick: () => void;
}) {
  const [showTip, setShowTip] = useState(false);
  const tipTimer = useRef<number | null>(null);
  const hovered = useRef(false);

  function clearTipTimer() {
    if (tipTimer.current != null) {
      window.clearTimeout(tipTimer.current);
      tipTimer.current = null;
    }
  }

  function openTip() {
    clearTipTimer();
    tipTimer.current = window.setTimeout(() => {
      setShowTip(true);
    }, TIP_SHOW_MS);
  }

  function closeTip() {
    clearTipTimer();
    setShowTip(false);
  }

  useEffect(() => {
    return () => {
      if (tipTimer.current != null) {
        window.clearTimeout(tipTimer.current);
      }
    };
  }, []);

  const button = (
    <button
      type="button"
      title={tip ? undefined : label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseEnter={
        tip
          ? () => {
              hovered.current = true;
              openTip();
            }
          : undefined
      }
      onMouseLeave={
        tip
          ? () => {
              hovered.current = false;
              closeTip();
            }
          : undefined
      }
      onFocus={tip ? openTip : undefined}
      onBlur={
        tip
          ? () => {
              if (!hovered.current) {
                closeTip();
              }
            }
          : undefined
      }
      onClick={(event) => {
        event.currentTarget.blur();
        onClick();
      }}
      className={[
        "video-player-icon-button",
        pressed ? (soft ? "is-soft-pressed" : "is-pressed") : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );

  if (!tip) {
    return button;
  }

  return (
    <span className="video-player-icon-wrap">
      {button}
      {showTip ? (
        <span
          role="tooltip"
          className={`video-player-tooltip ${tipAlign === "end" ? "align-end" : "align-center"}`}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}

function PlayerIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="video-player-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function SkipBackIcon() {
  return (
    <PlayerIcon>
      <polygon points="19 20 9 12 19 4 19 20" />
      <line x1="5" x2="5" y1="19" y2="5" />
    </PlayerIcon>
  );
}

function SkipForwardIcon() {
  return (
    <PlayerIcon>
      <polygon points="5 4 15 12 5 20 5 4" />
      <line x1="19" x2="19" y1="5" y2="19" />
    </PlayerIcon>
  );
}

function RepeatOneIcon() {
  return (
    <PlayerIcon>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      <path d="M11 10h1v4" />
    </PlayerIcon>
  );
}

function FolderLoopIcon() {
  return (
    <PlayerIcon>
      <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M9 14a3 3 0 1 0 3-3" />
      <path d="M12 11v3h-3" />
    </PlayerIcon>
  );
}

function FullscreenIcon() {
  return (
    <PlayerIcon>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </PlayerIcon>
  );
}

function CloseIcon() {
  return (
    <PlayerIcon>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </PlayerIcon>
  );
}

function MoreVerticalIcon() {
  return (
    <PlayerIcon>
      <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </PlayerIcon>
  );
}

function FullscreenExitIcon() {
  return (
    <PlayerIcon>
      <path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
    </PlayerIcon>
  );
}
