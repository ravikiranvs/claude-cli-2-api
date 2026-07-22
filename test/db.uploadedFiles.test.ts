import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { createUploadedFile, deleteUploadedFile, getUploadedFile, listUploadedFiles } from "../src/db/uploadedFiles.js";

describe("uploadedFiles", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates and retrieves an uploaded file by id", () => {
    const created = createUploadedFile(db, {
      id: "file-abc123",
      filename: "notes.txt",
      contentType: "text/plain",
      byteSize: 42,
      storagePath: "/data/uploads/file-abc123",
    });

    expect(created).toMatchObject({
      id: "file-abc123",
      filename: "notes.txt",
      contentType: "text/plain",
      byteSize: 42,
      storagePath: "/data/uploads/file-abc123",
    });
    expect(created.createdAt).toBeTypeOf("string");

    const fetched = getUploadedFile(db, "file-abc123");
    expect(fetched).toEqual(created);
  });

  it("returns undefined for an id that doesn't exist", () => {
    expect(getUploadedFile(db, "file-does-not-exist")).toBeUndefined();
  });

  it("lists uploaded files newest first", () => {
    createUploadedFile(db, {
      id: "file-1",
      filename: "a.txt",
      contentType: "text/plain",
      byteSize: 1,
      storagePath: "/data/uploads/file-1",
    });
    createUploadedFile(db, {
      id: "file-2",
      filename: "b.txt",
      contentType: "text/plain",
      byteSize: 2,
      storagePath: "/data/uploads/file-2",
    });

    const files = listUploadedFiles(db);
    expect(files.map((file) => file.id)).toEqual(["file-2", "file-1"]);
  });

  it("breaks created_at ties by insertion order, not by lexicographic comparison of the random id", () => {
    createUploadedFile(db, {
      id: "file-zzz",
      filename: "first-uploaded.txt",
      contentType: "text/plain",
      byteSize: 1,
      storagePath: "/data/uploads/file-zzz",
    });
    createUploadedFile(db, {
      id: "file-aaa",
      filename: "second-uploaded.txt",
      contentType: "text/plain",
      byteSize: 1,
      storagePath: "/data/uploads/file-aaa",
    });

    const files = listUploadedFiles(db);
    expect(files.map((file) => file.filename)).toEqual(["second-uploaded.txt", "first-uploaded.txt"]);
  });

  it("deletes an uploaded file by id and reports whether it existed", () => {
    createUploadedFile(db, {
      id: "file-1",
      filename: "a.txt",
      contentType: "text/plain",
      byteSize: 1,
      storagePath: "/data/uploads/file-1",
    });

    expect(deleteUploadedFile(db, "file-1")).toBe(true);
    expect(getUploadedFile(db, "file-1")).toBeUndefined();
    expect(deleteUploadedFile(db, "file-1")).toBe(false);
  });
});
