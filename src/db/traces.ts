import type Database from "better-sqlite3";
import { retentionCutoffIso } from "../retention.js";

export interface TraceInput {
  gatewayApiKeyId: number | null;
  endpoint: string;
  httpStatus: number;
  requestBody: string;
  responseBody: string | null;
  tokenCount: number | null;
}

export interface Trace {
  id: number;
  createdAt: string;
  gatewayApiKeyName: string | null;
  endpoint: string;
  httpStatus: number;
  tokenCount: number | null;
  requestBody: string;
  responseBody: string | null;
}

export interface ListTracesOptions {
  keyId?: number;
  now?: number;
}

interface TraceRow {
  id: number;
  created_at: string;
  gateway_api_key_name: string | null;
  endpoint: string;
  http_status: number;
  token_count: number | null;
  request_body: string;
  response_body: string | null;
}

function toTrace(row: TraceRow): Trace {
  return {
    id: row.id,
    createdAt: row.created_at,
    gatewayApiKeyName: row.gateway_api_key_name,
    endpoint: row.endpoint,
    httpStatus: row.http_status,
    tokenCount: row.token_count,
    requestBody: row.request_body,
    responseBody: row.response_body,
  };
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

export function listTraces(db: Database.Database, options: ListTracesOptions = {}): Trace[] {
  const now = options.now ?? Date.now();
  const cutoff = retentionCutoffIso(now);

  const clauses = ["traces.created_at >= ?"];
  const params: (string | number)[] = [cutoff];

  if (options.keyId !== undefined) {
    clauses.push("traces.gateway_api_key_id = ?");
    params.push(options.keyId);
  }

  const rows = db
    .prepare(
      `SELECT traces.id, traces.created_at, gateway_api_keys.name AS gateway_api_key_name,
              traces.endpoint, traces.http_status, traces.token_count,
              traces.request_body, traces.response_body
       FROM traces
       LEFT JOIN gateway_api_keys ON traces.gateway_api_key_id = gateway_api_keys.id
       WHERE ${clauses.join(" AND ")}
       ORDER BY traces.created_at DESC, traces.id DESC`,
    )
    .all(...params) as TraceRow[];

  return rows.map(toTrace);
}

/** Hard-deletes traces older than the retention window. Returns the number of rows removed. */
export function deleteExpiredTraces(db: Database.Database, now: number = Date.now()): number {
  const cutoff = retentionCutoffIso(now);
  const result = db.prepare("DELETE FROM traces WHERE created_at < ?").run(cutoff);
  return result.changes;
}
