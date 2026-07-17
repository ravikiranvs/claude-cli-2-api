import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";

describe("migrate", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gateway-db-"));
    dbPath = join(dir, "gateway.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the database file on first run", () => {
    migrate(dbPath);

    expect(existsSync(dbPath)).toBe(true);
  });

  it("creates the gateway_api_keys and traces tables", () => {
    migrate(dbPath);

    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    db.close();

    expect(tables).toContain("gateway_api_keys");
    expect(tables).toContain("traces");
  });

  it("is idempotent across repeated runs", () => {
    migrate(dbPath);

    expect(() => migrate(dbPath)).not.toThrow();
  });
});
