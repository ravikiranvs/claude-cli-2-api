import Fastify, { type FastifyInstance } from "fastify";
import { createClaudeSubprocess } from "../claude/index.js";
import type { Config } from "../config.js";
import { openDatabase } from "../db/connection.js";
import { registerHealthRoute } from "../health.js";
import { registerGatewayAuthHook } from "./auth.js";
import { registerChatCompletionsRoute } from "./chatCompletions.js";

export function buildGatewayServer(config: Config): FastifyInstance {
  const server = Fastify();
  const db = openDatabase(config.databasePath);
  server.addHook("onClose", (_instance, done) => {
    db.close();
    done();
  });

  registerHealthRoute(server);

  const claudeSubprocess = createClaudeSubprocess({ stub: config.claudeSubprocessStub });

  server.register(async (instance) => {
    registerGatewayAuthHook(instance, db);
    registerChatCompletionsRoute(instance, db, claudeSubprocess);
  });

  return server;
}
