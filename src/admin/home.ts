import type { FastifyInstance } from "fastify";

export function registerHomeRoute(server: FastifyInstance): void {
  server.get("/", async () => ({ status: "ok" }));
}
