import { MoreVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { VideoFileEntry } from "../lib/types";

export function VideoCardMenu({
  entry,
  onRename,
  onMove,
  onDelete,
}: {
  entry: VideoFileEntry;
  onRename: (entry: VideoFileEntry) => void;
  onMove: (entry: VideoFileEntry) => void;
  onDelete: (entry: VideoFileEntry) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div
      className="video-card-menu-wrap"
      ref={menuRef}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="video-card-menu-trigger"
        aria-label="More options"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        <MoreVertical size={16} />
      </button>
      {open ? (
        <div className="video-card-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="video-card-menu-item"
            onClick={() => {
              onRename(entry);
              setOpen(false);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="video-card-menu-item"
            onClick={() => {
              onMove(entry);
              setOpen(false);
            }}
          >
            Move
          </button>
          <button
            type="button"
            role="menuitem"
            className="video-card-menu-item danger"
            onClick={() => {
              onDelete(entry);
              setOpen(false);
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
