import {
  Download,
  FolderInput,
  FolderOpen,
  Grid3x3,
  List,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FolderRowMenu } from "./components/FolderRowMenu";
import { VideoCardMenu } from "./components/VideoCardMenu";
import {
  loadRepeatMode,
  saveRepeatMode,
  VideoPlayer,
} from "./components/VideoPlayer";
import {
  buildFolderEntries,
  filterVideos,
  formatBytes,
  formatDate,
  formatDuration,
  PAGE_SIZE,
  sortVideos,
} from "./lib/file-helpers";
import {
  activateLibrary,
  loadActiveLibrary,
  loadSavedLibraries,
  removeSavedLibrary,
  type SavedLibrary,
} from "./lib/library-roots";
import type {
  RepeatMode,
  ScanResult,
  SortDirection,
  SortKey,
  VideoFileEntry,
  VideoMeta,
  VideoStorageAdapter,
  ViewMode,
} from "./lib/types";
import { loadVideoMeta, loadVideoMetaBatch } from "./lib/video-thumb";
import {
  loadThumbPositionsFromVideos,
  migrateLegacyThumbPositionsToSidecars,
} from "./lib/video-thumb-sidecar";
import {
  folderPlaylist,
  playlistIndex,
  stepPlaylist,
} from "./lib/video-playlist";
import {
  createDirectoryAdapter,
  createFolderInputAdapter,
  ensureReadPermission,
  loadSavedRootHandle,
  pickDirectoryRoot,
  supportsDirectoryPicker,
} from "./lib/video-storage";

type DialogState =
  | { type: "rename-video"; entry: VideoFileEntry }
  | { type: "move-videos"; entries: VideoFileEntry[] }
  | { type: "delete-videos"; entries: VideoFileEntry[] }
  | { type: "create-folder" }
  | { type: "rename-folder"; folderPath: string; currentName: string }
  | { type: "delete-folder"; folderPath: string; folderName: string }
  | null;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const META_BATCH_SIZE = 80;

