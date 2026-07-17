import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerLoginRoutes, SESSION_COOKIE_NAME } from "../src/admin/login.js";
import { verifySessionToken } from "../src/admin/session.js";
import { makeTestConfig } from "./testConfig.js";

const config = makeTestConfig();

describe("login routes", () => {
  let server: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    server = Fastify();
    await server.register(cookie);
    await server.register(formbody);
    registerLoginRoutes(server, config);
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("renders a login form on GET /login", async () => {
    const response = await fetch(`${baseUrl}/login`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("<form");
    expect(body).toContain('name="username"');
    expect(body).toContain('name="password"');
  });

  it("sets a signed session cookie and redirects on correct credentials", async () => {
    const response = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "username=admin&password=hunter2",
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");

    const tokenMatch = setCookie?.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    const token = tokenMatch?.[1];
    expect(token).toBeTruthy();
    expect(verifySessionToken(token as string, config.adminSessionSecret)).toEqual({
      username: "admin",
    });
  });

  it("rejects incorrect credentials without issuing a session", async () => {
    const response = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "username=admin&password=wrong",
      redirect: "manual",
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();

    const body = await response.text();
    expect(body).toContain("<form");
  });

  it("rejects a missing username or password", async () => {
    const response = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "username=admin",
      redirect: "manual",
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
