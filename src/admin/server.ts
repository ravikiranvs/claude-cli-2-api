import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoute } from "../health.js";

export function buildAdminServer(): FastifyInstance {
  const server = Fastify();

  registerHealthRoute(server);

  return server;
}
