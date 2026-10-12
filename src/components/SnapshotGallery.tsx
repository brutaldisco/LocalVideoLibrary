import { GripVertical, Trash2 } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  moveAlbumFileOrder,
  type AlbumItem,
} from "../lib/snapshot-manifest";
import { SLIDESHOW_FLASH_NOTICE_MS } from "../lib/slideshow-timing";
import { IntervalSlider } from "./IntervalSlider";

export interface SnapshotCard {
  item: AlbumItem;
  url: string;
  label: string;
}

const DRAG_THRESHOLD_PX = 6;

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
  onReorder,
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
  onReorder: (fileOrder: string[]) => void;
}) {
  const [dragFile, setDragFile] = useState<string | null>(null);
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);
  const orderRef = useRef<string[] | null>(null);
  const suppressClickRef = useRef(false);

  function beginDrag(event: ReactPointerEvent<HTMLElement>, file: string) {
    if (event.button !== 0 || search.trim() || cards.length < 2) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest(".snapshot-delete")) {
      return;
    }
    const finePointer =
      event.pointerType === "mouse" || event.pointerType === "pen";
    if (!finePointer && !target.closest(".snapshot-grip")) {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const base = cards.map((card) => card.item.file);
    let dragging = false;

    function move(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) {
        return;
      }
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) {
          return;
        }
        dragging = true;
        suppressClickRef.current = true;
        orderRef.current = base;
        setDragFile(file);
        setPreviewOrder(base);
      }
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const over = hit?.closest("[data-snapshot-file]")?.getAttribute("data-snapshot-file");
      if (!over || over === file) {
        return;
      }
      const current = orderRef.current ?? base;
      const next = moveAlbumFileOrder(current, file, over);
      if (next.every((name, index) => name === current[index])) {
        return;
      }
      orderRef.current = next;
      setPreviewOrder(next);
    }

    function end(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) {
        return;
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const next = orderRef.current;
      orderRef.current = null;
      setDragFile(null);
      setPreviewOrder(null);
      if (dragging) {
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      if (!dragging || !next) {
        return;
      }
      if (next.some((name, index) => name !== base[index])) {
        onReorder(next);
      }
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  function moveByKey(file: string, direction: -1 | 1) {
    const files = cards.map((card) => card.item.file);
    const index = files.indexOf(file);
    const target = files[index + direction];
    if (!target) {
      return;
    }
    onReorder(moveAlbumFileOrder(files, file, target));
  }

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
  const ordered = previewOrder
    ? previewOrder.flatMap((file) => {
        const card = cards.find((row) => row.item.file === file);
        return card ? [card] : [];
      })
    : cards;
  const visible = query
    ? ordered.filter((card) => {
        const haystack = `${card.item.file} ${card.item.sourcePath} ${card.label}`.toLowerCase();
        return haystack.includes(query);
      })
    : ordered;
  const flashVisible = showFlashNote && intervalMs < SLIDESHOW_FLASH_NOTICE_MS;
  const canReorder = !query && cards.length > 1;

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
        <div className={dragFile ? "video-grid is-reordering" : "video-grid"}>
          {visible.map((card) => {
            const index = cards.findIndex((row) => row.item.file === card.item.file);
            const dragging = dragFile === card.item.file;
            return (
              <article
                key={card.item.file}
                data-snapshot-file={card.item.file}
                className={
                  dragging ? "video-card snapshot-card is-dragging" : "video-card snapshot-card"
                }
                onPointerDown={(event) => beginDrag(event, card.item.file)}
              >
                <button
                  type="button"
                  className="snapshot-open"
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    onOpenAt(index);
                  }}
                >
                  <img src={card.url} alt="" className="snapshot-thumb" draggable={false} />
                  <span className="snapshot-label">{card.label}</span>
                </button>
                {canReorder ? (
                  <button
                    type="button"
                    className="snapshot-grip"
                    aria-label={`Reorder ${card.label}`}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                        event.preventDefault();
                        moveByKey(card.item.file, -1);
                      } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                        event.preventDefault();
                        moveByKey(card.item.file, 1);
                      }
                    }}
                  >
                    <GripVertical size={14} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="snapshot-delete"
                  aria-label={`Delete snapshot ${card.label}`}
                  onPointerDown={(event) => event.stopPropagation()}
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
