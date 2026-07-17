import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/connection.js";

describe("openDatabase", () => {
  it("returns a connection with the schema already applied", () => {
    const db = openDatabase(":memory:");

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    db.close();

    expect(tables).toContain("gateway_api_keys");
    expect(tables).toContain("traces");
  });

  it("keeps an in-memory database's schema alive across queries on the same connection", () => {
    const db = openDatabase(":memory:");

    db.prepare("INSERT INTO gateway_api_keys (name, key_hash, rate_limit_tpm) VALUES (?, ?, ?)").run(
      "test",
      "hash",
      100,
    );
    const row = db.prepare("SELECT name FROM gateway_api_keys WHERE name = ?").get("test");
    db.close();

    expect(row).toEqual({ name: "test" });
  });
});
