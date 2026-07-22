import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { listAllApiKeys, type GatewayApiKey } from "./apiKeys.js";
import { escapeHtml } from "./html.js";
import { registerNoStoreHook } from "./noStore.js";
import { listTraces, type Trace } from "../db/traces.js";

export const TRACES_PATH = "/traces";

interface TracesQuery {
  keyId?: string;
}

function renderTracesPage(
  traces: Trace[],
  keys: GatewayApiKey[],
  selectedKeyId: number | undefined,
): string {
  const keyOptions = [`<option value="">All keys</option>`]
    .concat(
      keys.map(
        (key) =>
          `<option value="${key.id}"${key.id === selectedKeyId ? " selected" : ""}>${escapeHtml(key.name)}</option>`,
      ),
    )
    .join("");

  const rows = traces
    .map(
      (trace) => `<tr>
        <td>${escapeHtml(trace.createdAt)}</td>
        <td>${escapeHtml(trace.gatewayApiKeyName ?? "—")}</td>
        <td>${escapeHtml(trace.endpoint)}</td>
        <td>${trace.httpStatus}</td>
        <td>${trace.tokenCount ?? "—"}</td>
      </tr>
      <tr>
        <td colspan="5">
          <details>
            <summary>Details</summary>
            <p>Request</p>
            <pre>${escapeHtml(trace.requestBody)}</pre>
            <p>Response</p>
            <pre>${escapeHtml(trace.responseBody ?? "")}</pre>
          </details>
        </td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
<head><title>Traces</title></head>
<body>
  <h1>Traces</h1>
  <form method="GET" action="${TRACES_PATH}">
    <label>Gateway API Key
      <select name="keyId">${keyOptions}</select>
    </label>
    <button type="submit">Filter</button>
  </form>
  <table>
    <thead><tr><th>Timestamp</th><th>Gateway API Key</th><th>Endpoint</th><th>Status</th><th>Tokens</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
`;
}

export function registerTracesRoutes(server: FastifyInstance, db: Database.Database): void {
  registerNoStoreHook(server, TRACES_PATH);

  server.get<{ Querystring: TracesQuery }>(TRACES_PATH, async (request, reply) => {
    const rawKeyId = request.query?.keyId?.trim();
    let keyId: number | undefined;

    if (rawKeyId !== undefined && rawKeyId !== "") {
      const parsed = Number(rawKeyId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        reply.status(400).send();
        return;
      }
      keyId = parsed;
    }

    const traces = listTraces(db, keyId !== undefined ? { keyId } : {});
    reply.type("text/html").send(renderTracesPage(traces, listAllApiKeys(db), keyId));
  });
}
