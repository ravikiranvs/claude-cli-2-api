import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

const KEY_PREFIX = "gwk_";

export interface GatewayApiKey {
  id: number;
  name: string;
  rateLimitTpm: number;
  createdAt: string;
}

export interface CreatedGatewayApiKey extends GatewayApiKey {
  key: string;
}

interface ApiKeyRow {
  id: number;
  name: string;
  rate_limit_tpm: number;
  created_at: string;
}

function toApiKey(row: ApiKeyRow): GatewayApiKey {
  return { id: row.id, name: row.name, rateLimitTpm: row.rate_limit_tpm, createdAt: row.created_at };
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function createApiKey(db: Database.Database, name: string, rateLimitTpm: number): CreatedGatewayApiKey {
  const key = `${KEY_PREFIX}${randomBytes(32).toString("hex")}`;

  const result = db
    .prepare("INSERT INTO gateway_api_keys (name, key_hash, rate_limit_tpm) VALUES (?, ?, ?)")
    .run(name, hashKey(key), rateLimitTpm);

  const row = db
    .prepare("SELECT id, name, rate_limit_tpm, created_at FROM gateway_api_keys WHERE id = ?")
    .get(result.lastInsertRowid) as ApiKeyRow;

  return { ...toApiKey(row), key };
}

export function listActiveApiKeys(db: Database.Database): GatewayApiKey[] {
  const rows = db
    .prepare(
      "SELECT id, name, rate_limit_tpm, created_at FROM gateway_api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC, id DESC",
    )
    .all() as ApiKeyRow[];

  return rows.map(toApiKey);
}

export function revokeApiKey(db: Database.Database, id: number): boolean {
  const result = db
    .prepare(
      "UPDATE gateway_api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND revoked_at IS NULL",
    )
    .run(id);

  return result.changes > 0;
}
