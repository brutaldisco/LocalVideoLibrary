export interface SnapshotToastBurst {
  album: string;
  count: number;
  at: number;
  message: string;
}

export function nextSnapshotToast(
  previous: Pick<SnapshotToastBurst, "album" | "count" | "at"> | null,
  album: string,
  now: number,
  windowMs = 2000,
): SnapshotToastBurst {
  const continueBurst =
    previous != null &&
    previous.album === album &&
    now - previous.at <= windowMs &&
    now >= previous.at;
  const count = continueBurst ? previous.count + 1 : 1;
  const message = count > 1 ? `Saved ${count} to ${album}` : `Saved to ${album}`;
  return { album, count, at: now, message };
}
