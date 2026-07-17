import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { hashGatewayApiKey } from "../gatewayApiKeyHash.js";
import { gatewayErrorBody } from "./errorBody.js";

declare module "fastify" {
  interface FastifyRequest {
    gatewayApiKeyId?: number;
  }
}

const BEARER_PREFIX = "Bearer ";

function extractBearerKey(header: string | undefined): string | null {
  if (!header?.startsWith(BEARER_PREFIX)) return null;
  const key = header.slice(BEARER_PREFIX.length).trim();
  return key.length > 0 ? key : null;
}

export function registerGatewayAuthHook(server: FastifyInstance, db: Database.Database): void {
  server.decorateRequest("gatewayApiKeyId", undefined);

  server.addHook("onRequest", async (request, reply) => {
    const key = extractBearerKey(request.headers.authorization);

    if (!key) {
      reply.status(401).send(gatewayErrorBody("Missing Gateway API Key", "invalid_request_error"));
      return;
    }

    const row = db
      .prepare("SELECT id FROM gateway_api_keys WHERE key_hash = ? AND revoked_at IS NULL")
      .get(hashGatewayApiKey(key)) as { id: number } | undefined;

    if (!row) {
      reply.status(401).send(gatewayErrorBody("Invalid Gateway API Key", "invalid_request_error"));
      return;
    }

    request.gatewayApiKeyId = row.id;
  });
}
