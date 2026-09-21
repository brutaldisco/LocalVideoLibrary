import { describe, expect, it } from "vitest";
import { placeLibraryFirst, type SavedLibrary } from "./library-roots";

function library(id: string): SavedLibrary {
  return {
    id,
    name: id,
    handle: { kind: "directory", name: id } as FileSystemDirectoryHandle,
  };
}

describe("placeLibraryFirst", () => {
  it("moves an existing library to the front", () => {
    const libraries = [library("a"), library("b"), library("c")];
    expect(placeLibraryFirst(libraries, library("b")).map((item) => item.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("inserts a new library at the front", () => {
    expect(placeLibraryFirst([library("a")], library("b")).map((item) => item.id)).toEqual([
      "b",
      "a",
    ]);
  });
});
