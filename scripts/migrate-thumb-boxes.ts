import { open, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rename } from "node:fs/promises";
import os from "node:os";
import {
  createMinimalBmff,
  embedThumbSeek,
  readThumbSeek,
  THUMB_BOX_SIZE,
} from "../src/lib/video-thumb-box";
import {
  parseThumbSidecar,
  THUMB_SIDECAR_SUFFIX,
} from "../src/lib/video-thumb-sidecar";

type FileHandle = Awaited<ReturnType<typeof open>>;

async function readAt(
  handle: FileHandle,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, offset);
  return new Uint8Array(buffer.subarray(0, bytesRead));
}

async function embedFile(videoPath: string, seconds: number): Promise<void> {
  const handle = await open(videoPath, "r+");
  try {
    const before = await handle.stat();
    const headLength = Math.min(65536, before.size);
    const head = Buffer.alloc(headLength);
    await handle.read(head, 0, headLength, 0);
    const last = Buffer.alloc(1);
    if (before.size > 0) {
      await handle.read(last, 0, 1, before.size - 1);
    }

    await embedThumbSeek(
      before.size,
      (offset, length) => readAt(handle, offset, length),
      async (offset, data) => {
        const buffer = Buffer.from(data);
        const { bytesWritten } = await handle.write(buffer, 0, buffer.length, offset);
        if (bytesWritten !== buffer.length) {
          throw new Error("Short write while storing thumbnail metadata");
        }
      },
      seconds,
      { truncate: (size) => handle.truncate(size) },
    );

    const after = await handle.stat();
    const headAfter = Buffer.alloc(headLength);
    await handle.read(headAfter, 0, headLength, 0);
    const lastAfter = Buffer.alloc(1);
    if (before.size > 0) {
      await handle.read(lastAfter, 0, 1, before.size - 1);
    }
    const prefixIntact = head.equals(headAfter) && last.equals(lastAfter);
    const grewByBox = after.size === before.size + THUMB_BOX_SIZE;
    if (!prefixIntact || !grewByBox) {
      await handle.truncate(before.size);
      throw new Error("Thumbnail write changed the original video bytes");
    }

    const stored = await readThumbSeek(after.size, (offset, length) =>
      readAt(handle, offset, length),
    );
    if (stored !== seconds) {
      await handle.truncate(before.size);
      throw new Error("Thumbnail metadata read-back did not match");
    }
  } finally {
    await handle.close();
  }
}

async function collectSidecars(dir: string, found: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSidecars(fullPath, found);
      continue;
    }
    if (entry.name.endsWith(THUMB_SIDECAR_SUFFIX)) {
      found.push(fullPath);
    }
  }
}

async function migrateSidecar(jsonPath: string): Promise<"migrated" | "skipped"> {
  const videoPath = jsonPath.slice(0, -THUMB_SIDECAR_SUFFIX.length);
  try {
    const info = await stat(videoPath);
    if (!info.isFile()) {
      throw new Error("Video path is not a file");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Video is missing for ${path.basename(jsonPath)}`);
    }
    throw error;
  }

  const seconds = parseThumbSidecar(await readFile(jsonPath, "utf8"));
  if (seconds == null) {
    return "skipped";
  }
  await embedFile(videoPath, seconds);
  await rm(jsonPath);
  return "migrated";
}

async function rehearseRename(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lvl-thumb-rehearsal-"));
  try {
    const folder = path.join(root, "pikpak");
    await mkdir(folder);
    const videoPath = path.join(folder, "clip.mp4");
    const jsonPath = `${videoPath}${THUMB_SIDECAR_SUFFIX}`;
    await writeFile(videoPath, createMinimalBmff());
    await writeFile(
      jsonPath,
      `${JSON.stringify({ version: 1, thumbSeekSeconds: 15.5 }, null, 2)}\n`,
    );
    if ((await migrateSidecar(jsonPath)) !== "migrated") {
      throw new Error("Rehearsal did not migrate the sample sidecar");
    }

    const renamedVideo = path.join(folder, "scene.mp4");
    await rename(videoPath, renamedVideo);
    const renamedFolder = path.join(root, "pikpak-renamed");
    await rename(folder, renamedFolder);
    const finalVideo = path.join(renamedFolder, "scene.mp4");
    const handle = await open(finalVideo, "r");
    try {
      const info = await handle.stat();
      const seconds = await readThumbSeek(info.size, (offset, length) =>
        readAt(handle, offset, length),
      );
      if (seconds !== 15.5) {
        throw new Error("Rehearsal lost the seek position after rename");
      }
    } finally {
      await handle.close();
    }
    await stat(`${finalVideo}${THUMB_SIDECAR_SUFFIX}`).then(
      () => {
        throw new Error("Rehearsal left a sidecar behind");
      },
      () => undefined,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function migrateFolder(folder: string): Promise<void> {
  const sidecars: string[] = [];
  await collectSidecars(folder, sidecars);
  let migrated = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const jsonPath of sidecars) {
    try {
      const result = await migrateSidecar(jsonPath);
      if (result === "migrated") {
        migrated += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failures.push(
        `${jsonPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const remaining: string[] = [];
  await collectSidecars(folder, remaining);
  console.log(
    `${folder}: migrated ${migrated}, skipped ${skipped}, failed ${failures.length}, remaining ${remaining.length}`,
  );
  for (const failure of failures) {
    console.error(failure);
  }
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

const folders = process.argv.slice(2);
if (folders.length === 0) {
  console.error("Usage: migrate-thumb-boxes.ts <folder>...");
  process.exit(1);
}

await rehearseRename();
console.log("Rehearsal passed (video rename and parent folder rename).");
for (const folder of folders) {
  await migrateFolder(folder);
}
