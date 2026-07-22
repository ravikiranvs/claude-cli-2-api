import type Database from "better-sqlite3";
import type { FastifyReply } from "fastify";
import type { ClaudeSubprocess } from "../claude/types.js";
import { insertTrace } from "../db/traces.js";
import { estimateTokens, extractAssistantText } from "./claudeOutput.js";
import type { TokenPerMinuteRateLimiter } from "./rateLimiter.js";
import { sendErrorAndTrace } from "./routeErrors.js";

export interface NonStreamingDispatchParams {
  db: Database.Database;
  claudeSubprocess: ClaudeSubprocess;
  rateLimiter: TokenPerMinuteRateLimiter;
  reply: FastifyReply;
  endpoint: string;
  gatewayApiKeyId: number | null;
  rateLimitTpm: number | null;
  requestBodyJson: string;
  prompt: string;
  buildResponseBody: (assistantText: string, promptTokens: number, completionTokens: number) => unknown;
}

/**
 * Shared non-streaming request path: rate-limit admission, Claude Subprocess dispatch, output
 * extraction, and Trace-writing. Used by both /v1/chat/completions (non-streaming) and the
 * legacy /v1/completions endpoint so both go through identical auth, dispatch, and
 * Trace-writing behavior — only prompt construction and response shape differ per caller.
 */
export async function dispatchNonStreamingCompletion(params: NonStreamingDispatchParams): Promise<void> {
  const {
    db,
    claudeSubprocess,
    rateLimiter,
    reply,
    endpoint,
    gatewayApiKeyId,
    rateLimitTpm,
    requestBodyJson,
    prompt,
    buildResponseBody,
  } = params;

  const sendError = (httpStatus: number, message: string, type: string): void => {
    sendErrorAndTrace(reply, db, endpoint, gatewayApiKeyId, requestBodyJson, httpStatus, message, type);
  };

  // Captured once so a request's prompt and completion tokens are always charged to the
  // same rate-limit window, even if the Claude Subprocess call straddles a minute boundary.
  const rateLimitNow = Date.now();
  const promptTokens = estimateTokens(prompt);

  if (
    gatewayApiKeyId !== null &&
    rateLimitTpm !== null &&
    !rateLimiter.tryConsume(gatewayApiKeyId, rateLimitTpm, promptTokens, rateLimitNow)
  ) {
    sendError(
      429,
      `Rate limit exceeded: this Gateway API Key is limited to ${rateLimitTpm} tokens per minute`,
      "rate_limit_error",
    );
    return;
  }

  let raw: string;
  try {
    raw = (await claudeSubprocess.send(prompt)).raw;
  } catch (err) {
    sendError(502, `Claude Subprocess failed: ${err instanceof Error ? err.message : String(err)}`, "api_error");
    return;
  }

  let assistantText: string;
  try {
    assistantText = extractAssistantText(raw);
  } catch (err) {
    sendError(
      502,
      `Claude Subprocess returned an unparseable response: ${err instanceof Error ? err.message : String(err)}`,
      "api_error",
    );
    return;
  }

  const completionTokens = estimateTokens(assistantText);
  if (gatewayApiKeyId !== null) {
    rateLimiter.record(gatewayApiKeyId, completionTokens, rateLimitNow);
  }

  const responseBody = buildResponseBody(assistantText, promptTokens, completionTokens);
  insertTrace(db, {
    gatewayApiKeyId,
    endpoint,
    httpStatus: 200,
    requestBody: requestBodyJson,
    responseBody: JSON.stringify(responseBody),
    tokenCount: promptTokens + completionTokens,
  });
  reply.status(200).send(responseBody);
}
