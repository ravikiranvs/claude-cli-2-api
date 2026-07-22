import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUploadedFile } from "../src/db/uploadedFiles.js";
import { openDatabase } from "../src/db/connection.js";
import { createFileResolver, validateFileReferences } from "../src/gateway/chatFiles.js";

describe("validateFileReferences / createFileResolver", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("returns null when no messages reference a file", () => {
    expect(validateFileReferences([{ role: "user", content: "hi" }], db)).toBeNull();
  });

  it("returns null when every referenced file id exists", () => {
    createUploadedFile(db, {
      id: "file-abc123",
      filename: "notes.txt",
      contentType: "text/plain",
      byteSize: 5,
      storagePath: "/data/uploads/file-abc123",
    });

    const error = validateFileReferences(
      [{ role: "user", content: [{ type: "file", file_id: "file-abc123" }] }],
      db,
    );
    expect(error).toBeNull();
  });

  it("rejects a reference to a file id that doesn't exist", () => {
    const error = validateFileReferences(
      [{ role: "user", content: [{ type: "file", file_id: "file-does-not-exist" }] }],
      db,
    );
    expect(error).toContain("file-does-not-exist");
  });

  it("createFileResolver resolves an existing file's storage path", () => {
    createUploadedFile(db, {
      id: "file-abc123",
      filename: "notes.txt",
      contentType: "text/plain",
      byteSize: 5,
      storagePath: "/data/uploads/file-abc123",
    });

    const resolve = createFileResolver(db);
    expect(resolve("file-abc123")).toEqual({ storagePath: "/data/uploads/file-abc123" });
  });

  it("createFileResolver returns undefined for an unknown file id", () => {
    const resolve = createFileResolver(db);
    expect(resolve("file-does-not-exist")).toBeUndefined();
  });
});
