import Fastify, { type FastifyInstance } from "fastify";
import { createClaudeSubprocess } from "../claude/index.js";
import type { Config } from "../config.js";
import { openDatabase } from "../db/connection.js";
import { registerHealthRoute } from "../health.js";
import { scheduleRetentionCleanup } from "../retentionCleanup.js";
import { registerGatewayAuthHook } from "./auth.js";
import { registerChatCompletionsRoute } from "./chatCompletions.js";
import { registerCompletionsRoute } from "./completions.js";
import { registerFilesRoutes } from "./files.js";
import { TokenPerMinuteRateLimiter } from "./rateLimiter.js";

export function buildGatewayServer(config: Config): FastifyInstance {
  const server = Fastify();
  const db = openDatabase(config.databasePath);
  const stopRetentionCleanup = scheduleRetentionCleanup(db);
  server.addHook("onClose", (_instance, done) => {
    stopRetentionCleanup();
    db.close();
    done();
  });

  registerHealthRoute(server);

  const claudeSubprocess = createClaudeSubprocess({ stub: config.claudeSubprocessStub });
  const rateLimiter = new TokenPerMinuteRateLimiter();

  server.register(async (instance) => {
    registerGatewayAuthHook(instance, db);
    registerChatCompletionsRoute(instance, db, claudeSubprocess, rateLimiter);
    registerCompletionsRoute(instance, db, claudeSubprocess, rateLimiter);
    registerFilesRoutes(instance, db, config.uploadsDir);
  });

  return server;
}
