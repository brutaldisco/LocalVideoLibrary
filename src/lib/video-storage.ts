import { browserEntryHint, browserPathHint } from "./browser-file-name";
import {
  isVideoFileName,
  joinFolderPath,
  normalizeFolderPath,
  parentFolderPath,
  splitFolderPath,
  validateEntryName,
  validateFolderPath,
  validateVideoFileName,
} from "./file-helpers";
import {
  relativePathFromFolderInput,
  supplementDirectoryListing,
} from "./scan-folder-files";
import {
  embedThumbSeek,
  playbackBlobFromFile,
  readThumbSeekFromBlob,
  UnsupportedMediaContainerError,
} from "./video-thumb-box";
import {
  parseThumbSidecar,
  serializeThumbSidecar,
  thumbSidecarName,
} from "./video-thumb-sidecar";
import { idbGet, idbSet, ROOT_HANDLE_KEY } from "./idb";
import { loadActiveLibrary, rememberLibrary } from "./library-roots";
import type {
  ScanProgress,
  ScanResult,
  SourceMode,
  VideoFileEntry,
  VideoStorageAdapter,
} from "./types";

const YIELD_EVERY = 48;
const READONLY_ERROR = "Read-only mode: file changes are not supported in this browser.";

let memoryRoot: FileSystemDirectoryHandle | null = null;

export function supportsDirectoryPicker(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function"
  );
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

async function queryPermission(
  handle: FileSystemHandle,
  mode: "read" | "readwrite",
): Promise<PermissionState> {
  if (!handle.queryPermission) {
    return "granted";
  }
  try {
    return await handle.queryPermission({ mode });
  } catch {
    return "denied";
  }
}

async function requestPermission(
  handle: FileSystemHandle,
  mode: "read" | "readwrite",
): Promise<PermissionState> {
  if (!handle.requestPermission) {
    return "granted";
  }
  try {
    return await handle.requestPermission({ mode });
  } catch {
    return "denied";
  }
}

export async function ensureReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const current = await queryPermission(handle, "read");
  if (current === "granted") {
    return true;
  }
  const next = await requestPermission(handle, "read");
  return next === "granted";
}

export async function ensureWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const current = await queryPermission(handle, "readwrite");
  if (current === "granted") {
    return true;
  }
  const next = await requestPermission(handle, "readwrite");
  return next === "granted";
}

export async function persistRootHandle(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  try {
    await idbSet(ROOT_HANDLE_KEY, handle);
    return true;
  } catch {
    return false;
  }
}

export async function loadSavedRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (memoryRoot) {
    return memoryRoot;
  }
  try {
    const stored =
      (await idbGet<FileSystemDirectoryHandle>(ROOT_HANDLE_KEY)) ?? null;
    if (stored) {
      memoryRoot = stored;
    }
    return stored;
  } catch {
    return null;
  }
}

export async function pickDirectoryRoot(): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) {
    throw new Error("File System Access API is not supported");
  }
  try {
    const handle = await window.showDirectoryPicker({
      id: "lvl",
      mode: "readwrite",
      startIn: "videos",
    });
    memoryRoot = handle;
    await rememberLibrary(handle);
    return handle;
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      throw error;
    }
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    memoryRoot = handle;
    await rememberLibrary(handle);
    return handle;
  }
}

async function resolveDirectoryHandle(
  root: FileSystemDirectoryHandle,
  folderPath: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const part of splitFolderPath(folderPath)) {
    current = await current.getDirectoryHandle(part, { create });
  }
  return current;
}

