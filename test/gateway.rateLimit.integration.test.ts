import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiKey } from "../src/admin/apiKeys.js";
import { openDatabase } from "../src/db/connection.js";
import { buildGatewayServer } from "../src/gateway/server.js";
import { makeTestConfig } from "./testConfig.js";

describe("Gateway rate limiting (integration)", () => {
  let dir: string;
  let databasePath: string;
  let server: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "gateway-rate-limit-"));
    databasePath = join(dir, "gateway.db");
  });

  afterEach(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function chat(apiKey: string): Promise<Response> {
    return fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "claude", messages: [{ role: "user", content: "hi" }] }),
    });
  }

  it("rejects a request that would exceed the key's token-per-minute limit with 429", async () => {
    const setupDb = openDatabase(databasePath);
    const lowLimitKey = createApiKey(setupDb, "low-limit", 3).key;
    setupDb.close();

    server = buildGatewayServer(makeTestConfig({ databasePath }));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const first = await chat(lowLimitKey);
    expect(first.status).toBe(200);

    const second = await chat(lowLimitKey);
    expect(second.status).toBe(429);
    const body = (await second.json()) as Record<string, any>;
    expect(body.error.type).toBe("rate_limit_error");

    const traceDb = openDatabase(databasePath);
    const rows = traceDb.prepare("SELECT http_status FROM traces ORDER BY id").all() as Array<{
      http_status: number;
    }>;
    traceDb.close();
    expect(rows.map((row) => row.http_status)).toEqual([200, 429]);
  });

  it("enforces each Gateway API Key's limit independently of other keys", async () => {
    const setupDb = openDatabase(databasePath);
    const lowLimitKey = createApiKey(setupDb, "low-limit", 3).key;
    const highLimitKey = createApiKey(setupDb, "high-limit", 1000).key;
    setupDb.close();

    server = buildGatewayServer(makeTestConfig({ databasePath }));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    expect((await chat(lowLimitKey)).status).toBe(200);
    expect((await chat(lowLimitKey)).status).toBe(429);

    // The high-limit key's budget is untouched by the low-limit key being exhausted.
    expect((await chat(highLimitKey)).status).toBe(200);
    expect((await chat(highLimitKey)).status).toBe(200);
  });
});
