import type { RepeatMode } from "./types";

/** プレーヤー右下に出す繰り返し。どちらも押していなければくり返さない */
export const REPEAT_TOGGLE_MODES: {
  id: Exclude<RepeatMode, "off">;
  label: string;
}[] = [
  { id: "one", label: "Repeat this video" },
  { id: "folder", label: "Play folder in order" },
];

export function toggleRepeatMode(
  current: RepeatMode,
  next: Exclude<RepeatMode, "off">,
): RepeatMode {
  return current === next ? "off" : next;
}

export function parseRepeatMode(raw: string | null | undefined): RepeatMode {
  return raw === "one" || raw === "folder" || raw === "off" ? raw : "folder";
}

export function folderPlaylist<T extends { id: string; folderPath: string }>(
  library: T[],
  item: T,
): T[] {
  const folderPath = item.folderPath;
  return library.filter((row) => row.folderPath === folderPath);
}

export function playlistIndex<T extends { id: string }>(
  list: T[],
  currentId: string,
): number {
  return list.findIndex((row) => row.id === currentId);
}

export function stepPlaylist<T extends { id: string }>(
  list: T[],
  currentId: string,
  delta: number,
): T | null {
  if (list.length === 0) {
    return null;
  }
  const index = playlistIndex(list, currentId);
  const from = index < 0 ? 0 : index;
  const next = (from + delta + list.length * 8) % list.length;
  return list[next] ?? null;
}
