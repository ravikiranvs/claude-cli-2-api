import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { signSessionToken } from "./session.js";

export const SESSION_COOKIE_NAME = "admin_session";
export const LOGIN_PATH = "/login";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

interface LoginBody {
  username?: string;
  password?: string;
}

function safeCompare(a: string, b: string): boolean {
  const hashedA = createHash("sha256").update(a).digest();
  const hashedB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashedA, hashedB);
}

function renderLoginPage(error?: string): string {
  return `<!doctype html>
<html>
<head><title>Admin Console Login</title></head>
<body>
  <h1>Admin Console</h1>
  ${error ? `<p role="alert">${error}</p>` : ""}
  <form method="POST" action="${LOGIN_PATH}">
    <label>Username <input type="text" name="username" /></label>
    <label>Password <input type="password" name="password" /></label>
    <button type="submit">Log in</button>
  </form>
</body>
</html>
`;
}

export function registerLoginRoutes(server: FastifyInstance, config: Config): void {
  server.get(LOGIN_PATH, async (_request, reply) => {
    reply.type("text/html").send(renderLoginPage());
  });

  server.post<{ Body: LoginBody }>(LOGIN_PATH, async (request, reply) => {
    const { username, password } = request.body ?? {};

    const validUsername =
      typeof username === "string" &&
      config.adminUsername.length > 0 &&
      safeCompare(username, config.adminUsername);
    const validPassword =
      typeof password === "string" &&
      config.adminPassword.length > 0 &&
      safeCompare(password, config.adminPassword);

    if (!validUsername || !validPassword) {
      reply.status(401).type("text/html").send(renderLoginPage("Invalid username or password"));
      return;
    }

    const token = signSessionToken(config.adminUsername, config.adminSessionSecret, {
      ttlSeconds: SESSION_TTL_SECONDS,
    });
    reply.setCookie(SESSION_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_TTL_SECONDS,
    });
    reply.redirect("/");
  });
}
