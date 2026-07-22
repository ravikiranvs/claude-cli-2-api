import type Database from "better-sqlite3";
import type { FastifyReply } from "fastify";
import { insertTrace } from "../db/traces.js";
import { gatewayErrorBody } from "./errorBody.js";

/**
 * Builds an OpenAI-format error body, writes a Trace row for it, and sends the HTTP response —
 * the single place every Gateway route emits an error so error Traces look alike across routes.
 */
export function sendErrorAndTrace(
  reply: FastifyReply,
  db: Database.Database,
  endpoint: string,
  gatewayApiKeyId: number | null,
  requestBodyJson: string,
  httpStatus: number,
  message: string,
  type: string,
): void {
  const body = gatewayErrorBody(message, type);
  insertTrace(db, {
    gatewayApiKeyId,
    endpoint,
    httpStatus,
    requestBody: requestBodyJson,
    responseBody: JSON.stringify(body),
    tokenCount: null,
  });
  reply.status(httpStatus).send(body);
}
