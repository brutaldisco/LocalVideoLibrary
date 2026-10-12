import {
  ChevronDown,
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
import { IntervalSlider } from "./components/IntervalSlider";
import { SnapshotGallery, type SnapshotCard } from "./components/SnapshotGallery";
import { SlideshowPlayer } from "./components/SlideshowPlayer";
import { VideoCardMenu } from "./components/VideoCardMenu";
import {
  loadRepeatMode,
  saveRepeatMode,
  VideoPlayer,
} from "./components/VideoPlayer";
import { browserEntryHint } from "./lib/browser-file-name";
import {
  buildFolderEntries,
  filterVideos,
  folderNameFromPath,
  formatBytes,
  formatDate,
  formatDuration,
  formatVideoQuality,
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
import { folderInputRootName } from "./lib/scan-folder-files";
import { captureVideoFrame } from "./lib/snapshot-capture";
import { orderAlbumItems, type AlbumItem } from "./lib/snapshot-manifest";
import {
  createSnapshotAlbum,
  deleteSnapshotAlbum,
  deleteSnapshotImage,
  ensureSnapshotWrite,
  listSnapshotAlbums,
  loadSnapshotRoot,
  readAlbum,
  renameSnapshotAlbum,
  saveSnapshotOrder,
  saveSnapshotRoot,
  setAlbumInterval as saveAlbumInterval,
  writeSnapshotImage,
  type SnapshotAlbumSummary,
} from "./lib/snapshot-storage";
import { nextSnapshotToast, type SnapshotToastBurst } from "./lib/snapshot-toast";
import {
  SLIDESHOW_INTERVAL_DEFAULT_MS,
  formatInterval,
} from "./lib/slideshow-timing";
import { isIosDevice } from "./lib/pointer";
import {
  createDirectoryAdapter,
  createFolderInputAdapter,
  ensureReadPermission,
  loadSavedRootHandle,
  pickDirectoryRoot,
  refreshDirectoryAdapterForRescan,
  supportsDirectoryPicker,
} from "./lib/video-storage";

type DialogState =
  | { type: "rename-video"; entry: VideoFileEntry }
  | { type: "move-videos"; entries: VideoFileEntry[] }
  | { type: "delete-videos"; entries: VideoFileEntry[] }
  | { type: "create-folder" }
  | { type: "rename-folder"; folderPath: string; currentName: string }
  | { type: "delete-folder"; folderPath: string; folderName: string }
  | { type: "create-album" }
  | { type: "rename-album"; name: string }
  | { type: "delete-album"; name: string; count: number }
  | { type: "delete-snapshot"; album: string; file: string }
  | null;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const META_BATCH_SIZE = 80;
type FolderPickIntent = "open-library" | "refresh-listing";
type LibraryMode = "videos" | "slideshows";

const LIBRARY_MODE_KEY = "lvl-library-mode";
const SNAPSHOT_ALBUM_KEY = "lvl-snapshot-album";
const SLIDESHOW_ALBUM_KEY = "lvl-slideshow-album";
const FLASH_NOTE_KEY = "lvl-slideshow-flash-note";

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* Storage can be blocked; the library still has to render. */
  }
}

function readLibraryMode(): LibraryMode {
  if (typeof window === "undefined") {
    return "videos";
  }
  return readStorage(LIBRARY_MODE_KEY) === "slideshows" ? "slideshows" : "videos";
}

