import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAdminServer } from "../src/admin/server.js";
import { makeTestConfig } from "./testConfig.js";

const config = makeTestConfig();

function extractCookie(setCookieHeader: string | null): string {
  const value = setCookieHeader?.split(";")[0];
  if (!value) throw new Error("expected a Set-Cookie header");
  return value;
}

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `username=${config.adminUsername}&password=${config.adminPassword}`,
    redirect: "manual",
  });
  return extractCookie(response.headers.get("set-cookie"));
}

describe("Admin Console Trace browsing", () => {
  let server: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    server = await buildAdminServer(config);
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("requires a session to reach /traces", async () => {
    const response = await fetch(`${baseUrl}/traces`, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("lets a logged-in admin browse traces", async () => {
    const cookie = await login(baseUrl);

    const response = await fetch(`${baseUrl}/traces`, { headers: { cookie } });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("<table");
  });
});
