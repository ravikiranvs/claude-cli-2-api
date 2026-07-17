import type Database from "better-sqlite3";

export interface TraceInput {
  gatewayApiKeyId: number | null;
  endpoint: string;
  httpStatus: number;
  requestBody: string;
  responseBody: string | null;
  tokenCount: number | null;
}

export function insertTrace(db: Database.Database, trace: TraceInput): void {
  db.prepare(
    `INSERT INTO traces (gateway_api_key_id, endpoint, http_status, request_body, response_body, token_count)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    trace.gatewayApiKeyId,
    trace.endpoint,
    trace.httpStatus,
    trace.requestBody,
    trace.responseBody,
    trace.tokenCount,
  );
}
