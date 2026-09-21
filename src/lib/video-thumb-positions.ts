import { idbGet, idbSet } from "./idb";

const THUMB_POSITIONS_KEY = "video-thumb-positions";

type ThumbPositionMap = Record<string, number>;

async function readMap(): Promise<ThumbPositionMap> {
  return (await idbGet<ThumbPositionMap>(THUMB_POSITIONS_KEY)) ?? {};
}

async function writeMap(map: ThumbPositionMap): Promise<void> {
  await idbSet(THUMB_POSITIONS_KEY, map);
}

export async function loadThumbPositions(): Promise<Map<string, number>> {
  const raw = await readMap();
  return new Map(Object.entries(raw));
}

export async function saveThumbPosition(
  videoId: string,
  seconds: number,
): Promise<void> {
  const map = await readMap();
  map[videoId] = seconds;
  await writeMap(map);
}

export async function removeThumbPositions(videoIds: string[]): Promise<void> {
  if (videoIds.length === 0) {
    return;
  }
  const map = await readMap();
  for (const id of videoIds) {
    delete map[id];
  }
  await writeMap(map);
}

export async function migrateThumbPosition(
  oldId: string,
  newId: string,
): Promise<void> {
  if (oldId === newId) {
    return;
  }
  const map = await readMap();
  if (map[oldId] == null) {
    return;
  }
  map[newId] = map[oldId];
  delete map[oldId];
  await writeMap(map);
}

export async function migrateThumbPositionPrefix(
  oldPrefix: string,
  newPrefix: string,
): Promise<void> {
  if (oldPrefix === newPrefix) {
    return;
  }
  const map = await readMap();
  const next: ThumbPositionMap = {};
  for (const [id, seconds] of Object.entries(map)) {
    if (id === oldPrefix || id.startsWith(`${oldPrefix}/`)) {
      const suffix = id === oldPrefix ? "" : id.slice(oldPrefix.length);
      next[`${newPrefix}${suffix}`] = seconds;
      continue;
    }
    next[id] = seconds;
  }
  await writeMap(next);
}

export async function removeThumbPositionsUnderPrefix(
  prefix: string,
): Promise<void> {
  const map = await readMap();
  for (const id of Object.keys(map)) {
    if (id === prefix || id.startsWith(`${prefix}/`)) {
      delete map[id];
    }
  }
  await writeMap(map);
}
