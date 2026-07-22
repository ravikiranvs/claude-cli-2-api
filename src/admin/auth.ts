import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { HEALTH_PATH } from "../health.js";
import { LOGIN_PATH, SESSION_COOKIE_NAME } from "./login.js";
import { verifySessionToken } from "./session.js";

const PUBLIC_PATHS = new Set([HEALTH_PATH, LOGIN_PATH]);

export function registerAuthHook(server: FastifyInstance, config: Config): void {
  server.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (PUBLIC_PATHS.has(path)) return;

    const token = request.cookies[SESSION_COOKIE_NAME];
    const session = token ? verifySessionToken(token, config.adminSessionSecret) : null;

    if (!session) {
      return reply.redirect(LOGIN_PATH);
    }
  });
}
