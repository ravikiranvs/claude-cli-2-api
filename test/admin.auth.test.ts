import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerAuthHook } from "../src/admin/auth.js";
import { SESSION_COOKIE_NAME } from "../src/admin/login.js";
import { signSessionToken } from "../src/admin/session.js";
import { makeTestConfig } from "./testConfig.js";

const config = makeTestConfig();

describe("auth gate", () => {
  let server: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    server = Fastify();
    await server.register(cookie);
    registerAuthHook(server, config);
    server.get("/health", async () => ({ status: "ok" }));
    server.get("/login", async () => "login form");
    server.get("/", async () => ({ status: "logged-in" }));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("redirects unauthenticated requests to a protected route to /login", async () => {
    const response = await fetch(`${baseUrl}/`, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("allows requests carrying a valid session cookie", async () => {
    const token = signSessionToken("admin", "test-secret");

    const response = await fetch(`${baseUrl}/`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "logged-in" });
  });

  it("redirects requests with an expired or tampered session cookie", async () => {
    const expiredToken = signSessionToken("admin", "test-secret", { ttlSeconds: -1 });

    const response = await fetch(`${baseUrl}/`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${expiredToken}` },
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("leaves /health reachable without a session", async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
  });

  it("leaves /login reachable without a session", async () => {
    const response = await fetch(`${baseUrl}/login`);

    expect(response.status).toBe(200);
  });
});
