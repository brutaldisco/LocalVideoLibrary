import { MoreVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function FolderRowMenu({
  onRename,
  onDelete,
}: {
  onRename: () => void;
  onDelete: () => void;
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
      className={`folder-row-menu-wrap ${open ? "is-open" : ""}`}
      ref={menuRef}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="folder-row-menu-trigger"
        aria-label="Folder options"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        <MoreVertical size={14} />
      </button>
      {open ? (
        <div className="folder-row-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="folder-row-menu-item"
            onClick={() => {
              onRename();
              setOpen(false);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="folder-row-menu-item danger"
            onClick={() => {
              onDelete();
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
