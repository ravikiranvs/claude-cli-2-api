import type Database from "better-sqlite3";
import { retentionCutoffIso } from "../retention.js";

export interface UploadedFile {
  id: string;
  filename: string;
  contentType: string | null;
  byteSize: number;
  storagePath: string;
  createdAt: string;
}

export interface CreateUploadedFileInput {
  id: string;
  filename: string;
  contentType: string | null;
  byteSize: number;
  storagePath: string;
}

interface UploadedFileRow {
  id: string;
  filename: string;
  content_type: string | null;
  byte_size: number;
  storage_path: string;
  created_at: string;
}

function toUploadedFile(row: UploadedFileRow): UploadedFile {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: row.byte_size,
    storagePath: row.storage_path,
    createdAt: row.created_at,
  };
}

export function createUploadedFile(db: Database.Database, input: CreateUploadedFileInput): UploadedFile {
  db.prepare(
    "INSERT INTO uploaded_files (id, filename, content_type, byte_size, storage_path) VALUES (?, ?, ?, ?, ?)",
  ).run(input.id, input.filename, input.contentType, input.byteSize, input.storagePath);

  const row = db.prepare("SELECT * FROM uploaded_files WHERE id = ?").get(input.id) as UploadedFileRow;
  return toUploadedFile(row);
}

export function listUploadedFiles(db: Database.Database): UploadedFile[] {
  // `id` is a random UUID, not a monotonically increasing key, so it can't break ties between
  // rows with the same `created_at` timestamp — the implicit SQLite `rowid` reflects insertion
  // order instead.
  const rows = db
    .prepare("SELECT * FROM uploaded_files ORDER BY created_at DESC, rowid DESC")
    .all() as UploadedFileRow[];
  return rows.map(toUploadedFile);
}

export function getUploadedFile(db: Database.Database, id: string): UploadedFile | undefined {
  const row = db.prepare("SELECT * FROM uploaded_files WHERE id = ?").get(id) as UploadedFileRow | undefined;
  return row ? toUploadedFile(row) : undefined;
}

export function deleteUploadedFile(db: Database.Database, id: string): boolean {
  const result = db.prepare("DELETE FROM uploaded_files WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Uploaded files older than the retention window, whose on-disk bytes and DB row still need removing. */
export function listExpiredUploadedFiles(db: Database.Database, now: number = Date.now()): UploadedFile[] {
  const cutoff = retentionCutoffIso(now);
  const rows = db.prepare("SELECT * FROM uploaded_files WHERE created_at < ?").all(cutoff) as UploadedFileRow[];
  return rows.map(toUploadedFile);
}
