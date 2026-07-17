import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiKey } from "../src/admin/apiKeys.js";
import { openDatabase } from "../src/db/connection.js";
import { insertTrace } from "../src/db/traces.js";

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
