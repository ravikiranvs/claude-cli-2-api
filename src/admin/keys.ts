import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { createApiKey, listActiveApiKeys, revokeApiKey, type GatewayApiKey } from "./apiKeys.js";

export const KEYS_PATH = "/keys";

interface CreateKeyBody {
  name?: string;
  rateLimitTpm?: string;
}

interface RevokeKeyParams {
  id: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderKeysPage(
  keys: GatewayApiKey[],
  options: { createdKey?: { name: string; key: string }; error?: string } = {},
): string {
  const { createdKey, error } = options;

  const createdKeyBanner = createdKey
    ? `<div role="status">
    <p>Key created for "${escapeHtml(createdKey.name)}". Copy it now — it will not be shown again.</p>
    <code>${escapeHtml(createdKey.key)}</code>
  </div>`
    : "";

  const errorBanner = error ? `<p role="alert">${escapeHtml(error)}</p>` : "";

  const rows = keys
    .map(
      (key) => `<tr>
        <td>${escapeHtml(key.name)}</td>
        <td>${key.rateLimitTpm}</td>
        <td>
          <form method="POST" action="${KEYS_PATH}/${key.id}/revoke">
            <button type="submit">Revoke</button>
          </form>
        </td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
<head><title>Gateway API Keys</title></head>
<body>
  <h1>Gateway API Keys</h1>
  ${createdKeyBanner}
  ${errorBanner}
  <form method="POST" action="${KEYS_PATH}">
    <label>Name <input type="text" name="name" /></label>
    <label>Rate Limit (tokens/min) <input type="number" name="rateLimitTpm" /></label>
    <button type="submit">Create key</button>
  </form>
  <table>
    <thead><tr><th>Name</th><th>Rate Limit (tpm)</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
`;
}

export function registerKeysRoutes(server: FastifyInstance, db: Database.Database): void {
  server.addHook("onSend", async (request, reply) => {
    if (request.url.split("?")[0].startsWith(KEYS_PATH)) {
      reply.header("Cache-Control", "no-store");
    }
  });

  server.get(KEYS_PATH, async (_request, reply) => {
    reply.type("text/html").send(renderKeysPage(listActiveApiKeys(db)));
  });

  server.post<{ Body: CreateKeyBody }>(KEYS_PATH, async (request, reply) => {
    const { name, rateLimitTpm } = request.body ?? {};
    const trimmedName = typeof name === "string" ? name.trim() : "";
    const parsedRateLimit = Number(rateLimitTpm);

    if (trimmedName.length === 0 || !Number.isInteger(parsedRateLimit) || parsedRateLimit <= 0) {
      reply
        .status(400)
        .type("text/html")
        .send(
          renderKeysPage(listActiveApiKeys(db), {
            error: "Name and a positive whole-number Rate Limit are required",
          }),
        );
      return;
    }

    const created = createApiKey(db, trimmedName, parsedRateLimit);
    reply
      .type("text/html")
      .send(renderKeysPage(listActiveApiKeys(db), { createdKey: { name: created.name, key: created.key } }));
  });

  server.post<{ Params: RevokeKeyParams }>(`${KEYS_PATH}/:id/revoke`, async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      reply.status(400).send();
      return;
    }

    revokeApiKey(db, id);
    reply.redirect(KEYS_PATH);
  });
}