export default function App() {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [adapter, setAdapter] = useState<VideoStorageAdapter | null>(null);
  const [libraries, setLibraries] = useState<SavedLibrary[]>([]);
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({
    videos: 0,
    folders: 0,
    skipped: 0,
  });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [writable, setWritable] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const [selectedFolder, setSelectedFolder] = useState<string | null | undefined>(
    undefined,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [metaMap, setMetaMap] = useState<Map<string, VideoMeta>>(new Map());
  const metaMapRef = useRef(metaMap);
  metaMapRef.current = metaMap;
  const [thumbPositions, setThumbPositions] = useState<Map<string, number>>(
    new Map(),
  );
  const thumbPositionsRef = useRef(thumbPositions);
  thumbPositionsRef.current = thumbPositions;
  const [thumbnailSaved, setThumbnailSaved] = useState(false);
  const [playing, setPlaying] = useState<VideoFileEntry | null>(null);
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(() => loadRepeatMode());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  const runScan = useCallback(async (nextAdapter: VideoStorageAdapter) => {
    setScanning(true);
    setErrorMessage(null);
    setStatusMessage("Scanning folder…");
    setScanProgress({ videos: 0, folders: 0, skipped: 0 });
    try {
      const result = await nextAdapter.scan((progress) => {
        setScanProgress(progress);
      });
      setScanResult(result);
      setSelectedIds(new Set());
      setVisibleCount(PAGE_SIZE);
      setMetaMap(new Map());
      setSelectedFolder(undefined);
      const loadedPositions = await loadThumbPositionsFromVideos(
        nextAdapter,
        result.videos,
      );
      const thumbPositions = await migrateLegacyThumbPositionsToSidecars(
        nextAdapter,
        result.videos,
        loadedPositions,
      );
      setThumbPositions(thumbPositions);
      const canWrite = await nextAdapter.canWrite();
      setWritable(canWrite);
      setNeedsPermission(false);
      setStatusMessage(
        result.errors.length > 0
          ? `Scan finished with ${result.errors.length} read error(s).`
          : `Found ${result.videos.length} video(s).`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Scan failed";
      if (/permission/i.test(message)) {
        setNeedsPermission(true);
      }
      setErrorMessage(message);
    } finally {
      setScanning(false);
    }
  }, []);

  const attachAdapter = useCallback(
    async (nextAdapter: VideoStorageAdapter, rescan = true) => {
      setAdapter(nextAdapter);
      if (rescan) {
        await runScan(nextAdapter);
      }
    },
    [runScan],
  );

  const refreshLibraries = useCallback(async () => {
    const items = await loadSavedLibraries();
    const active = await loadActiveLibrary();
    setLibraries(items);
    setActiveLibraryId(active?.id ?? null);
    return active;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const active = await refreshLibraries();
      if (!supportsDirectoryPicker()) {
        setStatusMessage(
          "This browser uses read-only folder selection. File management is disabled.",
        );
        return;
      }
      if (!active || cancelled) {
        return;
      }
      const restored = createDirectoryAdapter(active.handle);
      if (cancelled) {
        return;
      }
      setAdapter(restored);
      setStatusMessage(`Restored folder "${restored.rootName}".`);
      await runScan(restored);
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [refreshLibraries, runScan]);

  useEffect(() => {
    setThumbnailSaved(false);
  }, [playing?.id]);

  useEffect(() => {
    if (!thumbnailSaved) {
      return;
    }
    const timer = window.setTimeout(() => {
      setThumbnailSaved(false);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [thumbnailSaved]);

  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  useEffect(() => {
    if (searchQuery !== deferredQuery) {
      return;
    }
    setVisibleCount(PAGE_SIZE);
  }, [deferredQuery, searchQuery, selectedFolder, sortKey, sortDirection]);

  const durations = useMemo(() => {
    const map = new Map<string, number | undefined>();
    for (const [id, meta] of metaMap.entries()) {
      map.set(id, meta.duration);
    }
    return map;
  }, [metaMap]);

  const filteredVideos = useMemo(() => {
    if (!scanResult) {
      return [];
    }
    const filtered = filterVideos(scanResult.videos, {
      query: deferredQuery,
      folderPath: selectedFolder ?? null,
    });
    return sortVideos(filtered, sortKey, sortDirection, durations);
  }, [scanResult, deferredQuery, selectedFolder, sortKey, sortDirection, durations]);

  const visibleVideos = useMemo(
    () => filteredVideos.slice(0, visibleCount),
    [filteredVideos, visibleCount],
  );

  const folderEntries = useMemo(() => {
    if (!scanResult) {
      return [];
    }
    return buildFolderEntries(scanResult.videos, scanResult.folders).filter(
      (folder) => folder.path !== "",
    );
  }, [scanResult]);

  const allLibrary = scanResult?.videos ?? [];
  const folderPlay = playing
    ? folderPlaylist(allLibrary, playing)
    : [];
  const playerIndex = playing
    ? playlistIndex(folderPlay, playing.id)
    : -1;

  useEffect(() => {
    if (!adapter || visibleVideos.length === 0) {
      return;
    }
    let cancelled = false;
    const pending = visibleVideos
      .filter((entry) => {
        const meta = metaMapRef.current.get(entry.id);
        const customSeek = thumbPositionsRef.current.get(entry.id);
        if (customSeek != null) {
          return (
            !meta ||
            meta.thumbSeekSeconds !== customSeek ||
            (!meta.thumbUrl && !meta.failed)
          );
        }
        return !meta || (!meta.duration && !meta.failed && !meta.thumbUrl);
      })
      .slice(0, META_BATCH_SIZE);

    if (pending.length === 0) {
      return;
    }

    void loadVideoMetaBatch(
      pending,
      (entry) => adapter.createObjectUrl(entry),
      (id, meta) => {
        if (cancelled) {
          return;
        }
        setMetaMap((current) => {
          const next = new Map(current);
          next.set(id, { ...next.get(id), ...meta });
          return next;
        });
      },
      () => cancelled,
      (entry) => thumbPositionsRef.current.get(entry.id),
    );

    return () => {
      cancelled = true;
    };
  }, [adapter, visibleVideos, thumbPositions]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    async function openPlayer() {
      if (!playing || !adapter) {
        setPlayerUrl(null);
        setPlayerError(null);
        return;
      }
      try {
        const url = await adapter.createObjectUrl(playing);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPlayerUrl(url);
        setPlayerError(null);
      } catch (error) {
        setPlayerUrl(null);
        setPlayerError(
          error instanceof Error ? error.message : "Could not open video",
        );
      }
    }
    void openPlayer();
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [playing, adapter]);

  async function handleOpenDirectory() {
    setErrorMessage(null);
    try {
      const handle = await pickDirectoryRoot();
      await refreshLibraries();
      setPlaying(null);
      await attachAdapter(createDirectoryAdapter(handle));
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        return;
      }
      setErrorMessage(
        error instanceof Error ? error.message : "Could not open folder",
      );
    }
  }

  async function handleSelectLibrary(library: SavedLibrary) {
    if (library.id === activeLibraryId && adapter) {
      return;
    }
    setErrorMessage(null);
    try {
      const granted = await ensureReadPermission(library.handle);
      if (!granted) {
        setNeedsPermission(true);
        setErrorMessage("Folder access was not granted.");
        return;
      }
      await activateLibrary(library.id);
      setActiveLibraryId(library.id);
      setPlaying(null);
      await attachAdapter(createDirectoryAdapter(library.handle));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not open folder",
      );
    }
  }

  async function handleRemoveLibrary(id: string) {
    setErrorMessage(null);
    const wasActive = id === activeLibraryId;
    const { libraries: nextLibraries, active } = await removeSavedLibrary(id);
    setLibraries(nextLibraries);
    setActiveLibraryId(active?.id ?? null);
    if (!wasActive) {
      return;
    }
    setPlaying(null);
    if (!active) {
      setAdapter(null);
      setScanResult(null);
      setMetaMap(new Map());
      setThumbPositions(new Map());
      setWritable(false);
      setStatusMessage("No folder selected.");
      return;
    }
    await attachAdapter(createDirectoryAdapter(active.handle));
  }

  async function handleRelink() {
    setErrorMessage(null);
    try {
      const handle = await loadSavedRootHandle();
      if (!handle) {
        await handleOpenDirectory();
        return;
      }
      const granted = await ensureReadPermission(handle);
      if (!granted) {
        setNeedsPermission(true);
        setErrorMessage("Folder access was not granted.");
        return;
      }
      await attachAdapter(createDirectoryAdapter(handle));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not restore access",
      );
    }
  }

  function handleFolderInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) {
      return;
    }
    void attachAdapter(createFolderInputAdapter(files));
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function selectedEntries(): VideoFileEntry[] {
    if (!scanResult) {
      return [];
    }
    return scanResult.videos.filter((entry) => selectedIds.has(entry.id));
  }

  async function openVideo(entry: VideoFileEntry) {
    setPlaying(entry);
  }

  function closePlayer() {
    setPlaying(null);
    setPlayerUrl(null);
    setPlayerError(null);
  }

  function goToPlayerStep(delta: number) {
    if (!playing) {
      return;
    }
    const next = stepPlaylist(folderPlay, playing.id, delta);
    if (next) {
      setPlaying(next);
    }
  }

  function handlePlayerEnded() {
    if (!playing) {
      return;
    }
    if (repeatMode === "folder") {
      const next = stepPlaylist(folderPlay, playing.id, 1);
      if (next) {
        setPlaying(next);
      }
      return;
    }
    closePlayer();
  }

  async function handleUseCurrentFrameAsThumbnail(currentTime: number) {
    if (!playing || !adapter) {
      return;
    }
    setErrorMessage(null);
    try {
      const seekSeconds = Math.max(0, currentTime);
      await adapter.saveThumbSeekSeconds(playing, seekSeconds);
      setThumbPositions((current) => {
        const next = new Map(current);
        next.set(playing.id, seekSeconds);
        return next;
      });
      const meta = await loadVideoMeta(
        playing,
        (entry) => adapter.createObjectUrl(entry),
        { seekSeconds },
      );
      setMetaMap((current) => {
        const next = new Map(current);
        next.set(playing.id, {
          ...next.get(playing.id),
          ...meta,
          thumbSeekSeconds: seekSeconds,
        });
        return next;
      });
      setThumbnailSaved(true);
      setStatusMessage(`Thumbnail set at ${formatDuration(seekSeconds)}.`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not save thumbnail",
      );
    }
  }

  async function runWriteAction(action: () => Promise<void>) {
    if (!adapter) {
      return;
    }
    setErrorMessage(null);
    try {
      await action();
      await runScan(adapter);
      setDialog(null);
      setDialogValue("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Operation failed",
      );
    }
  }

  async function handleInstall() {
    if (!installPrompt) {
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function openRenameVideo(entry: VideoFileEntry) {
    setDialog({ type: "rename-video", entry });
    setDialogValue(entry.name);
  }

  function openMoveVideos(entries: VideoFileEntry[]) {
    setDialog({ type: "move-videos", entries });
    setDialogValue(selectedFolder ?? "");
  }

  function openDeleteVideos(entries: VideoFileEntry[]) {
    setDialog({ type: "delete-videos", entries });
    setDialogValue("");
  }

  function openCreateFolder() {
    setDialog({ type: "create-folder" });
    setDialogValue(selectedFolder ? `${selectedFolder}/` : "");
  }

  function openRenameFolder(folderPath: string, currentName: string) {
    setDialog({ type: "rename-folder", folderPath, currentName });
    setDialogValue(currentName);
  }

  function openDeleteFolder(folderPath: string, folderName: string) {
    setDialog({ type: "delete-folder", folderPath, folderName });
    setDialogValue("");
  }

  async function submitDialog() {
    if (!adapter || !dialog) {
      return;
    }
    switch (dialog.type) {
      case "rename-video":
        await runWriteAction(async () => {
          await adapter.renameVideo(dialog.entry, dialogValue.trim());
        });
        break;
      case "move-videos":
        await runWriteAction(async () => {
          await adapter.moveVideos(dialog.entries, dialogValue.trim());
        });
        break;
      case "delete-videos":
        await runWriteAction(async () => {
          await adapter.deleteVideos(dialog.entries);
        });
        break;
      case "create-folder":
        await runWriteAction(() => adapter.createFolder(dialogValue.trim()));
        break;
      case "rename-folder":
        await runWriteAction(async () => {
          await adapter.renameFolder(dialog.folderPath, dialogValue.trim());
        });
        break;
      case "delete-folder":
        await runWriteAction(async () => {
          await adapter.deleteFolder(dialog.folderPath);
        });
        break;
      default:
        break;
    }
  }

  const hasMore = visibleCount < filteredVideos.length;
  const readOnly = adapter != null && !writable;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Local Video Library</h1>
          <p className="sidebar-subtitle">
            {adapter ? adapter.rootName : "No folder selected"}
          </p>
        </div>

        <div className="sidebar-actions">
          {supportsDirectoryPicker() ? (
            <>
              <button
                type="button"
                className="btn icon outline"
                aria-label="Open folder"
                onClick={() => void handleOpenDirectory()}
              >
                <FolderOpen size={16} />
              </button>
              {needsPermission ? (
                <button type="button" className="btn" onClick={() => void handleRelink()}>
                  Re-link folder
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn outline"
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderInput size={16} />
                Choose folder
              </button>
              <input
                ref={folderInputRef}
                type="file"
                multiple
                hidden
                {...{ webkitdirectory: "", directory: "" }}
                onChange={handleFolderInputChange}
              />
            </>
          )}
          <button
            type="button"
            className="btn icon"
            aria-label="Refresh"
            disabled={!adapter || scanning}
            onClick={() => adapter && void runScan(adapter)}
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {readOnly ? (
          <p className="notice">
            Read-only mode. Rename, move, and delete are disabled.
          </p>
        ) : null}

        {libraries.length > 0 ? (
          <div className="library-panel">
            <h2>Opened folders</h2>
            <div className="library-list">
              {libraries.map((library) => (
                <div
                  key={library.id}
                  className={`folder-row ${library.id === activeLibraryId ? "active" : ""}`}
                >
                  <button
                    type="button"
                    className="folder-item"
                    onClick={() => void handleSelectLibrary(library)}
                  >
                    <span className="folder-item-name">{library.name}</span>
                  </button>
                  <FolderRowMenu
                    deleteLabel="Remove"
                    onDelete={() => void handleRemoveLibrary(library.id)}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="folder-panel">
          <div className="folder-panel-header">
            <h2>Folders</h2>
            {writable ? (
              <button
                type="button"
                className="btn icon"
                aria-label="Create folder"
                onClick={openCreateFolder}
              >
                <Plus size={16} />
              </button>
            ) : null}
          </div>
          <div className="folder-list">
            <div
              className={`folder-row ${selectedFolder === null ? "active" : ""}`}
            >
              <button
                type="button"
                className="folder-item"
                onClick={() => setSelectedFolder(null)}
              >
                <span className="folder-item-name">All videos</span>
              </button>
              <span className="folder-item-count">
                {scanResult?.videos.length ?? 0}
              </span>
            </div>
            <div className="folder-list-divider" aria-hidden="true" />
            {folderEntries.map((folder) => (
              <div
                key={folder.path}
                className={`folder-row ${selectedFolder === folder.path ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="folder-item"
                  onClick={() => setSelectedFolder(folder.path)}
                >
                  <span className="folder-item-name">{folder.name}</span>
                </button>
                {writable && folder.path ? (
                  <FolderRowMenu
                    onRename={() => openRenameFolder(folder.path, folder.name)}
                    onDelete={() => openDeleteFolder(folder.path, folder.name)}
                  />
                ) : null}
                <span className="folder-item-count">{folder.count}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="toolbar">
          <input
            type="search"
            className="search-input"
            placeholder="Search file or folder path"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <div className="toolbar-group">
            <label className="toolbar-label">
              Sort
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
              >
                <option value="name">Name</option>
                <option value="folder">Folder</option>
                <option value="modified">Modified</option>
                <option value="size">Size</option>
                <option value="duration">Duration</option>
              </select>
            </label>
            <button
              type="button"
              className="btn"
              onClick={() =>
                setSortDirection((current) =>
                  current === "asc" ? "desc" : "asc",
                )
              }
            >
              {sortDirection === "asc" ? "Asc" : "Desc"}
            </button>
            <button
              type="button"
              className={`btn icon ${viewMode === "grid" ? "active" : ""}`}
              aria-label="Grid view"
              onClick={() => setViewMode("grid")}
            >
              <Grid3x3 size={16} />
            </button>
            <button
              type="button"
              className={`btn icon ${viewMode === "list" ? "active" : ""}`}
              aria-label="List view"
              onClick={() => setViewMode("list")}
            >
              <List size={16} />
            </button>
            {installPrompt ? (
              <button type="button" className="btn" onClick={() => void handleInstall()}>
                <Download size={16} />
                Install
              </button>
            ) : null}
          </div>
        </header>

        {selectedIds.size > 0 ? (
          <div className="selection-bar">
            <span>{selectedIds.size} selected</span>
            <button type="button" className="btn tiny" onClick={clearSelection}>
              Clear
            </button>
            {writable ? (
              <>
                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => openMoveVideos(selectedEntries())}
                >
                  Move
                </button>
                <button
                  type="button"
                  className="btn tiny danger"
                  onClick={() => openDeleteVideos(selectedEntries())}
                >
                  Delete
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {(scanning || statusMessage || errorMessage) && (
          <div className="status-bar">
            {scanning ? (
              <span>
                Scanning… {scanProgress.videos} videos, {scanProgress.folders}{" "}
                folders, {scanProgress.skipped} skipped
              </span>
            ) : null}
            {!scanning && statusMessage ? <span>{statusMessage}</span> : null}
            {errorMessage ? <span className="error-text">{errorMessage}</span> : null}
          </div>
        )}

        {!adapter ? (
          <div className="empty-state">
            <h2>Open a local video folder</h2>
            <p>
              Choose a folder on this device. Videos stay on disk; nothing is
              uploaded or cached in the browser.
            </p>
            {supportsDirectoryPicker() ? (
              <button type="button" className="btn outline" onClick={() => void handleOpenDirectory()}>
                <FolderOpen size={16} />
                Open folder
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderInput size={16} />
                Choose folder
              </button>
            )}
          </div>
        ) : filteredVideos.length === 0 ? (
          <div className="empty-state">
            <h2>No videos found</h2>
            <p>
              {scanResult?.videos.length
                ? "Try clearing the search or folder filter."
                : "This folder does not contain supported video files."}
            </p>
            <button
              type="button"
              className="btn icon"
              aria-label="Rescan"
              onClick={() => adapter && void runScan(adapter)}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        ) : (
          <>
            <div className={viewMode === "grid" ? "video-grid" : "video-list"}>
              {visibleVideos.map((entry) => {
                const meta = metaMap.get(entry.id);
                const selected = selectedIds.has(entry.id);
                return (
                  <article
                    key={entry.id}
                    className={`video-card ${viewMode} ${selected ? "selected" : ""}`}
                  >
                    <label className="video-select">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelection(entry.id)}
                      />
                    </label>
                    <button
                      type="button"
                      className="video-open"
                      onClick={() => void openVideo(entry)}
                    >
                      <div className="thumb-wrap">
                        {meta?.thumbUrl ? (
                          <img src={meta.thumbUrl} alt="" className="thumb" />
                        ) : (
                          <div className="thumb placeholder">
                            {meta?.failed ? "Preview unavailable" : "Loading…"}
                          </div>
                        )}
                        <span className="duration-badge">
                          {formatDuration(meta?.duration)}
                        </span>
                      </div>
                      <div className="video-meta">
                        <strong>{entry.name}</strong>
                        <span>{entry.folderPath || "(root)"}</span>
                        <span>
                          {formatBytes(entry.size)} · {formatDate(entry.lastModified)}
                        </span>
                      </div>
                    </button>
                    {writable ? (
                      <VideoCardMenu
                        entry={entry}
                        onRename={openRenameVideo}
                        onMove={(item) => openMoveVideos([item])}
                        onDelete={(item) => openDeleteVideos([item])}
                      />
                    ) : null}
                  </article>
                );
              })}
            </div>
            {hasMore ? (
              <div className="load-more-wrap">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                >
                  Show more ({filteredVideos.length - visibleCount} remaining)
                </button>
              </div>
            ) : null}
          </>
        )}
      </main>

      {playing ? (
        <VideoPlayer
          url={playerUrl ?? ""}
          title={playing.name}
          folderLabel={playing.folderPath || "(root)"}
          index={playerIndex}
          total={folderPlay.length}
          repeat={repeatMode}
          errorMessage={
            playerError ??
            (playerUrl ? null : "Preparing video…")
          }
          onRepeatChange={(mode) => {
            setRepeatMode(mode);
            saveRepeatMode(mode);
          }}
          onClose={closePlayer}
          onPrev={() => goToPlayerStep(-1)}
          onNext={() => goToPlayerStep(1)}
          onEnded={handlePlayerEnded}
          onUseCurrentFrameAsThumbnail={(currentTime) =>
            void handleUseCurrentFrameAsThumbnail(currentTime)
          }
          thumbnailSaved={thumbnailSaved}
        />
      ) : null}

      {dialog ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="dialog" aria-modal="true">
            <h2>{dialogTitle(dialog)}</h2>
            {dialogBody(dialog)}
            {dialogNeedsInput(dialog) ? (
              <input
                className="dialog-input"
                value={dialogValue}
                onChange={(event) => setDialogValue(event.target.value)}
                autoFocus
              />
            ) : null}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${dialog.type.includes("delete") ? "danger" : "primary"}`}
                onClick={() => void submitDialog()}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  function dialogTitle(state: NonNullable<DialogState>): string {
    switch (state.type) {
      case "rename-video":
        return "Rename video";
      case "move-videos":
        return `Move ${state.entries.length} video(s)`;
      case "delete-videos":
        return `Delete ${state.entries.length} video(s)`;
      case "create-folder":
        return "Create folder";
      case "rename-folder":
        return "Rename folder";
      case "delete-folder":
        return "Delete folder";
      default:
        return "";
    }
  }

  function dialogBody(state: NonNullable<DialogState>) {
    switch (state.type) {
      case "move-videos":
        return (
          <p>
            Enter the destination folder path relative to the library root. Nested
            folders will be created if needed.
          </p>
        );
      case "delete-videos":
        return (
          <p>
            This permanently deletes the selected file(s) from your local folder.
            This cannot be undone.
          </p>
        );
      case "delete-folder":
        return (
          <p>
            This permanently deletes folder "{state.folderName}" and everything
            inside it from your local folder. This cannot be undone.
          </p>
        );
      case "create-folder":
        return <p>Enter a nested folder path, for example `music-videos/1997`.</p>;
      case "rename-folder":
        return <p>Enter a new folder name without path separators.</p>;
      case "rename-video":
        return <p>Enter a new file name including the extension.</p>;
      default:
        return null;
    }
  }

  function dialogNeedsInput(state: NonNullable<DialogState>): boolean {
    return state.type !== "delete-videos" && state.type !== "delete-folder";
  }
}
