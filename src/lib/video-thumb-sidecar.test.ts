import { describe, expect, it } from "vitest";
import {
  isThumbSidecarFileName,
  parseThumbSidecar,
  serializeThumbSidecar,
  thumbSidecarName,
} from "./video-thumb-sidecar";

describe("thumbSidecarName", () => {
  it("appends the lvl sidecar suffix to the video filename", () => {
    expect(thumbSidecarName("clip.mp4")).toBe("clip.mp4.lvl.json");
  });
});

describe("isThumbSidecarFileName", () => {
  it("detects sidecar files", () => {
    expect(isThumbSidecarFileName("clip.mp4.lvl.json")).toBe(true);
    expect(isThumbSidecarFileName("clip.mp4")).toBe(false);
  });
});

describe("parseThumbSidecar", () => {
  it("reads a valid seek position", () => {
    expect(
      parseThumbSidecar(
        JSON.stringify({ version: 1, thumbSeekSeconds: 42.5 }),
      ),
    ).toBe(42.5);
  });

  it("ignores invalid payloads", () => {
    expect(parseThumbSidecar("{")).toBeUndefined();
    expect(parseThumbSidecar('{"thumbSeekSeconds": -1}')).toBeUndefined();
  });
});

describe("serializeThumbSidecar", () => {
  it("writes versioned JSON", () => {
    const text = serializeThumbSidecar(12.25);
    expect(JSON.parse(text)).toEqual({
      version: 1,
      thumbSeekSeconds: 12.25,
    });
  });
});