async function fileExists(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await parent.getDirectoryHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function copyFileHandle(
  source: FileSystemFileHandle,
  targetDir: FileSystemDirectoryHandle,
  targetName: string,
): Promise<void> {
  const file = await source.getFile();
  const target = await targetDir.getFileHandle(targetName, { create: true });
  const writable = await target.createWritable();
  try {
    await writable.write(file);
    await writable.close();
  } catch (error) {
    await writable.close().catch(() => undefined);
    throw error;
  }
}

async function moveFileBetweenDirs(
  sourceDir: FileSystemDirectoryHandle,
  sourceName: string,
  targetDir: FileSystemDirectoryHandle,
  targetName: string,
): Promise<void> {
  const sourceHandle = await sourceDir.getFileHandle(sourceName);
  if (await fileExists(targetDir, targetName)) {
    throw new Error(`Target already exists: ${targetName}`);
  }
  await copyFileHandle(sourceHandle, targetDir, targetName);
  await sourceDir.removeEntry(sourceName);
}

async function readSidecarSeekSeconds(
  parent: FileSystemDirectoryHandle,
  videoName: string,
): Promise<number | undefined> {
  try {
    const handle = await parent.getFileHandle(thumbSidecarName(videoName));
    const file = await handle.getFile();
    return parseThumbSidecar(await file.text());
  } catch {
    return undefined;
  }
}

async function writeSidecarSeekSeconds(
  parent: FileSystemDirectoryHandle,
  videoName: string,
  seconds: number,
): Promise<void> {
  const handle = await parent.getFileHandle(thumbSidecarName(videoName), {
    create: true,
  });
  const writable = await handle.createWritable();
  try {
    await writable.write(serializeThumbSidecar(seconds));
    await writable.close();
  } catch (error) {
    await writable.close().catch(() => undefined);
    throw error;
  }
}

async function deleteSidecarIfExists(
  parent: FileSystemDirectoryHandle,
  videoName: string,
): Promise<void> {
  try {
    await parent.removeEntry(thumbSidecarName(videoName));
  } catch {
    // Sidecar is optional.
  }
}

async function withWritable(
  handle: FileSystemFileHandle,
  action: (writable: FileSystemWritableFileStream) => Promise<void>,
): Promise<void> {
  const writable = await handle.createWritable({ keepExistingData: true });
  try {
    await action(writable);
    await writable.close();
  } catch (error) {
    await writable.close().catch(() => undefined);
    throw error;
  }
}

async function writeEmbeddedThumbSeek(
  handle: FileSystemFileHandle,
  seconds: number,
): Promise<void> {
  const file = await handle.getFile();
  await embedThumbSeek(
    file.size,
    async (offset, length) =>
      new Uint8Array(
        await (await handle.getFile()).slice(offset, offset + length).arrayBuffer(),
      ),
    async (offset, data) => {
      await withWritable(handle, async (writable) => {
        await writable.seek(offset);
        const copy = new ArrayBuffer(data.byteLength);
        new Uint8Array(copy).set(data);
        await writable.write(copy);
      });
    },
    seconds,
    {
      truncate: async (size) => {
        await withWritable(handle, async (writable) => {
          await writable.truncate(size);
        });
      },
    },
  );
}

async function absorbSidecar(
  parent: FileSystemDirectoryHandle,
  handle: FileSystemFileHandle,
  videoName: string,
): Promise<"embedded" | "sidecar"> {
  const embedded = await readThumbSeekFromBlob(await handle.getFile());
  const sidecar = await readSidecarSeekSeconds(parent, videoName);
  if (embedded != null) {
    if (sidecar != null) {
      await deleteSidecarIfExists(parent, videoName);
    }
    return "embedded";
  }
  if (sidecar == null) {
    return "embedded";
  }
  try {
    await writeEmbeddedThumbSeek(handle, sidecar);
    await deleteSidecarIfExists(parent, videoName);
    return "embedded";
  } catch (error) {
    if (error instanceof UnsupportedMediaContainerError) {
      return "sidecar";
    }
    throw error;
  }
}

async function renameSidecarIfExists(
  parent: FileSystemDirectoryHandle,
  oldVideoName: string,
  nextVideoName: string,
): Promise<void> {
  const oldName = thumbSidecarName(oldVideoName);
  if (!(await fileExists(parent, oldName))) {
    return;
  }
  const nextName = thumbSidecarName(nextVideoName);
  if (await fileExists(parent, nextName)) {
    await parent.removeEntry(nextName);
  }
  const sourceHandle = await parent.getFileHandle(oldName);
  await copyFileHandle(sourceHandle, parent, nextName);
  await parent.removeEntry(oldName);
}

async function moveSidecarIfExists(
  sourceDir: FileSystemDirectoryHandle,
  videoName: string,
  targetDir: FileSystemDirectoryHandle,
): Promise<void> {
  const sidecarName = thumbSidecarName(videoName);
  if (!(await fileExists(sourceDir, sidecarName))) {
    return;
  }
  if (await fileExists(targetDir, sidecarName)) {
    await targetDir.removeEntry(sidecarName);
  }
  const sourceHandle = await sourceDir.getFileHandle(sidecarName);
  await copyFileHandle(sourceHandle, targetDir, sidecarName);
  await sourceDir.removeEntry(sidecarName);
}

async function moveDirectoryContents(
  sourceDir: FileSystemDirectoryHandle,
  targetDir: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const [name, handle] of sourceDir.entries()) {
    if (handle.kind === "file") {
      if (await fileExists(targetDir, name)) {
        throw new Error(`Target already exists: ${name}`);
      }
      await copyFileHandle(handle as FileSystemFileHandle, targetDir, name);
      await sourceDir.removeEntry(name);
      continue;
    }
    if (await directoryExists(targetDir, name)) {
      throw new Error(`Target folder already exists: ${name}`);
    }
    const nestedTarget = await targetDir.getDirectoryHandle(name, {
      create: true,
    });
    await moveDirectoryContents(
      handle as FileSystemDirectoryHandle,
      nestedTarget,
    );
    await sourceDir.removeEntry(name, { recursive: true });
  }
}

