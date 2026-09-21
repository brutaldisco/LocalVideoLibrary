import { idbDel, idbGet, idbSet, ROOT_HANDLE_KEY } from "./idb";

const LIBRARIES_KEY = "library-roots";
const ACTIVE_LIBRARY_KEY = "active-library-root";

export interface SavedLibrary {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
}

export function placeLibraryFirst(
  libraries: SavedLibrary[],
  saved: SavedLibrary,
): SavedLibrary[] {
  return [saved, ...libraries.filter((item) => item.id !== saved.id)];
}

function isSavedLibrary(value: unknown): value is SavedLibrary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as SavedLibrary;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    item.handle?.kind === "directory"
  );
}

async function writeLibraries(libraries: SavedLibrary[]): Promise<void> {
  await idbSet(LIBRARIES_KEY, libraries);
}

async function writeActive(library: SavedLibrary | null): Promise<void> {
  if (!library) {
    await idbDel(ACTIVE_LIBRARY_KEY);
    await idbDel(ROOT_HANDLE_KEY);
    return;
  }
  await idbSet(ACTIVE_LIBRARY_KEY, library.id);
  await idbSet(ROOT_HANDLE_KEY, library.handle);
}

async function handlesMatch(
  left: FileSystemDirectoryHandle,
  right: FileSystemDirectoryHandle,
): Promise<boolean> {
  if (!left.isSameEntry) {
    return false;
  }
  try {
    return await left.isSameEntry(right);
  } catch {
    return false;
  }
}

export async function loadSavedLibraries(): Promise<SavedLibrary[]> {
  const stored = await idbGet<unknown>(LIBRARIES_KEY);
  const libraries = Array.isArray(stored) ? stored.filter(isSavedLibrary) : [];
  if (libraries.length > 0) {
    return libraries;
  }

  const legacy = await idbGet<FileSystemDirectoryHandle>(ROOT_HANDLE_KEY);
  if (legacy?.kind !== "directory") {
    return [];
  }

  const migrated: SavedLibrary = {
    id: crypto.randomUUID(),
    name: legacy.name,
    handle: legacy,
  };
  await writeLibraries([migrated]);
  await writeActive(migrated);
  return [migrated];
}

export async function getActiveLibraryId(): Promise<string | null> {
  const id = await idbGet<string>(ACTIVE_LIBRARY_KEY);
  return typeof id === "string" ? id : null;
}

export async function loadActiveLibrary(): Promise<SavedLibrary | null> {
  const libraries = await loadSavedLibraries();
  const activeId = await getActiveLibraryId();
  return (
    libraries.find((item) => item.id === activeId) ?? libraries[0] ?? null
  );
}

export async function rememberLibrary(
  handle: FileSystemDirectoryHandle,
): Promise<SavedLibrary> {
  const libraries = await loadSavedLibraries();
  let existing: SavedLibrary | undefined;
  for (const library of libraries) {
    if (await handlesMatch(library.handle, handle)) {
      existing = library;
      break;
    }
  }
  const saved: SavedLibrary = existing
    ? { ...existing, name: handle.name, handle }
    : { id: crypto.randomUUID(), name: handle.name, handle };
  const next = placeLibraryFirst(libraries, saved);
  await writeLibraries(next);
  await writeActive(saved);
  return saved;
}

export async function activateLibrary(id: string): Promise<SavedLibrary | null> {
  const libraries = await loadSavedLibraries();
  const found = libraries.find((item) => item.id === id) ?? null;
  if (!found) {
    return null;
  }
  await writeActive(found);
  return found;
}

export async function removeSavedLibrary(id: string): Promise<{
  libraries: SavedLibrary[];
  active: SavedLibrary | null;
}> {
  const current = await loadSavedLibraries();
  const libraries = current.filter((item) => item.id !== id);
  const activeId = await getActiveLibraryId();
  const active =
    (activeId && activeId !== id
      ? libraries.find((item) => item.id === activeId)
      : undefined) ??
    libraries[0] ??
    null;
  await writeLibraries(libraries);
  await writeActive(active);
  return { libraries, active };
}
