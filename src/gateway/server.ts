import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoute } from "../health.js";

export function buildGatewayServer(): FastifyInstance {
  const server = Fastify();

  registerHealthRoute(server);

  return server;
}
