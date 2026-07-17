import formbody from "@fastify/formbody";
import type Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KEYS_PATH, registerKeysRoutes } from "../src/admin/keys.js";
import { openDatabase } from "../src/db/connection.js";

describe("keys routes", () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let db: Database.Database;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    server = Fastify();
    await server.register(formbody);
    registerKeysRoutes(server, db);
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it("renders an empty list with a create form on GET /keys", async () => {
    const response = await fetch(`${baseUrl}${KEYS_PATH}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("<form");
    expect(body).toContain('name="name"');
    expect(body).toContain('name="rateLimitTpm"');
  });

  it("creates a key and shows the plaintext value exactly once", async () => {
    const createResponse = await fetch(`${baseUrl}${KEYS_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=ci-bot&rateLimitTpm=1000",
    });
    const createBody = await createResponse.text();

    expect(createResponse.status).toBe(200);
    expect(createBody).toMatch(/gwk_[0-9a-f]{64}/);
    expect(createBody).toContain("ci-bot");

    const listBody = await (await fetch(`${baseUrl}${KEYS_PATH}`)).text();
    expect(listBody).not.toMatch(/gwk_[0-9a-f]{64}/);
    expect(listBody).toContain("ci-bot");
    expect(listBody).toContain("1000");
  });

  it("escapes a key name containing markup", async () => {
    const response = await fetch(`${baseUrl}${KEYS_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `name=${encodeURIComponent("<script>alert(1)</script>")}&rateLimitTpm=100`,
    });
    const body = await response.text();

    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("rejects a blank name", async () => {
    const response = await fetch(`${baseUrl}${KEYS_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=&rateLimitTpm=100",
    });

    expect(response.status).toBe(400);
    expect(await (await fetch(`${baseUrl}${KEYS_PATH}`)).text()).not.toContain("<td>");
  });

  it("rejects a non-positive rate limit", async () => {
    const response = await fetch(`${baseUrl}${KEYS_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=ci-bot&rateLimitTpm=0",
    });

    expect(response.status).toBe(400);
  });

  it("revokes a key so it no longer appears in the active list", async () => {
    const createBody = await (
      await fetch(`${baseUrl}${KEYS_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "name=ci-bot&rateLimitTpm=1000",
      })
    ).text();
    const id = createBody.match(/\/keys\/(\d+)\/revoke/)?.[1];
    expect(id).toBeTruthy();

    const revokeResponse = await fetch(`${baseUrl}${KEYS_PATH}/${id}/revoke`, {
      method: "POST",
      redirect: "manual",
    });

    expect(revokeResponse.status).toBe(302);
    expect(revokeResponse.headers.get("location")).toBe(KEYS_PATH);

    const listBody = await (await fetch(`${baseUrl}${KEYS_PATH}`)).text();
    expect(listBody).not.toContain("ci-bot");
  });

  it("rejects a revoke request with a non-numeric id", async () => {
    const response = await fetch(`${baseUrl}${KEYS_PATH}/not-a-number/revoke`, {
      method: "POST",
      redirect: "manual",
    });

    expect(response.status).toBe(400);
  });

  it("marks /keys responses as not to be cached, since the created-key banner must show only once", async () => {
    const response = await fetch(`${baseUrl}${KEYS_PATH}`);

    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
