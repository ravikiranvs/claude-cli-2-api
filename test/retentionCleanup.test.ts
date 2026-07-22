import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUploadedFile, getUploadedFile } from "../src/db/uploadedFiles.js";
import { insertTrace } from "../src/db/traces.js";
import { openDatabase } from "../src/db/connection.js";
import { runRetentionCleanup, scheduleRetentionCleanup } from "../src/retentionCleanup.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("runRetentionCleanup", () => {
  let db: Database.Database;
  let dir: string;
  const now = Date.parse("2026-07-22T00:00:00.000Z");

  beforeEach(() => {
    db = openDatabase(":memory:");
    dir = mkdtempSync(join(tmpdir(), "gateway-retention-"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function insertBackdatedTrace(id: string, ageMs: number): void {
    insertTrace(db, {
      gatewayApiKeyId: null,
      endpoint: `/v1/${id}`,
      httpStatus: 200,
      requestBody: "{}",
      responseBody: "{}",
      tokenCount: 1,
    });
    db.prepare("UPDATE traces SET created_at = ? WHERE endpoint = ?").run(
      new Date(now - ageMs).toISOString(),
      `/v1/${id}`,
    );
  }

  function createBackdatedFile(id: string, ageMs: number): string {
    const storagePath = join(dir, id);
    writeFileSync(storagePath, "contents");
    createUploadedFile(db, { id, filename: `${id}.txt`, contentType: "text/plain", byteSize: 8, storagePath });
    db.prepare("UPDATE uploaded_files SET created_at = ? WHERE id = ?").run(
      new Date(now - ageMs).toISOString(),
      id,
    );
    return storagePath;
  }

  it("removes only Traces older than 7 days", () => {
    insertBackdatedTrace("old", 8 * DAY_MS);
    insertBackdatedTrace("recent", 1 * DAY_MS);

    return runRetentionCleanup(db, now).then(() => {
      const endpoints = (db.prepare("SELECT endpoint FROM traces").all() as { endpoint: string }[]).map(
        (row) => row.endpoint,
      );
      expect(endpoints).toEqual(["/v1/recent"]);
    });
  });

  it("removes only Uploaded Files older than 7 days, deleting both the DB row and the on-disk bytes", async () => {
    const oldPath = createBackdatedFile("file-old", 8 * DAY_MS);
    const recentPath = createBackdatedFile("file-recent", 1 * DAY_MS);

    await runRetentionCleanup(db, now);

    expect(getUploadedFile(db, "file-old")).toBeUndefined();
    expect(existsSync(oldPath)).toBe(false);

    expect(getUploadedFile(db, "file-recent")).toBeDefined();
    expect(existsSync(recentPath)).toBe(true);
  });

  it("tolerates an Uploaded File row whose on-disk bytes are already gone", async () => {
    const storagePath = join(dir, "file-missing");
    createUploadedFile(db, {
      id: "file-missing",
      filename: "missing.txt",
      contentType: "text/plain",
      byteSize: 8,
      storagePath,
    });
    db.prepare("UPDATE uploaded_files SET created_at = ? WHERE id = ?").run(
      new Date(now - 8 * DAY_MS).toISOString(),
      "file-missing",
    );

    await expect(runRetentionCleanup(db, now)).resolves.toBeUndefined();
    expect(getUploadedFile(db, "file-missing")).toBeUndefined();
  });
});

describe("scheduleRetentionCleanup", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  it("runs immediately and then again on each interval tick, until stopped", async () => {
    insertTrace(db, {
      gatewayApiKeyId: null,
      endpoint: "/v1/a",
      httpStatus: 200,
      requestBody: "{}",
      responseBody: "{}",
      tokenCount: 1,
    });
    db.prepare("UPDATE traces SET created_at = '2000-01-01T00:00:00.000Z'").run();

    const stop = scheduleRetentionCleanup(db, 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM traces").get()).toEqual({ n: 0 });

    stop();

    insertTrace(db, {
      gatewayApiKeyId: null,
      endpoint: "/v1/b",
      httpStatus: 200,
      requestBody: "{}",
      responseBody: "{}",
      tokenCount: 1,
    });
    db.prepare("UPDATE traces SET created_at = '2000-01-01T00:00:00.000Z' WHERE endpoint = '/v1/b'").run();

    await vi.advanceTimersByTimeAsync(5000);
    expect(db.prepare("SELECT COUNT(*) AS n FROM traces").get()).toEqual({ n: 1 });
  });
});
