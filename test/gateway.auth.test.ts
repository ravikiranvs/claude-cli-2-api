import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiKey, revokeApiKey } from "../src/admin/apiKeys.js";
import { openDatabase } from "../src/db/connection.js";
import { registerGatewayAuthHook } from "../src/gateway/auth.js";
import type Database from "better-sqlite3";

describe("registerGatewayAuthHook", () => {
  let db: Database.Database;
  let server: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    server = Fastify();
    registerGatewayAuthHook(server, db);
    server.get("/protected", async (request) => ({ gatewayApiKeyId: request.gatewayApiKeyId }));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it("rejects a request with no Authorization header with 401", async () => {
    const response = await fetch(`${baseUrl}/protected`);

    expect(response.status).toBe(401);
  });

  it("rejects a request with an unrecognized key with 401", async () => {
    const response = await fetch(`${baseUrl}/protected`, {
      headers: { authorization: "Bearer gwk_does-not-exist" },
    });

    expect(response.status).toBe(401);
  });

  it("rejects a request with a revoked key with 401", async () => {
    const created = createApiKey(db, "ci-bot", 1000);
    revokeApiKey(db, created.id);

    const response = await fetch(`${baseUrl}/protected`, {
      headers: { authorization: `Bearer ${created.key}` },
    });

    expect(response.status).toBe(401);
  });

  it("accepts a request with a valid key and makes the key id available on the request", async () => {
    const created = createApiKey(db, "ci-bot", 1000);

    const response = await fetch(`${baseUrl}/protected`, {
      headers: { authorization: `Bearer ${created.key}` },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ gatewayApiKeyId: created.id });
  });
});