async function scanDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  relativePath: string,
  sourceMode: SourceMode,
  onProgress?: (progress: ScanProgress) => void,
): Promise<{
  videos: VideoFileEntry[];
  folders: Set<string>;
  skipped: number;
  errors: string[];
}> {
  const videos: VideoFileEntry[] = [];
  const folders = new Set<string>([relativePath]);
  let skipped = 0;
  const errors: string[] = [];
  let processed = 0;

  async function walk(
    handle: FileSystemDirectoryHandle,
    folderPath: string,
  ): Promise<void> {
    folders.add(folderPath);
    for await (const [name, entryHandle] of handle.entries()) {
      processed += 1;
      if (processed % YIELD_EVERY === 0) {
        onProgress?.({
          videos: videos.length,
          folders: folders.size,
          skipped,
        });
        await yieldToMain();
      }

      const childPath = joinFolderPath(folderPath, name);
      if (entryHandle.kind === "directory") {
        try {
          await walk(entryHandle as FileSystemDirectoryHandle, childPath);
        } catch (error) {
          errors.push(
            `${childPath}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        continue;
      }

      if (!isVideoFileName(name)) {
        skipped += 1;
        continue;
      }

      try {
        const fileHandle = entryHandle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const path = joinFolderPath(folderPath, name);
        videos.push({
          id: path,
          name,
          path,
          folderPath,
          size: file.size,
          lastModified: file.lastModified,
          sourceMode,
          file,
          handle: fileHandle,
        });
      } catch (error) {
        errors.push(
          `${childPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  await walk(dirHandle, relativePath);
  onProgress?.({ videos: videos.length, folders: folders.size, skipped });
  return { videos, folders, skipped, errors };
}

class DirectoryVideoAdapter implements VideoStorageAdapter {
  readonly mode: SourceMode = "directory";
  readonly writable = true;

  constructor(
    private readonly root: FileSystemDirectoryHandle,
    readonly supplementalFiles: readonly File[] = [],
  ) {}

  get rootName(): string {
    return this.root.name;
  }

  async scan(onProgress?: (progress: ScanProgress) => void): Promise<ScanResult> {
    if (!(await ensureReadPermission(this.root))) {
      throw new Error("Read permission was not granted");
    }
    const result = await scanDirectoryHandle(
      this.root,
      "",
      this.mode,
      onProgress,
    );
    const merged = supplementDirectoryListing(
      {
        videos: result.videos,
        folders: [...result.folders],
        skipped: result.skipped,
        errors: result.errors,
      },
      this.supplementalFiles,
      this.root.name,
    );
    return {
      ...merged,
      folders: [...merged.folders].sort(),
    };
  }

  private supplementalFile(relativePath: string): File | undefined {
    const target = normalizeFolderPath(relativePath);
    for (const file of this.supplementalFiles) {
      const relative = relativePathFromFolderInput(file, this.root.name);
      if (relative && normalizeFolderPath(relative) === target) {
        return file;
      }
    }
    return undefined;
  }

  private assertMutableEntry(entry: VideoFileEntry): void {
    const hint = browserEntryHint(entry);
    if (hint) {
      throw new Error(hint);
    }
  }

  private assertMutablePath(relativePath: string): void {
    const hint = browserPathHint(relativePath);
    if (hint) {
      throw new Error(hint);
    }
  }

  private async loadSupplementalThumb(
    entry: VideoFileEntry,
  ): Promise<number | undefined> {
    try {
      const videoFile = entry.file ?? this.supplementalFile(entry.path);
      if (videoFile) {
        const embedded = await readThumbSeekFromBlob(videoFile);
        if (embedded != null) {
          return embedded;
        }
      }
      const sidecar = this.supplementalFile(
        joinFolderPath(entry.folderPath, thumbSidecarName(entry.name)),
      );
      if (!sidecar) {
        return undefined;
      }
      return parseThumbSidecar(await sidecar.text());
    } catch {
      return undefined;
    }
  }

  async createObjectUrl(entry: VideoFileEntry): Promise<string> {
    const file = entry.handle
      ? await entry.handle.getFile()
      : (entry.file ?? null);
    if (!file) {
      throw new Error(`File not found: ${entry.path}`);
    }
    const playback = await playbackBlobFromFile(file);
    return URL.createObjectURL(playback);
  }

  async loadThumbSeekSeconds(
    entry: VideoFileEntry,
  ): Promise<number | undefined> {
    if (browserEntryHint(entry)) {
      return this.loadSupplementalThumb(entry);
    }
    const parent = await resolveDirectoryHandle(this.root, entry.folderPath);
    const handle = entry.handle ?? (await parent.getFileHandle(entry.name));
    const embedded = await readThumbSeekFromBlob(await handle.getFile());
    if (embedded != null) {
      await deleteSidecarIfExists(parent, entry.name);
      return embedded;
    }
    const sidecar = await readSidecarSeekSeconds(parent, entry.name);
    if (sidecar == null) {
      return undefined;
    }
    try {
      await writeEmbeddedThumbSeek(handle, sidecar);
      await deleteSidecarIfExists(parent, entry.name);
    } catch {
      // Keep the sidecar until a later writable scan can embed it.
    }
    return sidecar;
  }

  async saveThumbSeekSeconds(
    entry: VideoFileEntry,
    seconds: number,
  ): Promise<void> {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error("Invalid thumbnail seek position");
    }
    this.assertMutableEntry(entry);
    await this.requireWrite();
    const parent = await resolveDirectoryHandle(this.root, entry.folderPath);
    const handle = entry.handle ?? (await parent.getFileHandle(entry.name));
    try {
      await writeEmbeddedThumbSeek(handle, seconds);
      await deleteSidecarIfExists(parent, entry.name);
    } catch (error) {
      if (!(error instanceof UnsupportedMediaContainerError)) {
        throw error;
      }
      await writeSidecarSeekSeconds(parent, entry.name, seconds);
    }
  }

  async canWrite(): Promise<boolean> {
    return ensureWritePermission(this.root);
  }

  private async requireWrite(): Promise<void> {
    if (!(await this.canWrite())) {
      throw new Error("Write permission was not granted");
    }
  }

  async deleteVideos(entries: VideoFileEntry[]): Promise<void> {
    for (const entry of entries) {
      this.assertMutableEntry(entry);
    }
    await this.requireWrite();
    for (const entry of entries) {
      const parent = await resolveDirectoryHandle(this.root, entry.folderPath);
      await deleteSidecarIfExists(parent, entry.name);
      await parent.removeEntry(entry.name);
    }
  }

  async renameVideo(entry: VideoFileEntry, nextName: string): Promise<void> {
    const err = validateVideoFileName(nextName);
    if (err) {
      throw new Error(err);
    }
    this.assertMutableEntry(entry);
    await this.requireWrite();
    const parent = await resolveDirectoryHandle(this.root, entry.folderPath);
    if (await fileExists(parent, nextName)) {
      throw new Error(`A file named "${nextName}" already exists`);
    }
    const sourceHandle = await parent.getFileHandle(entry.name);
    const thumb = await absorbSidecar(parent, sourceHandle, entry.name);
    await copyFileHandle(sourceHandle, parent, nextName);
    try {
      if (thumb === "sidecar") {
        await renameSidecarIfExists(parent, entry.name, nextName);
      }
      await parent.removeEntry(entry.name);
    } catch (error) {
      throw new Error(
        `Renamed copy created but original could not be removed: ${
          error instanceof Error ? error.message : String(error)
        }. Rescan to verify.`,
      );
    }
  }

  async moveVideos(
    entries: VideoFileEntry[],
    targetFolderPath: string,
  ): Promise<void> {
    const normalized = normalizeFolderPath(targetFolderPath);
    const pathErr = validateFolderPath(normalized);
    if (pathErr) {
      throw new Error(pathErr);
    }
    for (const entry of entries) {
      this.assertMutableEntry(entry);
    }
    await this.requireWrite();
    const targetDir = await resolveDirectoryHandle(this.root, normalized, true);
    for (const entry of entries) {
      const sourceDir = await resolveDirectoryHandle(this.root, entry.folderPath);
      const sourceHandle = await sourceDir.getFileHandle(entry.name);
      const thumb = await absorbSidecar(sourceDir, sourceHandle, entry.name);
      await moveFileBetweenDirs(sourceDir, entry.name, targetDir, entry.name);
      if (thumb === "sidecar") {
        await moveSidecarIfExists(sourceDir, entry.name, targetDir);
      }
    }
  }

  async createFolder(folderPath: string): Promise<void> {
    const normalized = normalizeFolderPath(folderPath);
    const pathErr = validateFolderPath(normalized);
    if (pathErr) {
      throw new Error(pathErr);
    }
    await this.requireWrite();
    await resolveDirectoryHandle(this.root, normalized, true);
  }

  async renameFolder(folderPath: string, nextName: string): Promise<void> {
    const normalized = normalizeFolderPath(folderPath);
    if (!normalized) {
      throw new Error("Root folder cannot be renamed");
    }
    const nameErr = validateEntryName(nextName);
    if (nameErr) {
      throw new Error(nameErr);
    }
    this.assertMutablePath(normalized);
    await this.requireWrite();
    const parentPath = parentFolderPath(normalized);
    const oldName = normalized.split("/").pop() ?? normalized;
    if (oldName === nextName) {
      return;
    }
    const parentDir = await resolveDirectoryHandle(this.root, parentPath);
    if (await directoryExists(parentDir, nextName)) {
      throw new Error(`Folder "${nextName}" already exists`);
    }
    const sourceDir = await parentDir.getDirectoryHandle(oldName);
    const targetDir = await parentDir.getDirectoryHandle(nextName, {
      create: true,
    });
    await moveDirectoryContents(sourceDir, targetDir);
    await parentDir.removeEntry(oldName, { recursive: true });
  }

  async deleteFolder(folderPath: string): Promise<void> {
    const normalized = normalizeFolderPath(folderPath);
    if (!normalized) {
      throw new Error("Root folder cannot be deleted");
    }
    this.assertMutablePath(normalized);
    await this.requireWrite();
    const parentPath = parentFolderPath(normalized);
    const name = normalized.split("/").pop() ?? normalized;
    const parentDir = await resolveDirectoryHandle(this.root, parentPath);
    await parentDir.removeEntry(name, { recursive: true });
  }
}

class FolderInputVideoAdapter implements VideoStorageAdapter {
  readonly mode: SourceMode = "folder-input";
  readonly writable = false;

  constructor(
    private readonly files: File[],
    readonly rootName: string,
  ) {}

  async scan(onProgress?: (progress: ScanProgress) => void): Promise<ScanResult> {
    const videos: VideoFileEntry[] = [];
    const folders = new Set<string>([""]);
    let skipped = 0;
    const errors: string[] = [];

    for (let index = 0; index < this.files.length; index += 1) {
      const file = this.files[index];
      if (index % YIELD_EVERY === 0) {
        onProgress?.({
          videos: videos.length,
          folders: folders.size,
          skipped,
        });
        await yieldToMain();
      }

      const relative = normalizeFolderPath(
        file.webkitRelativePath
          ? file.webkitRelativePath.split("/").slice(0, -1).join("/")
          : "",
      );
      folders.add(relative);

      if (!isVideoFileName(file.name)) {
        skipped += 1;
        continue;
      }

      const path = joinFolderPath(relative, file.name);
      videos.push({
        id: path,
        name: file.name,
        path,
        folderPath: relative,
        size: file.size,
        lastModified: file.lastModified,
        sourceMode: this.mode,
        file,
      });
    }

    onProgress?.({ videos: videos.length, folders: folders.size, skipped });
    return {
      videos,
      folders: [...folders].sort(),
      skipped,
      errors,
    };
  }

  async createObjectUrl(entry: VideoFileEntry): Promise<string> {
    if (!entry.file) {
      throw new Error(`File not found: ${entry.path}`);
    }
    const playback = await playbackBlobFromFile(entry.file);
    return URL.createObjectURL(playback);
  }

  async loadThumbSeekSeconds(
    entry: VideoFileEntry,
  ): Promise<number | undefined> {
    if (entry.file) {
      const embedded = await readThumbSeekFromBlob(entry.file);
      if (embedded != null) {
        return embedded;
      }
    }
    const sidecarPath = joinFolderPath(
      entry.folderPath,
      thumbSidecarName(entry.name),
    );
    const sidecarFile = this.files.find((file) => {
      const folderPath = normalizeFolderPath(
        file.webkitRelativePath
          ? file.webkitRelativePath.split("/").slice(0, -1).join("/")
          : "",
      );
      const path = joinFolderPath(folderPath, file.name);
      return path === sidecarPath;
    });
    if (!sidecarFile) {
      return undefined;
    }
    return parseThumbSidecar(await sidecarFile.text());
  }

  async saveThumbSeekSeconds(
    _entry: VideoFileEntry,
    _seconds: number,
  ): Promise<void> {
    this.denyWrite();
  }

  async canWrite(): Promise<boolean> {
    return false;
  }

  private denyWrite(): never {
    throw new Error(READONLY_ERROR);
  }

  async deleteVideos(_entries: VideoFileEntry[]): Promise<void> {
    this.denyWrite();
  }

  async renameVideo(_entry: VideoFileEntry, _nextName: string): Promise<void> {
    this.denyWrite();
  }

  async moveVideos(
    _entries: VideoFileEntry[],
    _targetFolderPath: string,
  ): Promise<void> {
    this.denyWrite();
  }

  async createFolder(_folderPath: string): Promise<void> {
    this.denyWrite();
  }

  async renameFolder(_folderPath: string, _nextName: string): Promise<void> {
    this.denyWrite();
  }

  async deleteFolder(_folderPath: string): Promise<void> {
    this.denyWrite();
  }
}

export function createDirectoryAdapter(
  handle: FileSystemDirectoryHandle,
  supplementalFiles: readonly File[] = [],
): VideoStorageAdapter {
  memoryRoot = handle;
  return new DirectoryVideoAdapter(handle, supplementalFiles);
}

export function hasCompleteFolderListing(adapter: VideoStorageAdapter): boolean {
  return (
    adapter instanceof DirectoryVideoAdapter && adapter.supplementalFiles.length > 0
  );
}

/** Re-resolve the saved library handle before scanning so directory listings stay in sync with disk. */
export async function refreshDirectoryAdapterForRescan(
  adapter: VideoStorageAdapter,
): Promise<VideoStorageAdapter> {
  if (adapter.mode !== "directory") {
    return adapter;
  }
  const supplementalFiles =
    adapter instanceof DirectoryVideoAdapter ? adapter.supplementalFiles : [];
  const active = await loadActiveLibrary();
  if (!active) {
    return adapter;
  }
  if (!(await ensureReadPermission(active.handle))) {
    throw new Error("Read permission was not granted");
  }
  return createDirectoryAdapter(active.handle, supplementalFiles);
}

export function createFolderInputAdapter(files: File[]): VideoStorageAdapter {
  const rootName =
    files[0]?.webkitRelativePath?.split("/")[0] ?? "Selected folder";
  return new FolderInputVideoAdapter(files, rootName);
}

export async function restoreDirectoryAdapter(): Promise<VideoStorageAdapter | null> {
  const active = await loadActiveLibrary();
  if (!active) {
    return null;
  }
  return createDirectoryAdapter(active.handle);
}
