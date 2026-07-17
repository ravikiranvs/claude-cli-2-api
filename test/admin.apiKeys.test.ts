import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiKey, listActiveApiKeys, revokeApiKey } from "../src/admin/apiKeys.js";
import { openDatabase } from "../src/db/connection.js";

describe("apiKeys", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates a key and returns the plaintext value exactly once", () => {
    const created = createApiKey(db, "ci-bot", 1000);

    expect(created.name).toBe("ci-bot");
    expect(created.rateLimitTpm).toBe(1000);
    expect(created.key).toMatch(/^gwk_[0-9a-f]{64}$/);
  });

  it("stores only a hash of the key, never the plaintext", () => {
    const created = createApiKey(db, "ci-bot", 1000);

    const row = db
      .prepare("SELECT key_hash FROM gateway_api_keys WHERE id = ?")
      .get(created.id) as { key_hash: string };

    expect(row.key_hash).not.toBe(created.key);
    expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a distinct key and hash on every call", () => {
    const first = createApiKey(db, "ci-bot", 1000);
    const second = createApiKey(db, "ci-bot", 1000);

    expect(first.key).not.toBe(second.key);
  });

  it("lists active keys without exposing the plaintext key", () => {
    createApiKey(db, "ci-bot", 1000);

    const keys = listActiveApiKeys(db);

    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toHaveProperty("key");
    expect(keys[0]).toMatchObject({ name: "ci-bot", rateLimitTpm: 1000 });
  });

  it("excludes revoked keys from the active list", () => {
    const created = createApiKey(db, "ci-bot", 1000);

    revokeApiKey(db, created.id);

    expect(listActiveApiKeys(db)).toHaveLength(0);
  });

  it("reports whether a revoke actually matched an active key", () => {
    const created = createApiKey(db, "ci-bot", 1000);

    expect(revokeApiKey(db, created.id)).toBe(true);
    expect(revokeApiKey(db, created.id)).toBe(false);
    expect(revokeApiKey(db, 999999)).toBe(false);
  });
});
