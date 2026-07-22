import type Database from "better-sqlite3";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiKey } from "../src/admin/apiKeys.js";
import { registerTracesRoutes, TRACES_PATH } from "../src/admin/traces.js";
import { openDatabase } from "../src/db/connection.js";
import { insertTrace } from "../src/db/traces.js";

describe("traces routes", () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let db: Database.Database;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    server = Fastify();
    await server.register(formbody);
    registerTracesRoutes(server, db);
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it("renders an empty table on GET /traces", async () => {
    const response = await fetch(`${baseUrl}${TRACES_PATH}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("<table");
  });

  it("shows timestamp, key name, endpoint, status, and token count for each trace", async () => {
    const key = createApiKey(db, "ci-bot", 1000);
    insertTrace(db, {
      gatewayApiKeyId: key.id,
      endpoint: "/v1/chat/completions",
      httpStatus: 200,
      requestBody: '{"model":"claude"}',
      responseBody: '{"id":"chatcmpl-1"}',
      tokenCount: 42,
    });

    const body = await (await fetch(`${baseUrl}${TRACES_PATH}`)).text();

    expect(body).toContain("ci-bot");
    expect(body).toContain("/v1/chat/completions");
    expect(body).toContain("200");
    expect(body).toContain("42");
  });

  it("lets an admin expand a trace to see the full verbatim request and response bodies", async () => {
    insertTrace(db, {
      gatewayApiKeyId: null,
      endpoint: "/v1/chat/completions",
      httpStatus: 200,
      requestBody: '{"model":"claude","messages":[{"role":"user","content":"hi"}]}',
      responseBody: '{"id":"chatcmpl-1","choices":[]}',
      tokenCount: 5,
    });

    const body = await (await fetch(`${baseUrl}${TRACES_PATH}`)).text();

    expect(body).toContain("<details");
    expect(body).toContain("claude");
    expect(body).toContain("user");
    expect(body).toContain("chatcmpl-1");
  });

  it("escapes bodies containing markup", async () => {
    insertTrace(db, {
      gatewayApiKeyId: null,
      endpoint: "/v1/chat/completions",
      httpStatus: 200,
      requestBody: "<script>alert(1)</script>",
      responseBody: null,
      tokenCount: null,
    });

    const body = await (await fetch(`${baseUrl}${TRACES_PATH}`)).text();

    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("filters the list by Gateway API Key", async () => {
    const keyA = createApiKey(db, "key-a", 1000);
    const keyB = createApiKey(db, "key-b", 1000);
    insertTrace(db, {
      gatewayApiKeyId: keyA.id,
      endpoint: "/a",
      httpStatus: 200,
      requestBody: "{}",
      responseBody: null,
      tokenCount: null,
    });
    insertTrace(db, {
      gatewayApiKeyId: keyB.id,
      endpoint: "/b",
      httpStatus: 200,
      requestBody: "{}",
      responseBody: null,
      tokenCount: null,
    });

    const body = await (await fetch(`${baseUrl}${TRACES_PATH}?keyId=${keyA.id}`)).text();

    expect(body).toContain("<td>/a</td>");
    expect(body).not.toContain("<td>/b</td>");
  });

  it("offers a select of Gateway API Keys to filter by", async () => {
    createApiKey(db, "ci-bot", 1000);

    const body = await (await fetch(`${baseUrl}${TRACES_PATH}`)).text();

    expect(body).toContain("<select");
    expect(body).toContain("ci-bot");
  });

  it("rejects a non-numeric keyId filter", async () => {
    const response = await fetch(`${baseUrl}${TRACES_PATH}?keyId=not-a-number`);

    expect(response.status).toBe(400);
  });

  it("treats a whitespace-only keyId as no filter, rather than silently matching id 0", async () => {
    const key = createApiKey(db, "ci-bot", 1000);
    insertTrace(db, {
      gatewayApiKeyId: key.id,
      endpoint: "/v1/chat/completions",
      httpStatus: 200,
      requestBody: "{}",
      responseBody: null,
      tokenCount: null,
    });

    const response = await fetch(`${baseUrl}${TRACES_PATH}?keyId=%20`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("/v1/chat/completions");
  });

  it("rejects a zero or negative keyId filter", async () => {
    const response = await fetch(`${baseUrl}${TRACES_PATH}?keyId=0`);

    expect(response.status).toBe(400);
  });

  it("marks /traces responses as not to be cached", async () => {
    const response = await fetch(`${baseUrl}${TRACES_PATH}`);

    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
