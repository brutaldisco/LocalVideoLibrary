# lvl

**lvl** (Local Video Library) is a local-first Progressive Web App for browsing, playing, and organizing video folders on your device. Videos stay on disk; the app uses temporary object URLs for playback and thumbnails.

## Features

- File System Access API folder selection with IndexedDB handle persistence (Chrome/Edge)
- Read-only folder input fallback for Safari/Firefox
- Recursive scan for `.mp4`, `.m4v`, `.mov`, `.webm`, `.ogv`, `.ogg`
- Grid/list browsing with search, folder filter, and sorting
- Lazy thumbnails and duration metadata
- Fullscreen-style player with keyboard shortcuts and folder repeat
- Rename, move, delete, and nested folder management (writable mode only)
- Offline app shell via service worker (video files are never cached)

## Development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173` in a Chromium browser for full read/write support.

## Scripts

- `pnpm dev` — start Vite dev server
- `pnpm build` — typecheck and build production assets
- `pnpm preview` — preview the production build
- `pnpm test` — run unit tests
- `pnpm typecheck` — TypeScript check only

## Browser notes

- **Chrome / Edge**: full folder persistence and file management
- **Safari / Firefox**: browse-only via folder input; management actions are disabled
- **PWA install**: requires HTTPS or localhost

## Safety

Destructive actions always require confirmation. The app does not upload videos, cache video blobs in Cache Storage, or store thumbnails in IndexedDB.
