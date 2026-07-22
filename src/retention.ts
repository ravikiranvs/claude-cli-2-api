export const RETENTION_DAYS = 7;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** SQLite `created_at` cutoff string: rows/files older than this have aged out of the retention window. */
export function retentionCutoffIso(now: number): string {
  return new Date(now - RETENTION_MS).toISOString();
}
