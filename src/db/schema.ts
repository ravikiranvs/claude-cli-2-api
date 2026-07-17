import type Database from "better-sqlite3";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS gateway_api_keys (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  key_hash       TEXT NOT NULL UNIQUE,
  rate_limit_tpm INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at     TEXT
);

CREATE TABLE IF NOT EXISTS traces (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  gateway_api_key_id  INTEGER REFERENCES gateway_api_keys(id),
  endpoint            TEXT NOT NULL,
  http_status         INTEGER NOT NULL,
  request_body        TEXT NOT NULL,
  response_body       TEXT,
  token_count         INTEGER,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

export function migrateDatabase(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
}
