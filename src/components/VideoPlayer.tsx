import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { prefersCoarsePointer } from "../lib/pointer";
import {
  exitFullscreen,
  getFullscreenElement,
  isFullscreen,
  requestFullscreen,
  subscribeFullscreen,
} from "../lib/video-fullscreen";
import {
  formatPlaybackRate,
  loadPlaybackRate,
  savePlaybackRate,
} from "../lib/playback-rate";
import {
  isPlaybackRateSliderTarget,
  isVideoPlayerTypingTarget,
  videoPlayerKeyAction,
} from "../lib/video-player-keys";
import { PlaybackSpeedSlider } from "./PlaybackSpeedSlider";
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

function applyPlaybackRate(
  video: HTMLVideoElement | null,
  rate: number,
): void {
  if (!video) {
    return;
  }
  video.defaultPlaybackRate = rate;
  if (video.playbackRate !== rate) {
    video.playbackRate = rate;
  }
}

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
  try {
    return parseRepeatMode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "folder";
  }
}

export function saveRepeatMode(mode: RepeatMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* Ignore blocked storage. */
  }
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
  snapshotsAvailable = false,
  hasSnapshotRoot = false,
  snapshotNeedsPermission = false,
  snapshotDestination = null,
  snapshotAlbums = [],
  snapshotToast = null,
  onTakeSnapshot,
  onPickSnapshotAlbum,
  onCreateSnapshotAlbum,
  onChooseSnapshotFolder,
  onAllowSnapshotAccess,
  onViewSnapshotToast,
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
  snapshotsAvailable?: boolean;
  hasSnapshotRoot?: boolean;
  snapshotNeedsPermission?: boolean;
  snapshotDestination?: string | null;
  snapshotAlbums?: { name: string; count: number }[];
  snapshotToast?: string | null;
  onTakeSnapshot?: (video: HTMLVideoElement) => Promise<void>;
  onPickSnapshotAlbum?: (name: string, video: HTMLVideoElement) => Promise<void>;
  onCreateSnapshotAlbum?: (name: string, video: HTMLVideoElement) => Promise<void>;
  onChooseSnapshotFolder?: () => void;
  onAllowSnapshotAccess?: () => void;
  onViewSnapshotToast?: () => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceClickRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const speedWrapRef = useRef<HTMLDivElement>(null);
  const [shellFullscreen, setShellFullscreen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [albumDraft, setAlbumDraft] = useState("");
  const [frameReady, setFrameReady] = useState(false);
  const [snapshotSaved, setSnapshotSaved] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [shutterOn, setShutterOn] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(loadPlaybackRate);
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedOpenRef = useRef(speedOpen);
  speedOpenRef.current = speedOpen;
  const pickerOpenRef = useRef(false);
  pickerOpenRef.current = pickerOpen;
  const takeSnapshotRef = useRef<() => void>(() => undefined);

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
    applyPlaybackRate(el, playbackRateRef.current);
  }, [url]);

  useLayoutEffect(() => {
    applyPlaybackRate(videoRef.current, playbackRate);
  }, [playbackRate]);

  useEffect(() => {
    function sync() {
      const shell = shellRef.current;
      const video = videoRef.current;
      setShellFullscreen(Boolean(shell && getFullscreenElement() === shell));
      if (
        shell &&
        video &&
        document.fullscreenEnabled &&
        getFullscreenElement() === video
      ) {
        void exitFullscreen()
          .then(() => requestFullscreen(shell, video))
          .catch(() => undefined);
      }
    }
    sync();
    const video = videoRef.current;
    video?.addEventListener("webkitbeginfullscreen", sync);
    video?.addEventListener("webkitendfullscreen", sync);
    const unsubscribe = subscribeFullscreen(sync);
    return () => {
      video?.removeEventListener("webkitbeginfullscreen", sync);
      video?.removeEventListener("webkitendfullscreen", sync);
      unsubscribe();
    };
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
      if (action === "close" && pickerOpenRef.current) {
        event.preventDefault();
        event.stopPropagation();
        setPickerOpen(false);
        setPickerError(null);
        return;
      }
      if (action === "close" && speedOpenRef.current) {
        event.preventDefault();
        event.stopPropagation();
        setSpeedOpen(false);
        return;
      }
      if (isVideoPlayerTypingTarget(event.target)) {
        return;
      }
      if (
        (action === "next" || action === "prev") &&
        isPlaybackRateSliderTarget(event.target)
      ) {
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
      if (action === "snapshot") {
        takeSnapshotRef.current();
        return;
      }
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
      if (isPlaybackRateSliderTarget(event.target)) {
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
    if (prefersCoarsePointer()) {
      return;
    }
    clearIdleTimer();
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      setChromeVisible(false);
    }, IDLE_HIDE_MS);
  }

  function onPointerActivity() {
    setChromeVisible(true);
    if (menuOpen || speedOpen) {
      clearIdleTimer();
      return;
    }
    scheduleChromeHide();
  }

  function setPlaybackSpeed(rate: number) {
    setPlaybackRate(rate);
    savePlaybackRate(rate);
    applyPlaybackRate(videoRef.current, rate);
  }

  useEffect(() => {
    setMenuOpen(false);
    setPickerOpen(false);
    setSpeedOpen(false);
    setFrameReady(false);
    setSnapshotSaved(false);
    setCaptureError(null);
  }, [url]);

  useEffect(() => {
    if (!snapshotSaved) {
      return;
    }
    const timer = window.setTimeout(() => setSnapshotSaved(false), 1800);
    return () => window.clearTimeout(timer);
  }, [snapshotSaved]);

  useEffect(() => {
    if (!menuOpen && !speedOpen) {
      return;
    }
    setChromeVisible(true);
    clearIdleTimer();
  }, [menuOpen, speedOpen]);

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
    if (!speedOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!speedWrapRef.current?.contains(event.target as Node)) {
        setSpeedOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [speedOpen]);

  useEffect(() => {
    if (!prefersCoarsePointer()) {
      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = null;
        setChromeVisible(false);
      }, IDLE_HIDE_MS);
    }
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
    const video = videoRef.current;
    if (getFullscreenElement() === shell || isFullscreen(video)) {
      await exitFullscreen(video).catch(() => undefined);
    } else {
      await requestFullscreen(shell, video).catch(() => undefined);
    }
    setShellFullscreen(getFullscreenElement() === shell || isFullscreen(video));
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

  const canCapture = snapshotsAvailable && frameReady;
  const snapshotHint = !snapshotsAvailable
    ? "Available in Chrome and Edge"
    : !frameReady
      ? "Wait until the picture appears"
      : snapshotDestination
        ? snapshotDestination
        : "Choose album";

  async function runCapture(action: (video: HTMLVideoElement) => Promise<void>) {
    const video = videoRef.current;
    if (!video || !canCapture) {
      return;
    }
    setCaptureError(null);
    setPickerError(null);
    try {
      await action(video);
      setSnapshotSaved(true);
      setPickerOpen(false);
      setMenuOpen(false);
      const reduced =
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced) {
        setShutterOn(true);
        window.setTimeout(() => setShutterOn(false), 140);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not save snapshot";
      if (pickerOpenRef.current) {
        setPickerError(message);
      } else {
        setCaptureError(message);
      }
    }
  }

  function takeSnapshot() {
    if (!canCapture) {
      return;
    }
    if (!snapshotDestination || !hasSnapshotRoot || snapshotNeedsPermission) {
      setMenuOpen(true);
      setPickerOpen(true);
      setChromeVisible(true);
      return;
    }
    if (!onTakeSnapshot) {
      return;
    }
    void runCapture(onTakeSnapshot);
  }

  takeSnapshotRef.current = takeSnapshot;

  function openSnapshotPicker() {
    setPickerError(null);
    setPickerOpen(true);
    setMenuOpen(true);
    setChromeVisible(true);
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
          {onUseCurrentFrameAsThumbnail || onTakeSnapshot ? (
            <div className="video-player-menu-wrap" ref={menuRef}>
              <IconButton
                label="More options"
                pressed={menuOpen}
                onClick={() => {
                  setMenuOpen((open) => !open);
                  setPickerOpen(false);
                }}
              >
                <MoreVerticalIcon />
              </IconButton>
              {menuOpen ? (
                <div
                  className={`video-player-menu ${pickerOpen ? "is-picker" : ""}`}
                  role="menu"
                >
                  {pickerOpen ? (
                    <div className="snapshot-picker">
                      <p className="snapshot-picker-title">Save snapshot to</p>
                      {!hasSnapshotRoot ? (
                        <>
                          <p className="snapshot-picker-copy">
                            Snapshots are saved as image files in a folder you
                            choose.
                          </p>
                          <button
                            type="button"
                            className="btn primary"
                            onClick={onChooseSnapshotFolder}
                          >
                            Choose folder
                          </button>
                        </>
                      ) : snapshotNeedsPermission ? (
                        <>
                          <p className="snapshot-picker-copy">
                            Allow access to the snapshot folder to save this frame.
                          </p>
                          <button
                            type="button"
                            className="btn primary"
                            onClick={onAllowSnapshotAccess}
                          >
                            Allow access
                          </button>
                        </>
                      ) : (
                        <>
                          {snapshotAlbums.length > 0 ? (
                            <div className="video-player-album-list">
                              {snapshotAlbums.map((album, albumIndex) => (
                                <button
                                  key={album.name}
                                  type="button"
                                  role="menuitem"
                                  className="video-player-menu-item"
                                  autoFocus={albumIndex === 0}
                                  onClick={() => {
                                    if (!onPickSnapshotAlbum) {
                                      return;
                                    }
                                    void runCapture((video) =>
                                      onPickSnapshotAlbum(album.name, video),
                                    );
                                  }}
                                >
                                  <span className="snapshot-album-name">
                                    {album.name}
                                  </span>
                                  <span className="video-player-menu-kbd">
                                    {album.count}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                          <form
                            className="snapshot-create"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const name = albumDraft.trim();
                              if (!name || !onCreateSnapshotAlbum) {
                                return;
                              }
                              void runCapture(async (video) => {
                                await onCreateSnapshotAlbum(name, video);
                                setAlbumDraft("");
                              });
                            }}
                          >
                            <p className="snapshot-picker-label">New album</p>
                            <div className="snapshot-create-row">
                              <input
                                className="dialog-input"
                                value={albumDraft}
                                placeholder="Album name"
                                aria-label="Album name"
                                autoFocus={snapshotAlbums.length === 0}
                                onChange={(event) =>
                                  setAlbumDraft(event.target.value)
                                }
                              />
                              <button
                                type="submit"
                                className="btn primary"
                                disabled={!albumDraft.trim()}
                              >
                                Create
                              </button>
                            </div>
                            <p className="snapshot-picker-copy">
                              Interval starts at 1.0 s
                            </p>
                          </form>
                        </>
                      )}
                      {pickerError ? (
                        <p className="snapshot-picker-error">{pickerError}</p>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      {onUseCurrentFrameAsThumbnail ? (
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
                          <span>
                            {thumbnailSaved
                              ? "Thumbnail saved"
                              : "Use current frame as thumbnail"}
                          </span>
                        </button>
                      ) : null}
                      {onTakeSnapshot ? (
                        <div className="snapshot-menu-block">
                          <button
                            type="button"
                            role="menuitem"
                            className={`video-player-menu-item ${snapshotSaved ? "is-saved" : ""}`}
                            disabled={!canCapture}
                            onClick={() => takeSnapshot()}
                          >
                            <span>
                              {snapshotSaved
                                ? "Snapshot saved"
                                : snapshotDestination
                                  ? "Take snapshot"
                                  : "Take snapshot…"}
                            </span>
                            {canCapture ? (
                              <span className="video-player-menu-kbd">S</span>
                            ) : null}
                          </button>
                          {snapshotDestination && canCapture ? (
                            <button
                              type="button"
                              role="menuitem"
                              className="video-player-menu-sub"
                              onClick={openSnapshotPicker}
                            >
                              {snapshotDestination}
                            </button>
                          ) : (
                            <p className="video-player-menu-sub">{snapshotHint}</p>
                          )}
                        </div>
                      ) : null}
                    </>
                  )}
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
          preload="metadata"
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
          onPlay={(event) => {
            setPaused(false);
            applyPlaybackRate(event.currentTarget, playbackRateRef.current);
          }}
          onPause={() => setPaused(true)}
          onCanPlay={(event) => {
            setFrameReady(true);
            applyPlaybackRate(event.currentTarget, playbackRateRef.current);
          }}
          onLoadedData={(event) => {
            setFrameReady(true);
            const video = event.currentTarget;
            applyPlaybackRate(video, playbackRateRef.current);
            void video
              .play()
              .then(() => applyPlaybackRate(video, playbackRateRef.current))
              .catch(() => undefined);
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
          style={{
            bottom:
              chromeVisible || prefersCoarsePointer()
                ? prefersCoarsePointer()
                  ? 96
                  : CONTROL_BAR_PX
                : 0,
          }}
          onMouseDown={(event) => {
            if (event.detail === 0 || prefersCoarsePointer()) {
              return;
            }
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
        <div className="video-player-bottom-trailing">
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
                    modeIndex === REPEAT_TOGGLE_MODES.length - 1
                      ? "end"
                      : "center"
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
          <div className="video-player-speed-wrap" ref={speedWrapRef}>
            <button
              type="button"
              className="video-player-speed-trigger"
              aria-label="Playback speed"
              aria-expanded={speedOpen}
              aria-haspopup="dialog"
              onClick={() => {
                setSpeedOpen((open) => !open);
                setChromeVisible(true);
                clearIdleTimer();
              }}
            >
              {formatPlaybackRate(playbackRate)}
            </button>
            {speedOpen ? (
              <div
                className="video-player-speed-overlay"
                role="dialog"
                aria-label="Playback speed"
              >
                <PlaybackSpeedSlider
                  compact
                  rate={playbackRate}
                  onChange={setPlaybackSpeed}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {shutterOn ? <div className="video-player-shutter is-active" /> : null}
      {captureError || snapshotToast ? (
        <div
          className={`video-player-toast ${captureError ? "is-error" : ""}`}
          role={captureError ? "alert" : "status"}
        >
          <span>{captureError ?? snapshotToast}</span>
          {!captureError && onViewSnapshotToast ? (
            <button type="button" onClick={onViewSnapshotToast}>
              View
            </button>
          ) : null}
        </div>
      ) : null}
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
