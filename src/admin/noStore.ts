import type { FastifyInstance } from "fastify";

export function registerNoStoreHook(server: FastifyInstance, pathPrefix: string): void {
  server.addHook("onSend", async (request, reply) => {
    if (request.url.split("?")[0].startsWith(pathPrefix)) {
      reply.header("Cache-Control", "no-store");
    }
  });
}
