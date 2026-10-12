import { Trash2 } from "lucide-react";
import type { AlbumItem } from "../lib/snapshot-manifest";
import { SLIDESHOW_FLASH_NOTICE_MS } from "../lib/slideshow-timing";
import { IntervalSlider } from "./IntervalSlider";

export interface SnapshotCard {
  item: AlbumItem;
  url: string;
  label: string;
}

export function SnapshotGallery({
  hasRoot,
  needsPermission,
  canPickFolder,
  albumName,
  cards,
  loading,
  intervalMs,
  search,
  showFlashNote,
  onSearch,
  onChooseFolder,
  onAllowAccess,
  onCreateAlbum,
  onIntervalChange,
  onDismissFlashNote,
  onPlay,
  onOpenAt,
  onDelete,
}: {
  hasRoot: boolean;
  needsPermission: boolean;
  canPickFolder: boolean;
  albumName: string | null;
  cards: SnapshotCard[];
  loading: boolean;
  intervalMs: number;
  search: string;
  showFlashNote: boolean;
  onSearch: (value: string) => void;
  onChooseFolder: () => void;
  onAllowAccess: () => void;
  onCreateAlbum: () => void;
  onIntervalChange: (intervalMs: number) => void;
  onDismissFlashNote: () => void;
  onPlay: () => void;
  onOpenAt: (index: number) => void;
  onDelete: (item: AlbumItem) => void;
}) {
  if (!canPickFolder) {
    return (
      <div className="empty-state">
        <h2>Snapshots need Chrome or Edge</h2>
        <p>Taking snapshots and saving albums uses folder access in those browsers.</p>
      </div>
    );
  }

  if (!hasRoot) {
    return (
      <div className="empty-state">
        <h2>Choose a folder for snapshots</h2>
        <p>
          Choose a folder on this device. Albums you create are real folders, and
          snapshots are image files inside them.
        </p>
        <button type="button" className="btn primary" onClick={onChooseFolder}>
          Choose folder
        </button>
      </div>
    );
  }

  if (needsPermission) {
    return (
      <div className="empty-state">
        <h2>Allow snapshot access</h2>
        <p>This browser needs permission again before albums can be read or updated.</p>
        <button type="button" className="btn primary" onClick={onAllowAccess}>
          Allow access
        </button>
      </div>
    );
  }

  if (!albumName) {
    return (
      <div className="empty-state">
        <h2>No album selected</h2>
        <p>Create an album, then take snapshots from the video player menu.</p>
        <button type="button" className="btn primary" onClick={onCreateAlbum}>
          Create album
        </button>
      </div>
    );
  }

  const query = search.trim().toLowerCase();
  const visible = query
    ? cards.filter((card) => {
        const haystack = `${card.item.file} ${card.item.sourcePath} ${card.label}`.toLowerCase();
        return haystack.includes(query);
      })
    : cards;
  const flashVisible = showFlashNote && intervalMs < SLIDESHOW_FLASH_NOTICE_MS;

  return (
    <>
      <header className="toolbar">
        <input
          type="search"
          className="search-input"
          placeholder="Search snapshots"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
        <div className="toolbar-group">
          <IntervalSlider value={intervalMs} onChange={onIntervalChange} />
          <button
            type="button"
            className="btn primary"
            disabled={cards.length === 0 || loading}
            onClick={onPlay}
          >
            Play
          </button>
        </div>
      </header>
      {flashVisible ? (
        <p className="flash-note flash-note-inline">
          Fast changes fill the screen. Pause if this feels uncomfortable.
          <button type="button" onClick={onDismissFlashNote}>
            Dismiss
          </button>
        </p>
      ) : null}
      {loading ? (
        <div className="empty-state">
          <h2>Loading snapshots…</h2>
        </div>
      ) : cards.length === 0 ? (
        <div className="empty-state">
          <h2>Nothing here yet</h2>
          <p>Play a video and choose Take snapshot.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <h2>No matching snapshots</h2>
          <p>Try a different search.</p>
        </div>
      ) : (
        <div className="video-grid">
          {visible.map((card) => {
            const index = cards.findIndex((row) => row.item.file === card.item.file);
            return (
              <article key={card.item.file} className="video-card snapshot-card">
                <button
                  type="button"
                  className="snapshot-open"
                  onClick={() => onOpenAt(index)}
                >
                  <img src={card.url} alt="" className="snapshot-thumb" />
                  <span className="snapshot-label">{card.label}</span>
                </button>
                <button
                  type="button"
                  className="snapshot-delete"
                  aria-label={`Delete snapshot ${card.label}`}
                  onClick={() => onDelete(card.item)}
                >
                  <Trash2 size={14} />
                </button>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
