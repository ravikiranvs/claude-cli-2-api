import { rm } from "node:fs/promises";
import type Database from "better-sqlite3";
import { deleteExpiredTraces } from "./db/traces.js";
import { deleteUploadedFile, listExpiredUploadedFiles } from "./db/uploadedFiles.js";

export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Hard-deletes Traces and Uploaded Files (row + on-disk bytes) older than the retention window. */
export async function runRetentionCleanup(db: Database.Database, now: number = Date.now()): Promise<void> {
  deleteExpiredTraces(db, now);

  for (const file of listExpiredUploadedFiles(db, now)) {
    try {
      await rm(file.storagePath, { force: true });
    } catch (err) {
      // Leave the DB row in place so the file stays discoverable/retryable on the next run,
      // rather than losing track of on-disk bytes we failed to remove. Don't let one bad file
      // block the rest of this run's expired files.
      console.error(`Retention cleanup failed to delete ${file.storagePath}:`, err);
      continue;
    }
    deleteUploadedFile(db, file.id);
  }
}

/** Runs `runRetentionCleanup` immediately, then on a recurring interval. Returns a function that stops the schedule. */
export function scheduleRetentionCleanup(
  db: Database.Database,
  intervalMs: number = CLEANUP_INTERVAL_MS,
): () => void {
  const run = (): void => {
    runRetentionCleanup(db).catch((err) => {
      console.error("Retention cleanup failed:", err);
    });
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
