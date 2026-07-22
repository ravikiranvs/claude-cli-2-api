import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiKey, revokeApiKey } from "../src/admin/apiKeys.js";
import { openDatabase } from "../src/db/connection.js";
import { buildGatewayServer } from "../src/gateway/server.js";
import { makeTestConfig } from "./testConfig.js";

describe("Gateway auth + legacy completions (integration)", () => {
  let dir: string;
  let databasePath: string;
  let server: FastifyInstance;
  let baseUrl: string;
  let apiKey: string;
  let revokedKey: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "gateway-completions-"));
    databasePath = join(dir, "gateway.db");

    const setupDb = openDatabase(databasePath);
    apiKey = createApiKey(setupDb, "ci-bot", 1000).key;
    const revoked = createApiKey(setupDb, "ex-bot", 1000);
    revokeApiKey(setupDb, revoked.id);
    revokedKey = revoked.key;
    setupDb.close();

    server = buildGatewayServer(makeTestConfig({ databasePath }));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a request with no Gateway API Key with 401", async () => {
    const response = await fetch(`${baseUrl}/v1/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude", prompt: "hi" }),
    });

    expect(response.status).toBe(401);
  });

  it("rejects a request with a revoked Gateway API Key with 401", async () => {
    const response = await fetch(`${baseUrl}/v1/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${revokedKey}` },
      body: JSON.stringify({ model: "claude", prompt: "hi" }),
    });

    expect(response.status).toBe(401);
  });

  it("dispatches a valid, authenticated request to the Claude Subprocess and traces it", async () => {
    const response = await fetch(`${baseUrl}/v1/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "claude", prompt: "hi" }),
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body.object).toBe("text_completion");
    expect(body.choices[0].text).toBe("stubbed response");

    const traceDb = openDatabase(databasePath);
    const trace = traceDb.prepare("SELECT * FROM traces").get() as Record<string, unknown>;
    traceDb.close();

    expect(trace.http_status).toBe(200);
    expect(trace.endpoint).toBe("/v1/completions");
    expect(trace.gateway_api_key_id).toBeTypeOf("number");
  });

  it("rejects a request that would exceed the key's token-per-minute limit with 429", async () => {
    const setupDb = openDatabase(databasePath);
    const lowLimitKey = createApiKey(setupDb, "low-limit", 3).key;
    setupDb.close();

    const request = () =>
      fetch(`${baseUrl}/v1/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${lowLimitKey}` },
        body: JSON.stringify({ model: "claude", prompt: "hi" }),
      });

    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(429);
  });
});
