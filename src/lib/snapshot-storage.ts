import { validateEntryName } from "./file-helpers";
import { idbDel, idbGet, idbSet } from "./idb";
import {
  ALBUM_MANIFEST_FILE,
  type AlbumItem,
  type AlbumManifest,
  buildSnapshotFileName,
  emptyAlbumManifest,
  parseAlbumManifest,
  reconcileAlbumManifest,
  serializeAlbumManifest,
} from "./snapshot-manifest";
import { clampIntervalMs } from "./slideshow-timing";

export const SNAPSHOT_ROOT_HANDLE_KEY = "snapshot-root-handle";

export interface SnapshotAlbumSummary {
  name: string;
  path: string;
  count: number;
  intervalMs: number;
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

async function ensureWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const current = await queryPermission(handle, "readwrite");
  if (current === "granted") {
    return true;
  }
  const next = await requestPermission(handle, "readwrite");
  return next === "granted";
}

async function ensureReadPermissionNoPrompt(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const read = await queryPermission(handle, "read");
  if (read === "granted") {
    return;
  }
  const write = await queryPermission(handle, "readwrite");
  if (write === "granted") {
    return;
  }
  throw new Error("Permission is required to read snapshots");
}

export async function loadSnapshotRoot(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await idbGet<FileSystemDirectoryHandle>(SNAPSHOT_ROOT_HANDLE_KEY);
  return handle?.kind === "directory" ? handle : null;
}

export async function saveSnapshotRoot(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await idbSet(SNAPSHOT_ROOT_HANDLE_KEY, handle);
}

export async function clearSnapshotRoot(): Promise<void> {
  await idbDel(SNAPSHOT_ROOT_HANDLE_KEY);
}

export async function ensureSnapshotWrite(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const granted = await ensureWritePermission(handle);
  if (!granted) {
    throw new Error("Permission is required to save snapshots");
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

async function getAlbumDirectory(
  root: FileSystemDirectoryHandle,
  albumName: string,
): Promise<FileSystemDirectoryHandle> {
  try {
    return await root.getDirectoryHandle(albumName);
  } catch {
    throw new Error("Album not found");
  }
}

async function listFileNamesInDirectory(
  dir: FileSystemDirectoryHandle,
): Promise<string[]> {
  const names: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") {
      names.push(name);
    }
  }
  return names;
}

async function readManifestRaw(
  dir: FileSystemDirectoryHandle,
): Promise<AlbumManifest> {
  try {
    const handle = await dir.getFileHandle(ALBUM_MANIFEST_FILE);
    const file = await handle.getFile();
    const text = await file.text();
    return parseAlbumManifest(JSON.parse(text) as unknown);
  } catch {
    return emptyAlbumManifest();
  }
}

async function writeManifest(
  dir: FileSystemDirectoryHandle,
  manifest: AlbumManifest,
): Promise<void> {
  const text = serializeAlbumManifest(manifest);
  const handle = await dir.getFileHandle(ALBUM_MANIFEST_FILE, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error) {
    await writable.close().catch(() => undefined);
    throw error;
  }
}

async function copyFileBetweenDirs(
  sourceDir: FileSystemDirectoryHandle,
  sourceName: string,
  targetDir: FileSystemDirectoryHandle,
  targetName: string,
): Promise<void> {
  const sourceHandle = await sourceDir.getFileHandle(sourceName);
  const file = await sourceHandle.getFile();
  const targetHandle = await targetDir.getFileHandle(targetName, { create: true });
  const writable = await targetHandle.createWritable();
  try {
    await writable.write(file);
    await writable.close();
  } catch (error) {
    await writable.close().catch(() => undefined);
    throw error;
  }
}

export async function listSnapshotAlbums(
  root: FileSystemDirectoryHandle,
): Promise<SnapshotAlbumSummary[]> {
  await ensureReadPermissionNoPrompt(root);
  const summaries: SnapshotAlbumSummary[] = [];
  for await (const [name, handle] of root.entries()) {
    if (handle.kind !== "directory") {
      continue;
    }
    const dir = handle as FileSystemDirectoryHandle;
    const fileNames = await listFileNamesInDirectory(dir);
    const manifest = reconcileAlbumManifest(await readManifestRaw(dir), fileNames);
    summaries.push({
      name,
      path: name,
      count: manifest.items.length,
      intervalMs: manifest.intervalMs,
    });
  }
  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}

export async function readAlbum(
  root: FileSystemDirectoryHandle,
  albumName: string,
): Promise<{ manifest: AlbumManifest; files: Map<string, File> }> {
  await ensureReadPermissionNoPrompt(root);
  const dir = await getAlbumDirectory(root, albumName);
  const fileNames = await listFileNamesInDirectory(dir);
  const manifest = reconcileAlbumManifest(await readManifestRaw(dir), fileNames);
  const files = new Map<string, File>();
  for (const item of manifest.items) {
    try {
      const handle = await dir.getFileHandle(item.file);
      files.set(item.file, await handle.getFile());
    } catch {
      // Missing files are dropped on the next reconcile write.
    }
  }
  return { manifest, files };
}

