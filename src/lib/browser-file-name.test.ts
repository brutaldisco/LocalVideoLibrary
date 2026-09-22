import { describe, expect, it } from "vitest";
import {
  browserEntryHint,
  browserFileNameBlockReason,
  toBrowserSafeFileName,
} from "./browser-file-name";
import { supplementDirectoryListing } from "./scan-folder-files";
import type { ScanResult } from "./types";

const hiddenByChrome = [
  "Cristobal Pesce - Skatepark (Techno:Psytrance) DJ Set 4K.MP4",
  "Felinae - Nuclear (Psytrance:Hardtechno) Full energy Dj set.MP4",
  "KEN ISHII - stage Solo Vinilo : Circus Nation 2024 (Granada).MP4",
  "Schranz Set | BELPHE\u0308 - Cord Room x SBX.MP4",
  "¥ØU$UK€ ¥UK1MAT$U | Boiler Room Tokyo - Video.MP4",
];

const visibleToChrome = [
  "Avicii - Without You (Lyrics Video) .MP4",
  "Batsu live at FUTURE WHAT'S II, Sep 13, 2019 (Full DJ set) .MP4",
  "Brian Eno - Thursday Afternoon.MP4",
  "Don Diablo & Mearsy - Physique (feat. RBZ) [Extended Mix].MP4",
  "Klangkuenstler @ Outworld Secret Rave, Berlin (live set).MP4",
  "MAT ZO filter house set in The Lab LA.MP4",
  "Peggy Gou[AOMIX] EP.17 Streaming at the Han River, Seoul by Peggy Gou.MP4",
  "Speech Therapy-5.m4v",
  "sabi#japanesegarden.MP4",
  "【90s-00s】BEST TRANCE MIX by DJ tomoya.MP4",
  "ソ\u3099ーンに入るBGM アンヒ\u3099エント528HZの勉強に集中て\u3099きる音楽タイマー.MP4",
];

function listedFile(root: string, relative: string): File {
  const name = relative.split("/").pop() ?? relative;
  return {
    name,
    size: relative.length,
    lastModified: 10,
    webkitRelativePath: `${root}/${relative}`,
  } as File;
}

describe("browserFileNameBlockReason", () => {
  it("matches the names Chrome omits from a saved folder listing", () => {
    for (const name of hiddenByChrome) {
      expect(browserFileNameBlockReason(name), name).not.toBeNull();
    }
    for (const name of visibleToChrome) {
      expect(browserFileNameBlockReason(name), name).toBeNull();
    }
  });

  it("allows a single leading dot and fullwidth replacements", () => {
    expect(browserFileNameBlockReason(".hidden.mp4")).toBeNull();
    expect(browserFileNameBlockReason("Techno\uff1aPsytrance.mp4")).toBeNull();
    expect(browserFileNameBlockReason("Set \uff5c live.mp4")).toBeNull();
  });

  it("rejects Windows reserved names, trailing whitespace, and control characters", () => {
    expect(browserFileNameBlockReason("CON.mp4")).toMatch(/reserved/i);
    expect(browserFileNameBlockReason("COM10.mp4")).toBeNull();
    expect(browserFileNameBlockReason("clip.mp4 ")).toMatch(/whitespace/i);
    expect(browserFileNameBlockReason("a\u200bb.mp4")).toMatch(/control|hidden/i);
  });
});

describe("toBrowserSafeFileName", () => {
  it("replaces colon and pipe with fullwidth characters Chrome can list", () => {
    for (const name of hiddenByChrome) {
      const safe = toBrowserSafeFileName(name);
      expect(safe).not.toBe(name);
      expect(browserFileNameBlockReason(safe)).toBeNull();
      expect(toBrowserSafeFileName(safe)).toBe(safe);
    }
    expect(toBrowserSafeFileName(hiddenByChrome[0] ?? "")).toContain("\uff1a");
    expect(toBrowserSafeFileName(hiddenByChrome[3] ?? "")).toContain("\uff5c");
  });

  it("leaves visible names unchanged", () => {
    for (const name of visibleToChrome) {
      expect(toBrowserSafeFileName(name)).toBe(name);
    }
  });

  it("prefixes reserved Windows names", () => {
    const safe = toBrowserSafeFileName("CON.mp4");
    expect(safe).toBe("_CON.mp4");
    expect(browserFileNameBlockReason(safe)).toBeNull();
  });
});

describe("supplementDirectoryListing", () => {
  const rootName = "Music";
  const base: ScanResult = {
    videos: [
      {
        id: "Brian Eno - Thursday Afternoon.MP4",
        name: "Brian Eno - Thursday Afternoon.MP4",
        path: "Brian Eno - Thursday Afternoon.MP4",
        folderPath: "",
        size: 4,
        sourceMode: "directory",
      },
    ],
    folders: [""],
    skipped: 1,
    errors: [],
  };

  it("adds videos whose names the directory handle cannot list", () => {
    const merged = supplementDirectoryListing(
      base,
      [
        listedFile(rootName, "Brian Eno - Thursday Afternoon.MP4"),
        listedFile(rootName, hiddenByChrome[0] ?? "a:b.mp4"),
        listedFile(rootName, "bad:dir/clip.mp4"),
        listedFile(rootName, "notes.txt"),
        listedFile(rootName, "only-in-the-snapshot.mp4"),
      ],
      rootName,
    );

    expect(merged.videos.map((video) => video.path)).toEqual([
      "Brian Eno - Thursday Afternoon.MP4",
      hiddenByChrome[0],
      "bad:dir/clip.mp4",
    ]);
    expect(merged.folders).toContain("bad:dir");
    expect(merged.videos[1]?.file).toBeDefined();
    expect(browserEntryHint(merged.videos[1] ?? { name: "", folderPath: "" })).toMatch(
      /Chrome cannot modify/,
    );
  });

  it("ignores a listing from a different folder", () => {
    const merged = supplementDirectoryListing(
      base,
      [listedFile("Other", hiddenByChrome[0] ?? "a:b.mp4")],
      rootName,
    );
    expect(merged.videos).toHaveLength(1);
  });
});
