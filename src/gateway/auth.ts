import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { hashGatewayApiKey } from "../gatewayApiKeyHash.js";
import { gatewayErrorBody } from "./errorBody.js";

declare module "fastify" {
  interface FastifyRequest {
    gatewayApiKeyId?: number;
    gatewayApiKeyRateLimitTpm?: number;
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
  server.decorateRequest("gatewayApiKeyRateLimitTpm", undefined);

  server.addHook("onRequest", async (request, reply) => {
    const key = extractBearerKey(request.headers.authorization);

    if (!key) {
      return reply.status(401).send(gatewayErrorBody("Missing Gateway API Key", "invalid_request_error"));
    }

    const row = db
      .prepare("SELECT id, rate_limit_tpm FROM gateway_api_keys WHERE key_hash = ? AND revoked_at IS NULL")
      .get(hashGatewayApiKey(key)) as { id: number; rate_limit_tpm: number } | undefined;

    if (!row) {
      return reply.status(401).send(gatewayErrorBody("Invalid Gateway API Key", "invalid_request_error"));
    }

    request.gatewayApiKeyId = row.id;
    request.gatewayApiKeyRateLimitTpm = row.rate_limit_tpm;
  });
}
