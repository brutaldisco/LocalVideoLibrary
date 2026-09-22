import { isBrowserHiddenPath } from "./browser-file-name";
import { isVideoFileName, joinFolderPath, normalizeFolderPath } from "./file-helpers";
import type { ScanResult } from "./types";

export function folderInputRootName(files: readonly File[]): string {
  const relative = files.find((file) => file.webkitRelativePath)?.webkitRelativePath;
  if (!relative) {
    return "";
  }
  return relative.split("/")[0] ?? "";
}

export function relativePathFromFolderInput(
  file: File,
  rootName: string,
): string | null {
  const relative = file.webkitRelativePath;
  if (!relative || !rootName) {
    return null;
  }
  const parts = relative.split("/").filter(Boolean);
  if (parts[0] !== rootName) {
    return null;
  }
  parts.shift();
  if (parts.length === 0) {
    return null;
  }
  return parts.join("/");
}

function folderChain(folderPath: string): string[] {
  const folders: string[] = [];
  let current = "";
  for (const part of folderPath.split("/")) {
    if (!part) {
      continue;
    }
    current = current ? `${current}/${part}` : part;
    folders.push(current);
  }
  return folders;
}

/**
 * Adds videos that a `<input webkitdirectory>` listing can see but
 * FileSystemDirectoryHandle.entries() drops. Safe names stay on the live
 * directory scan so a stale file snapshot cannot resurrect deleted files.
 */
export function supplementDirectoryListing(
  result: ScanResult,
  files: readonly File[],
  rootName: string,
): ScanResult {
  if (files.length === 0 || !rootName || folderInputRootName(files) !== rootName) {
    return result;
  }

  const seen = new Set(result.videos.map((video) => video.path));
  const folders = new Set(result.folders);
  const videos = [...result.videos];

  for (const file of files) {
    const relative = relativePathFromFolderInput(file, rootName);
    if (!relative || !isBrowserHiddenPath(relative) || !isVideoFileName(file.name)) {
      continue;
    }
    const parts = relative.split("/");
    const name = parts[parts.length - 1] ?? file.name;
    const folderPath = normalizeFolderPath(parts.slice(0, -1).join("/"));
    const path = joinFolderPath(folderPath, name);
    if (seen.has(path)) {
      continue;
    }
    folders.add("");
    for (const folder of folderChain(folderPath)) {
      folders.add(folder);
    }
    videos.push({
      id: path,
      name,
      path,
      folderPath,
      size: file.size,
      lastModified: file.lastModified,
      sourceMode: "directory",
      file,
    });
    seen.add(path);
  }

  return {
    ...result,
    videos,
    folders: [...folders],
  };
}
