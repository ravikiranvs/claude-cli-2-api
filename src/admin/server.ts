import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { registerHealthRoute } from "../health.js";
import { registerAuthHook } from "./auth.js";
import { registerHomeRoute } from "./home.js";
import { registerLoginRoutes } from "./login.js";

export async function buildAdminServer(config: Config): Promise<FastifyInstance> {
  const server = Fastify();

  await server.register(cookie);
  await server.register(formbody);

  registerHealthRoute(server);
  registerLoginRoutes(server, config);
  registerAuthHook(server, config);
  registerHomeRoute(server);

  return server;
}
