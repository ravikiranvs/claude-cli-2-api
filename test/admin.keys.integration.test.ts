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

describe("Gateway API Key management", () => {
  let server: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    server = await buildAdminServer(config);
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("requires a session to reach /keys", async () => {
    const response = await fetch(`${baseUrl}/keys`, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("lets a logged-in admin create, list, and revoke a key", async () => {
    const cookie = await login(baseUrl);

    const createResponse = await fetch(`${baseUrl}/keys`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: "name=ci-bot&rateLimitTpm=1000",
    });
    const createBody = await createResponse.text();
    expect(createResponse.status).toBe(200);
    expect(createBody).toMatch(/gwk_[0-9a-f]{64}/);

    const listBody = await (await fetch(`${baseUrl}/keys`, { headers: { cookie } })).text();
    expect(listBody).toContain("ci-bot");
    expect(listBody).not.toMatch(/gwk_[0-9a-f]{64}/);

    const id = createBody.match(/\/keys\/(\d+)\/revoke/)?.[1];
    expect(id).toBeTruthy();

    const revokeResponse = await fetch(`${baseUrl}/keys/${id}/revoke`, {
      method: "POST",
      headers: { cookie },
      redirect: "manual",
    });
    expect(revokeResponse.status).toBe(302);

    const afterRevoke = await (await fetch(`${baseUrl}/keys`, { headers: { cookie } })).text();
    expect(afterRevoke).not.toContain("ci-bot");
  });
});
