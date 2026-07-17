import type { FastifyInstance } from "fastify";

export const HEALTH_PATH = "/health";

export function registerHealthRoute(server: FastifyInstance): void {
  server.get(HEALTH_PATH, async () => ({ status: "ok" }));
}
