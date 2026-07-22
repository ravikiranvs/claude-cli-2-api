import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiKey, revokeApiKey } from "../src/admin/apiKeys.js";
import { openDatabase } from "../src/db/connection.js";
import { deleteExpiredTraces, insertTrace, listTraces } from "../src/db/traces.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("insertTrace", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("stores a verbatim record of the request and response", () => {
    insertTrace(db, {
      gatewayApiKeyId: null,
      endpoint: "/v1/chat/completions",
      httpStatus: 200,
      requestBody: '{"model":"claude","messages":[]}',
      responseBody: '{"id":"chatcmpl-1"}',
      tokenCount: 12,
    });

    const row = db.prepare("SELECT * FROM traces").get() as Record<string, unknown>;

    expect(row.endpoint).toBe("/v1/chat/completions");
    expect(row.http_status).toBe(200);
    expect(row.request_body).toBe('{"model":"claude","messages":[]}');
    expect(row.response_body).toBe('{"id":"chatcmpl-1"}');
    expect(row.token_count).toBe(12);
    expect(row.gateway_api_key_id).toBeNull();
  });

  it("associates the trace with the Gateway API Key that made the request", () => {
    const key = createApiKey(db, "ci-bot", 1000);

    insertTrace(db, {
      gatewayApiKeyId: key.id,
      endpoint: "/v1/chat/completions",
      httpStatus: 200,
      requestBody: "{}",
      responseBody: null,
      tokenCount: null,
    });

    const row = db.prepare("SELECT gateway_api_key_id, response_body, token_count FROM traces").get() as Record<
      string,
      unknown
    >;

    expect(row.gateway_api_key_id).toBe(key.id);
    expect(row.response_body).toBeNull();
    expect(row.token_count).toBeNull();
  });
});

describe("listTraces", () => {
  let db: Database.Database;
  const now = Date.parse("2026-07-22T00:00:00.000Z");

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function insertBackdated(ageMs: number, overrides: Partial<Parameters<typeof insertTrace>[1]> = {}): number {
    insertTrace(db, {
      gatewayApiKeyId: null,
      endpoint: "/v1/chat/completions",
      httpStatus: 200,
      requestBody: "{}",
      responseBody: "{}",
      tokenCount: 1,
      ...overrides,
    });

    const id = (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
    db.prepare("UPDATE traces SET created_at = ? WHERE id = ?").run(
      new Date(now - ageMs).toISOString(),
      id,
    );
    return id;
  }

  it("excludes traces older than 7 days", () => {
    insertBackdated(8 * DAY_MS, { endpoint: "/old" });
    insertBackdated(1 * DAY_MS, { endpoint: "/recent" });

    const traces = listTraces(db, { now });

    expect(traces).toHaveLength(1);
    expect(traces[0]!.endpoint).toBe("/recent");
  });

  it("returns traces newest first", () => {
    insertBackdated(5 * DAY_MS, { endpoint: "/older" });
    insertBackdated(1 * DAY_MS, { endpoint: "/newer" });

    const traces = listTraces(db, { now });

    expect(traces.map((t) => t.endpoint)).toEqual(["/newer", "/older"]);
  });

  it("includes the Gateway API Key name via join, and null when there is none", () => {
    const key = createApiKey(db, "ci-bot", 1000);
    insertBackdated(1 * DAY_MS, { gatewayApiKeyId: key.id, endpoint: "/with-key" });
    insertBackdated(1 * DAY_MS, { gatewayApiKeyId: null, endpoint: "/without-key" });

    const traces = listTraces(db, { now });

    const withKey = traces.find((t) => t.endpoint === "/with-key");
    const withoutKey = traces.find((t) => t.endpoint === "/without-key");
    expect(withKey?.gatewayApiKeyName).toBe("ci-bot");
    expect(withoutKey?.gatewayApiKeyName).toBeNull();
  });

  it("still shows the key name for traces made by a since-revoked key", () => {
    const key = createApiKey(db, "ci-bot", 1000);
    insertBackdated(1 * DAY_MS, { gatewayApiKeyId: key.id });
    revokeApiKey(db, key.id);

    const traces = listTraces(db, { now });

    expect(traces[0]!.gatewayApiKeyName).toBe("ci-bot");
  });

  it("filters by Gateway API Key id", () => {
    const keyA = createApiKey(db, "key-a", 1000);
    const keyB = createApiKey(db, "key-b", 1000);
    insertBackdated(1 * DAY_MS, { gatewayApiKeyId: keyA.id, endpoint: "/a" });
    insertBackdated(1 * DAY_MS, { gatewayApiKeyId: keyB.id, endpoint: "/b" });

    const traces = listTraces(db, { now, keyId: keyA.id });

    expect(traces).toHaveLength(1);
    expect(traces[0]!.endpoint).toBe("/a");
  });

  it("includes the full verbatim request and response bodies", () => {
    insertBackdated(1 * DAY_MS, {
      requestBody: '{"model":"claude","messages":[]}',
      responseBody: '{"id":"chatcmpl-1"}',
    });

    const traces = listTraces(db, { now });

    expect(traces[0]!.requestBody).toBe('{"model":"claude","messages":[]}');
    expect(traces[0]!.responseBody).toBe('{"id":"chatcmpl-1"}');
  });
});

describe("deleteExpiredTraces", () => {
  let db: Database.Database;
  const now = Date.parse("2026-07-22T00:00:00.000Z");

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function insertBackdated(ageMs: number, overrides: Partial<Parameters<typeof insertTrace>[1]> = {}): number {
    insertTrace(db, {
      gatewayApiKeyId: null,
      endpoint: "/v1/chat/completions",
      httpStatus: 200,
      requestBody: "{}",
      responseBody: "{}",
      tokenCount: 1,
      ...overrides,
    });

    const id = (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
    db.prepare("UPDATE traces SET created_at = ? WHERE id = ?").run(
      new Date(now - ageMs).toISOString(),
      id,
    );
    return id;
  }

  it("hard-deletes only traces older than 7 days", () => {
    const oldId = insertBackdated(8 * DAY_MS, { endpoint: "/old" });
    const recentId = insertBackdated(1 * DAY_MS, { endpoint: "/recent" });

    const deletedCount = deleteExpiredTraces(db, now);

    expect(deletedCount).toBe(1);
    expect(db.prepare("SELECT id FROM traces WHERE id = ?").get(oldId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM traces WHERE id = ?").get(recentId)).toBeDefined();
  });

  it("returns 0 when nothing is old enough to delete", () => {
    insertBackdated(1 * DAY_MS);

    expect(deleteExpiredTraces(db, now)).toBe(0);
  });
});
