export type SourceMode = "directory" | "folder-input";
export type SortKey = "name" | "folder" | "modified" | "size" | "duration";
export type SortDirection = "asc" | "desc";
export type ViewMode = "grid" | "list";
export type RepeatMode = "off" | "one" | "folder";

export interface VideoFileEntry {
  id: string;
  name: string;
  path: string;
  folderPath: string;
  size: number;
  lastModified?: number;
  sourceMode: SourceMode;
  file?: File;
  handle?: FileSystemFileHandle;
}

export interface FolderEntry {
  path: string;
  name: string;
  count: number;
  totalSize: number;
}

export interface VideoMeta {
  duration?: number;
  thumbUrl?: string;
  failed?: boolean;
  customThumb?: boolean;
  thumbSeekSeconds?: number;
}

export interface ScanProgress {
  videos: number;
  folders: number;
  skipped: number;
}

export interface ScanResult {
  videos: VideoFileEntry[];
  folders: string[];
  skipped: number;
  errors: string[];
}

export interface VideoStorageAdapter {
  readonly mode: SourceMode;
  readonly writable: boolean;
  readonly rootName: string;
  scan(onProgress?: (progress: ScanProgress) => void): Promise<ScanResult>;
  createObjectUrl(entry: VideoFileEntry): Promise<string>;
  canWrite(): Promise<boolean>;
  deleteVideos(entries: VideoFileEntry[]): Promise<void>;
  renameVideo(entry: VideoFileEntry, nextName: string): Promise<void>;
  moveVideos(
    entries: VideoFileEntry[],
    targetFolderPath: string,
  ): Promise<void>;
  createFolder(folderPath: string): Promise<void>;
  renameFolder(folderPath: string, nextName: string): Promise<void>;
  deleteFolder(folderPath: string): Promise<void>;
}