function snapshotLabel(item: AlbumItem): string {
  const sourceName = item.sourcePath.split("/").filter(Boolean).pop();
  const name = sourceName || item.file;
  if (!item.sourcePath) {
    return name;
  }
  const safe = Math.max(0, item.sourceTimeSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${name} · ${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

export default function App() {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderPickIntentRef = useRef<FolderPickIntent>("open-library");
  const [adapter, setAdapter] = useState<VideoStorageAdapter | null>(null);
  const [libraries, setLibraries] = useState<SavedLibrary[]>([]);
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const libraryPickerRef = useRef<HTMLDivElement>(null);
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
  const [libraryMode, setLibraryMode] = useState<LibraryMode>(() => readLibraryMode());
  const [snapshotRoot, setSnapshotRoot] = useState<FileSystemDirectoryHandle | null>(
    null,
  );
  const [snapshotRootName, setSnapshotRootName] = useState<string | null>(null);
  const [snapshotNeedsPermission, setSnapshotNeedsPermission] = useState(false);
  const [albums, setAlbums] = useState<SnapshotAlbumSummary[]>([]);
  const [destinationAlbum, setDestinationAlbum] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readStorage(SNAPSHOT_ALBUM_KEY),
  );
  const [viewAlbum, setViewAlbum] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readStorage(SLIDESHOW_ALBUM_KEY),
  );
  const [albumItems, setAlbumItems] = useState<AlbumItem[]>([]);
  const [albumUrls, setAlbumUrls] = useState<Map<string, string>>(new Map());
  const [albumIntervalMs, setAlbumIntervalMs] = useState(
    SLIDESHOW_INTERVAL_DEFAULT_MS,
  );
  const [albumLoading, setAlbumLoading] = useState(false);
  const [albumQuery, setAlbumQuery] = useState("");
  const [snapshotToast, setSnapshotToast] = useState<string | null>(null);
  const [slideshow, setSlideshow] = useState<{ startIndex: number } | null>(null);
  const [dialogInterval, setDialogInterval] = useState(SLIDESHOW_INTERVAL_DEFAULT_MS);
  const [flashNoteDismissed, setFlashNoteDismissed] = useState(
    () => typeof window !== "undefined" && readStorage(FLASH_NOTE_KEY) === "1",
  );
  const snapshotRootRef = useRef(snapshotRoot);
  snapshotRootRef.current = snapshotRoot;
  const destinationRef = useRef(destinationAlbum);
  destinationRef.current = destinationAlbum;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const activeLibraryIdRef = useRef(activeLibraryId);
  activeLibraryIdRef.current = activeLibraryId;
  const librariesRef = useRef(libraries);
  librariesRef.current = libraries;
  const viewAlbumRef = useRef(viewAlbum);
  viewAlbumRef.current = viewAlbum;
  const albumUrlsRef = useRef(albumUrls);
  albumUrlsRef.current = albumUrls;
  const captureQueueRef = useRef<Promise<void>>(Promise.resolve());
  const toastBurstRef = useRef<SnapshotToastBurst | null>(null);
  const loadSeqRef = useRef(0);
  const intervalTimerRef = useRef<number | null>(null);

  const runScan = useCallback(
    async (
      nextAdapter: VideoStorageAdapter,
      options?: { resetListFilters?: boolean },
    ) => {
      setScanning(true);
      setErrorMessage(null);
      setStatusMessage("Scanning folder…");
      setScanProgress({ videos: 0, folders: 0, skipped: 0 });
      try {
        const adapterToUse = await refreshDirectoryAdapterForRescan(nextAdapter);
        if (adapterToUse !== nextAdapter) {
          setAdapter(adapterToUse);
        }
        if (options?.resetListFilters) {
          setSearchQuery("");
        }
        const result = await adapterToUse.scan((progress) => {
          setScanProgress(progress);
        });
        setScanResult(result);
        setSelectedIds(new Set());
        setVisibleCount(PAGE_SIZE);
        setMetaMap(new Map());
        setSelectedFolder(null);
        const loadedPositions = await loadThumbPositionsFromVideos(
          adapterToUse,
          result.videos,
        );
        const thumbPositions = await migrateLegacyThumbPositionsToSidecars(
          adapterToUse,
          result.videos,
          loadedPositions,
        );
        setThumbPositions(thumbPositions);
        const canWrite = await adapterToUse.canWrite();
        setWritable(canWrite);
        setNeedsPermission(false);
        const blockedCount = result.videos.filter((entry) =>
          browserEntryHint(entry),
        ).length;
        const summary =
          result.errors.length > 0
            ? `Scan finished with ${result.errors.length} read error(s).`
            : `Found ${result.videos.length} video(s).`;
        const blocked =
          blockedCount > 0
            ? ` ${blockedCount} can play, but Chrome cannot save changes to those names.`
            : "";
        setStatusMessage(`${summary}${blocked}`);
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
    },
    [],
  );

  function handleRescan() {
    if (!adapter || scanning) {
      return;
    }
    if (supportsDirectoryPicker() && adapter.mode !== "directory") {
      void handleOpenDirectory();
      return;
    }
    beginFolderPick(
      adapter.mode === "directory" && supportsDirectoryPicker()
        ? "refresh-listing"
        : "open-library",
    );
  }

  function beginFolderPick(intent: FolderPickIntent) {
    folderPickIntentRef.current = intent;
    const input = folderInputRef.current;
    if (!input) {
      return;
    }
    input.value = "";
    input.click();
  }

  async function handleOpenDirectory() {
    setErrorMessage(null);
    try {
      // showDirectoryPicker() must run in this click turn. A file-input
      // change event is not a user gesture, and Chrome rejects it.
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
    setLibraryPickerOpen(false);
  }, [activeLibraryId]);

  useEffect(() => {
    if (!libraryPickerOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!libraryPickerRef.current?.contains(event.target as Node)) {
        setLibraryPickerOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [libraryPickerOpen]);

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

  const refreshAlbums = useCallback(async (root: FileSystemDirectoryHandle) => {
    try {
      const list = await listSnapshotAlbums(root);
      setAlbums(list);
      setSnapshotNeedsPermission(false);
      setDestinationAlbum((current) =>
        current && !list.some((album) => album.name === current) ? null : current,
      );
      setViewAlbum((current) =>
        current && !list.some((album) => album.name === current) ? null : current,
      );
      return list;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not read snapshots";
      if (/permission/i.test(message)) {
        setSnapshotNeedsPermission(true);
        return [];
      }
      setErrorMessage(message);
      return [];
    }
  }, []);

  const loadAlbum = useCallback(
    async (root: FileSystemDirectoryHandle, name: string) => {
      const seq = ++loadSeqRef.current;
      setAlbumLoading(true);
      try {
        const { manifest, files } = await readAlbum(root, name);
        if (seq !== loadSeqRef.current) {
          return;
        }
        const next = new Map<string, string>();
        for (const item of manifest.items) {
          const file = files.get(item.file);
          if (file) {
            next.set(item.file, URL.createObjectURL(file));
          }
        }
        setAlbumUrls((previous) => {
          for (const url of previous.values()) {
            URL.revokeObjectURL(url);
          }
          return next;
        });
        setAlbumItems(manifest.items);
        setAlbumIntervalMs(manifest.intervalMs);
      } catch (error) {
        if (seq !== loadSeqRef.current) {
          return;
        }
        setErrorMessage(
          error instanceof Error ? error.message : "Could not open album",
        );
      } finally {
        if (seq === loadSeqRef.current) {
          setAlbumLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    writeStorage(LIBRARY_MODE_KEY, libraryMode);
  }, [libraryMode]);

  useEffect(() => {
    writeStorage(SNAPSHOT_ALBUM_KEY, destinationAlbum);
  }, [destinationAlbum]);

  useEffect(() => {
    writeStorage(SLIDESHOW_ALBUM_KEY, viewAlbum);
  }, [viewAlbum]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const root = await loadSnapshotRoot();
      if (cancelled || !root) {
        return;
      }
      setSnapshotRoot(root);
      setSnapshotRootName(root.name);
      await refreshAlbums(root);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAlbums]);

  useEffect(() => {
    if (
      libraryMode !== "slideshows" ||
      !snapshotRoot ||
      !viewAlbum ||
      snapshotNeedsPermission
    ) {
      return;
    }
    void loadAlbum(snapshotRoot, viewAlbum);
  }, [libraryMode, snapshotRoot, viewAlbum, snapshotNeedsPermission, loadAlbum]);

  useEffect(() => {
    if (!snapshotToast) {
      return;
    }
    const timer = window.setTimeout(() => setSnapshotToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [snapshotToast]);

  useEffect(() => {
    return () => {
      for (const url of albumUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      if (intervalTimerRef.current != null) {
        window.clearTimeout(intervalTimerRef.current);
      }
    };
  }, []);

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
        setErrorMessage("Folder access is not saved. Open the folder again.");
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

  async function handleFolderInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) {
      return;
    }
    const intent = folderPickIntentRef.current;
    setErrorMessage(null);

    if (!supportsDirectoryPicker()) {
      setPlaying(null);
      await attachAdapter(createFolderInputAdapter(files));
      return;
    }

    const pickedRoot = folderInputRootName(files);
    if (intent === "refresh-listing" && adapter?.mode === "directory") {
      if (pickedRoot !== adapter.rootName) {
        setErrorMessage(
          `Choose "${adapter.rootName}". The selected folder was "${pickedRoot}".`,
        );
        return;
      }
      try {
        const active = await loadActiveLibrary();
        if (!active || active.handle.name !== pickedRoot) {
          setErrorMessage("Folder access is not saved. Open the folder again.");
          return;
        }
        setSearchQuery("");
        setPlaying(null);
        await attachAdapter(createDirectoryAdapter(active.handle, files));
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Could not refresh folder",
        );
      }
      return;
    }

    // showDirectoryPicker() is not allowed from this change event.
    setPlaying(null);
    await attachAdapter(createFolderInputAdapter(files));
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

  async function refreshCurrentAlbums() {
    const root = snapshotRootRef.current;
    if (!root) {
      return;
    }
    await refreshAlbums(root);
  }

  async function handleChooseSnapshotFolder() {
    if (!window.showDirectoryPicker) {
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({
        id: "lvl-snapshots",
        mode: "readwrite",
        startIn: "pictures",
      });
      await saveSnapshotRoot(handle);
      setSnapshotRoot(handle);
      snapshotRootRef.current = handle;
      setSnapshotRootName(handle.name);
      setSnapshotNeedsPermission(false);
      setErrorMessage(null);
      await refreshAlbums(handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setErrorMessage(
        error instanceof Error ? error.message : "Could not open snapshot folder",
      );
    }
  }

  async function handleAllowSnapshots() {
    const root = snapshotRootRef.current;
    if (!root) {
      return;
    }
    try {
      await ensureSnapshotWrite(root);
      setSnapshotNeedsPermission(false);
      setErrorMessage(null);
      await refreshAlbums(root);
    } catch (error) {
      setSnapshotNeedsPermission(true);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Permission is required to save snapshots",
      );
    }
  }

  function noteSnapshotSaved(album: string) {
    const next = nextSnapshotToast(toastBurstRef.current, album, Date.now());
    toastBurstRef.current = next;
    setSnapshotToast(next.message);
  }

  async function waitIfSeeking(video: HTMLVideoElement): Promise<void> {
    if (!video.seeking) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("Could not capture this frame"));
      }, 4000);
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        video.removeEventListener("seeked", onSeeked);
      };
      video.addEventListener("seeked", onSeeked);
    });
  }

  async function captureToAlbum(video: HTMLVideoElement, albumName: string) {
    const root = snapshotRootRef.current;
    const entry = playingRef.current;
    if (!root) {
      throw new Error("Choose a folder for snapshots");
    }
    if (!entry) {
      throw new Error("Could not capture this frame");
    }
    await waitIfSeeking(video);
    const blob = await captureVideoFrame(video);
    const timeSeconds = video.currentTime;
    const sourcePath = entry.folderPath
      ? `${entry.folderPath}/${entry.name}`
      : entry.name;
    const library = librariesRef.current.find(
      (item) => item.id === activeLibraryIdRef.current,
    );
    const write = async () => {
      await writeSnapshotImage(root, albumName, {
        blob,
        videoBaseName: entry.name,
        timeSeconds,
        sourceLibraryId: library?.id,
        sourceLibraryName: library?.name,
        sourcePath,
        capturedAt: new Date().toISOString(),
      });
      noteSnapshotSaved(albumName);
      await refreshAlbums(root);
    };
    const run = captureQueueRef.current.then(write, write);
    captureQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    await run;
  }

  async function handleTakeSnapshot(video: HTMLVideoElement) {
    const album = destinationRef.current;
    if (!album) {
      throw new Error("Choose an album");
    }
    await captureToAlbum(video, album);
  }

  async function handlePickSnapshotAlbum(name: string, video: HTMLVideoElement) {
    setDestinationAlbum(name);
    destinationRef.current = name;
    await captureToAlbum(video, name);
  }

  async function handleCreateSnapshotFromPlayer(
    name: string,
    video: HTMLVideoElement,
  ) {
    const root = snapshotRootRef.current;
    if (!root) {
      throw new Error("Choose a folder for snapshots");
    }
    const trimmed = name.trim();
    await createSnapshotAlbum(root, trimmed, SLIDESHOW_INTERVAL_DEFAULT_MS);
    setDestinationAlbum(trimmed);
    destinationRef.current = trimmed;
    setViewAlbum((current) => current ?? trimmed);
    await refreshAlbums(root);
    await captureToAlbum(video, trimmed);
  }

  function handleViewSnapshotToast() {
    const album = destinationRef.current;
    if (album) {
      setViewAlbum(album);
    }
    setLibraryMode("slideshows");
    setSlideshow(null);
    setSnapshotToast(null);
    closePlayer();
  }

  function handleIntervalChange(ms: number) {
    const album = viewAlbumRef.current;
    const root = snapshotRootRef.current;
    setAlbumIntervalMs(ms);
    if (album) {
      setAlbums((current) =>
        current.map((row) =>
          row.name === album ? { ...row, intervalMs: ms } : row,
        ),
      );
    }
    if (intervalTimerRef.current != null) {
      window.clearTimeout(intervalTimerRef.current);
    }
    if (!album || !root) {
      return;
    }
    intervalTimerRef.current = window.setTimeout(() => {
      void saveAlbumInterval(root, album, ms).catch((error) => {
        setErrorMessage(
          error instanceof Error ? error.message : "Could not save interval",
        );
      });
    }, 300);
  }

  function handleReorderSnapshots(fileOrder: string[]) {
    const album = viewAlbumRef.current;
    const root = snapshotRootRef.current;
    if (!album || !root) {
      return;
    }
    setAlbumItems((current) => orderAlbumItems(current, fileOrder));
    void saveSnapshotOrder(root, album, fileOrder).catch((error) => {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not save snapshot order",
      );
      void loadAlbum(root, album);
    });
  }

  function dismissFlashNote() {
    writeStorage(FLASH_NOTE_KEY, "1");
    setFlashNoteDismissed(true);
  }

  function openCreateAlbum() {
    setErrorMessage(null);
    setDialog({ type: "create-album" });
    setDialogValue("");
    setDialogInterval(SLIDESHOW_INTERVAL_DEFAULT_MS);
  }

  function openRenameAlbum(name: string) {
    setErrorMessage(null);
    setDialog({ type: "rename-album", name });
    setDialogValue(name);
  }

  function openDeleteAlbum(name: string, count: number) {
    setErrorMessage(null);
    setDialog({ type: "delete-album", name, count });
    setDialogValue("");
  }

  function openDeleteSnapshot(album: string, file: string) {
    setErrorMessage(null);
    setDialog({ type: "delete-snapshot", album, file });
    setDialogValue("");
  }

  async function submitDialog() {
    if (!dialog) {
      return;
    }
    if (
      dialog.type === "create-album" ||
      dialog.type === "rename-album" ||
      dialog.type === "delete-album" ||
      dialog.type === "delete-snapshot"
    ) {
      const root = snapshotRootRef.current;
      if (!root) {
        setErrorMessage("Choose a folder for snapshots");
        return;
      }
      setErrorMessage(null);
      try {
        if (dialog.type === "create-album") {
          const name = dialogValue.trim();
          await createSnapshotAlbum(root, name, dialogInterval);
          await refreshAlbums(root);
          setViewAlbum(name);
          setDestinationAlbum((current) => current ?? name);
        } else if (dialog.type === "rename-album") {
          const nextName = dialogValue.trim();
          await renameSnapshotAlbum(root, dialog.name, nextName);
          if (destinationRef.current === dialog.name) {
            setDestinationAlbum(nextName);
          }
          if (viewAlbumRef.current === dialog.name) {
            setViewAlbum(nextName);
          }
          await refreshAlbums(root);
        } else if (dialog.type === "delete-album") {
          await deleteSnapshotAlbum(root, dialog.name);
          if (destinationRef.current === dialog.name) {
            setDestinationAlbum(null);
          }
          if (viewAlbumRef.current === dialog.name) {
            setViewAlbum(null);
            setAlbumItems([]);
            setAlbumUrls((previous) => {
              for (const url of previous.values()) {
                URL.revokeObjectURL(url);
              }
              return new Map();
            });
          }
          await refreshAlbums(root);
        } else {
          await deleteSnapshotImage(root, dialog.album, dialog.file);
          await refreshAlbums(root);
          await loadAlbum(root, dialog.album);
        }
        setDialog(null);
        setDialogValue("");
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Operation failed",
        );
      }
      return;
    }
    if (!adapter) {
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
  const activeLibrary =
    libraries.find((library) => library.id === activeLibraryId) ?? null;
  const otherLibraries = libraries.filter(
    (library) => library.id !== activeLibraryId,
  );
  const snapshotCards = useMemo<SnapshotCard[]>(
    () =>
      albumItems.flatMap((item) => {
        const url = albumUrls.get(item.file);
        if (!url) {
          return [];
        }
        return [{ item, url, label: snapshotLabel(item) }];
      }),
    [albumItems, albumUrls],
  );
  const overlayOpen = playing != null || slideshow != null || dialog != null;

  return (
    <div className="app-shell">
      <input
        ref={folderInputRef}
        className="folder-input"
        type="file"
        multiple
        {...{ webkitdirectory: "", directory: "" }}
        onChange={(event) => void handleFolderInputChange(event)}
      />
      <aside className="sidebar" inert={overlayOpen}>
        <div className="sidebar-header">
          <h1>Local Video Library</h1>
          <div className="sidebar-actions">
            {libraryMode === "slideshows" ? (
              <>
                {supportsDirectoryPicker() ? (
                  <button
                    type="button"
                    className="btn icon outline"
                    aria-label="Choose snapshot folder"
                    onClick={() => void handleChooseSnapshotFolder()}
                  >
                    <FolderOpen size={16} />
                  </button>
                ) : null}
                {snapshotNeedsPermission ? (
                  <button type="button" className="btn" onClick={() => void handleAllowSnapshots()}>
                    Allow access
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn icon"
                  aria-label="Refresh albums"
                  disabled={!snapshotRoot}
                  onClick={() => void refreshCurrentAlbums()}
                >
                  <RefreshCw size={16} />
                </button>
              </>
            ) : supportsDirectoryPicker() ? (
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
                <button
                  type="button"
                  className="btn icon"
                  aria-label="Refresh"
                  title="Choose this folder again so names Chrome hides are included"
                  disabled={!adapter || scanning}
                  onClick={handleRescan}
                >
                  <RefreshCw size={16} />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn outline"
                  onClick={() => beginFolderPick("open-library")}
                >
                  <FolderInput size={16} />
                  Choose folder
                </button>
                <button
                  type="button"
                  className="btn icon"
                  aria-label="Refresh"
                  title="Choose this folder again so names Chrome hides are included"
                  disabled={!adapter || scanning}
                  onClick={handleRescan}
                >
                  <RefreshCw size={16} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mode-switch" role="group" aria-label="Library mode">
          <button
            type="button"
            aria-pressed={libraryMode === "videos"}
            onClick={() => setLibraryMode("videos")}
          >
            Videos
          </button>
          <button
            type="button"
            aria-pressed={libraryMode === "slideshows"}
            onClick={() => setLibraryMode("slideshows")}
          >
            Slideshows
          </button>
        </div>

        {libraryMode === "videos" ? (
          <>
        {readOnly ? (
          <p className="notice">
            Read-only mode. Rename, move, and delete are disabled.
          </p>
        ) : null}

        {activeLibrary ? (
          <div className="library-panel" ref={libraryPickerRef}>
            <div
              className={`folder-row library-current ${libraryPickerOpen ? "active" : ""}`}
            >
              <button
                type="button"
                className="folder-item"
                aria-expanded={libraryPickerOpen}
                aria-haspopup="listbox"
                onClick={() => {
                  if (otherLibraries.length > 0) {
                    setLibraryPickerOpen((current) => !current);
                  }
                }}
              >
                <span className="folder-item-name">{activeLibrary.name}</span>
              </button>
              {otherLibraries.length > 0 ? (
                <ChevronDown
                  size={14}
                  className={`library-chevron ${libraryPickerOpen ? "is-open" : ""}`}
                  aria-hidden="true"
                />
              ) : null}
              <FolderRowMenu
                deleteLabel="Remove"
                onDelete={() => void handleRemoveLibrary(activeLibrary.id)}
              />
            </div>
            {libraryPickerOpen && otherLibraries.length > 0 ? (
              <div className="library-picker-list" role="listbox">
                {otherLibraries.map((library) => (
                  <button
                    key={library.id}
                    type="button"
                    role="option"
                    className="library-picker-item"
                    onClick={() => {
                      setLibraryPickerOpen(false);
                      void handleSelectLibrary(library);
                    }}
                  >
                    {library.name}
                  </button>
                ))}
              </div>
            ) : null}
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
          </>
        ) : (
          <div className="folder-panel">
            {snapshotRootName ? (
              <div className="folder-row active">
                <div className="folder-item">
                  <span className="folder-item-name">{snapshotRootName}</span>
                  <span className="album-row-meta">Snapshot folder</span>
                </div>
              </div>
            ) : null}
            <div className="folder-panel-header">
              <h2>Albums</h2>
              {supportsDirectoryPicker() && snapshotRoot && !snapshotNeedsPermission ? (
                <button
                  type="button"
                  className="btn icon"
                  aria-label="Create album"
                  onClick={openCreateAlbum}
                >
                  <Plus size={16} />
                </button>
              ) : null}
            </div>
            <div className="folder-list">
              {albums.length === 0 ? (
                <p className="album-row-meta">No albums yet</p>
              ) : (
                albums.map((album) => (
                  <div
                    key={album.path}
                    className={`folder-row ${viewAlbum === album.name ? "active" : ""}`}
                  >
                    <button
                      type="button"
                      className="folder-item"
                      onClick={() => setViewAlbum(album.name)}
                    >
                      <span className="folder-item-name">{album.name}</span>
                      <span className="album-row-meta">
                        {album.name === destinationAlbum
                          ? `Saving here · ${formatInterval(album.intervalMs)}`
                          : formatInterval(album.intervalMs)}
                      </span>
                    </button>
                    {supportsDirectoryPicker() ? (
                      <FolderRowMenu
                        menuLabel="Album options"
                        onRename={() => openRenameAlbum(album.name)}
                        onUseForSnapshots={
                          album.name === destinationAlbum
                            ? undefined
                            : () => setDestinationAlbum(album.name)
                        }
                        onDelete={() => openDeleteAlbum(album.name, album.count)}
                      />
                    ) : null}
                    <span className="folder-item-count">{album.count}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </aside>

      <main className="main-panel" inert={overlayOpen}>
        {libraryMode === "slideshows" ? (
          <>
            {errorMessage ? (
              <div className="status-bar">
                <span className="error-text">{errorMessage}</span>
              </div>
            ) : null}
            <SnapshotGallery
              hasRoot={snapshotRoot != null}
              needsPermission={snapshotNeedsPermission}
              canPickFolder={supportsDirectoryPicker()}
              albumName={viewAlbum}
              cards={snapshotCards}
              loading={albumLoading}
              intervalMs={albumIntervalMs}
              search={albumQuery}
              showFlashNote={!flashNoteDismissed}
              onSearch={setAlbumQuery}
              onChooseFolder={() => void handleChooseSnapshotFolder()}
              onAllowAccess={() => void handleAllowSnapshots()}
              onCreateAlbum={openCreateAlbum}
              onIntervalChange={handleIntervalChange}
              onDismissFlashNote={dismissFlashNote}
              onPlay={() => setSlideshow({ startIndex: 0 })}
              onOpenAt={(index) => setSlideshow({ startIndex: index })}
              onDelete={(item) => {
                if (viewAlbum) {
                  openDeleteSnapshot(viewAlbum, item.file);
                }
              }}
              onReorder={handleReorderSnapshots}
            />
          </>
        ) : (
          <>
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
            {isIosDevice() ? (
              <p>In the picker, open the folder, then tap Open.</p>
            ) : null}
            {supportsDirectoryPicker() ? (
              <button type="button" className="btn outline" onClick={() => void handleOpenDirectory()}>
                <FolderOpen size={16} />
                Open folder
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={() => beginFolderPick("open-library")}
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
              onClick={handleRescan}
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
                const nameHint = browserEntryHint(entry);
                const quality = formatVideoQuality(meta?.videoWidth, meta?.videoHeight);
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
                        {nameHint ? (
                          <span className="name-warning" title={nameHint}>
                            {nameHint}
                          </span>
                        ) : null}
                        {viewMode === "list" ? (
                          <>
                            {entry.folderPath ? (
                              <span>{entry.folderPath}</span>
                            ) : null}
                            <span>
                              {`${formatBytes(entry.size)} · ${formatDate(entry.lastModified)}`}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </button>
                    {viewMode === "grid" ? (
                      <div
                        className={`video-meta-foot${entry.folderPath ? "" : " align-end"}`}
                      >
                        {entry.folderPath ? (
                          <span
                            className="video-meta-folder"
                            title={entry.folderPath}
                          >
                            {folderNameFromPath(entry.folderPath)}
                          </span>
                        ) : null}
                        <span className="video-meta-size">
                          {formatBytes(entry.size)}
                        </span>
                        {quality ? (
                          <>
                            <span className="video-meta-sep" aria-hidden="true">
                              ·
                            </span>
                            <span className="video-meta-quality">{quality}</span>
                          </>
                        ) : null}
                        {writable ? (
                          <VideoCardMenu
                            entry={entry}
                            onRename={openRenameVideo}
                            onMove={(item) => openMoveVideos([item])}
                            onDelete={(item) => openDeleteVideos([item])}
                          />
                        ) : null}
                      </div>
                    ) : writable ? (
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
          snapshotsAvailable={supportsDirectoryPicker()}
          hasSnapshotRoot={snapshotRoot != null}
          snapshotNeedsPermission={snapshotNeedsPermission}
          snapshotDestination={destinationAlbum}
          snapshotAlbums={albums}
          snapshotToast={snapshotToast}
          onTakeSnapshot={handleTakeSnapshot}
          onPickSnapshotAlbum={handlePickSnapshotAlbum}
          onCreateSnapshotAlbum={handleCreateSnapshotFromPlayer}
          onChooseSnapshotFolder={() => void handleChooseSnapshotFolder()}
          onAllowSnapshotAccess={() => void handleAllowSnapshots()}
          onViewSnapshotToast={handleViewSnapshotToast}
        />
      ) : null}

      {slideshow && viewAlbum ? (
        <SlideshowPlayer
          albumName={viewAlbum}
          slides={snapshotCards.map((card) => ({
            url: card.url,
            label: card.label,
          }))}
          startIndex={slideshow.startIndex}
          intervalMs={albumIntervalMs}
          showFlashNote={!flashNoteDismissed}
          onClose={() => setSlideshow(null)}
          onIntervalChange={handleIntervalChange}
          onDismissFlashNote={dismissFlashNote}
        />
      ) : null}

      {dialog ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="dialog" aria-modal="true">
            <h2>{dialogTitle(dialog)}</h2>
            {dialogBody(dialog)}
            {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
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
      case "create-album":
        return "Create album";
      case "rename-album":
        return "Rename album";
      case "delete-album":
        return "Delete album";
      case "delete-snapshot":
        return "Delete snapshot";
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
      case "create-album":
        return (
          <>
            <p>
              Albums are folders inside your snapshot directory. The interval is
              how long each photo stays on screen.
            </p>
            <input
              className="dialog-input"
              value={dialogValue}
              aria-label="Album name"
              placeholder="Album name"
              autoFocus
              onChange={(event) => setDialogValue(event.target.value)}
            />
            <IntervalSlider value={dialogInterval} onChange={setDialogInterval} />
          </>
        );
      case "rename-album":
        return <p>Enter a new album name without path separators.</p>;
      case "delete-album":
        return (
          <p>
            This permanently deletes album "{state.name}" and {state.count} photo(s)
            from your snapshot folder. This cannot be undone.
          </p>
        );
      case "delete-snapshot":
        return (
          <p>
            This permanently deletes this snapshot from the album folder. This
            cannot be undone.
          </p>
        );
      default:
        return null;
    }
  }

  function dialogNeedsInput(state: NonNullable<DialogState>): boolean {
    return (
      state.type !== "delete-videos" &&
      state.type !== "delete-folder" &&
      state.type !== "delete-album" &&
      state.type !== "delete-snapshot" &&
      state.type !== "create-album"
    );
  }
}
