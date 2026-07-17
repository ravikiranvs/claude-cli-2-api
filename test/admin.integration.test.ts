import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAdminServer } from "../src/admin/server.js";
import { makeTestConfig } from "./testConfig.js";
import type { FastifyInstance } from "fastify";

const config = makeTestConfig();

function extractCookie(setCookieHeader: string | null): string {
  const value = setCookieHeader?.split(";")[0];
  if (!value) throw new Error("expected a Set-Cookie header");
  return value;
}

describe("Admin Console login flow", () => {
  let server: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    server = await buildAdminServer(config);
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("redirects an unauthenticated request to any Admin Console route to /login", async () => {
    const response = await fetch(`${baseUrl}/`, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("rejects incorrect credentials and issues no session", async () => {
    const response = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "username=admin&password=wrong",
      redirect: "manual",
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("establishes a session on correct credentials and allows access to protected routes", async () => {
    const loginResponse = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "username=admin&password=hunter2",
      redirect: "manual",
    });
    expect(loginResponse.status).toBe(302);

    const sessionCookie = extractCookie(loginResponse.headers.get("set-cookie"));

    const protectedResponse = await fetch(`${baseUrl}/`, {
      headers: { cookie: sessionCookie },
    });

    expect(protectedResponse.status).toBe(200);
  });

  it("keeps /health reachable without a session", async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
  });
});
