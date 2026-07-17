import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerHomeRoute } from "../src/admin/home.js";

describe("home route", () => {
  let server: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    server = Fastify();
    registerHomeRoute(server);
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("responds to GET / with 200", async () => {
    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