export async function createSnapshotAlbum(
  root: FileSystemDirectoryHandle,
  name: string,
  intervalMs: number,
): Promise<void> {
  await ensureSnapshotWrite(root);
  const err = validateEntryName(name);
  if (err) {
    throw new Error(err);
  }
  const trimmed = name.trim();
  if (await directoryExists(root, trimmed)) {
    throw new Error("An album with that name already exists");
  }
  const dir = await root.getDirectoryHandle(trimmed, { create: true });
  const manifest: AlbumManifest = {
    version: 1,
    intervalMs: clampIntervalMs(intervalMs),
    items: [],
  };
  await writeManifest(dir, manifest);
}

export async function renameSnapshotAlbum(
  root: FileSystemDirectoryHandle,
  albumName: string,
  nextName: string,
): Promise<void> {
  await ensureSnapshotWrite(root);
  const err = validateEntryName(nextName);
  if (err) {
    throw new Error(err);
  }
  const trimmed = nextName.trim();
  if (trimmed === albumName.trim()) {
    return;
  }
  if (await directoryExists(root, trimmed)) {
    throw new Error("An album with that name already exists");
  }
  const sourceDir = await getAlbumDirectory(root, albumName);
  const targetDir = await root.getDirectoryHandle(trimmed, { create: true });
  for await (const [fileName, handle] of sourceDir.entries()) {
    if (handle.kind !== "file") {
      continue;
    }
    await copyFileBetweenDirs(sourceDir, fileName, targetDir, fileName);
  }
  await root.removeEntry(albumName, { recursive: true });
}

export async function deleteSnapshotAlbum(
  root: FileSystemDirectoryHandle,
  albumName: string,
): Promise<void> {
  await ensureSnapshotWrite(root);
  await root.removeEntry(albumName, { recursive: true });
}

export async function deleteSnapshotImage(
  root: FileSystemDirectoryHandle,
  albumName: string,
  fileName: string,
): Promise<void> {
  await ensureSnapshotWrite(root);
  const dir = await getAlbumDirectory(root, albumName);
  try {
    await dir.removeEntry(fileName);
  } catch {
    // File may already be gone.
  }
  const fileNames = await listFileNamesInDirectory(dir);
  const manifest = reconcileAlbumManifest(await readManifestRaw(dir), fileNames);
  const next: AlbumManifest = {
    ...manifest,
    items: manifest.items.filter((item) => item.file !== fileName),
  };
  await writeManifest(dir, next);
}

export async function writeSnapshotImage(
  root: FileSystemDirectoryHandle,
  albumName: string,
  input: {
    blob: Blob;
    videoBaseName: string;
    timeSeconds: number;
    sourceLibraryId?: string;
    sourceLibraryName?: string;
    sourcePath: string;
    capturedAt: string;
  },
): Promise<AlbumItem> {
  await ensureSnapshotWrite(root);
  const dir = await getAlbumDirectory(root, albumName);
  const fileNames = await listFileNamesInDirectory(dir);
  const existingNames = new Set(fileNames);
  const file = buildSnapshotFileName(
    input.videoBaseName,
    input.timeSeconds,
    existingNames,
  );
  const handle = await dir.getFileHandle(file, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(input.blob);
    await writable.close();
  } catch (error) {
    await writable.close().catch(() => undefined);
    throw error;
  }

  const namesAfter = await listFileNamesInDirectory(dir);
  const manifest = reconcileAlbumManifest(await readManifestRaw(dir), namesAfter);
  const item: AlbumItem = {
    file,
    capturedAt: input.capturedAt,
    sourcePath: input.sourcePath,
    sourceTimeSeconds: Math.max(0, input.timeSeconds),
  };
  if (input.sourceLibraryId) {
    item.sourceLibraryId = input.sourceLibraryId;
  }
  if (input.sourceLibraryName) {
    item.sourceLibraryName = input.sourceLibraryName;
  }
  await writeManifest(dir, {
    ...manifest,
    items: [...manifest.items.filter((row) => row.file !== file), item],
  });
  return item;
}

export async function setAlbumInterval(
  root: FileSystemDirectoryHandle,
  albumName: string,
  intervalMs: number,
): Promise<void> {
  await ensureSnapshotWrite(root);
  const dir = await getAlbumDirectory(root, albumName);
  const fileNames = await listFileNamesInDirectory(dir);
  const manifest = reconcileAlbumManifest(await readManifestRaw(dir), fileNames);
  await writeManifest(dir, {
    ...manifest,
    intervalMs: clampIntervalMs(intervalMs),
  });
}
