import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAdminServer } from "../src/admin/server.js";
import { makeTestConfig } from "./testConfig.js";
import type { FastifyInstance } from "fastify";

const config = makeTestConfig();

describe("Admin Console server", () => {
  let server: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    server = await buildAdminServer(config);
    const address = await server.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = address;
  });

  afterEach(async () => {
    await server.close();
  });

  it("responds to GET /health with 200 and a healthy status", async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });
});
